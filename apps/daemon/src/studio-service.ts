import { allowedCollections, importKnowledge, searchKnowledge } from "./knowledge-service.js";
import { prepareKnowledgeLibrary } from "@ai0/storage";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  bundlePrivacyScrubbedCreatorAsset,
  distillSillyTavernCard,
  matchesUmoPattern
} from "@ai0/cognition-core";
import type { SoulProfileAndCapabilitiesConfig } from "@ai0/protocol";
import {
  compileStudioPromptPreview,
  initializeSoulDirectory,
  readConsoleStudioConfig,
  readHostInfrastructureConfig,
  readHostVaultKey,
  readSoulArchiveConfig,
  readSoulProfileConfig,
  resolveHostInfrastructureDir,
  ROLE_ARCHETYPE_PRESETS,
  saveHostVaultKey,
  writeConsoleStudioConfig,
  writeHostInfrastructureConfig,
  writeSoulProfileConfig,
  type CoordinatorStorageMutator,
  type RelationshipArchetype,
  type SoulConsoleStudioConfig
} from "@ai0/storage";

import type { Ai0DaemonRuntime } from "./index.js";

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

export function discoverSoulDirectories(soulsRoot: string): string[] {
  if (!existsSync(soulsRoot)) return [];
  return readdirSync(soulsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith(".soul"))
    .map(entry => entry.name)
    .sort();
}

export function listAvailableSoulInstances(soulsRootOrActiveSoulDir: string, hasAwakenedSoul = true): Array<{
  id: string;
  name: string;
  role: string;
  path: string;
  active: boolean;
}> {
  const resolved = resolve(soulsRootOrActiveSoulDir);
  const active = hasAwakenedSoul && resolved.endsWith(".soul") ? resolved : undefined;
  const root = active ? dirname(active) : resolved;
  return discoverSoulDirectories(root).map(id => {
    const path = join(root, id);
    const item = { id, path, active: path === active };
    try {
      const { soulStudio } = readConsoleStudioConfig(path);
      return { ...item, name: soulStudio.displayName, role: ROLE_ARCHETYPE_PRESETS[soulStudio.primaryRole].label };
    } catch {
      return { ...item, name: id.slice(0, -5), role: "数字生命" };
    }
  });
}

// Both list and detail queries project the same accepted and delivered messages.
const conversationMessages = `WITH turns AS (
  SELECT e.event_id, e.event_seq, e.wall_ts_ms, e.source_channel_id, e.audience_scope, e.principal_id,
    e.summary_text, json_array(e.source_channel_id, e.audience_scope,
      COALESCE(json_extract(e.payload_json,'$.thread'), CASE WHEN e.audience_scope='only_owner' THEN e.principal_id ELSE e.audience_scope END)) AS conversation,
    json_extract(t.step7_emitted_intent_json,'$.fallback_text') AS generated,
    json_extract(t.step8_delivery_receipt_json,'$.spoken_char_offset') AS delivered,
    json_extract(t.step8_delivery_receipt_json,'$.status') AS delivery_status
  FROM event_log e LEFT JOIN turn_decision_traces t ON t.turn_event_id=e.event_id
  WHERE e.event_category='perception_committed' AND e.redacted_at_ts_ms IS NULL
), messages AS (
  SELECT *, 0 AS direction, summary_text AS content FROM turns
  UNION ALL SELECT *, 1 AS direction, substr(generated,1,delivered) AS content FROM turns
  WHERE delivered>0 AND delivery_status IN ('completed','interrupted')
)`;

export function readConversation(storage: CoordinatorStorageMutator, conversation: string, before: number) {
  return storage.sqlite.prepare(conversationMessages + `
    SELECT event_id AS evidenceId, event_seq*2+direction AS cursor, direction, content, principal_id,
      wall_ts_ms, CASE WHEN generated IS NOT NULL THEN COALESCE(delivery_status,'unknown') END AS deliveryStatus
    FROM messages WHERE conversation=? AND event_seq*2+direction < ? ORDER BY cursor DESC LIMIT 50
  `).all(conversation, before);
}

export function buildConversationsList(
  storage: CoordinatorStorageMutator,
  studio: SoulConsoleStudioConfig,
  soulProfiles?: SoulProfileAndCapabilitiesConfig
) {
  const rows = storage.sqlite.prepare(conversationMessages + `, ranked AS (
    SELECT *, COUNT(*) OVER (PARTITION BY conversation) AS count,
      ROW_NUMBER() OVER (PARTITION BY conversation ORDER BY event_seq DESC,direction DESC) AS rank FROM messages
  ) SELECT * FROM ranked WHERE rank=1 ORDER BY event_seq DESC`).all();
  return rows.map(row => {
    const platform = String(row.source_channel_id);
    const audienceScope = row.audience_scope === "only_owner" ? "only_owner" as const :
      row.audience_scope === "public_all" ? "public_all" as const : "fixed_group" as const;
    const parts = JSON.parse(String(row.conversation)) as [string, string, string];
    const normalizedUmo = `${parts[0]}:${audienceScope === "public_all" ? "public_livestream" : "private_1on1"}:${parts[2]}`;
    const orthoRule = soulProfiles?.routingRules.find(
      (item) => item.enabled && (item.umoPattern === row.conversation || matchesUmoPattern(item.umoPattern, normalizedUmo))
    );
    const legacyRule = studio.customRules.find(item => item.umo === row.conversation);
    const resolvedProfileName = orthoRule
      ? (soulProfiles?.profiles.find((p) => p.id === orthoRule.profileId)?.name ?? "默认策略")
      : (soulProfiles?.profiles.find((p) => p.id === soulProfiles.defaultProfileId)?.name ??
        studio.profiles.find(profile => profile.id === legacyRule?.profileId)?.name ?? "默认策略");
    return {
      umo: String(row.conversation), platform, audienceScope,
      canOpenOwnerThread: audienceScope === "only_owner" && parts[2] === "owner:local",
      label: orthoRule?.label ?? legacyRule?.label ?? String(parts[2]),
      profileName: resolvedProfileName,
      messageCount: Number(row.count), lastSummary: String(row.content),
      lastActiveAt: new Date(Number(row.wall_ts_ms)).toISOString(), evidenceId: String(row.event_id)
    };
  });
}

function getVaultKeysPath(soulDir: string): string {
  return join(resolve(soulDir), "vault", "provider_keys.json");
}

export function saveVaultProviderKey(soulDir: string, providerId: string, rawKey: string): void {
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.includes("••") || ["local-no-key", "builtin-local", "local-tts-token", "local-stt"].includes(trimmed)) {
    return;
  }
  saveHostVaultKey(resolveHostInfrastructureDir(soulDir), providerId, trimmed);
  const filePath = getVaultKeysPath(soulDir);
  let store: Record<string, string> = {};
  try {
    if (existsSync(filePath)) store = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
  } catch {
    store = {};
  }
  store[providerId] = trimmed;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function readVaultProviderKey(soulDir: string, providerId: string): string | undefined {
  const hostKey = readHostVaultKey(resolveHostInfrastructureDir(soulDir), providerId);
  if (hostKey) return hostKey;
  const filePath = getVaultKeysPath(soulDir);
  if (!existsSync(filePath)) return undefined;
  try {
    const store = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
    const key = store[providerId]?.trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function updateStudioConfig(
  runtime: Ai0DaemonRuntime,
  patch: Record<string, unknown>
): SoulConsoleStudioConfig {
  const current = readConsoleStudioConfig(runtime.soulDir);
  if (Array.isArray(patch.providers)) {
    patch = {
      ...patch,
      providers: (patch.providers as Array<Record<string, unknown>>).map((p) => {
        const raw = typeof p.apiKeyMasked === "string" ? p.apiKeyMasked.trim() : "";
        const id = typeof p.id === "string" ? p.id : "";
        if (id && raw && !raw.includes("••") && !["local-no-key", "builtin-local", "local-tts-token", "local-stt"].includes(raw)) {
          saveVaultProviderKey(runtime.soulDir, id, raw);
          return {
            ...p,
            apiKeyMasked: raw.length > 8 ? `${raw.slice(0, 4)}••••••${raw.slice(-4)}` : "••••••"
          };
        }
        return p;
      })
    };
  }
  // Merge legacy partial settings against the current host values.
  const systemSettingsPatch = patch.systemSettings;
  const infrastructure = "systemSettings" in patch ? readHostInfrastructureConfig(runtime.hostDir) : undefined;
  const base = infrastructure ? { ...current, systemSettings: infrastructure.systemSettings } : current;
  const merged = deepMerge(base, patch);
  const saved = writeConsoleStudioConfig(runtime.soulDir, merged);
  runtime.mutableState.circadianAnchors = saved.soulStudio.circadianAnchors.map((a) => ({
    hour: a.hour,
    energy: a.energy
  }));
  const primaryPlatform = saved.platforms.find((p) => p.enabled) ?? saved.platforms[0];
  if (primaryPlatform) runtime.mutableState.debounceWindowMs = primaryPlatform.debounceMs;

  // Keep orthogonal host/profile stores in sync when legacy /api/studio/config patches them
  if (infrastructure && systemSettingsPatch && typeof systemSettingsPatch === "object") {
    const changedSettings = Object.entries(saved.systemSettings).filter(([key]) => Object.hasOwn(systemSettingsPatch, key));
    if (changedSettings.length > 0) {
      writeHostInfrastructureConfig(runtime.hostDir, {
        ...infrastructure,
        systemSettings: { ...infrastructure.systemSettings, ...Object.fromEntries(changedSettings) }
      });
    }
  }
  if ("ragSettings" in patch) {
    const soulProfiles = readSoulProfileConfig(runtime.soulDir);
    writeSoulProfileConfig(runtime.soulDir, {
      ...soulProfiles,
      capabilities: {
        ...soulProfiles.capabilities,
        knowledge: {
          ...soulProfiles.capabilities.knowledge,
          ...saved.ragSettings
        }
      }
    });
  }

  // Sync display_name back to identity.yaml when modified
  try {
    const identityPath = join(runtime.soulDir, "identity.yaml");
    if (saved.soulStudio.displayName !== current.soulStudio.displayName && existsSync(identityPath)) {
      const identityObj = JSON.parse(readFileSync(identityPath, "utf8")) as Record<string, unknown>;
      identityObj.display_name = saved.soulStudio.displayName;
      writeFileSync(identityPath, `${JSON.stringify(identityObj, null, 2)}\n`, "utf8");
    }
  } catch {
    // Keep identity.yaml untouched if custom format
  }

  runtime.adminServer.broadcastTelemetry(
    "[SYS]",
    { action: "studio_config_saved", displayName: saved.soulStudio.displayName, primaryRole: saved.soulStudio.primaryRole },
    "live"
  );
  return saved;
}

export function distillAndOptionallyApplyCard(
  runtime: Ai0DaemonRuntime,
  input: { card: Record<string, unknown>; apply?: boolean; roleArchetype?: RelationshipArchetype }
) {
  const distilled = distillSillyTavernCard(input.card);
  const cardName = String(input.card.name ?? input.card.display_name ?? (distilled.identity_dna.name || "Soul"));
  const cardDesc = String(
    input.card.description ?? input.card.personality ?? distilled.identity_dna.description ?? ""
  );
  let appliedConfig: SoulConsoleStudioConfig | undefined;

  if (input.apply) {
    const current = readConsoleStudioConfig(runtime.soulDir);
    const nextRole = input.roleArchetype ?? current.soulStudio.primaryRole;
    const rolePreset = ROLE_ARCHETYPE_PRESETS[nextRole];
    const nextExemplars = distilled.voice_exemplars.length
      ? distilled.voice_exemplars.map((ex, idx) => ({
          id: `gv_distilled_${idx + 1}`,
          mood: ex.scene_tags[0] || "蒸馏原声",
          user: "日常对话样本",
          assistant: ex.text.slice(0, 180)
        }))
      : current.soulStudio.goldenVoiceExemplars;

    const nextLorebooks = distilled.lore_entries.length
      ? [
          ...distilled.lore_entries.map((entry, idx) => ({
            id: `lore_distilled_${idx + 1}`,
            title: String(entry.comment ?? entry.name ?? entry.id ?? `蒸馏词条 #${idx + 1}`),
            keys: Array.isArray(entry.keys)
              ? entry.keys.map((k) => String(k))
              : [cardName],
            secondaryKeys: [],
            priority: 85,
            tokenBudget: 160,
            content: String(entry.content ?? ""),
            enabled: true
          })),
          ...current.soulStudio.lorebooks
        ].slice(0, 12)
      : current.soulStudio.lorebooks;

    appliedConfig = updateStudioConfig(runtime, {
      onboardingCompleted: true,
      soulStudio: {
        displayName: cardName,
        primaryRole: nextRole,
        corePersonalityPrompt: cardDesc.trim() || current.soulStudio.corePersonalityPrompt,
        catchphrases: rolePreset.catchphrases,
        goldenVoiceExemplars: nextExemplars,
        lorebooks: nextLorebooks
      }
    });
  }

  return {
    distilled,
    applied: Boolean(input.apply),
    studioConfig: appliedConfig
  };
}

export async function pingStudioProvider(
  runtime: Ai0DaemonRuntime,
  providerId: string
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const provider = studio.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: "PROVIDER_NOT_FOUND" };

  const started = Date.now();
  let latencyMs = 0;
  let status: "ready" | "error" | "configured" = "configured";
  let detail = "已配置；尚未测量模型调用延迟";
  if (URL.canParse(provider.baseUrl) && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(provider.baseUrl).hostname)) {
    try {
      const response = await fetch(provider.baseUrl, { method: "HEAD", signal: AbortSignal.timeout(900) });
      latencyMs = Date.now() - started;
      status = response.ok ? "ready" : "error";
      detail = "HTTP " + response.status + "，端点响应耗时 " + latencyMs + " ms";
    } catch {
      status = "error";
      detail = "端点未响应";
    }
  }
  const nextProviders = studio.providers.map((item) =>
    item.id === providerId ? { ...item, lastLatencyMs: latencyMs, status } : item
  );
  const saved = updateStudioConfig(runtime, { providers: nextProviders });
  return { ok: true, providerId, latencyMs, status, detail, studioConfig: saved };
}

export async function dispatchOrAdvanceCoWorkTask(
  runtime: Ai0DaemonRuntime,
  input: {
    action: "create" | "approve" | "complete" | "execute" | "pause";
    taskId?: string;
    title?: string;
    subAgentId?: string;
  }
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const tasks = [...studio.agency.activeTasks];
  const nowMs = runtime.virtualClock.nowMs();

  if (input.action === "create") {
    const subAgent = studio.agency.subAgents.find((s) => s.id === input.subAgentId) ?? studio.agency.subAgents[0];
    const newTask = {
      id: "task_" + randomUUID(),
      title: (input.title || "协助整理项目文档并提炼 3 条核心建议").trim(),
      subAgentId: subAgent?.id ?? "sub_code_reviewer",
      status: "waiting_approval" as const,
      currentStep: 0,
      totalSteps: 1,
      stepLabel: "等待批准",
      riskLevel: "read_only_safe" as const,
      createdAt: "刚刚",
      outputSummary: ""
    };
    tasks.unshift(newTask);
    const saved = updateStudioConfig(runtime, { agency: { activeTasks: tasks } });
    runtime.adminServer.broadcastTelemetry("[AGENCY]", { action: "task_created", task: newTask }, "live", nowMs);
    return { ok: true, task: newTask, studioConfig: saved };
  }

  const target = tasks.find(task => task.id === input.taskId);
  if (!target) return { ok: false, error: "TASK_NOT_FOUND" };
  if (input.action === "complete") return { ok: false, error: "EXECUTION_RESULT_REQUIRED" };
  if (input.action === "execute") {
    const evidenceId = "evt_task_" + target.id;
    const recorded = runtime.storage.getEventById(evidenceId);
    if (!recorded && target.status !== "queued") return { ok: false, error: "TASK_NOT_QUEUED" };
    if (target.subAgentId !== "sub_research_scholar") return { ok: false, error: "NO_TASK_EXECUTOR" };
    if (!recorded) {
      const cfg = readSoulProfileConfig(runtime.soulDir);
      const mounted = cfg.profiles.find(p => p.id===cfg.defaultProfileId)?.knowledgeCollectionIds ?? [];
      const search = await searchKnowledge(runtime,runtime.storage,target.title,allowedCollections(runtime.storage,mounted,"only_owner",true));
      const hits = search.results.filter(hit => hit.score >= cfg.capabilities.knowledge.honestForgetThreshold);
      // Retrieval can yield to another task update. Commit against the latest task and event.
      const latest = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks.find(task => task.id === target.id);
      if (!latest || (latest.status !== "queued" && latest.status !== "completed"))
        return {ok:false,error:"TASK_NOT_QUEUED"};
      if (!runtime.storage.getEventById(evidenceId)) runtime.storage.appendEvent({
        event_id: evidenceId, event_category: "action_episode_completed", principal_trust: "tool_output",
        wall_ts_ms: Date.now(), virtual_ts_ms: nowMs, source_channel_id: "knowledge.search",
        principal_id: "executor:knowledge.search", audience_scope: "only_owner", venue_type: "internal_background",
        modality: "text", summary_text: "知识库检索完成，返回 " + hits.length + " 个片段",
        payload_json: JSON.stringify({ task_id: target.id, query: target.title, chunk_ids: hits.map(hit => hit.chunkId) }),
        state_rev_after: runtime.coordinator.getSnapshot().state_rev, active_modules_mask: 31
      });
    }
    const activeTasks = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks;
    const completed = activeTasks.find(task => task.id === target.id);
    if (!completed) return {ok:false,error:"TASK_NOT_FOUND"};
    completed.status = "completed";
    completed.currentStep = completed.totalSteps;
    completed.stepLabel = "知识库检索已完成";
    completed.outputSummary = runtime.storage.getEventById(evidenceId)!.summary_text;
    completed.evidenceId = evidenceId;
    return { ok: true, task: completed, studioConfig: updateStudioConfig(runtime, { agency: { activeTasks } }) };
  }
  if (!["approve", "pause"].includes(input.action)) return { ok: false, error: "UNKNOWN_TASK_ACTION" };
  if (target.status === "completed") return { ok: false, error: "TASK_ALREADY_COMPLETED" };
  target.status = input.action === "pause" ? "paused" : "queued";
  target.stepLabel = input.action === "pause" ? "已暂停" : "已批准，等待执行器";
  const saved = updateStudioConfig(runtime, { agency: { activeTasks: tasks } });
  return { ok: true, task: target, studioConfig: saved };
}

export function reviewGrowthProposal(
  runtime: Ai0DaemonRuntime,
  proposalId: string,
  decision: "approved" | "rejected"
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const proposals = studio.evolution.growthProposals.map((item) =>
    item.id === proposalId ? { ...item, status: decision } : item
  );
  const chosen = studio.evolution.growthProposals.find((item) => item.id === proposalId);

  if (chosen && decision === "approved" && chosen.targetFile === "narrative.md") {
    const narrativePath = join(runtime.soulDir, "narrative.md");
    const existing = existsSync(narrativePath) ? readFileSync(narrativePath, "utf8") : "";
    const addition = `\n## 伴生演化记录 (${new Date().toISOString().slice(0, 10)})\n- ${chosen.afterText}\n`;
    writeFileSync(narrativePath, `${existing.trimEnd()}${addition}`, "utf8");
  }

  const saved = updateStudioConfig(runtime, { evolution: { growthProposals: proposals } });
  return { ok: true, proposalId, decision, studioConfig: saved };
}

export function runManualSleepReflection(runtime: Ai0DaemonRuntime) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const nowMs = runtime.virtualClock.nowMs();
  const timeStr = new Date(nowMs).toISOString().slice(11, 16);
  const sources: string[] = [];
  const accepted = runtime.workers.w3.runSleepMemoryConsolidation(id => sources.push(id));
  const newDream = {
    id: "drm_" + randomUUID(),
    date: `刚刚 ${timeStr}`,
    title: "🌙 睡梦整理完成 · Level-0 原始对话巩固",
    content: "本次 W3 巩固接受了 " + accepted + " 项记忆提议。",
    kind: "curiosity_note" as const
  };
  const nextJournal = [newDream, ...studio.evolution.dreamJournal].slice(0, 12);
  runtime.storage.appendEvent({
    event_id: "evt_sleep_" + randomUUID(),
    wall_ts_ms: Date.now(),
    virtual_ts_ms: nowMs,
    source_channel_id: "kernel.w3.sleep",
    principal_id: "system:w3",
    principal_trust: "environment_sensor",
    venue_type: "local_ambient",
    audience_scope: "only_owner",
    event_category: "sleep_consolidation_run",
    modality: "text",
    summary_text: newDream.content,
    payload_json: JSON.stringify({ ...newDream, source_event_ids: sources, memory_ids: sources.map(id => "mem_consolidated_" + id) }),
    state_rev_after: runtime.coordinator.getSnapshot().state_rev,
    active_modules_mask: 31
  });
  const saved = updateStudioConfig(runtime, { evolution: { dreamJournal: nextJournal } });
  return { ok: true, entry: newDream, studioConfig: saved };
}

export async function ingestKnowledgeDocument(runtime: Ai0DaemonRuntime,input:{collectionId:string;title:string;content:string},sandbox=false) {
  const storage=sandbox?runtime.sandboxStorage:runtime.storage;
  prepareKnowledgeLibrary(storage);
  if(!input.content.trim()) return {ok:false,error:"EMPTY_DOCUMENT_CONTENT"};
  storage.sqlite.prepare("INSERT OR IGNORE INTO knowledge_collections(id,name) VALUES(?,?)").run(input.collectionId,input.collectionId);
  const result=await importKnowledge(runtime,storage,input.collectionId,input.title,Buffer.from(input.content),"text");
  const config=readSoulProfileConfig(runtime.soulDir).capabilities.knowledge;
  return {ok:true,collectionId:input.collectionId,...result,chunkSize:config.chunkSize,chunkOverlap:config.chunkOverlap};
}

export async function searchKnowledgeChunks(runtime: Ai0DaemonRuntime,input:{query:string;collectionId?:string},sandbox=false) {
  const storage=sandbox?runtime.sandboxStorage:runtime.storage;
  const result=await searchKnowledge(runtime,storage,input.query,allowedCollections(storage,input.collectionId?[input.collectionId]:undefined,"only_owner",true));
  return {...result,ok:true,query:input.query,results:result.results.map(h=>({...h,chunk_id:h.chunkId,collection_id:h.collectionId,source_uri:h.title,content_text:h.excerpt,citation_count:Number(storage.sqlite.prepare("SELECT citation_count FROM knowledge_chunks WHERE chunk_id=?").get(h.chunkId)?.citation_count ?? 0)}))};
}

export function createPrivacyScrubbedReleasePackage(
  runtime: Ai0DaemonRuntime,
  input: {
    packageType?: "soul-template" | "ai0pack";
    includePromptBricks?: boolean;
    includeLorebooks?: boolean;
    includeSkillsAndFlows?: boolean;
  }
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const archive = readSoulArchiveConfig(runtime.soulDir);
  const rawAsset = {
    schema: input.packageType === "ai0pack" ? "ai0.creator_pack.v1" : "ai0.soul_template.v1",
    exported_at: new Date().toISOString(),
    display_name: studio.soulStudio.displayName,
    avatar_emoji: studio.soulStudio.avatarEmoji,
    tagline: studio.soulStudio.tagline,
    primary_role: studio.soulStudio.primaryRole,
    work_venue_role: studio.soulStudio.workVenueRole,
    ontological_mode: studio.soulStudio.ontologicalMode,
    core_personality_prompt: studio.soulStudio.corePersonalityPrompt,
    catchphrases: studio.soulStudio.catchphrases,
    banned_cliches: studio.soulStudio.bannedCliches,
    golden_voice_exemplars: studio.soulStudio.goldenVoiceExemplars,
    temperament: studio.soulStudio.temperament,
    circadian_anchors: studio.soulStudio.circadianAnchors,
    ...(input.includePromptBricks !== false ? { prompt_bricks: studio.soulStudio.promptBricks } : {}),
    ...(input.includeLorebooks !== false ? { lorebooks: studio.soulStudio.lorebooks } : {}),
    ...(input.includeSkillsAndFlows !== false
      ? { skills: studio.ecosystem.skills, eca_flows: studio.ecosystem.ecaFlows }
      : {}),
    // Deliberately supply sensitive keys so the kernel privacy scrubber proves it physically strips them!
    event_log: runtime.storage.listEvents({ limit: 5 }),
    private_memories: ["[OWNER_SECRET_MUST_BE_SCRUBBED]"],
    api_key: "sk-must-be-stripped",
    owner_master_token: "token-must-be-stripped",
    vault_secrets: { deepseek: "secret" },
    soul_core_sqlite: archive.manifest.soul_id
  };

  const bundled = bundlePrivacyScrubbedCreatorAsset(rawAsset);
  return {
    ok: true,
    filename:
      input.packageType === "ai0pack"
        ? `${studio.soulStudio.displayName.toLowerCase().replace(/[^a-z0-9_-]/gi, "") || "soul"}.ai0pack.json`
        : `${studio.soulStudio.displayName.toLowerCase().replace(/[^a-z0-9_-]/gi, "") || "soul"}.soul-template.json`,
    sha256: bundled.sha256,
    excluded_keys: bundled.excluded_keys,
    scrubbed_events_count: runtime.storage.listEvents({ limit: 500 }).length,
    scrubbed_memories_count: runtime.storage.queryMemoriesWithAudienceGuard({
      audience_scope: "only_owner",
      principal_trust: "owner_verified",
      current_virtual_ts: runtime.virtualClock.nowMs(),
      limit: 500
    }).length,
    scrubbed_payload: bundled.payload
  };
}

export function createNewSoulInstance(
  runtime: Ai0DaemonRuntime,
  input: { slug: string; displayName: string; primaryRole: RelationshipArchetype; avatarEmoji?: string }
) {
  const safeSlug = (input.slug || input.displayName || `soul_${Date.now()}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `soul-${Date.now()}`;
  const targetDir = resolve(runtime.soulsRoot, `${safeSlug}.soul`);
  try { mkdirSync(targetDir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("SOUL_ALREADY_EXISTS"); throw error; }
  initializeSoulDirectory(targetDir);
  const preset = ROLE_ARCHETYPE_PRESETS[input.primaryRole] ?? ROLE_ARCHETYPE_PRESETS.best_friend;
  const studio = readConsoleStudioConfig(targetDir, input.displayName || safeSlug);
  studio.soulStudio.displayName = input.displayName || safeSlug;
  studio.soulStudio.avatarEmoji = input.avatarEmoji || preset.icon;
  studio.soulStudio.primaryRole = input.primaryRole;
  studio.soulStudio.corePersonalityPrompt = preset.defaultPromptHint;
  studio.soulStudio.catchphrases = preset.catchphrases;
  studio.soulStudio.maxBlackboardTokens = preset.tokenBudget;
  writeConsoleStudioConfig(targetDir, studio);

  return {
    ok: true,
    id: `${safeSlug}.soul`,
    path: targetDir,
    instances: runtime.listSoulInstances()
  };
}

export function buildLivePromptPreviews(
  runtime: Ai0DaemonRuntime,
  studio: SoulConsoleStudioConfig,
  memories: Array<{ content_text: string; visibility_scope: string }>,
  narrativeText: string,
  mode: "live" | "sandbox" = "live"
) {
  const snap = (mode === "live" ? runtime.coordinator : runtime.sandboxCoordinator).getSnapshot();
  const affect = snap.D2_HOMEOSTASIS_AFFECT;
  const privateMemories = memories.slice(0, 3).map((m) => `[${m.visibility_scope}] ${m.content_text}`);
  const publicMemories = memories
    .filter((m) => m.visibility_scope === "public_all")
    .slice(0, 3)
    .map((m) => `[公开] ${m.content_text}`);

  const promptPreviewPrivate = compileStudioPromptPreview(studio, {
    audienceScope: "only_owner",
    venueType: "private_1on1",
    platform: runtime.fallbackChannelId(),
    moodValence: affect.instant_valence,
    circadianEnergy: affect.circadian_energy,
    metabolicEnergy: affect.metabolic_energy,
    narrativeSummary: narrativeText.slice(0, 180),
    recalledMemories: privateMemories
  });
  const promptPreviewPublic = compileStudioPromptPreview(studio, {
    audienceScope: "public_all",
    venueType: "public_livestream",
    platform: "公开场合预览",
    moodValence: Number((affect.instant_valence * 0.3).toFixed(2)),
    circadianEnergy: affect.circadian_energy,
    metabolicEnergy: affect.metabolic_energy,
    narrativeSummary: "",
    recalledMemories: publicMemories
  });

  return { promptPreviewPrivate, promptPreviewPublic };
}
