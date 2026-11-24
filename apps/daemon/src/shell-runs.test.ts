import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer } from "./index.js";

it("streams persisted generic shell turns via /protocol/v0/shell/* and enforces ScopedCapabilityToken privacy fences", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-shell-runs-"));
  const ownerToken = "shell-runs-test-owner";
  const runtime = createDefaultDaemonRuntime({
    soulDir: join(root, "test.soul"),
    ownerMasterToken: ownerToken,
    seedIfEmpty: true
  });
  const server = createUnifiedDaemonHttpServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${baseUrl}/protocol/v0/shell`;
  const shellId = "community.stage.example";
  const ownerHeaders = { "x-ai0-owner-token": ownerToken, "content-type": "application/json" };
  const scopedToken = runtime.shellGateway.issueScopedCapabilityToken(
    {
      shell_id: shellId,
      max_audience_privacy_ceiling: "only_owner",
      allowed_modalities: ["text", "typing_activity"],
      expires_at_ts_ms: Date.now() + 60_000
    },
    ownerToken
  );
  const scopedHeaders = { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" };
  const requestId = "6f3d4cde-0773-48a0-884d-ea2b547e99b4";
  const eventId = `evt_shell_${requestId}`;
  const text = "深夜写代码有些累。请提醒我喝杯水，并告诉我你还记得我常喝什么。";
  const post = (path: string, body: object, headers = scopedHeaders) => fetch(url + path, {
    method: "POST", headers, body: JSON.stringify(body)
  });

  try {
    expect((await fetch(url + "/history")).status).toBe(401);
    expect((await post("/runs", { requestId, mode: "wrong", text })).status).toBe(400);
    const generate = runtime.workers.w1.runTurnAsync.bind(runtime.workers.w1);
    vi.spyOn(runtime.workers.w1, "runTurnAsync").mockImplementationOnce(async (input, options) => {
      const turn = await generate(input, options);
      options?.onReasoning?.("可展示摘要");
      return { ...turn, provider: { name: "test", model: "test-model" },
        usage: { inputTokens: 12000, contextWindow: 128000, cachedInputTokens: 9000 } };
    });
    const response = await post("/runs", { requestId, mode: "live", text });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ai0-protocol-stream")).toBe("v0");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const raw = await response.text();
    const events = raw.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    const stages = events.filter((frame) => frame.type === "data-turn-stage").map((frame) => frame.data.stage);
    expect(stages).toEqual(["accepted", "gate", "recall", "blackboard", "generating", "committed", "delivering"]);
    const firstReasoning = events.findIndex(frame => frame.type === "data-turn-reasoning");
    expect(firstReasoning).toBeGreaterThan(-1);
    expect(firstReasoning).toBeLessThan(events.findIndex(frame => frame.type === "text-delta"));
    const process = { reasoning: "可展示摘要", usage: { inputTokens: 12000, cachedInputTokens: 9000 },
      provider: { name: "test", model: "test-model" }, stages: stages.map(stage => ({ stage })) };
    const deltas = events.filter((frame) => frame.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    const generated = deltas.map((frame) => frame.delta).join("");
    expect(generated.length).toBeGreaterThan(18);
    expect(raw).not.toContain("theatrical_subtext");
    expect(raw).not.toContain("compiled_prompt_text");
    expect(raw).toContain("data: [DONE]");

    const trace = runtime.storage.getDecisionTraceByEvent(eventId);
    expect(trace?.steps.step7_emitted_intent.fallback_text).toBe(generated);
    expect(trace?.steps.step8_delivery_receipt).toBeNull();
    expect((await fetch(url + `/runs/${requestId}?mode=sandbox`, { headers: scopedHeaders })).status).toBe(404);
    const status = await fetch(url + `/runs/${requestId}?mode=live`, { headers: scopedHeaders });
    expect(await status.json()).toMatchObject({ requestId, shellId, status: "delivering", deliveryFinished: true, text: generated, process });

    // Channel A zero-backdoor fence: ScopedCapabilityToken MUST NOT access Channel B VerifiableTurnTrace!
    expect((await fetch(url + `/runs/${requestId}/trace?mode=live`)).status).toBe(401);
    expect((await fetch(url + `/runs/${requestId}/trace?mode=live`, { headers: scopedHeaders })).status).toBe(401);
    const traceResponse = await fetch(
      url + `/runs/${requestId}/trace?mode=live&shellId=${encodeURIComponent(shellId)}`,
      { headers: ownerHeaders }
    );
    expect(traceResponse.status).toBe(200);
    expect(await traceResponse.json()).toMatchObject({ trace: { trace_id: trace?.trace_id } });

    expect((await post(`/runs/${requestId}/receipt`, { mode: "live", spokenCharOffset: 0 })).status).toBe(400);
    const receipt = await post(`/runs/${requestId}/receipt`, { mode: "live", spokenCharOffset: Array.from(generated).length });
    expect(await receipt.json()).toMatchObject({ status: "completed", receipt: { status: "completed" } });
    const recorded = await fetch(url + "/history?mode=live", { headers: scopedHeaders });
    expect((await recorded.json()).turns.find((turn: { requestId: string }) => turn.requestId === requestId))
      .toMatchObject({ process });
    const eventCount = runtime.storage.listEvents().length;
    const traceCount = runtime.storage.listDecisionTraces().length;
    const replay = await post("/runs", { requestId, mode: "live", text });
    expect(await replay.text()).toContain(`"traceId":"${trace?.trace_id}"`);
    expect(runtime.storage.listEvents()).toHaveLength(eventCount);
    expect(runtime.storage.listDecisionTraces()).toHaveLength(traceCount);
    expect((await post("/runs", { requestId, mode: "live", text: "不同内容" })).status).toBe(409);

    const sandbox = await post("/runs", { requestId, mode: "sandbox", text });
    expect(sandbox.status).toBe(200);
    await sandbox.text();
    const stop = await post(`/runs/${requestId}/stop`, { mode: "sandbox", spokenCharOffset: 0 });
    expect(await stop.json()).toMatchObject({
      status: "interrupted", text: "", receipt: { status: "interrupted", spokenCharOffset: 0 }
    });
    const repeated = await post(`/runs/${requestId}/stop`, { mode: "sandbox", spokenCharOffset: 2 });
    expect(await repeated.json()).toMatchObject({ receipt: { spokenCharOffset: 0 } });
    const history = await fetch(url + "/history?mode=sandbox", { headers: scopedHeaders });
    expect(await history.json()).toMatchObject({
      shellId,
      turns: expect.arrayContaining([expect.objectContaining({
        requestId, assistantText: "", targetInstance: "sandbox:console"
      })])
    });
    await post("/clear", { mode: "live" });
    expect(runtime.storage.listDecisionTraces()).toHaveLength(traceCount);

    const publicTurn = await runtime.handleShellTurn({
      shell_id: shellId,
      text: "直播间公开演示，和观众打个招呼。",
      audience_scope: "public_all",
      venue_type: "public_livestream"
    });
    const privateHistory = await fetch(url + "/history?mode=live", { headers: scopedHeaders });
    expect((await privateHistory.json()).turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: publicTurn.event_id })
    ]));

    const streamingId = "25adfcc0-0445-4f53-9001-e578fe9beec4";
    const originalGeneration = runtime.workers.w1.runTurnAsync.bind(runtime.workers.w1);
    const longReply = "风停了，我们继续。".repeat(250);
    const longGeneration = vi.spyOn(runtime.workers.w1, "runTurnAsync").mockImplementationOnce(async (...args) => {
      const turn = await originalGeneration(...args);
      turn.expression.fallback_text = longReply;
      turn.trace.steps.step7_emitted_intent.fallback_text = longReply;
      return turn;
    });
    const delivering = await post("/runs", { requestId: streamingId, mode: "live", text });
    const deliveryReader = delivering.body!.getReader();
    const decoder = new TextDecoder();
    let delivered = "";
    while (!delivered.includes('"type":"text-delta"')) {
      const part = await deliveryReader.read();
      if (part.done) break;
      delivered += decoder.decode(part.value, { stream: true });
    }
    expect(delivered).toContain('"type":"text-delta"');
    const activeHistory = await fetch(url + "/history?mode=live", { headers: scopedHeaders });
    expect((await activeHistory.json()).turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: streamingId })
    ]));
    const activeTrace = await fetch(
      url + `/runs/${streamingId}/trace?mode=live&shellId=${encodeURIComponent(shellId)}`,
      { headers: ownerHeaders }
    );
    expect(activeTrace.status).toBe(409);
    await deliveryReader.cancel();
    await vi.waitFor(async () => {
      const archivedHistory = await fetch(url + "/history?mode=live", { headers: scopedHeaders });
      expect((await archivedHistory.json()).turns).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestId: streamingId, assistantText: "", generatedText: longReply, deliveryStatus: "unknown" })
      ]));
    });
    longGeneration.mockRestore();

    const pendingId = "91d7b2bf-783a-4c56-b2c3-8ff6a3a1553d";
    const generation = vi.spyOn(runtime.workers.w1, "runTurnAsync").mockImplementation(
      async (_input, options) => {
        options?.onStage?.("generating");
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      }
    );
    const pending = await post("/runs", { requestId: pendingId, mode: "live", text });
    const pendingBody = pending.text();
    expect((await post("/runs", { requestId: pendingId, mode: "live", text })).status).toBe(409);
    const cancel = await post(`/runs/${pendingId}/stop`, { mode: "live", spokenCharOffset: 0 });
    expect(await cancel.json()).toMatchObject({ status: "cancelled" });
    const cancelledStream = await pendingBody;
    expect(cancelledStream).toContain('"status":"cancelled"');
    expect(cancelledStream).not.toContain('"type":"text-delta"');
    const cancelled = await fetch(url + `/runs/${pendingId}?mode=live`, { headers: scopedHeaders });
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
    expect(runtime.storage.getDecisionTraceByEvent(`evt_shell_${pendingId}`)).toBeUndefined();

    const disconnectedId = "7d5a2e97-0337-4feb-9687-2eb50aa40d21";
    const disconnected = await post("/runs", { requestId: disconnectedId, mode: "live", text });
    await disconnected.body?.cancel();
    await vi.waitFor(async () => {
      const state = await fetch(url + `/runs/${disconnectedId}?mode=live`, { headers: scopedHeaders });
      expect(await state.json()).toMatchObject({ status: "cancelled" });
    });
    generation.mockRestore();

    const stranger = runtime.shellGateway.issueScopedCapabilityToken({
      shell_id: shellId, principal_id: "another-user", max_audience_privacy_ceiling: "only_owner",
      allowed_modalities: ["text"], expires_at_ts_ms: Date.now() + 60_000
    }, ownerToken);
    const otherHeaders = { authorization: "Bearer " + stranger };
    expect((await fetch(url + "/runs/" + requestId + "?mode=live", { headers: otherHeaders })).status).toBe(404);
    expect((await (await fetch(url + "/history?mode=live", { headers: otherHeaders })).json()).turns).toEqual([]);

    expect(runtime.storage.getShellRunProcess(eventId)?.reasoning).toBe("可展示摘要");
    runtime.storage.sqlite.prepare("UPDATE event_log SET redacted_at_ts_ms=? WHERE event_id=?").run(Date.now(), eventId);
    expect(runtime.storage.getShellRunProcess(eventId)).toBeUndefined();
    expect((await fetch(url + "/runs/" + requestId + "?mode=live", { headers: scopedHeaders })).status).toBe(404);
  } finally {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

it("discovers out-of-tree community plugins and serves only compiled dist assets safely", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-ext-plugins-"));
  const externalPluginsRoot = join(root, "community-plugins");
  const pluginDir = join(externalPluginsRoot, "my-live2d-stage");
  mkdirSync(join(pluginDir, "dist", "ui"), { recursive: true });
  writeFileSync(join(pluginDir, "package.json"), JSON.stringify({ name: "community-live2d-stage", version: "1.0.0" }));
  writeFileSync(
    join(pluginDir, "ai0.extension.json"),
    JSON.stringify({
      manifest_version: "1.1.0",
      extension_id: "community.live2d.stage",
      display_name: "Community Live2D Stage",
      version: "0.2.0",
      author: "external-creator",
      carrier_kind: "native_code_plugin",
      dimension: "ext.shell",
      entry: "./dist/index.js",
      permissions: {
        read_blackboard_domains: ["D1_WORKING_TURN"],
        propose_mutation_domains: [],
        max_audience_scope: "only_owner",
        network_access: false
      },
      console_contributions: {
        ui_slots: [
          {
            slot_target: "slot.shells.mounted_stage",
            widget_type: "web_stage_module",
            title: "Live2D Stage",
            route_path: "/shells/stage/community.live2d.stage",
            shell_id: "community.live2d.default",
            entry_module: "./dist/ui/stage.js",
            style_sheets: ["./dist/ui/stage.css"]
          }
        ]
      }
    })
  );
  writeFileSync(join(pluginDir, "dist", "ui", "stage.js"), "export function mountShellStage() { return () => {}; }\n");
  writeFileSync(join(pluginDir, "dist", "ui", "stage.css"), ".community-stage { display: grid; }\n");

  const ownerToken = "ext-owner-token";
  const runtime = createDefaultDaemonRuntime({
    soulDir: join(root, "test.soul"),
    ownerMasterToken: ownerToken,
    seedIfEmpty: true,
    extraPluginDirs: [externalPluginsRoot]
  });
  const server = createUnifiedDaemonHttpServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const manifestRes = await fetch(`${baseUrl}/api/plugins/community.live2d.stage/manifest`);
    expect(manifestRes.status).toBe(200);
    const manifestBody = (await manifestRes.json()) as {
      plugin: {
        extension_id: string;
        origin: string;
        ui_slots: Array<{ entry_module_url?: string; style_sheet_urls?: string[] }>;
      };
    };
    expect(manifestBody.plugin.extension_id).toBe("community.live2d.stage");
    expect(manifestBody.plugin.origin).toBe("external");
    const entryUrl = manifestBody.plugin.ui_slots[0]?.entry_module_url;
    expect(entryUrl).toBe("/api/plugins/community.live2d.stage/assets/dist/ui/stage.js");

    const jsRes = await fetch(`${baseUrl}${entryUrl}`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("text/javascript");
    expect(await jsRes.text()).toContain("mountShellStage");

    // Must block reading files outside dist/ (e.g., package.json or traversal)
    const leakRes = await fetch(`${baseUrl}/api/plugins/community.live2d.stage/assets/..%2Fpackage.json`);
    expect(leakRes.status).toBe(404);
    const directPkgRes = await fetch(`${baseUrl}/api/plugins/community.live2d.stage/assets/package.json`);
    expect(directPkgRes.status).toBe(404);

    const config = (await runtime.buildConsoleLiveSnapshot()).studioConfig!;
    await fetch(baseUrl + "/api/studio/config", { method: "POST",
      headers: { "x-ai0-owner-token": ownerToken, "content-type": "application/json" },
      body: JSON.stringify({ ecosystem: { plugins: config.ecosystem.plugins.map(plugin =>
        plugin.id === "community.live2d.stage" ? { ...plugin, enabled: true } : plugin) } }) });
    // Stage token endpoint issues a shell-scoped capability token bound to community.live2d.default
    const tokenRes = await fetch(`${baseUrl}/api/plugins/community.live2d.stage/stage-token`, {
      method: "POST",
      headers: { "x-ai0-owner-token": ownerToken }
    });
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as { shellId: string; token: string };
    expect(tokenData.shellId).toBe("community.live2d.default");
    const verified = runtime.shellGateway.verifyScopedCapabilityToken(tokenData.token, ownerToken);
    expect(verified.shell_id).toBe("community.live2d.default");
  } finally {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
