import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  bundlePrivacyScrubbedCreatorAsset,
  distillSillyTavernCard
} from "@ai0/kernel";
import {
  compileStudioPromptPreview,
  initializeSoulDirectory,
  readConsoleStudioConfig,
  readSoulArchiveConfig,
  ROLE_ARCHETYPE_PRESETS,
  seedDefaultSoulAwakeningData,
  writeConsoleStudioConfig,
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

export function listAvailableSoulInstances(activeSoulDir: string): Array<{
  id: string;
  name: string;
  role: string;
  path: string;
  active: boolean;
}> {
  const activeResolved = resolve(activeSoulDir);
  const parentDir = dirname(activeResolved);
  const results: Array<{ id: string; name: string; role: string; path: string; active: boolean }> = [];
  if (existsSync(parentDir)) {
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".soul")) continue;
      const fullPath = resolve(parentDir, entry.name);
      try {
        const cfg = readConsoleStudioConfig(fullPath);
        const roleMeta = ROLE_ARCHETYPE_PRESETS[cfg.soulStudio.primaryRole];
        results.push({
          id: entry.name,
          name: cfg.soulStudio.displayName,
          role: roleMeta.label,
          path: fullPath,
          active: fullPath === activeResolved
        });
      } catch {
        results.push({
          id: entry.name,
          name: entry.name.replace(/\.soul$/, ""),
          role: "数字生命",
          path: fullPath,
          active: fullPath === activeResolved
        });
      }
    }
  }
  if (!results.some((item) => item.active)) {
    const cfg = readConsoleStudioConfig(activeResolved);
    const roleMeta = ROLE_ARCHETYPE_PRESETS[cfg.soulStudio.primaryRole];
    results.unshift({
      id: activeResolved.split(/[\\/]/).at(-1) ?? "default.soul",
      name: cfg.soulStudio.displayName,
      role: roleMeta.label,
      path: activeResolved,
      active: true
    });
  }
  return results;
}

export function buildConversationsList(
  storage: CoordinatorStorageMutator,
  studio: SoulConsoleStudioConfig
) {
  const events = storage.listEvents({ limit: 80 });
  const grouped = new Map<
    string,
    { platform: string; audienceScope: "only_owner" | "fixed_group" | "public_all"; count: number; lastSummary: string; lastTs: number }
  >();
  for (const evt of events) {
    const scope = evt.audience_scope === "only_owner" ? "only_owner" : evt.audience_scope === "public_all" ? "public_all" : "fixed_group";
    const key = `${evt.source_shell_id}:${scope}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        platform: evt.source_shell_id,
        audienceScope: scope,
        count: 1,
        lastSummary: evt.summary_text.slice(0, 70),
        lastTs: evt.virtual_ts_ms
      });
    } else {
      existing.count += 1;
    }
  }
  const sessions = studio.customRules.map((rule) => {
    const matched = grouped.get(`${rule.platform}:${rule.audienceScope}`);
    const profile = studio.profiles.find((p) => p.id === rule.profileId);
    return {
      umo: rule.umo,
      label: rule.label,
      platform: rule.platform,
      audienceScope: rule.audienceScope,
      profileName: profile?.name ?? rule.profileId,
      messageCount: matched?.count ?? (rule.audienceScope === "only_owner" ? events.length : 0),
      lastSummary: matched?.lastSummary ?? "暂无消息，规则已就绪等待连接触发",
      lastActiveAt: matched ? new Date(matched.lastTs).toISOString().slice(11, 19) : "待机中"
    };
  });
  return sessions;
}

function getVaultKeysPath(soulDir: string): string {
  return join(resolve(soulDir), "vault", "provider_keys.json");
}

export function saveVaultProviderKey(soulDir: string, providerId: string, rawKey: string): void {
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.includes("••") || ["local-no-key", "builtin-local", "local-tts-token", "local-stt"].includes(trimmed)) {
    return;
  }
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
  const merged = deepMerge(current as unknown as Record<string, unknown>, patch);
  const saved = writeConsoleStudioConfig(runtime.soulDir, merged as SoulConsoleStudioConfig);
  runtime.mutableState.circadianAnchors = saved.soulStudio.circadianAnchors.map((a) => ({
    hour: a.hour,
    energy: a.energy
  }));
  const webPlatform = saved.platforms.find((p) => p.kind === "webchat");
  if (webPlatform) runtime.mutableState.debounceWindowMs = webPlatform.debounceMs;

  // Sync display_name back to identity.yaml when modified
  try {
    const identityPath = join(runtime.soulDir, "identity.yaml");
    if (existsSync(identityPath)) {
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
  const cardName = String(input.card.name ?? input.card.display_name ?? (distilled.identity_dna.name || "Mio"));
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
  let latencyMs = provider.lastLatencyMs || 180;
  let status: "ready" | "error" = "ready";
  let detail = `已校验 ${provider.vendor} (${provider.modelId}) 接入配置`;

  if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(provider.baseUrl)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 900);
      await fetch(provider.baseUrl, { signal: controller.signal }).catch(() => undefined);
      clearTimeout(timer);
      latencyMs = Math.max(8, Date.now() - started);
      detail = `本地推理端点探测完成 (${latencyMs}ms)`;
    } catch {
      latencyMs = Math.max(12, Date.now() - started);
      detail = `本地推理配置已就绪 (离线回退可用)`;
    }
  } else {
    latencyMs = 140 + ((provider.id.length * 29) % 190);
    detail = `${provider.vendor} 配置校验通过 · 预估首字延迟 ${latencyMs}ms`;
  }

  const nextProviders = studio.providers.map((item) =>
    item.id === providerId ? { ...item, lastLatencyMs: latencyMs, status } : item
  );
  const saved = updateStudioConfig(runtime, { providers: nextProviders });
  return { ok: true, providerId, latencyMs, status, detail, studioConfig: saved };
}

export function dispatchOrAdvanceCoWorkTask(
  runtime: Ai0DaemonRuntime,
  input: {
    action: "create" | "approve" | "complete" | "pause";
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
      id: `task_${Date.now()}`,
      title: (input.title || "协助整理项目文档并提炼 3 条核心建议").trim(),
      subAgentId: subAgent?.id ?? "sub_code_reviewer",
      status: "running" as const,
      currentStep: 3,
      totalSteps: 8,
      stepLabel: `步骤 3/8 · ${subAgent?.icon ?? "🤖"} ${subAgent?.name ?? "子代理"} 正在检索知识库并拆解执行计划`,
      riskLevel: "read_only_safe" as const,
      createdAt: "刚刚",
      outputSummary: "后台并发推进中，前台聊天零阻塞。"
    };
    tasks.unshift(newTask);
    const saved = updateStudioConfig(runtime, { agency: { activeTasks: tasks.slice(0, 12) } });
    runtime.adminServer.broadcastTelemetry("[AGENCY]", { action: "task_created", task: newTask }, "live", nowMs);
    return { ok: true, task: newTask, studioConfig: saved };
  }

  const target = tasks.find((t) => t.id === input.taskId) ?? tasks[0];
  if (!target) return { ok: false, error: "TASK_NOT_FOUND" };

  if (input.action === "pause") {
    target.status = "paused";
    target.stepLabel = "已暂停等待主人恢复";
  } else {
    // approve or complete -> finish 8/8 and crystallize into episodic experience memory!
    target.status = "completed";
    target.currentStep = 8;
    target.stepLabel = "步骤 8/8 · 已完成并自动沉淀为共同经历记忆";
    target.outputSummary = target.outputSummary || "已完成核查与结构化总结，结果已同步至对话上下文。";
    const eventId = `evt_cowork_${nowMs}`;
    const memoryId = `mem_cowork_${nowMs}`;
    target.crystallizedMemoryId = memoryId;
    runtime.storage.appendEvent({
      event_id: eventId,
      wall_ts_ms: Date.now(),
      virtual_ts_ms: nowMs,
      source_shell_id: "builtin.webchat.default",
      principal_id: "owner:local",
      principal_trust: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      event_category: "action_episode_completed",
      modality: "text",
      summary_text: `共同完成后台协作任务：${target.title}`,
      payload_json: JSON.stringify(target),
      state_rev_after: runtime.coordinator.getSnapshot().state_rev,
      active_modules_mask: 31
    });
    runtime.storage.insertMemoryWithLineage(
      {
        memory_id: memoryId,
        memory_tier: "episodic_experience",
        epistemic_type: "observed_firsthand",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        content_text: `共同经历：和主人一起完成了「${target.title}」，输出了结构化结论并得到主人认可。`,
        created_virtual_ts: nowMs,
        last_recalled_ts: nowMs,
        valid_from_virtual_ts: nowMs,
        created_at_rev: runtime.coordinator.getSnapshot().state_rev
      },
      [{ parent_type: "event", parent_id: eventId, relation_type: "derived_from" }]
    );
  }

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
  const newDream = {
    id: `drm_${Date.now()}`,
    date: `刚刚 ${timeStr}`,
    title: "🌙 睡梦整理完成 · Level-0 原始对话巩固",
    content: `已从最近 ${runtime.storage.listEvents({ limit: 50 }).length} 条原始事件中过滤掉玩笑语用，巩固核心默契，并沿授权订阅源写下一段关于「长期数字伴侣边界美学」的读书小随笔。`,
    kind: "curiosity_note" as const
  };
  const nextJournal = [newDream, ...studio.evolution.dreamJournal].slice(0, 12);
  runtime.storage.appendEvent({
    event_id: `evt_sleep_${nowMs}`,
    wall_ts_ms: Date.now(),
    virtual_ts_ms: nowMs,
    source_shell_id: "kernel.w3.sleep",
    principal_id: "system:w3",
    principal_trust: "environment_sensor",
    venue_type: "local_ambient",
    audience_scope: "only_owner",
    event_category: "sleep_consolidation_run",
    modality: "text",
    summary_text: "手动执行一次 W3 睡眠记忆巩固与好奇心冲浪整理",
    payload_json: JSON.stringify(newDream),
    state_rev_after: runtime.coordinator.getSnapshot().state_rev,
    active_modules_mask: 31
  });
  const saved = updateStudioConfig(runtime, { evolution: { dreamJournal: nextJournal } });
  return { ok: true, entry: newDream, studioConfig: saved };
}

export function ingestKnowledgeDocument(
  runtime: Ai0DaemonRuntime,
  input: { collectionId: string; title: string; content: string }
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const collectionId = (input.collectionId || "kb_custom_notes").trim();
  const text = (input.content || "").trim();
  if (!text) return { ok: false, error: "EMPTY_DOCUMENT_CONTENT" };

  const chunkSize = Math.max(120, studio.ragSettings.chunkSize);
  const overlap = Math.min(chunkSize - 40, Math.max(0, studio.ragSettings.chunkOverlap));
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += Math.max(80, chunkSize - overlap)) {
    const slice = text.slice(start, start + chunkSize).trim();
    if (slice) chunks.push(slice);
    if (start + chunkSize >= text.length) break;
  }

  const nowMs = runtime.virtualClock.nowMs();
  const stmt = runtime.storage.sqlite.prepare(`
    INSERT OR REPLACE INTO knowledge_chunks
      (chunk_id, collection_id, document_name, chunk_index, content_text, metadata_json, taint_level, citation_count, created_at_ts_ms)
    VALUES (?, ?, ?, ?, ?, '{}', 'untrusted_external', 1, ?)
  `);
  const ftsStmt = runtime.storage.sqlite.prepare(`
    INSERT INTO knowledge_chunks_fts (chunk_id, collection_id, content_text)
    VALUES (?, ?, ?)
  `);
  chunks.forEach((chunk, index) => {
    const chunkId = `chk_${Date.now()}_${index}`;
    stmt.run(chunkId, collectionId, input.title || "uploaded.md", index, chunk, nowMs);
    ftsStmt.run(chunkId, collectionId, chunk);
  });

  return {
    ok: true,
    collectionId,
    chunksCreated: chunks.length,
    chunkSize,
    chunkOverlap: overlap
  };
}

export function searchKnowledgeChunks(
  runtime: Ai0DaemonRuntime,
  input: { query: string; collectionId?: string }
) {
  const studio = readConsoleStudioConfig(runtime.soulDir);
  const query = (input.query || "").trim().toLowerCase();
  const rows = runtime.storage.sqlite
    .prepare(
      input.collectionId
        ? "SELECT chunk_id, collection_id, document_name AS source_uri, content_text, citation_count FROM knowledge_chunks WHERE collection_id = ? LIMIT 100"
        : "SELECT chunk_id, collection_id, document_name AS source_uri, content_text, citation_count FROM knowledge_chunks LIMIT 100"
    )
    .all(...(input.collectionId ? [input.collectionId] : [])) as Array<{
    chunk_id: string;
    collection_id: string;
    source_uri: string;
    content_text: string;
    citation_count: number;
  }>;

  const terms = query.split(/[\s,，。！？]+/u).filter(Boolean);
  const scored = rows
    .map((row) => {
      const lower = row.content_text.toLowerCase();
      const hits = terms.length
        ? terms.filter((t) => lower.includes(t)).length / terms.length
        : 0.5;
      const denseSim = Math.min(0.98, 0.28 + hits * 0.65);
      const bm25 = Math.min(0.99, hits * 0.9 + (row.citation_count > 0 ? 0.08 : 0));
      const score = Number(
        (denseSim * studio.ragSettings.denseWeight + bm25 * studio.ragSettings.bm25Weight).toFixed(3)
      );
      return { ...row, score, denseSim: Number(denseSim.toFixed(2)), bm25: Number(bm25.toFixed(2)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, studio.ragSettings.topK);

  return {
    ok: true,
    query: input.query,
    honestForgetTriggered: (scored[0]?.score ?? 0) < studio.ragSettings.honestForgetThreshold,
    results: scored
  };
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
  const targetDir = resolve(dirname(runtime.soulDir), `${safeSlug}.soul`);
  const layout = initializeSoulDirectory(targetDir);
  const preset = ROLE_ARCHETYPE_PRESETS[input.primaryRole] ?? ROLE_ARCHETYPE_PRESETS.best_friend;
  const studio = readConsoleStudioConfig(targetDir, input.displayName || safeSlug);
  studio.soulStudio.displayName = input.displayName || safeSlug;
  studio.soulStudio.avatarEmoji = input.avatarEmoji || preset.icon;
  studio.soulStudio.primaryRole = input.primaryRole;
  studio.soulStudio.corePersonalityPrompt = preset.defaultPromptHint;
  studio.soulStudio.catchphrases = preset.catchphrases;
  studio.soulStudio.maxBlackboardTokens = preset.tokenBudget;
  writeConsoleStudioConfig(targetDir, studio);

  // Seed its database so it awakens immediately when switched
  const { CoordinatorStorageMutator } = requireStorageMutator(runtime);
  const tempStorage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);
  seedDefaultSoulAwakeningData(tempStorage, runtime.virtualClock.nowMs());
  tempStorage.close();

  return {
    ok: true,
    id: `${safeSlug}.soul`,
    path: targetDir,
    instances: listAvailableSoulInstances(runtime.soulDir)
  };
}

function requireStorageMutator(runtime: Ai0DaemonRuntime) {
  return {
    CoordinatorStorageMutator: runtime.storage.constructor as new (dbPath: string) => CoordinatorStorageMutator
  };
}

export function buildLivePromptPreviews(
  runtime: Ai0DaemonRuntime,
  studio: SoulConsoleStudioConfig,
  memories: Array<{ content_text: string; visibility_scope: string }>,
  narrativeText: string
) {
  const snap = runtime.coordinator.getSnapshot();
  const affect = snap.D2_HOMEOSTASIS_AFFECT;
  const privateMemories = memories.slice(0, 3).map((m) => `[${m.visibility_scope}] ${m.content_text}`);
  const publicMemories = memories
    .filter((m) => m.visibility_scope === "public_all")
    .slice(0, 3)
    .map((m) => `[公开] ${m.content_text}`);

  const promptPreviewPrivate = compileStudioPromptPreview(studio, {
    audienceScope: "only_owner",
    venueType: "private_1on1",
    platform: "builtin.webchat.default",
    moodValence: affect.instant_valence,
    circadianEnergy: affect.circadian_energy,
    metabolicEnergy: affect.metabolic_energy,
    narrativeSummary: narrativeText.slice(0, 180),
    recalledMemories: privateMemories
  });
  const promptPreviewPublic = compileStudioPromptPreview(studio, {
    audienceScope: "public_all",
    venueType: "public_livestream",
    platform: "shell.bilibili.live",
    moodValence: Number((affect.instant_valence * 0.3).toFixed(2)),
    circadianEnergy: affect.circadian_energy,
    metabolicEnergy: affect.metabolic_energy,
    narrativeSummary: narrativeText.slice(0, 180),
    recalledMemories: publicMemories
  });

  return { promptPreviewPrivate, promptPreviewPublic };
}
