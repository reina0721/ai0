import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import {
  CoordinatorStorageMutator,
  listKnowledgeCollections,
  readHostInfrastructureConfig,
  readSoulProfileConfig,
  writeHostInfrastructureConfig,
  writeSoulProfileConfig
} from "@ai0/storage";
import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer } from "./index.js";
import {
  allowedCollections,
  importKnowledge,
  readKnowledgePages,
  searchKnowledge
} from "./knowledge-service.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function setup(allowDeterministicSandbox = false) {
  const root = mkdtempSync(join(tmpdir(), "ai0-rag-test-"));
  const runtime = createDefaultDaemonRuntime({
    soulDir: join(root, "owner.soul"),
    ownerMasterToken: "owner-test",
    allowDeterministicSandbox
  });
  cleanups.push(() => {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  });
  runtime.storage.sqlite.prepare("INSERT INTO knowledge_collections(id,name) VALUES('manual','手册')").run();
  const cfg = readSoulProfileConfig(runtime.soulDir);
  writeSoulProfileConfig(runtime.soulDir, {
    ...cfg,
    routingRules: [],
    profiles: cfg.profiles.map((p) => ({
      ...p,
      knowledgeCollectionIds: ["manual"]
    })),
    capabilities: {
      ...cfg.capabilities,
      knowledge: { ...cfg.capabilities.knowledge, embeddingBinding: undefined, rerankBinding: undefined }
    }
  });
  return runtime;
}

// Small, valid multi-page PDF with reproducible byte offsets and selectable text.
function pdfFixture(pages: string[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count " +
      pages.length +
      " /Kids [" +
      pages.map((_, i) => 4 + i * 2 + " 0 R").join(" ") +
      "] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  pages.forEach((text, i) => {
    const stream = "BT /F1 12 Tf 40 700 Td (" + text + ") Tj ET";
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents " +
        (5 + i * 2) +
        " 0 R >>",
      "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream"
    );
  });
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += i + 1 + " 0 obj\n" + o + "\nendobj\n";
  });
  const xref = body.length;
  body +=
    "xref\n0 " +
    offsets.length +
    "\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("");
  return Buffer.from(
    body + "trailer\n<< /Size " + offsets.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"
  );
}

it("persists originals, atomically replaces revisions and searches beyond the first hundred chunks", async () => {
  const rt = setup(),
    storage = rt.storage;
  const original = Buffer.from(
    Array.from({ length: 105 }, (_, i) => "# Chapter " + i + "\n常规维护记录").join("\n") +
      "\n# 光学\n望远镜光轴校准代号为白鹭九号。"
  );
  const doc = await importKnowledge(rt, storage, "manual", "维修.md", original, "text");
  expect(doc.chunksCreated).toBeGreaterThan(100);
  expect(listKnowledgeCollections(storage)[0]?.searchableDocuments).toBe(1);
  expect((await importKnowledge(rt, storage, "manual", "另名.md", original, "text")).reused).toBe(true);
  const query = (text: string) => searchKnowledge(rt, storage, text, ["manual"]);
  const hit = await query("光轴校准代号");
  expect(hit.results[0]).toMatchObject({
    documentId: doc.id,
    location: expect.stringContaining("光学"),
    bm25: expect.any(Number),
    denseSim: null
  });
  expect(hit.honestForgetTriggered).toBe(false);
  expect((await query("unfindablefoobar")).results).toEqual([]);
  expect(
    (await query("代号 unfindablefoobar extraneousword excessword anotherword")).honestForgetTriggered
  ).toBe(true);
  await expect(
    importKnowledge(rt, storage, "manual", "坏.pdf", pdfFixture([""]), "pdf", doc.id)
  ).rejects.toThrow("未提取到文字");
  expect((await query("光轴")).results[0]?.documentId).toBe(doc.id);
  const bytes = pdfFixture(["Maintenance manual", "Calibrate with Atlas Prism"]);
  await importKnowledge(rt, storage, "manual", "manual.pdf", bytes, "pdf", doc.id);
  expect((await query("Atlas Prism")).results[0]?.location).toBe("第 2 页");
  expect((await query("光轴")).results).toHaveLength(0);
  const reopened = new CoordinatorStorageMutator(join(rt.soulDir, "state", "soul_core.sqlite"));
  try {
    expect(listKnowledgeCollections(reopened)[0]?.documents).toBe(1);
    const row = reopened.sqlite
      .prepare("SELECT original,revision FROM knowledge_documents WHERE id=?")
      .get(doc.id)!;
    expect(row.revision).toBe(2);
    expect((await readKnowledgePages(row.original as Uint8Array, "pdf"))[1]).toContain("Atlas Prism");
    reopened.sqlite.prepare("UPDATE knowledge_locations SET active=0 WHERE document_id=?").run(doc.id);
    expect(listKnowledgeCollections(reopened)[0]).toMatchObject({ documents: 1, searchableDocuments: 0, chunks: 0 });
  } finally {
    reopened.close();
  }
});

it("preserves old chunk IDs and separates previous counts on an idempotent upgrade", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai0-legacy-rag-")),
    path = join(dir, "old.sqlite");
  const old = new CoordinatorStorageMutator(path);
  old.insertKnowledgeChunk({
    chunk_id: "old-1",
    collection_id: "kb.old",
    document_name: "note.md",
    chunk_index: 0,
    content_text: "迁移后的资料",
    citation_count: 4,
    created_at_ts_ms: 123
  });
  old.close();
  try {
    for (let i = 0; i < 2; i++) {
      const db = new CoordinatorStorageMutator(path);
      try {
        expect(listKnowledgeCollections(db)[0]).toMatchObject({ id: "kb.old", chunks: 1, citations: 0 });
        expect(
          db.sqlite.prepare("SELECT legacy_citations FROM knowledge_locations WHERE chunk_id='old-1'").get()
            ?.legacy_citations
        ).toBe(4);
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reopens a V1 knowledge archive without reactivating retired chunks or resetting citation counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai0-indexed-reopen-"));
  const path = join(dir, "soul_core.sqlite");
  try {
    const previous = new CoordinatorStorageMutator(path);
    try {
      previous.insertKnowledgeChunk({ chunk_id: "retained", collection_id: "manual", document_name: "guide.md",
        chunk_index: 0, content_text: "existing content", citation_count: 7, created_at_ts_ms: 1 });
      listKnowledgeCollections(previous);
      previous.incrementKnowledgeCitation("retained", 2);
      previous.sqlite.prepare("UPDATE knowledge_locations SET active=0 WHERE chunk_id=?").run("retained");
      previous.sqlite.prepare("INSERT INTO knowledge_import_errors VALUES(?,?,?)").run("manual","old.pdf","无法读取");
    } finally { previous.close(); }
    for (let open = 0; open < 2; open++) {
      const storage = new CoordinatorStorageMutator(path);
      try {
        expect(listKnowledgeCollections(storage)).toMatchObject([{id:"manual",documents:1,searchableDocuments:0,chunks:0,citations:1,errors:1}]);
        expect(storage.sqlite.prepare("SELECT active,legacy_citations FROM knowledge_locations WHERE chunk_id='retained'").get())
          .toMatchObject({active:0,legacy_citations:7});
      } finally { storage.close(); }
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

it("uses bound HTTP models, checks evidence in both channel requests and counts acknowledged citations once", async () => {
  const rt = setup(),
    storage = rt.storage;
  const requests: { path: string; body: string }[] = [];
  let failRank = false,
    dimension = 2;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw);
    requests.push({ path: req.url!, body: raw });
    if (req.url?.endsWith("/embeddings")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: data.input.map((_: unknown, index: number) => ({
            index,
            embedding: Array(dimension).fill(0.5)
          }))
        })
      );
      return;
    }
    if (req.url?.endsWith("/rerank")) {
      res.writeHead(failRank ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: [{ index: 0, relevance_score: 0.92 }] }));
      return;
    }
    const content = JSON.stringify({
      surface_utterance: raw.includes("ORCHID-991") ? "ORCHID-991 [K1]" : "没有资料",
      theatrical_subtext: "检查来源",
      chosen_strategy: "answer",
      masked_placeholder: "",
      interaction_frame: "serious_factual",
      vocal_emotion_tag: "neutral",
      facial_expression: "neutral",
      valence_impulse: "none"
    });
    const packet = {
      id: "chunk",
      object: "chat.completion.chunk",
      created: 1,
      model: data.model,
      choices: [{ index: 0, delta: { content }, finish_reason: "stop" }]
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: " + JSON.stringify(packet) + "\n\ndata: [DONE]\n\n");
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  try {
    const url = "http://127.0.0.1:" + (upstream.address() as AddressInfo).port + "/v1";
    const infra = readHostInfrastructureConfig(rt.hostDir);
    writeHostInfrastructureConfig(rt.hostDir, {
      ...infra,
      providerSources: infra.providerSources.map((s) => ({ ...s, baseUrl: url }))
    });
    const cfg = readSoulProfileConfig(rt.soulDir);
    writeSoulProfileConfig(rt.soulDir, {
      ...cfg,
      profiles: cfg.profiles.map(profile => ({
        ...profile, primaryChat: { providerId: "prov_ollama_local", modelId: "qwen2.5:7b-instruct" }
      })),
      capabilities: {
        ...cfg.capabilities,
        knowledge: {
          ...cfg.capabilities.knowledge,
          embeddingBinding: { providerId: "prov_bge_embed", modelId: "bge-m3" },
          rerankBinding: { providerId: "prov_bge_rerank", modelId: "BAAI/bge-reranker-v2-m3" }
        }
      }
    });
    await importKnowledge(
      rt,
      storage,
      "manual",
      "calibration.md",
      Buffer.from("# Calibrate\nThe calibration key is ORCHID-991."),
      "text"
    );
    const query = () => searchKnowledge(rt, storage, "calibration key", ["manual"]);
    expect((await query()).stages).toEqual(["FTS5 BM25", "向量召回", "模型精排"]);
    failRank = true;
    expect((await query()).warnings.join()).toContain("精排不可用");
    failRank = false;
    dimension = 3;
    expect((await query()).warnings.join()).toContain("重建");
    dimension = 2;
    let firstEvent = "";
    for (const channel of ["builtin.webchat", "builtin.terminal.default"]) {
      const turn = await rt.handleChannelTurn({
        channel_id: channel,
        principalId: "owner:local",
        text: "calibration key"
      });
      expect(requests.filter((r) => r.path.endsWith("/chat/completions")).at(-1)?.body).toContain("ORCHID-991");
      expect(turn.sources[0]).toMatchObject({
        title: "calibration.md",
        marker: 1,
        taint_level: "untrusted_external"
      });
      firstEvent ||= turn.event_id;
      for (let i = 0; i < 2; i++)
        rt.commitDelivery("live", turn.event_id, "completed", turn.expression.fallback_text.length);
    }
    expect(listKnowledgeCollections(storage)[0]?.citations).toBe(2);
    const cancel = await rt.handleChannelTurn({ principalId: "owner:local", text: "calibration key" });
    rt.commitDelivery("live", cancel.event_id, "interrupted", 0);
    expect(listKnowledgeCollections(storage)[0]?.citations).toBe(2);
    expect(allowedCollections(storage, ["manual"], "group:one", false)).toEqual([]);
    storage.sqlite.prepare("UPDATE knowledge_collections SET audience='group:one'").run();
    expect(allowedCollections(storage, ["manual"], "group:one", false)).toEqual(["manual"]);
    const groupTurn = await rt.handleChannelTurn({ text: "calibration key", principalId: "guest", audience_scope: "group:one" });
    expect(groupTurn.sources[0]).toMatchObject({ title: "calibration.md", marker: 1 });
    for (const audience of ["group:two", "public_all"] as const) {
      const start = requests.length;
      const turn = await rt.handleChannelTurn({
        text: "calibration key",
        principalId: "guest",
        audience_scope: audience
      });
      expect(turn.sources).toEqual([]);
      expect(
        requests
          .slice(start)
          .map((r) => r.body)
          .join()
      ).not.toContain("ORCHID-991");
    }
    expect(
      (await rt.handleChannelTurn({ text: "calibration key", principalId: "owner:local", mode: "sandbox" }))
        .sources
    ).toEqual([]);
    const daemon = createUnifiedDaemonHttpServer(rt);
    await new Promise<void>((done) => daemon.listen(0, "127.0.0.1", done));
    try {
      const token = rt.channelGateway.issueScopedCapabilityToken(
        {
          channel_id: "builtin.terminal.default",
          principal_id: "owner:local",
          max_audience_privacy_ceiling: "only_owner",
          allowed_modalities: ["text"],
          expires_at_ts_ms: Date.now() + 60_000
        },
        "owner-test"
      );
      const child = spawn(process.execPath, ["plugins/channels/terminal/client.mjs"], {
        windowsHide: true,
        env: {
          ...process.env,
          AI0_URL: "http://127.0.0.1:" + (daemon.address() as AddressInfo).port,
          AI0_CHANNEL_TOKEN: token
        }
      });
      let output = "",
        errors = "";
      child.stdout.on("data", (v) => (output += v));
      child.stderr.on("data", (v) => (errors += v));
      const finished = once(child, "close");
      child.stdin.end("calibration key\n");
      expect((await finished)[0], errors).toBe(0);
      expect(output).toContain("[K1] calibration.md · Calibrate");
      expect(listKnowledgeCollections(storage)[0]?.citations).toBe(3);
    } finally {
      daemon.closeAllConnections();
      await new Promise<void>((done) => daemon.close(() => done()));
    }
    const latest = readSoulProfileConfig(rt.soulDir);
    writeSoulProfileConfig(rt.soulDir, {
      ...latest,
      profiles: latest.profiles.map((p) => ({ ...p, knowledgeCollectionIds: [] }))
    });
    expect(rt.knowledgeSources("live", firstEvent)).toEqual([]);
    const start = requests.length;
    const noMount = await rt.handleChannelTurn({
      channel_id: "builtin.terminal.default",
      text: "calibration key",
      principalId: "owner:local"
    });
    expect(noMount.sources).toEqual([]);
    expect(
      requests
        .slice(start)
        .map((r) => r.body)
        .join()
    ).not.toContain("ORCHID-991");
  } finally {
    await new Promise<void>((done) => upstream.close(() => done()));
  }
});

it("keeps sandbox uploads, profile mounts and source inspection local to their target", async () => {
  const rt = setup(true);
  const path = "/api/admin/v1/capabilities/knowledge/collections";
  async function admin(method: string, suffix: string, target: string, body?: object) {
    return rt.adminServer.handleRequest({
      method,
      path: path + suffix,
      headers: { "x-ai0-owner-token": "owner-test" },
      query: { target_instance: target },
      body
    });
  }
  const sandbox = "sandbox:console";
  const created = await admin("POST", "", sandbox, { name: "沙盒文库" });
  expect(created.status).toBe(200);
  const id = (created.body as { id: string }).id;
  const profile = readSoulProfileConfig(rt.soulDir).defaultProfileId;
  expect(
    (await admin("POST", "/" + id + "/mount", sandbox, { profileId: profile, mounted: true })).status
  ).toBe(200);
  expect(
    (
      await admin("POST", "/" + id + "/import", sandbox, {
        name: "机库.txt",
        content: "滑翔机测试编号为 PT-772。"
      })
    ).status
  ).toBe(200);
  expect((await admin("GET", "/" + id, "live")).status).toBe(404);
  expect((await admin("GET", "/" + id, "sandbox:unknown")).status).toBe(404);
  expect(
    readSoulProfileConfig(rt.soulDir).profiles.find((p) => p.id === profile)?.knowledgeCollectionIds
  ).not.toContain(id);
  const turn = await rt.handleChannelTurn({
    text: "滑翔机测试编号",
    principalId: "owner:local",
    mode: "sandbox"
  });
  expect(turn.sources[0]).toMatchObject({ collectionId: id, title: "机库.txt" });
  await admin("POST", "/" + id + "/mount", sandbox, { profileId: profile, mounted: false });
  expect(rt.knowledgeSources("sandbox", turn.event_id)).toEqual([]);
});
