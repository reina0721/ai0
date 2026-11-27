import { allowedCollections, importKnowledge, searchKnowledge } from "./knowledge-service.js";
import { prepareKnowledgeLibrary } from "@ai0/storage";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { matchesUmoPattern } from "@ai0/cognition-core";
import { TaskExecutorInputSchema, TaskExecutorReceiptSchema, type SoulProfileAndCapabilitiesConfig } from "@ai0/protocol";
import { agentModelAdapterFacet, ServiceBindingError, taskExecutorContract } from "@ai0/sdk";
import {
  initializeSoulDirectory,
  isTaskExecutionApproved,
  taskExecutionApprovalDigest,
  readConsoleStudioConfig,
  readHostInfrastructureConfig,
  readHostVaultKey,
  readSoulArchiveConfig,
  readSoulProfileConfig,
  resolveHostInfrastructureDir,
  resolveRolePreset,
  saveHostVaultKey,
  writeConsoleStudioConfig,
  writeHostInfrastructureConfig,
  writeSoulProfileConfig,
  type CoordinatorStorageMutator,
  type RolePresetId,
  type SoulConsoleStudioConfig
} from "@ai0/storage";
import { bundlePrivacyScrubbedCreatorAsset, decodeProfileCard } from "./asset-bundler.js";

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
      return { ...item, name: soulStudio.displayName, role: resolveRolePreset(soulStudio.primaryRole).label };
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

export async function distillAndOptionallyApplyCard(
  runtime: Ai0DaemonRuntime,
  input: { card: Record<string, unknown>; asset?: unknown; format?: string; provider?: string; apply?: boolean; roleArchetype?: RolePresetId }
) {
  const archive = runtime.archiveSignal;
  await runtime.refreshCapabilities();
  const distilled = await decodeProfileCard(runtime.extensionHost, input.asset ?? input.card, input.format, input.provider);
  if (input.apply && archive.aborted) throw new Error("ASSET_TARGET_CHANGED");
  const cardName = distilled.identity_dna.name || String(distilled.clean.display_name ?? "Soul");
  const cardDesc = distilled.identity_dna.description || distilled.identity_dna.personality;
  let appliedConfig: SoulConsoleStudioConfig | undefined;

  if (input.apply) {
    const current = readConsoleStudioConfig(runtime.soulDir);
    const nextRole = input.roleArchetype ?? current.soulStudio.primaryRole;
    const rolePreset = resolveRolePreset(nextRole);
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
    const subAgent = studio.agency.subAgents.find(agent => agent.enabled && (!input.subAgentId || agent.id === input.subAgentId));
    if (!subAgent) return { ok: false, error: "SUBAGENT_UNAVAILABLE" };
    const newTask = {
      id: "task_" + randomUUID(),
      title: (input.title || "协助整理项目文档并提炼 3 条核心建议").trim(),
      subAgentId: subAgent.id,
      status: "waiting_approval" as const,
      currentStep: 0,
      totalSteps: 1,
      stepLabel: "等待批准",
      riskLevel: "needs_owner_confirm" as const,
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
  const subAgent = studio.agency.subAgents.find(agent => agent.id === target.subAgentId && agent.enabled);
  const evidenceId = "evt_task_" + target.id;
  const claimId = "evt_task_claim_" + target.id;
  if (input.action === "execute") {
    const archive = runtime.archiveSignal;
    if (!runtime.storage.getEventById(evidenceId)) {
      if (runtime.storage.getEventById(claimId)) return { ok: false, error: "TASK_CLAIMED_WITHOUT_RECEIPT" };
      if (target.status !== "queued") return { ok: false, error: "TASK_NOT_QUEUED" };
      if (!subAgent) return { ok: false, error: "NO_TASK_EXECUTOR" };
      if (subAgent.executionMode === "agent_tool_loop") {
        if (!subAgent.allowedTools.length) return { ok: false, error: "NO_TASK_EXECUTOR" };
        if (!isTaskExecutionApproved(target, subAgent)) {
          return { ok: false, error: "EXECUTOR_APPROVAL_REQUIRED" };
        }
        const event = {
          wall_ts_ms: Date.now(), virtual_ts_ms: nowMs, source_channel_id: "studio.task",
          audience_scope: "only_owner", venue_type: "internal_background", modality: "text",
          state_rev_after: runtime.coordinator.getSnapshot().state_rev, active_modules_mask: 31
        } as const;
        try {
          runtime.storage.appendEvent({ ...event, event_id: claimId, event_category: "config_or_ablation_changed",
            principal_id: "owner:local", principal_trust: "owner_verified", summary_text: "已交给多步工具代理环执行",
            payload_json: JSON.stringify({ task_id: target.id, title: target.title, mode: "agent_tool_loop", allowedTools: subAgent.allowedTools }) });
        } catch (error) {
          if (runtime.storage.getEventById(claimId)) return { ok: false, error: "TASK_CLAIMED_WITHOUT_RECEIPT" };
          throw error;
        }
        target.status = "running";
        target.stepLabel = "多步工具环执行中";
        updateStudioConfig(runtime, { agency: { activeTasks: tasks } });
        try {
          runtime.workers.w2.startTask({
            task_id: target.id,
            goal: target.title,
            source_event_id: claimId,
            principal: "owner_verified",
            audience_scope: "only_owner",
            capability_risk: "high_side_effect_privileged",
            steps: [{ step_title: target.title }]
          });
          runtime.workers.w2.approveTask(target.id);
          const isRegisteredModelPkg = runtime.extensionHost
            .listFacets(agentModelAdapterFacet)
            .some((entry) => entry.packageId === subAgent.modelProviderId);
          const upstreamAdapter = isRegisteredModelPkg
            ? undefined
            : runtime.channelUpstream.asModelAdapter(subAgent.modelProviderId || "default");
          const loopOut = await runtime.workers.w2.executeToolLoopTask({
            taskId: target.id,
            inputs: [
              ...(subAgent.systemPrompt ? [{ role: "developer_frame" as const, content: subAgent.systemPrompt, source: "studio.subagent" }] : []),
              { role: "user" as const, content: target.title, source: "studio.task" }
            ],
            adapter: upstreamAdapter,
            modelPackageId: isRegisteredModelPkg ? subAgent.modelProviderId : undefined,
            manualPackageIds: subAgent.skillIds.map((skillId) => `carrier:skill:${skillId}`),
            allowedTools: subAgent.allowedTools,
            highRiskOwnerApproved: true,
            maxSteps: subAgent.maxSteps,
            signal: archive
          });
          archive.throwIfAborted();
          if (loopOut.report.stopReason !== "finished") throw new Error("TASK_STEP_LIMIT");
          const summary = (loopOut.report.rounds.at(-1)?.text || `已完成 ${loopOut.verifiedToolCount} 项工具操作`).slice(0, 240);
          runtime.storage.appendEvent({ ...event, event_id: evidenceId, event_category: "action_episode_completed",
            wall_ts_ms: Date.now(), virtual_ts_ms: runtime.virtualClock.nowMs(), principal_id: "subagent:" + subAgent.id,
            principal_trust: "tool_output", summary_text: summary,
            payload_json: JSON.stringify({ task_id: target.id, verified_tools: loopOut.verifiedToolCount }) });
        } catch {
          if (archive.aborted) return { ok: false, error: "EXECUTOR_RESULT_UNKNOWN" };
          const activeTasks = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks;
          const pending = activeTasks.find(task => task.id === target.id);
          if (pending) {
            pending.status = "paused";
            pending.stepLabel = "执行结果未知，等待核查";
            updateStudioConfig(runtime, { agency: { activeTasks } });
          }
          return { ok: false, error: "EXECUTOR_RESULT_UNKNOWN" };
        }
        const activeTasks = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks;
        const completed = activeTasks.find(task => task.id === target.id);
        if (!completed) return { ok: false, error: "TASK_NOT_FOUND" };
        completed.status = "completed";
        completed.currentStep = completed.totalSteps;
        completed.stepLabel = "多步工具环已完成";
        completed.outputSummary = runtime.storage.getEventById(evidenceId)!.summary_text;
        completed.evidenceId = evidenceId;
        return { ok: true, task: completed, studioConfig: updateStudioConfig(runtime, { agency: { activeTasks } }) };
      }
      const ref = subAgent.executor;
      if (!ref) return { ok: false, error: "NO_TASK_EXECUTOR" };
      if (!isTaskExecutionApproved(target, subAgent)) {
        return { ok: false, error: "EXECUTOR_APPROVAL_REQUIRED" };
      }
      let execute;
      try {
        execute = runtime.extensionHost.bindService(taskExecutorContract(ref), ref.provider);
      } catch (error) {
        if (error instanceof ServiceBindingError) return { ok: false, error: "EXECUTOR_" + error.reason.status.toUpperCase() };
        throw error;
      }
      const event = {
        wall_ts_ms: Date.now(), virtual_ts_ms: nowMs, source_channel_id: "studio.task",
        audience_scope: "only_owner", venue_type: "internal_background", modality: "text",
        state_rev_after: runtime.coordinator.getSnapshot().state_rev, active_modules_mask: 31
      } as const;
      // A durable unique claim precedes dispatch. A restart or ambiguous result must never replay an effect.
      try {
        runtime.storage.appendEvent({ ...event, event_id: claimId, event_category: "config_or_ablation_changed",
          principal_id: "owner:local", principal_trust: "owner_verified", summary_text: "已交给任务执行器",
          payload_json: JSON.stringify({ task_id: target.id, title: target.title, executor: ref }) });
      } catch (error) {
        if (runtime.storage.getEventById(claimId)) return { ok: false, error: "TASK_CLAIMED_WITHOUT_RECEIPT" };
        throw error;
      }
      target.status = "running";
      target.stepLabel = "已派发，等待执行回执";
      updateStudioConfig(runtime, { agency: { activeTasks: tasks } });
      try {
        const taskInput = { taskId: target.id, title: target.title, subAgentId: subAgent.id, allowedTools: subAgent.allowedTools };
        const captured = execute;
        const live = () => {
          if (archive.aborted) return false;
          const agency = readConsoleStudioConfig(runtime.soulDir).agency;
          const task = agency.activeTasks.find(item => item.id === target.id);
          const agent = agency.subAgents.find(item => item.id === subAgent.id && item.enabled);
          return !!task && !!agent && task.status === "running" && isTaskExecutionApproved(task, agent);
        };
        const report = await runtime.workers.w2.executeApprovedAction({
          signal: AbortSignal.any([archive, runtime.pluginSignal(ref.provider, "live")]),
          action: { call: { kind: "tool", id: claimId, name: ref.name, input: taskInput }, live,
            definition: { name: ref.name, description: "Execute the approved task",
              inputSchema: { jsonSchema: { type: "object", required: ["taskId","title","subAgentId","allowedTools"] }, parse: TaskExecutorInputSchema.parse },
              resultSchema: { jsonSchema: { type: "object", required: ["summary","evidence"] }, parse: TaskExecutorReceiptSchema.parse },
              execute: async (call, signal) => ({ status: "verified", value: await captured(TaskExecutorInputSchema.parse(call.input), signal) }),
              project: value => ({ summary: TaskExecutorReceiptSchema.parse(value).summary }) } },
          verifyGoal(rounds) {
            const item = rounds[0]?.receipts[0];
            if (!item || item.call.id !== claimId || item.result.status !== "verified") return false;
            const parsed = TaskExecutorReceiptSchema.safeParse(item.result.value);
            return parsed.success && Object.keys(parsed.data.evidence).length > 0;
          }
        });
        const result = report.rounds[0]?.receipts[0]?.result;
        archive.throwIfAborted();
        if (report.goalVerification !== "verified" || !result || result.status !== "verified") throw new Error("TASK_RECEIPT_UNVERIFIED");
        const receipt = TaskExecutorReceiptSchema.parse(result.value);
        runtime.storage.appendEvent({ ...event, event_id: evidenceId, event_category: "action_episode_completed",
          wall_ts_ms: Date.now(), virtual_ts_ms: runtime.virtualClock.nowMs(), principal_id: "executor:" + ref.provider,
          principal_trust: "tool_output", summary_text: receipt.summary,
          payload_json: JSON.stringify({ ...receipt.evidence, task_id: target.id, executor: ref }) });
      } catch {
        if (archive.aborted) return { ok: false, error: "EXECUTOR_RESULT_UNKNOWN" };
        const activeTasks = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks;
        const pending = activeTasks.find(task => task.id === target.id);
        if (pending) {
          pending.status = "paused";
          pending.stepLabel = "执行结果未知，等待核查";
          updateStudioConfig(runtime, { agency: { activeTasks } });
        }
        return { ok: false, error: "EXECUTOR_RESULT_UNKNOWN" };
      }
    }
    const activeTasks = readConsoleStudioConfig(runtime.soulDir).agency.activeTasks;
    const completed = activeTasks.find(task => task.id === target.id);
    if (!completed) return {ok:false,error:"TASK_NOT_FOUND"};
    completed.status = "completed";
    completed.currentStep = completed.totalSteps;
    completed.stepLabel = "执行回执已记录";
    completed.outputSummary = runtime.storage.getEventById(evidenceId)!.summary_text;
    completed.evidenceId = evidenceId;
    return { ok: true, task: completed, studioConfig: updateStudioConfig(runtime, { agency: { activeTasks } }) };
  }
  if (!["approve", "pause"].includes(input.action)) return { ok: false, error: "UNKNOWN_TASK_ACTION" };
  if (target.status === "completed") return { ok: false, error: "TASK_ALREADY_COMPLETED" };
  if (runtime.storage.getEventById(claimId)) return { ok: false, error: "TASK_ALREADY_DISPATCHED" };
  if (input.action === "approve" && !subAgent) return { ok: false, error: "SUBAGENT_UNAVAILABLE" };
  target.approvedExecutor = input.action === "approve" ? subAgent?.executor : undefined;
  target.approvedRequestDigest = input.action === "approve" && subAgent ? taskExecutionApprovalDigest(target, subAgent) : undefined;
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
  input: { slug: string; displayName: string; primaryRole: RolePresetId; avatarEmoji?: string }
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
  const preset = resolveRolePreset(input.primaryRole);
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
