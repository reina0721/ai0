import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer, createUnifiedDaemonHttpApp } from "./index.js";
import { CharacterCardV3Schema } from "@ai0/protocol";
import { getConsoleStudioConfigPath, getHostInfrastructureFilePath, readConsoleStudioConfig, readHostInfrastructureConfig,
  readHostOwnerClaim, readSoulArchiveConfig, resolveEffectiveSourceApiKeys } from "@ai0/storage";
import { lifecycleFixture } from "./test-support/lifecycle.js";
import { cognitionProposalPolicyFacet, defineExtensionPackage, extensionAssetCodecFacet, taskExecutorContract } from "@ai0/sdk";
import { installStudioTestProfile } from "./test-support/studio-profile.js";
import { updateStudioConfig } from "./studio-service.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ai0-composition-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const soulDir = join(root, "person.soul"), builtinPluginsDir = join(root, "plugins");
  const ownerMasterToken = randomUUID();
  const start = () => createDefaultDaemonRuntime({ soulDir, builtinPluginsDir, ownerMasterToken, allowDeterministicSandbox: true });
  let runtime = start();
  let app = createUnifiedDaemonHttpApp(runtime);
  cleanups.push(() => runtime.close());
  const request = (path: string, method = "GET", data?: unknown, token = ownerMasterToken as string) =>
    app.request(path, { method, headers: { authorization: "Bearer " + token,
      "x-ai0-owner-token": token === ownerMasterToken ? token : "", "content-type": "application/json" },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  return { root, soulDir, builtinPluginsDir, request,
    get runtime() { return runtime; },
    restart() { runtime.close(); runtime = start(); app = createUnifiedDaemonHttpApp(runtime); }
  };
}

it("uses mounted author codecs and state guards in Studio and the live profile", async () => {
  const f = fixture();
  const domain = "D1_WORKING_TURN";
  const pkg = "author.card-and-focus";
  const host = f.runtime.extensionHost;
  host.mountPackage(defineExtensionPackage({ manifest: {
    extension_id: pkg, version: "1", author: "fixture", display_name: "Card and focus", carrier_kind: "native_code_plugin",
    facets: [extensionAssetCodecFacet.id, cognitionProposalPolicyFacet.id],
    permissions: { read_blackboard_domains: [domain], propose_mutation_domains: [domain], max_audience_scope: "only_owner", network_access: false }
  }, activate(scope) {
    scope.contributeFacet(extensionAssetCodecFacet, { format: "author.title", target: "ai0.distilled-card.v1",
      decode: title => ({ identity_dna: { name: String(title), description: "Imported", personality: "" },
        voice_exemplars: [], lore_entries: [], stripped_jailbreak_lines: [], stripped_pua_lines: [], clean: {} }) });
    scope.contributeFacet(cognitionProposalPolicyFacet, { domain, review: () => ({ action: "reject", reason: "FOCUS_LOCKED" }) });
  } }));
  const source = { format: "author.title", provider: pkg, asset: "Atlas" };
  const preview = await f.request("/api/admin/v1/soul/distill", "POST", source);
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ identity_dna: { name: "Atlas" } });
  const applied = await f.request("/api/studio/distill-apply", "POST", { ...source, apply: true });
  expect(applied.status).toBe(200);
  expect(await applied.json()).toMatchObject({ applied: true, studioConfig: { soulStudio: { displayName: "Atlas" } } });
  const coordinator = f.runtime.coordinator;
  const proposal = { proposal_id: "set-focus", domain, base_rev: coordinator.getSnapshot().domain_revs[domain],
    payload: { active_focus_channel_id: "calendar" } } as const;
  expect(coordinator.submitProposal(proposal)).toMatchObject({ accepted: false, reason: "FOCUS_LOCKED" });
  host.setPackageEnabled(pkg, false);
  expect(coordinator.submitProposal(proposal).accepted).toBe(true);
  expect(coordinator.getSnapshot().D1_WORKING_TURN.active_focus_channel_id).toBe("calendar");
});

it("keeps discovery, presence, confirmed messages and identity independent across removal and restart", async () => {
  const f = fixture();
  const snapshot = () => f.runtime.buildConsoleLiveSnapshot();
  const empty = await snapshot();
  expect(empty).toMatchObject({ activeConnections: 0, eventsCount: 0, conversations: [], extensions: [] });
  expect(empty.studioConfig?.agency.activeTasks).toEqual([]);
  const root = join(f.builtinPluginsDir, "view");
  mkdirSync(root, { recursive: true });
  const file = join(root, "ai0.extension.json");
  writeFileSync(file, JSON.stringify({ manifest_version: "2.0.0", extension_id: "test.view", display_name: "View", version: "1.0.0", author: "test",
    carrier_kind: "native_code_plugin", facets: ["channel.bridge", "console.ui_slot"],
    permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false },
    console_contributions: { ui_slots: [{ slot_target: "slot.channels.mounted_stage", widget_type: "web_stage_module",
      title: "View", channel_id: "view.default", entry_module: "./dist/view.js" }] } }));
  expect((await snapshot()).extensions[0]).toMatchObject({ missingAssets: ["./dist/view.js"], uiSlots: [] });
  expect((await f.request("/api/plugins/test.view/stage-token", "POST")).status).toBe(409);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/view.js"), "export function mountChannelStage() {}");
  const token = (await (await f.request("/api/plugins/test.view/stage-token", "POST")).json()).token;
  expect(typeof token).toBe("string");
  const sandboxToken = (await (await f.request("/api/plugins/test.view/stage-token?mode=sandbox", "POST")).json()).token;
  expect(await f.runtime.reloadExtension("test.view", "sandbox", { theme: "blue" }, 0)).toBe(1);
  expect((await f.request("/protocol/v0/channel/history?mode=sandbox", "GET", undefined, sandboxToken)).status).toBe(401);
  expect((await f.request("/protocol/v0/channel/history?mode=live", "GET", undefined, token)).status).toBe(200);
  expect(f.runtime.sandboxExtensionHost.getPackage("test.view")?.config).toMatchObject({ theme: "blue" });
  expect((await snapshot()).activeConnections).toBe(0);

  const grant = async (channelId: string, audience: string) => {
    const response = await f.request("/api/studio/channel-grants", "POST",
      { channelId, audience, principalId: "owner:local", externalUserId: "verified-account" });
    expect(response.status).toBe(200);
    return (await response.json()).token as string;
  };
  const qq = await grant("qq.adapter", "group:lab");
  const avatar = await grant("live2d.avatar", "only_owner");
  async function connect(channel_id: string, token: string, scope: string) {
    const response = await f.request("/protocol/v0/channel/connections", "POST", { protocol_version: "0.1.0",
      channel_id, channel_kind: "im_bridge", display_name: channel_id, venue_type: scope === "only_owner" ? "private_1on1" : "group_chat",
      current_audience: { scope, member_count: 1 }, latency_budget_ms: 300,
      capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] } }, token);
    expect(response.status).toBe(200);
    return (await response.json()).session_id;
  }
  await connect("view.default", token, "only_owner");
  await connect("qq.adapter", qq, "group:lab");
  const avatarId = await connect("live2d.avatar", avatar, "only_owner");
  expect((await snapshot()).activeConnections).toBe(3);

  async function send(token: string, text: string) {
    const requestId = randomUUID();
    const response = await f.request("/protocol/v0/channel/runs", "POST", { text, mode: "live", requestId }, token);
    expect(response.status).toBe(200);
    const frames = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const reply = frames.filter(frame => frame.type === "text-delta").map(frame => frame.delta).join("");
    expect(reply).not.toBe("");
    return { id: requestId, reply };
  }
  const actuators = [{ actuator_id: "avatar.nod", description: "Nod", parameters_json_schema: {}, requires_local_user_consent: false }];
  await f.request("/protocol/v0/channel/connections/" + avatarId, "PATCH", {
    capabilities: { sensors: ["text"], supported_extensions: [], actuators }
  }, avatar);
  const dispatch = await f.request("/api/studio/channel-actions", "POST", { sessionId: avatarId, actuatorId: "avatar.nod" });
  expect(dispatch.status).toBe(201);
  const action = await dispatch.json();
  const actionPath = "/protocol/v0/channel/connections/" + avatarId + "/actions";
  expect(await (await f.request(actionPath, "GET", undefined, avatar)).json()).toMatchObject({ actions: [{ intent_id: action.intent_id }] });
  const privateTurn = { id: randomUUID() };
  const qqTurn = send(qq, "今天群内公开讨论。");
  const stream = await f.request("/protocol/v0/channel/runs", "POST", {
    requestId: privateTurn.id, mode: "live", text: "昨天网页上的私密交谈。".repeat(32)
  }, token);
  const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
  let frames = "";
  while (!frames.includes('"type":"text-delta"')) {
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    frames += chunk.value;
  }
  rmSync(file);
  await f.runtime.refreshCapabilities();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; frames += chunk.value; }
  expect(frames).not.toContain('"type":"text-end"');
  const publicTurn = await qqTurn;
  const after = await snapshot();
  expect(after.activeConnections).toBe(2);
  expect(after.extensions).toHaveLength(0);
  expect((await f.request("/protocol/v0/channel/history?mode=live", "GET", undefined, token)).status).toBe(401);
  expect(after.conversations?.map(row => row.messageCount)).toEqual([1, 1]);
  const receipt = { mode: "live", spokenCharOffset: Array.from(publicTurn.reply).length };
  for (let i = 0; i < 2; i++) expect((await f.request("/protocol/v0/channel/runs/" + publicTurn.id + "/receipt", "POST", receipt, qq)).status).toBe(200);
  expect((await f.request("/protocol/v0/channel/connections/" + avatarId, "PATCH", {
    capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] }
  }, avatar)).status).toBe(200);
  const outcome = { intent_id: action.intent_id, chunk_seq: 0, status: "completed", actuator_outcome: { success: true, result_summary: "点头完成" } };
  expect((await f.request(actionPath, "POST", outcome, qq)).status).toBe(403);
  for (let attempt = 0; attempt < 2; attempt++) expect((await f.request(actionPath, "POST", outcome, avatar)).status).toBe(200);
  expect(f.runtime.storage.getEventById("evt_action_" + action.intent_id)?.summary_text).toBe("点头完成");
  const latest = await snapshot();
  expect(latest.conversations?.find(row => row.platform === "qq.adapter")?.messageCount).toBe(2);
  const conversation = latest.conversations!.find(row => row.platform === "view.default")!.umo;
  const historyPath = "/api/studio/conversations/history?conversation=" + encodeURIComponent(conversation);
  expect((await (await f.request(historyPath)).json()).messages[0]).toMatchObject({ evidenceId: "evt_channel_" + privateTurn.id, deliveryStatus: "unknown" });
  f.restart();
  expect(await snapshot()).toMatchObject({ soulId: empty.soulId, activeConnections: 0, stateRev: latest.stateRev });
  expect((await (await f.request(historyPath)).json()).messages).toHaveLength(1);
  expect((await (await f.request("/protocol/v0/channel/history?mode=live", "GET", undefined, qq)).json()).turns)
    .toMatchObject([{ userText: "今天群内公开讨论。" }]);
  // A separate, non-browser process uses a new channel grant bound to the same person.
  const terminal = await grant("builtin.terminal.default", "only_owner");
  const server = createUnifiedDaemonHttpServer(f.runtime);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const child = spawn(process.execPath, ["plugins/channels/terminal/client.mjs"], { windowsHide: true,
      env: { ...process.env, AI0_URL: "http://127.0.0.1:" + (server.address() as AddressInfo).port, AI0_CHANNEL_TOKEN: terminal } });
    let output = "", errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    const ended = once(child, "close");
    child.stdin.end("换个载体继续聊。\n");
    expect((await ended)[0], errors).toBe(0);
    expect(output.trim()).not.toBe("");
    const rows = (await snapshot()).conversations!;
    expect(rows.find(row => row.platform === "builtin.terminal.default")).toMatchObject({ label: "owner:local", messageCount: 2 });
    expect(rows).toHaveLength(3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const created = await f.request("/api/studio/instances", "POST", { slug: "another", displayName: "另一位", primaryRole: "best_friend" });
  expect(created.status).toBe(200);
  expect(readSoulArchiveConfig(join(f.root,"another.soul")).manifest.soul_id).not.toBe(empty.soulId);
});

it("preserves damaged configuration originals without creating legacy .bak files", () => {
  const f = fixture();
  const configPath = join(f.soulDir, "config", "console_studio.json");
  writeFileSync(configPath, "damaged original", "utf8");
  expect(() => readConsoleStudioConfig(f.soulDir)).toThrow();
  expect(readFileSync(configPath, "utf8")).toBe("damaged original");
  expect(readdirSync(join(f.soulDir, "config")).filter(name => name.endsWith(".bak"))).toEqual([]);
});

it("restores each selected archive's checkpoint, releases the old channel, and exports an archive without an imported card", async () => {
  const f = fixture();
  const { runtime } = f;
  const original = readSoulArchiveConfig(f.soulDir);
  const ownerTurn = "Only the original archive saw this conversation.";
  const first = await runtime.handleChannelTurn({ principalId: "owner:local", text: ownerTurn });
  const firstSnapshot = runtime.coordinator.getSnapshot();
  expect(firstSnapshot.D1_WORKING_TURN.recent_turns.some(turn => turn.text === ownerTurn)).toBe(true);
  const exportResponse = await f.request("/api/admin/v1/souls/" + original.manifest.soul_id + "/export-card");
  expect(exportResponse.status).toBe(200);
  const { card } = await exportResponse.json();
  expect(CharacterCardV3Schema.parse(card).data.name).toBe(original.identity.display_name);
  expect(JSON.stringify(card)).not.toContain(ownerTurn);

  const channelId = "composition.viewer";
  const grant = await f.request("/api/studio/channel-grants", "POST", {
    channelId, audience: "only_owner", principalId: "owner:local", externalUserId: "original-account"
  });
  expect(grant.status).toBe(200);
  const { token } = await grant.json();
  const manifest = {
    protocol_version: "0.1.0", channel_id: channelId, channel_kind: "im_bridge", display_name: "Viewer",
    venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 }, latency_budget_ms: 300,
    capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] }
  };
  expect((await f.request("/protocol/v0/channel/connections", "POST", manifest, token)).status).toBe(200);
  expect(runtime.channelGateway.listConnections("live")).toHaveLength(1);

  const created = await f.request("/api/studio/instances", "POST", { slug: "second", displayName: "Second" });
  expect(created.status).toBe(200);
  const select = async (id: string) => {
    expect((await f.request("/api/studio/souls/select", "POST", { id })).status).toBe(200);
  };
  await select("second.soul");
  expect(runtime.channelGateway.listConnections("live")).toHaveLength(0);
  const previousGrant = await f.request("/protocol/v0/channel/connections", "POST", manifest, token);
  expect(previousGrant.status).toBe(403);
  expect(await previousGrant.json()).toMatchObject({ error: "SOUL_MISMATCH" });
  expect(runtime.coordinator.getSnapshot().D1_WORKING_TURN.recent_turns).toHaveLength(0);
  expect(runtime.storage.getEventById(first.trace.turn_event_id)).toBeUndefined();
  const second = await runtime.handleChannelTurn({ principalId: "owner:local", text: "Private note from the second archive." });
  const secondSnapshot = runtime.coordinator.getSnapshot();

  await select(original.manifest.soul_id);
  expect(runtime.coordinator.getSnapshot()).toEqual(firstSnapshot);
  expect(runtime.storage.getDecisionTraceByEvent(first.trace.turn_event_id)).toEqual(first.trace);
  expect(runtime.storage.getEventById(second.trace.turn_event_id)).toBeUndefined();
  await select("second.soul");
  expect(runtime.coordinator.getSnapshot()).toEqual(secondSnapshot);
  expect(runtime.storage.getDecisionTraceByEvent(second.trace.turn_event_id)).toEqual(second.trace);
});

it("onboards a Markdown card with a vault key and reports a missing consciousness override on a second awakening", async ctx => {
  const { runtime, request, readiness } = lifecycleFixture(ctx);
  const apiKey = "offline-onboarding-test-key";
  const providerId = "tpl_opencode_go";
  const modelId = "onboarding-chat";
  const description = "Records observations in the telescope log.";
  const { soulId } = await request<{ soulId: string }>("/api/studio/onboarding", "POST", {
    rawCard: "---\nname: Lyra\n---\n" + description,
    apiKey, providerId, modelId, baseUrl: "http://127.0.0.1:1/v1"
  });
  expect(readHostOwnerClaim(runtime.hostDir)).toMatchObject({
    claimed: true, deploymentMode: "local_sovereign", ownerTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
  });
  expect(readConsoleStudioConfig(runtime.soulDir)).toMatchObject({
    onboardingCompleted: true, soulStudio: { displayName: "Lyra", corePersonalityPrompt: description }
  });
  const infra = readHostInfrastructureConfig(runtime.hostDir);
  expect(infra.modelInstances.find(item => item.modelId === modelId)).toMatchObject({ health: { status: "ready" } });
  const source = infra.providerSources.find(item => item.id === providerId)!;
  expect(resolveEffectiveSourceApiKeys(runtime.hostDir, source)).toContain(apiKey);
  expect(JSON.stringify(infra)).not.toContain(apiKey);
  expect((await readiness("L4_SOUL_AWAKENED_NO_CHANNEL")).checks).toMatchObject({
    providerReady: true, defaultChatModel: modelId, activeSoulId: soulId, bindingValid: true, hostCardsCount: 1
  });

  await request("/api/studio/onboarding", "POST", { awakenNew: true, card: {
    spec: "chara_card_v3", spec_version: "3.0", data: { name: "Cygnus",
      extensions: { "ai0.soul.v1": { module_overrides: { consciousness: { mode: "Override", sourceId: "unavailable", modelId } } } }
    }
  } });
  const report = await readiness("L3_SOUL_AWAKENED_CONFIG_NEEDED");
  expect(report.checks).toMatchObject({ providerReady: true, soulAwakened: true, bindingValid: false, hostCardsCount: 2 });
  expect(report.missing_prerequisites.toSorted()).toEqual(["connected_compliant_channel", "soul_consciousness_model_binding"]);
  expect(await request("/protocol/v0/channel/perception", "POST", { text: "Hello" }, 503))
    .toMatchObject({ error: "PROVIDER_NOT_READY" });
  await request("/api/admin/v1/souls/select", "POST", { id: soulId });
  expect((await readiness("L4_SOUL_AWAKENED_NO_CHANNEL")).checks.activeSoulId).toBe(soulId);
});

it("persists console preferences across daemon restarts and keeps legacy patches compatible", async () => {
  const f = fixture();
  const settingsPath = "/api/admin/v1/system/settings";
  const legacyPath = "/api/studio/config";
  const preferences = {
    appearance: "dark",
    soulTheme: "astral-blue",
    navRailMode: "dual",
    inspectorView: "sandbox-diff"
  };

  expect((await f.request(settingsPath, "PATCH", preferences, "")).status).toBe(401);
  expect((await f.request(settingsPath + "?target_instance=sandbox:console", "PATCH", preferences)).status).toBe(403);
  expect(await (await f.request(settingsPath)).json()).toMatchObject({ navRailMode: "expanded", inspectorView: "trace" });

  const saved = await f.request(settingsPath, "PATCH", preferences);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject(preferences);
  const invalid = await f.request(settingsPath, "PATCH", { navRailMode: "wide", inspectorView: "mini" });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: "INVALID_SYSTEM_SETTINGS" });

  const hostPath = getHostInfrastructureFilePath(f.runtime.hostDir);
  const hostContents = readFileSync(hostPath, "utf8") + "\n";
  writeFileSync(hostPath, hostContents);
  const legacyLayout = await f.request(legacyPath, "POST", { systemSettings: { navRailMode: "mini" } });
  expect(legacyLayout.status).toBe(200);
  expect(readFileSync(hostPath, "utf8")).toBe(hostContents);

  const legacySecurity = await f.request(legacyPath, "POST", {
    systemSettings: { auth2faEnabled: true, navRailMode: "mini", inspectorView: "trace" }
  }, "");
  expect(legacySecurity.status).toBe(200);
  expect(await (await f.request(settingsPath)).json()).toMatchObject({ ...preferences, auth2faEnabled: true });
  const legacyTheme = { systemSettings: { soulTheme: "cyber-emerald" } };
  expect((await f.request(legacyPath, "POST", legacyTheme, "")).status).toBe(401);
  expect((await f.request(legacyPath, "POST", legacyTheme)).status).toBe(200);

  f.restart();
  const expected = { ...preferences, soulTheme: "cyber-emerald", auth2faEnabled: true };
  expect(await (await f.request(settingsPath)).json()).toMatchObject(expected);
  for (const mode of ["live", "sandbox"]) {
    const bootstrap = await f.request(`/api/studio/bootstrap?mode=${mode}`);
    expect(bootstrap.status).toBe(200);
    expect(await bootstrap.json()).toMatchObject({ snapshot: { infrastructure: { systemSettings: expected } } });
  }
});

it("links task completion to a real executor and W3 memory to its source", async () => {
  const f = fixture();
  installStudioTestProfile(f.runtime);
  async function task(action: string, taskId?: string) {
    return (await f.request("/api/studio/co-work-task", "POST", { action, taskId, title: "research", subAgentId: "sub_research_scholar" })).json();
  }
  const id = (await task("create")).task.id;
  expect((await task("approve", id)).task.status).toBe("queued");
  expect((await task("complete", id)).ok).toBe(false);
  const result = (await task("execute", id)).task;
  expect(JSON.parse(f.runtime.storage.getEventById(result.evidenceId)!.payload_json)).toMatchObject({ query: "research", chunk_ids: [] });
  expect((await task("execute", id)).task.evidenceId).toBe(result.evidenceId);
  const turn = await f.runtime.handleChannelTurn({ text: "记录今天的研究", principalId: "owner:local" });
  const report = f.runtime.workers.w3.runSleepMemoryConsolidation();
  expect(report).toBe(1);
  expect(f.runtime.workers.w3.runSleepMemoryConsolidation()).toBe(0);
  expect(f.runtime.storage.sqlite.prepare("SELECT visibility_scope FROM memories WHERE memory_id=?")
    .get("mem_consolidated_" + turn.trace.turn_event_id)?.visibility_scope).toBe("only_owner");
});

it("pins approval to a configured service and never repeats a claimed external action", async () => {
  const f = fixture();
  installStudioTestProfile(f.runtime);
  const ref = { owner: "thirdparty.task", name: "count", version: 1 };
  const contract = taskExecutorContract(ref);
  let acknowledge!: () => void;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { acknowledge = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  f.runtime.extensionHost.mountPackage({
    manifest: { manifest_version: "2.0.0", extension_id: ref.owner, version: "1", author: "fixture",
      display_name: "Counter", carrier_kind: "native_code_plugin", facets: [],
      permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false },
      services: { defines: [ref], provides: [ref] } },
    activate(scope) {
      scope.defineService(contract);
      scope.provideService(contract, async () => {
        calls++;
        acknowledge();
        await release;
        return { summary: "Counted", evidence: { count: calls } };
      });
    }
  });
  const current = readConsoleStudioConfig(f.soulDir);
  const agent = { ...current.agency.subAgents[0]!, id: "counter", executor: { ...ref, provider: ref.owner } };
  updateStudioConfig(f.runtime, { agency: { subAgents: [agent] } });
  const task = async (action: string, taskId?: string) => (await f.request("/api/studio/co-work-task", "POST",
    { action, taskId, title: "Count", subAgentId: "counter" })).json();
  const id = (await task("create")).task.id;
  await task("approve", id);
  const approvedTasks = readConsoleStudioConfig(f.soulDir).agency.activeTasks;
  updateStudioConfig(f.runtime, { agency: { activeTasks: approvedTasks.map(item => ({ ...item, title: "Different operation" })) } });
  expect(await task("execute", id)).toMatchObject({ error: "EXECUTOR_APPROVAL_REQUIRED" });
  updateStudioConfig(f.runtime, { agency: { activeTasks: approvedTasks } });
  updateStudioConfig(f.runtime, { agency: { subAgents: [{ ...agent, allowedTools: [...agent.allowedTools, "new.permission"] }] } });
  expect(await task("execute", id)).toMatchObject({ error: "EXECUTOR_APPROVAL_REQUIRED" });
  updateStudioConfig(f.runtime, { agency: { subAgents: [{ ...agent, executor: { ...agent.executor, version: 2 } }] } });
  expect(await task("execute", id)).toMatchObject({ error: "EXECUTOR_APPROVAL_REQUIRED" });
  updateStudioConfig(f.runtime, { agency: { subAgents: [agent] } });
  const first = task("execute", id);
  await started;
  expect(await task("execute", id)).toMatchObject({ error: "TASK_CLAIMED_WITHOUT_RECEIPT" });
  f.runtime.extensionHost.unmountPackage(ref.owner);
  finish();
  expect(await first).toMatchObject({ error: "EXECUTOR_RESULT_UNKNOWN" });
  expect(await task("approve", id)).toMatchObject({ error: "TASK_ALREADY_DISPATCHED" });
  f.restart();
  expect(await task("execute", id)).toMatchObject({ error: "TASK_CLAIMED_WITHOUT_RECEIPT" });
  expect(calls).toBe(1);
});

it("never mints a missing approval when persisted task approval digests are stripped", async () => {
  const f = fixture();
  async function task(action: string, subAgentId: string, taskId?: string) {
    return (await f.request("/api/studio/co-work-task", "POST", { action, title: "Research", subAgentId, taskId })).json();
  }
  installStudioTestProfile(f.runtime);
  const research = "sub_research_scholar", review = "sub_code_reviewer";
  const taskIds: Record<string, string> = {};
  for (const id of [research, review]) {
    const created = await task("create", id);
    taskIds[id] = created.task.id;
    await task("approve", id, created.task.id);
  }
  const config = readConsoleStudioConfig(f.soulDir);
  const researcher = config.agency.subAgents.find(agent => agent.id === research)!;
  config.agency.subAgents.find(agent => agent.id === review)!.executor = researcher.executor;
  for (const item of config.agency.activeTasks) {
    delete item.approvedRequestDigest;
    delete item.approvedExecutor;
  }
  const location = getConsoleStudioConfigPath(f.soulDir);
  writeFileSync(location, JSON.stringify(config));
  expect(readConsoleStudioConfig(f.soulDir).agency.activeTasks.every(item => !item.approvedRequestDigest && !item.approvedExecutor)).toBe(true);
  f.restart();
  expect(await task("execute", research, taskIds[research])).toMatchObject({ error: "EXECUTOR_APPROVAL_REQUIRED" });
  expect(await task("execute", review, taskIds[review])).toMatchObject({ error: "EXECUTOR_APPROVAL_REQUIRED" });
});
