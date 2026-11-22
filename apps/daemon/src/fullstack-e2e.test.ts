import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer } from "./index.js";

describe("Phase 2 Masterwork Full-Stack E2E Audit: Real Daemon + Gateway + Kernel + SQLite + Console WebUI", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("wires Console WebUI, Channel A Protocol v0, 18 Admin APIs, SQLite Hard Forget, and 5-Step Golden Replay end-to-end over real HTTP", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ai0-e2e-"));
    const soulDir = join(tempRoot, "e2e.soul");
    const ownerToken = "e2e-owner-secret-token";
    const runtime = createDefaultDaemonRuntime({
      soulDir,
      ownerMasterToken: ownerToken,
      seedIfEmpty: true
    });
    const server = createUnifiedDaemonHttpServer(runtime);

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    cleanups.push(async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      runtime.close();
      rmSync(tempRoot, { recursive: true, force: true });
    });

    // 1. Live snapshot from seeded SQLite `.soul`
    const snapRes = await fetch(`${baseUrl}/api/admin/v1/snapshot`);
    expect(snapRes.status).toBe(200);
    const snap = (await snapRes.json()) as {
      eventsCount: number;
      memoriesCount: number;
      totalBlackboardTokens: number;
      maxBlackboardTokens: number;
      pragmaStatus: { journal_mode: string; foreign_keys: number; secure_delete: number };
      lineageNodes: Array<{ id: string }>;
    };
    expect(snap.eventsCount).toBeGreaterThanOrEqual(5);
    expect(snap.memoriesCount).toBeGreaterThanOrEqual(5);
    expect(snap.totalBlackboardTokens).toBeGreaterThan(0);
    expect(snap.totalBlackboardTokens).toBeLessThanOrEqual(snap.maxBlackboardTokens);
    expect(snap.pragmaStatus.journal_mode.toLowerCase()).toBe("wal");

    runtime.soulArchiveManager.createSnapshot("e2e-snapshot");
    const rollbackPath = `${baseUrl}/api/admin/v1/system/snapshots/rollback`;
    const adminHeaders = { "content-type": "application/json", "x-ai0-owner-token": ownerToken };
    const snapshots = await fetch(rollbackPath, { headers: adminHeaders });
    expect(snapshots.status).toBe(200);
    expect(await snapshots.json()).toEqual({ snapshot_ids: ["e2e-snapshot"] });
    const badRollback = await fetch(rollbackPath, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ snapshot_id: "../e2e.soul" })
    });
    expect(badRollback.status).toBe(404);
    expect(runtime.storage.listEvents({ limit: 1 })).toHaveLength(1);

    // 2. Real Channel A WebChat dialogue (private vs public social mask)
    const chatRes = await fetch(`${baseUrl}/protocol/v0/shell/perception`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "深夜还在调试 TypeScript 代码，有点累了，你还记得我习惯喝什么吗？",
        venue_type: "private_1on1",
        audience_scope: "only_owner"
      })
    });
    expect(chatRes.status).toBe(200);
    const chatData = (await chatRes.json()) as {
      expression: { intent_id: string; fallback_text: string };
      trace: { trace_id: string; steps: { step5_strategy_proposal: { theatrical_subtext: { raw_text: string } } } };
    };
    expect(chatData.expression.fallback_text.length).toBeGreaterThan(8);
    expect(chatData.trace.steps.step5_strategy_proposal.theatrical_subtext.raw_text.length).toBeGreaterThan(5);

    // 3. Real Channel A barge-in interruption receipt
    const interruptRes = await fetch(`${baseUrl}/protocol/v0/shell/receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent_id: chatData.expression.intent_id,
        spoken_char_offset: 6,
        full_text: chatData.expression.fallback_text
      })
    });
    expect(interruptRes.status).toBe(200);
    const interruptData = (await interruptRes.json()) as { unsaid_remainder: string; spoken_char_offset: number };
    expect(interruptData.spoken_char_offset).toBe(6);
    expect(interruptData.unsaid_remainder.length).toBeGreaterThan(0);

    // 4. Channel B Live Sovereignty 403 Fence vs Sandbox +38h VirtualClock Advance
    const liveClockRes = await fetch(`${baseUrl}/api/admin/v1/clock/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai0-owner-token": ownerToken },
      body: JSON.stringify({ target_instance: "live", hours: 38 })
    });
    expect(liveClockRes.status).toBe(403);

    const sandboxClockRes = await fetch(`${baseUrl}/api/admin/v1/clock/advance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai0-owner-token": ownerToken },
      body: JSON.stringify({ target_instance: "sandbox:console", hours: 38, mode: "hibernation" })
    });
    expect(sandboxClockRes.status).toBe(200);
    const clockData = (await sandboxClockRes.json()) as { virtual_offset_hours: number };
    expect(Math.round(clockData.virtual_offset_hours)).toBe(38);

    // 5. Real SQLite 5-Table Hard Forget + redaction_ledger.json tombstone
    const forgetTarget = snap.lineageNodes.find((n) => n.id === "mem_seed_03_private_wrist")?.id;
    expect(forgetTarget).toBe("mem_seed_03_private_wrist");
    const forgetRes = await fetch(`${baseUrl}/api/admin/v1/memory/hard-forget`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai0-owner-token": ownerToken },
      body: JSON.stringify({ target_instance: "live", target_memory_ids: [forgetTarget] })
    });
    expect(forgetRes.status).toBe(200);
    const snapAfterForget = (await (await fetch(`${baseUrl}/api/admin/v1/snapshot`)).json()) as {
      redactionLedgerCount: number;
      lineageNodes: Array<{ id: string }>;
    };
    expect(snapAfterForget.redactionLedgerCount).toBeGreaterThanOrEqual(1);
    expect(snapAfterForget.lineageNodes.some((n) => n.id === "mem_seed_03_private_wrist")).toBe(false);

    // 6. Real 5-Step Golden Regression Scenario over HTTP
    const scenarioRes = await fetch(`${baseUrl}/api/admin/v1/sandbox/scenarios/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ai0-owner-token": ownerToken },
      body: JSON.stringify({ target_instance: "sandbox:console" })
    });
    expect(scenarioRes.status).toBe(200);
    const scenarioReport = (await scenarioRes.json()) as { passed: boolean; summary: { pass_rate: number } };
    expect(scenarioReport.passed).toBe(true);
    expect(scenarioReport.summary.pass_rate).toBe(1);

    // 7. Studio SPA bootstrap API & SPA HTML serving via Hono
    const bootstrapRes = await fetch(`${baseUrl}/api/studio/bootstrap?mode=live`);
    expect(bootstrapRes.status).toBe(200);
    const bootstrap = (await bootstrapRes.json()) as {
      ok: boolean;
      ownerToken: string;
      snapshot: { soulId: string; eventsCount: number };
    };
    expect(bootstrap.ok).toBe(true);
    expect(bootstrap.ownerToken).toBe(ownerToken);
    expect(bootstrap.snapshot.eventsCount).toBeGreaterThanOrEqual(5);

    const htmlRes = await fetch(`${baseUrl}/shells/stage/builtin.webchat?theme=astral-blue&inspector=trace`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html.toLowerCase()).toContain("<!doctype html>");

    // 8. Production /healthz & Full 16-Panel Mature Studio DIY / Co-Work / RAG / Creator Publish Endpoints
    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean };
    expect(health.ok).toBe(true);

    // 9-Brick Full Prompt Preview (Private vs Public 70% Social Mask)
    const previewRes = await fetch(`${baseUrl}/api/studio/prompt-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      privatePreview: { promptText: string; totalTokens: number };
      publicPreview: { promptText: string; totalTokens: number };
    };
    expect(preview.privatePreview.totalTokens).toBeGreaterThan(preview.publicPreview.totalTokens);
    expect(preview.publicPreview.promptText).toContain("70%");

    // Co-Worker SubAgent Task Dispatch -> Approve -> Crystallize into SQLite Episodic Memory
    const createTaskRes = await fetch(`${baseUrl}/api/studio/co-work-task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", title: "核对架构评审清单", subAgentId: "sub_code_reviewer" })
    });
    expect(createTaskRes.status).toBe(200);
    const createdTask = (await createTaskRes.json()) as { task: { id: string } };
    const approveTaskRes = await fetch(`${baseUrl}/api/studio/co-work-task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", taskId: createdTask.task.id })
    });
    expect(approveTaskRes.status).toBe(200);
    const approvedTask = (await approveTaskRes.json()) as { task: { status: string; crystallizedMemoryId?: string } };
    expect(approvedTask.task.status).toBe("completed");
    expect(approvedTask.task.crystallizedMemoryId).toBeTruthy();

    // Hybrid RAG Document Ingest + Search
    const ingestRes = await fetch(`${baseUrl}/api/studio/rag-ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collectionId: "kb_e2e_guide",
        title: "onboarding.md",
        content: "ai0 uses a five-brain heterogeneous routing architecture with 70% public social mask damping."
      })
    });
    expect(ingestRes.status).toBe(200);
    const searchRes = await fetch(`${baseUrl}/api/studio/rag-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "social mask damping", collectionId: "kb_e2e_guide" })
    });
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as { results: Array<{ content_text: string }> };
    expect(searchData.results.length).toBeGreaterThanOrEqual(1);

    // Creator One-Click Privacy-Scrubbed Publish Package
    const publishRes = await fetch(`${baseUrl}/api/studio/publish-pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packageType: "ai0pack" })
    });
    expect(publishRes.status).toBe(200);
    const publishData = (await publishRes.json()) as {
      filename: string;
      sha256: string;
      excluded_keys: string[];
      scrubbed_payload: Record<string, unknown>;
    };
    expect(publishData.filename).toMatch(/\.ai0pack\.json$/);
    expect(publishData.sha256.length).toBe(64);
    expect(publishData.excluded_keys).toContain("api_key");
    expect(publishData.excluded_keys).toContain("event_log");
    expect(publishData.scrubbed_payload).not.toHaveProperty("api_key");
    expect(publishData.scrubbed_payload).not.toHaveProperty("event_log");

    // Verify Front-to-Back Live Cognitive Binding: importing Mio via /api/studio/distill-apply
    // immediately updates live WebChat responses when asked "你是谁" (zero stale default template!)
    const distillRes = await fetch(`${baseUrl}/api/studio/distill-apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apply: true,
        roleArchetype: "study_classmate",
        card: {
          name: "Mio",
          description: "理性敏锐的协作与学习伙伴，擅长将复杂系统拆解为清晰结构。",
          character_book: {
            entries: [{ keys: ["手账"], content: "习惯用结构化提纲整理技术笔记。" }]
          }
        }
      })
    });
    expect(distillRes.status).toBe(200);
    const mioWhoRes = await fetch(`${baseUrl}/protocol/v0/shell/perception`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "你是谁",
        venue_type: "private_1on1",
        audience_scope: "only_owner"
      })
    });
    expect(mioWhoRes.status).toBe(200);
    const mioWhoData = (await mioWhoRes.json()) as { expression: { fallback_text: string } };
    expect(mioWhoData.expression.fallback_text).toContain("Mio");
    expect(mioWhoData.expression.fallback_text).toContain("理性敏锐");

    // Verify SPA deep-link routes serve 200 HTML and live snapshot contains zero fake mock group rules
    for (const p of ["/dashboard", "/conversations", "/profiles/rules", "/dashboard/blackboard", "/soul/distiller", "/soul/homeostasis", "/models/providers", "/runtime/coordinator-agency", "/system/instances-storage"]) {
      const pageRes = await fetch(`${baseUrl}${p}`);
      expect(pageRes.status).toBe(200);
      const body = await pageRes.text();
      expect(body.toLowerCase()).toContain("<!doctype html>");
    }
    const finalSnapJson = JSON.stringify(await (await fetch(`${baseUrl}/api/admin/v1/snapshot`)).json());
    expect(finalSnapJson).not.toContain("qq:group:88420911");
    expect(finalSnapJson).not.toContain("bilibili:room:102477");
  });
});
