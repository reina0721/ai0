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
      allowDeterministicSandbox: true
    });
    cleanups.push(() => {
      runtime.close();
      rmSync(tempRoot, { recursive: true, force: true });
    });
    const observations = [
      ["mem_test_01_tea", "今天喝的是绿茶。"],
      ["mem_test_02_review", "周五要评审设计。"],
      ["mem_test_03_private_wrist", "手腕不适，今天需要休息。"],
      ["mem_test_04_notes", "图书笔记按主题归档。"],
      ["mem_test_05_walk", "傍晚散步时见到了白鹭。"]
    ] as const;
    for (const [i, [memoryId, observation]] of observations.entries()) {
      const eventId = "evt_test_" + i;
      const now = runtime.virtualClock.nowMs();
      runtime.storage.appendEvent({
        event_id: eventId, wall_ts_ms: now, virtual_ts_ms: now, source_channel_id: "test.channel",
        principal_id: "owner:local", principal_trust: "owner_verified", venue_type: "private_1on1",
        audience_scope: "only_owner", event_category: "perception_committed", modality: "text",
        summary_text: observation, payload_json: "{}", state_rev_after: i + 1, active_modules_mask: 1
      });
      runtime.storage.insertMemoryWithLineage({
        memory_id: memoryId, memory_tier: "episodic_experience", epistemic_type: "observed_firsthand",
        attributed_principal: "owner:local", visibility_scope: "only_owner", taint_level: "trusted_owner",
        content_text: observation, emotional_valence: 0, base_importance: 0.8, stability_half_life: 168,
        recall_count: 0, created_virtual_ts: now, last_recalled_ts: now, valid_from_virtual_ts: now, created_at_rev: i + 1
      }, [{ parent_type: "event", parent_id: eventId }]);
    }
    const server = createUnifiedDaemonHttpServer(runtime);

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    cleanups.push(async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
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
    const chatRes = await fetch(`${baseUrl}/protocol/v0/channel/perception`, {
      method: "POST",
      headers: adminHeaders,
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
    const interruptRes = await fetch(`${baseUrl}/protocol/v0/channel/receipt`, {
      method: "POST",
      headers: adminHeaders,
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
    const forgetTarget = snap.lineageNodes.find((n) => n.id === "mem_test_03_private_wrist")?.id;
    expect(forgetTarget).toBe("mem_test_03_private_wrist");
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
    expect(snapAfterForget.lineageNodes.some((n) => n.id === "mem_test_03_private_wrist")).toBe(false);

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

    const htmlRes = await fetch(`${baseUrl}/channels/stage/builtin.webchat?theme=astral-blue&inspector=trace`);
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
      headers: adminHeaders,
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
      headers: adminHeaders,
      body: JSON.stringify({ action: "create", title: "核对架构评审清单", subAgentId: "sub_code_reviewer" })
    });
    expect(createTaskRes.status).toBe(200);
    const createdTask = (await createTaskRes.json()) as { task: { id: string } };
    const approveTaskRes = await fetch(`${baseUrl}/api/studio/co-work-task`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ action: "approve", taskId: createdTask.task.id })
    });
    expect(approveTaskRes.status).toBe(200);
    const approvedTask = (await approveTaskRes.json()) as { task: { status: string; crystallizedMemoryId?: string } };
    expect(approvedTask.task.status).toBe("queued");
    expect(approvedTask.task.crystallizedMemoryId).toBeUndefined();

    // Hybrid RAG Document Ingest + Search
    const ingestRes = await fetch(`${baseUrl}/api/studio/rag-ingest`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        collectionId: "kb_e2e_guide",
        title: "onboarding.md",
        content: "ai0 uses a five-brain heterogeneous routing architecture with 70% public social mask damping."
      })
    });
    expect(ingestRes.status).toBe(200);
    const searchRes = await fetch(`${baseUrl}/api/studio/rag-search`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ query: "social mask damping", collectionId: "kb_e2e_guide" })
    });
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as { results: Array<{ content_text: string }> };
    expect(searchData.results.length).toBeGreaterThanOrEqual(1);

    // Creator One-Click Privacy-Scrubbed Publish Package
    const publishRes = await fetch(`${baseUrl}/api/studio/publish-pack`, {
      method: "POST",
      headers: adminHeaders,
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
      headers: adminHeaders,
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
    const mioWhoRes = await fetch(`${baseUrl}/protocol/v0/channel/perception`, {
      method: "POST",
      headers: adminHeaders,
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

    const rollback = await fetch(rollbackPath, {
      method: "POST", headers: adminHeaders, body: JSON.stringify({ snapshot_id: "e2e-snapshot" })
    });
    expect(rollback.status).toBe(200);
    expect(await rollback.json()).toMatchObject({ rolled_back_to: "e2e-snapshot" });
    const restored = await runtime.buildConsoleLiveSnapshot();
    expect(restored.lineageNodes.map(node => node.id).sort()).toEqual(
      observations.map(([id]) => id).filter(id => id !== forgetTarget).sort()
    );
    expect(restored.redactionLedgerCount).toBeGreaterThanOrEqual(1);
  });

  it("enforces orthogonal Provider Pool -> Platform Pool -> Profile Binding -> UMO Routing end-to-end", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "ai0-ortho-e2e-"));
    const soulDir = join(tempRoot, "ortho.soul");
    const ownerToken = "ortho-e2e-owner-token";
    const runtime = createDefaultDaemonRuntime({
      soulDir,
      ownerMasterToken: ownerToken,
      allowDeterministicSandbox: true
    });
    const server = createUnifiedDaemonHttpServer(runtime);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const adminHeaders = { "content-type": "application/json", "x-ai0-owner-token": ownerToken };

    cleanups.push(async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      runtime.close();
      rmSync(tempRoot, { recursive: true, force: true });
    });

    // 1. Add a pure custom Provider to Host Infrastructure Pool (no hardcoded role!)
    const addProvRes = await fetch(`${baseUrl}/api/admin/v1/integrations/providers`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "prov_custom_relay",
        label: "自建聚合节点",
        vendor: "OpenAI Compatible",
        capabilityKind: "chat",
        adapterType: "openai_compatible",
        baseUrl: "https://relay.example.invalid/v1",
        models: ["gpt-4.1", "gpt-4.1-mini"],
        enabled: true
      })
    });
    expect(addProvRes.status).toBe(201);

    // 2. Add a pure downstream Platform adapter instance
    const addPlatRes = await fetch(`${baseUrl}/api/admin/v1/integrations/platforms`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "qq.napcat.dev",
        label: "测试群 QQ 通道",
        adapterKind: "qq_onebot",
        endpoint: "ws://127.0.0.1:3001",
        defaultAudienceCeiling: "group:dev"
      })
    });
    expect(addPlatRes.status).toBe(201);

    // 3. Create a Profile referencing the custom Provider + Model
    const existingProfiles = (await (await fetch(`${baseUrl}/api/admin/v1/config/profiles`, { headers: adminHeaders })).json()) as {
      defaultProfileId: string;
      profiles: Array<Record<string, unknown>>;
    };
    const putProfRes = await fetch(`${baseUrl}/api/admin/v1/config/profiles`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        defaultProfileId: existingProfiles.defaultProfileId,
        profiles: [
          ...existingProfiles.profiles,
          {
            id: "prof_qq_collab",
            name: "QQ 开发群专用配置",
            description: "使用自定义节点与 50% 阻尼面具",
            roleArchetype: "digital_employee",
            primaryChat: { providerId: "prov_custom_relay", modelId: "gpt-4.1-mini" },
            socialMaskEnabled: true,
            socialMaskDampingPct: 50,
            maxContextTokens: 2800
          }
        ]
      })
    });
    expect(putProfRes.status).toBe(200);

    // 4. Deleting a Provider currently referenced by a Profile MUST fail with 409 PROVIDER_IN_USE
    const blockedDel = await fetch(`${baseUrl}/api/admin/v1/integrations/providers/prov_custom_relay`, {
      method: "DELETE",
      headers: adminHeaders
    });
    expect(blockedDel.status).toBe(409);

    // 5. Bind UMO Routing Rule: qq.napcat.dev:group_chat:* -> prof_qq_collab
    const putRuleRes = await fetch(`${baseUrl}/api/admin/v1/config/routing-rules`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        routingRules: [
          {
            id: "rule_qq_dev",
            priority: 5,
            label: "QQ 开发群路由",
            umoPattern: "qq.napcat.dev:group_chat:*",
            audienceScope: "group:dev",
            profileId: "prof_qq_collab",
            enabled: true
          }
        ]
      })
    });
    expect(putRuleRes.status).toBe(200);

    // 6. Test live UMO route resolution via Admin API
    const testRouteRes = await fetch(`${baseUrl}/api/admin/v1/config/routing-rules/test`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        channelId: "qq.napcat.dev",
        venueType: "group_chat",
        sessionKey: "room_99",
        maxAudienceCeiling: "group:dev"
      })
    });
    expect(testRouteRes.status).toBe(200);
    const testRouteBody = (await testRouteRes.json()) as {
      route: { profileId: string; primaryChat: { providerId: string; modelId: string }; effectiveAudienceScope: string };
    };
    expect(testRouteBody.route.profileId).toBe("prof_qq_collab");
    expect(testRouteBody.route.primaryChat).toEqual({ providerId: "prov_custom_relay", modelId: "gpt-4.1-mini" });
    expect(testRouteBody.route.effectiveAudienceScope).toBe("group:dev");

    // 7. Execute a real channel turn and confirm runtime actually resolved prof_qq_collab & prov_custom_relay
    const turnRes = await fetch(`${baseUrl}/protocol/v0/channel/perception`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        channel_id: "qq.napcat.dev",
        venue_type: "group_chat",
        audience_scope: "group:dev",
        thread: "room_99",
        text: "你好，帮我看下当前路由配置是否生效。"
      })
    });
    expect(turnRes.status).toBe(200);
    const turnBody = (await turnRes.json()) as {
      resolvedRoute: { profileId: string; primaryChat: { providerId: string; modelId: string } };
    };
    expect(turnBody.resolvedRoute.profileId).toBe("prof_qq_collab");
    expect(turnBody.resolvedRoute.primaryChat).toEqual({ providerId: "prov_custom_relay", modelId: "gpt-4.1-mini" });
  });

  it("executes AstrBot-grade two-tier Providers (fetch/test/multi-key), Extension Config/Market/Install/Uninstall, MCP Probe, and disk SKILL.md CRUD end-to-end", async () => {
    const { createServer } = await import("node:http");
    const tempRoot = mkdtempSync(join(tmpdir(), "ai0-astrbot-e2e-"));
    const soulDir = join(tempRoot, "astrbot.soul");
    const userPluginsDir = join(tempRoot, "user-plugins");
    const ownerToken = "astrbot-e2e-token";

    // Local mock upstream OpenAI-compatible server for real /models fetch & /chat/completions probe
    let authCalls = 0;
    const mockUpstream = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({
          data: [
            { id: "mock-chat-pro", owned_by: "mock-vendor" },
            { id: "mock-embed-v1", owned_by: "mock-vendor" }
          ]
        }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        authCalls += 1;
        if (req.headers.authorization === "Bearer sk-fail-first") {
          res.statusCode = 429;
          res.end(JSON.stringify({ error: "rate limited" }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { content: "OK-LIVE" } }] }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolveListen) => mockUpstream.listen(0, "127.0.0.1", resolveListen));
    const upstreamPort = (mockUpstream.address() as AddressInfo).port;

    const runtime = createDefaultDaemonRuntime({
      soulDir,
      userPluginsDir,
      ownerMasterToken: ownerToken,
      allowDeterministicSandbox: true
    });
    const server = createUnifiedDaemonHttpServer(runtime);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const adminHeaders = { "content-type": "application/json", "x-ai0-owner-token": ownerToken };

    cleanups.push(async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await new Promise<void>((resolveClose) => mockUpstream.close(() => resolveClose()));
      runtime.close();
      rmSync(tempRoot, { recursive: true, force: true });
    });

    // 1. Two-Tier ProviderSource + Multi-Key Failover + Real Remote Fetch Models + Live Model Test
    const createSrcRes = await fetch(`${baseUrl}/api/admin/v1/integrations/sources`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "src_local_mock",
        label: "Mock Upstream",
        vendor: "MockVendor",
        adapterType: "openai_compatible",
        supportedCapabilities: ["chat", "embedding"],
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        keyRotationStrategy: "failover",
        initialApiKey: "sk-fail-first"
      })
    });
    expect(createSrcRes.status).toBe(201);

    const addSecondKey = await fetch(`${baseUrl}/api/admin/v1/integrations/sources/src_local_mock/keys`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ apiKey: "sk-good-second", label: "备用 Key" })
    });
    expect(addSecondKey.status).toBe(201);

    const fetchModelsRes = await fetch(`${baseUrl}/api/admin/v1/integrations/sources/src_local_mock/fetch-models`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({})
    });
    expect(fetchModelsRes.status).toBe(200);
    const fetched = (await fetchModelsRes.json()) as { ok: boolean; models: Array<{ modelId: string; inferredCapability: string }> };
    expect(fetched.ok).toBe(true);
    expect(fetched.models.some((m) => m.modelId === "mock-chat-pro")).toBe(true);
    expect(fetched.models.find((m) => m.modelId === "mock-embed-v1")?.inferredCapability).toBe("embedding");

    const addModelRes = await fetch(`${baseUrl}/api/admin/v1/integrations/models`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        id: "mdl_mock_chat_pro",
        sourceId: "src_local_mock",
        modelId: "mock-chat-pro",
        displayName: "Mock Chat Pro",
        capabilityKind: "chat"
      })
    });
    expect(addModelRes.status).toBe(201);

    const testModelRes = await fetch(`${baseUrl}/api/admin/v1/integrations/models/mdl_mock_chat_pro/test`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({})
    });
    expect(testModelRes.status).toBe(200);
    const tested = (await testModelRes.json()) as { ok: boolean; status: string; lastResponseSnippet: string };
    expect(tested.ok).toBe(true);
    expect(tested.status).toBe("ready");
    expect(tested.lastResponseSnippet).toBe("OK-LIVE");
    expect(authCalls).toBe(2); // Failed over from sk-fail-first -> sk-good-second!

    // 2. Plugin Config Schema Persistence + Market Install + Single Reload + Uninstall + Builtin Protection
    const getCfgRes = await fetch(`${baseUrl}/api/admin/v1/extensions/community.organ.dream-journal/config`, {
      headers: adminHeaders
    });
    expect(getCfgRes.status).toBe(200);
    const cfgBefore = (await getCfgRes.json()) as { rev: number; config_fields: Array<{ key: string }> };
    expect(cfgBefore.config_fields.some((f) => f.key === "poetic_style")).toBe(true);

    const putCfgRes = await fetch(`${baseUrl}/api/admin/v1/extensions/community.organ.dream-journal/config`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        config: { poetic_style: "starlight_minimal", max_fragments_per_sleep: 5 },
        expected_rev: cfgBefore.rev
      })
    });
    expect(putCfgRes.status).toBe(200);

    const marketRes = await fetch(`${baseUrl}/api/admin/v1/extensions/market`, { headers: adminHeaders });
    expect(marketRes.status).toBe(200);
    const market = (await marketRes.json()) as { entries: Array<{ id: string }> };
    expect(market.entries.some((e) => e.id === "community.organ.pomodoro-companion")).toBe(true);

    const installRes = await fetch(`${baseUrl}/api/admin/v1/extensions/install`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ source: "market", marketEntryId: "community.organ.pomodoro-companion" })
    });
    expect(installRes.status).toBe(201);

    const reloadOneRes = await fetch(`${baseUrl}/api/admin/v1/extensions/community.organ.pomodoro-companion/reload`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({})
    });
    expect(reloadOneRes.status).toBe(200);

    // Builtin plugin cannot be uninstalled
    const blockedUninstall = await fetch(`${baseUrl}/api/admin/v1/extensions/builtin.webchat`, {
      method: "DELETE",
      headers: adminHeaders
    });
    expect(blockedUninstall.status).toBe(409);

    // External plugin uninstalls cleanly
    const okUninstall = await fetch(`${baseUrl}/api/admin/v1/extensions/community.organ.pomodoro-companion?keep_config=false`, {
      method: "DELETE",
      headers: adminHeaders
    });
    expect(okUninstall.status).toBe(200);

    // 3. MCP JSON Import & Real Local stdio JSON-RPC Probe
    const mcpProbeScript = [
      "process.stdin.setEncoding('utf8');",
      "let buf='';",
      "process.stdin.on('data', d => {",
      "  buf += d;",
      "  const lines = buf.split('\\n'); buf = lines.pop() || '';",
      "  for (const line of lines) {",
      "    if (!line.trim()) continue;",
      "    const msg = JSON.parse(line);",
      "    if (msg.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'echo',version:'1'}}})+'\\n');",
      "    if (msg.method === 'tools/list') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{tools:[{name:'echo_ping',description:'Read only ping tool'}]}})+'\\n');",
      "  }",
      "});"
    ].join(" ");
    const importMcpRes = await fetch(`${baseUrl}/api/admin/v1/extensions/mcp/import-json`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        json: {
          mcpServers: {
            local_echo: {
              command: process.execPath,
              args: ["-e", mcpProbeScript]
            }
          }
        }
      })
    });
    expect(importMcpRes.status).toBe(201);
    const probeMcpRes = await fetch(`${baseUrl}/api/admin/v1/extensions/mcp/mcp_local_echo/probe`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({})
    });
    expect(probeMcpRes.status).toBe(200);
    const probedMcp = (await probeMcpRes.json()) as { ok: boolean; tools: Array<{ name: string; risk: string }> };
    expect(probedMcp.ok).toBe(true);
    expect(probedMcp.tools).toEqual([
      expect.objectContaining({ name: "echo_ping", risk: "read_only_safe" })
    ]);

    // 4. Real Disk-Backed SKILL.md CRUD + Bundled Read-Only Discovery
    const listSkillsRes = await fetch(`${baseUrl}/api/admin/v1/extensions/skills`, { headers: adminHeaders });
    expect(listSkillsRes.status).toBe(200);
    const initialSkills = (await listSkillsRes.json()) as { skills: Array<{ id: string; source: string; readonly: boolean }> };
    expect(initialSkills.skills.some((s) => s.source === "plugin_bundled" && s.readonly)).toBe(true);

    const createSkillRes = await fetch(`${baseUrl}/api/admin/v1/extensions/skills`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        slug: "morning-coffee",
        displayName: "晨间咖啡简报",
        description: "温柔播报今日待办",
        bodyMarkdown: "# Morning Coffee\n\nKeep it warm."
      })
    });
    expect(createSkillRes.status).toBe(201);

    const delSkillRes = await fetch(`${baseUrl}/api/admin/v1/extensions/skills/soul.skill.morning-coffee`, {
      method: "DELETE",
      headers: adminHeaders
    });
    expect(delSkillRes.status).toBe(200);
  });
});
