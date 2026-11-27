import type { ExtensionCoreHost } from "@ai0/sdk";
import type { ChannelProtocolGateway } from "@ai0/gateway";
import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  AdminOperation, AdminRouteHandler, AdminTelemetryFrame, AdminTelemetryTrack
} from "@ai0/gateway";
import {
  fetchUpstreamProviderModels,
  probeUpstreamModelInstance
} from "@ai0/agent-core";
import {
  type InteractionOpportunityPool
} from "@ai0/expression-core";
import {
  type SensoryCoverageBucketManager,
  type SensoryCoverageUpdate
} from "@ai0/perception-core";
import {
  buildRegionBindingsFromProfile,
  resolveSessionProfile,
  toBrainRouterConfig,
  type AuthoritativeStateCoordinator,
  type BlackboardCompiler,
  type BlackboardPolicy,
  type StandardBrainRegion as BrainRegion,
  type CoordinatorDecisionTrace as CoordinatorTrace,
  type MetabolicRegionRouter as BrainRegionRouter,
  type VirtualClock
} from "@ai0/cognition-core";
import {
  AgentConfigProfileSchema, AudienceScopeSchema, DaemonSystemSettingsSchema, getSupportedReasoningEfforts,
  KnowledgeCapabilityConfigSchema, McpServerConfigSchema, ModelInstanceSchema, CarrierProjectionSchema,
  MultimodalCapabilityConfigSchema, PlatformChannelInstanceSchema,
  ProviderInstanceSchema, ProviderSourceSchema, UmoRoutingRuleSchema,
  VenueTypeSchema,
  type AudienceScope, type CapabilityRisk, type ModelInstance, type ProviderSource, type SensorModality, type VenueType
} from "@ai0/protocol";
import { bundlePrivacyScrubbedCreatorAsset, decodeLorebookSimulation, decodeProfileCard } from "./asset-bundler.js";
import { GOLDEN_REGRESSION_SCENARIO_V1, runScenarioPlaybook } from "./scenario-runner.js";
import type { W1FastDialogueWorker } from "./turn-coordinator.js";
import {
  addSourceApiKey, deleteMcpServerConfig, deleteModelInstance,
  deletePlatformChannelInstance, deleteProviderInstance, deleteProviderSource,
  deleteUserAgentSkill, extractGistCardsBeforeUnmount,
  findProviderReferences, getModelCatalogEntry, importMcpServersFromJson, importUserSkillMarkdown,
  inferModelCapabilities, listAgentSkills, makeDefaultModelInstanceId,
  prepareKnowledgeLibrary, PLATFORM_ADAPTER_TEMPLATES, PROVIDER_VENDOR_TEMPLATES,
  readConsoleStudioConfig, readHostInfrastructureConfig, readSoulProfileConfig, removeSourceApiKey,
  resolveEffectiveSourceApiKeys, sameProviderCatalogConnection, saveUserAgentSkill, setAgentSkillEnabled,
  updateModelInstanceHealth, updateSourceApiKey, upsertMcpServerConfig,
  upsertModelInstance, upsertPlatformChannelInstance, upsertProviderInstance,
  upsertProviderSource, writeHostInfrastructureConfig, writeSoulProfileConfig,
  type CoordinatorStorageMutator, type HardForgetEngine, type SoulArchiveManager
} from "@ai0/storage";
import { knowledgeAdmin } from "./knowledge-admin.js";
import type { Ai0DaemonRuntime } from "./index.js";
import { createLifecycleAdminHandlers } from "./soul-lifecycle.js";
import { probeMcpServer, sameMcpConnection, withCurrentMcpDiscovery } from "./mcp-probe.js";
import type { DiscoveredPlugin, InstallExternalPluginInput, RuntimePluginLoader } from "./plugin-loader.js";

type Json = Record<string, unknown>;
export interface CircadianAnchor { hour: number; energy: number }
export interface DaemonMutableState {
  rollbackInProgress?: boolean;
  virtualOffsetHours: number; debounceWindowMs: number; circadianAnchors: CircadianAnchor[];
  telemetryFrames: AdminTelemetryFrame[]; sandboxForks: Map<string, CoordinatorStorageMutator>;
}
export interface DaemonHandlerContext {
  readonly runtime: Ai0DaemonRuntime;
  reloadExtension(id: string, mode: "live" | "sandbox", config: Json, expected?: number): Promise<number>;
  reloadSingleExtension(id: string, mode: "live" | "sandbox"): Promise<{ rev: number; generation?: string }>;
  refreshCapabilities(changed?: boolean): Promise<void>;
  reloadAllExtensions(): Promise<{ count: number; revision: number }>;
  installExternalExtension(input: InstallExternalPluginInput): Promise<DiscoveredPlugin>;
  uninstallExternalExtension(id: string, keepConfig: boolean): Promise<void>;
  pluginLoader: RuntimePluginLoader;
  bundledSkillsDir: string;
  channelGateway: ChannelProtocolGateway;
  soulDir: string;
  hostDir: string;
  storage: CoordinatorStorageMutator; sandboxStorage: CoordinatorStorageMutator;
  hardForgetEngine: HardForgetEngine; sandboxHardForgetEngine: HardForgetEngine;
  soulArchiveManager: SoulArchiveManager; virtualClock: VirtualClock; sandboxClock: VirtualClock;
  coordinator: AuthoritativeStateCoordinator; sandboxCoordinator: AuthoritativeStateCoordinator;
  blackboardCompiler: BlackboardCompiler; sandboxBlackboardCompiler: BlackboardCompiler;
  brainRegionRouter: BrainRegionRouter; extensionHost: ExtensionCoreHost;
  sandboxExtensionHost: ExtensionCoreHost; sensoryCoverage: SensoryCoverageBucketManager;
  opportunityPool: InteractionOpportunityPool; sandboxW1: W1FastDialogueWorker;
  coordinatorTraces: CoordinatorTrace[]; state: DaemonMutableState;
  emitTelemetry(track: AdminTelemetryTrack, payload: unknown,
    target?: "live" | `sandbox:${string}`, timestampMs?: number): void;
  replaceLiveStorage?(storage: CoordinatorStorageMutator): void;
}

const REGIONS: BrainRegion[] = ["W1_fast_dialogue", "W2_agency_planner",
  "W3_sleep_curiosity", "W4_multimodal", "L0_crisis_classifier"];
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bodyOf = (value: unknown): Json => isRecord(value) ? value : {};
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string") : [];
const finite = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const rows = (storage: CoordinatorStorageMutator, sql: string): Json[] =>
  storage.sqlite.prepare(sql).all() as unknown as Json[];

function unsupportedReasoningEffort(source: ProviderSource | undefined, model: ModelInstance, stored?: ModelInstance) {
  if (!model.reasoningEffort) return undefined;
  const allowed = source && model.capabilityKind === "chat"
    ? getSupportedReasoningEfforts(source.adapterType, model.modelId, getModelCatalogEntry(source, model.modelId, stored), source.baseUrl)
    : [];
  return allowed.includes(model.reasoningEffort) ? undefined : {
    status: 400,
    body: { error: "UNSUPPORTED_REASONING_EFFORT", message: "当前模型不支持所选推理强度。", allowed }
  };
}

function unavailableCatalogLimit(source: ProviderSource | undefined, model: ModelInstance, stored?: ModelInstance) {
  const catalog = source ? getModelCatalogEntry(source, model.modelId, stored) : undefined;
  if ((model.useCatalogContextWindow && !stored?.useCatalogContextWindow && catalog?.contextWindow === undefined) ||
      (model.useCatalogMaxOutputTokens && !stored?.useCatalogMaxOutputTokens && catalog?.maxOutputTokens === undefined)) {
    return { status: 400, body: { error: "MODEL_CATALOG_LIMIT_UNAVAILABLE", message: "模型目录未提供所选上限，请刷新目录或改用本地设置。" } };
  }
  return undefined;
}

function localTemplateCatalog(source: ProviderSource) {
  if (source.adapterType !== "custom_http") return undefined;
  const baseUrl = source.baseUrl.trim().replace(/\/+$/u, "");
  const preset = PROVIDER_VENDOR_TEMPLATES.find((template) => !template.requiresApiKey &&
    template.adapterType === source.adapterType && template.vendor === source.vendor &&
    template.defaultBaseUrl === baseUrl && source.supportedCapabilities.includes(template.capabilityKind));
  return preset?.defaultModels.map((modelId) => ({
    modelId,
    inferredCapability: preset.capabilityKind,
    capabilities: inferModelCapabilities(modelId, preset.capabilityKind)
  }));
}

function selected(runtime: DaemonHandlerContext, target: "live" | `sandbox:${string}`) {
  const sandbox = target !== "live";
  return { storage: sandbox ? runtime.sandboxStorage : runtime.storage,
    engine: sandbox ? runtime.sandboxHardForgetEngine : runtime.hardForgetEngine,
    clock: sandbox ? runtime.sandboxClock : runtime.virtualClock,
    coordinator: sandbox ? runtime.sandboxCoordinator : runtime.coordinator,
    compiler: sandbox ? runtime.sandboxBlackboardCompiler : runtime.blackboardCompiler,
    extensions: sandbox ? runtime.sandboxExtensionHost : runtime.extensionHost };
}

export async function readRedactionLedgerCount(soulDir: string): Promise<number> {
  try {
    const value: unknown = JSON.parse(await readFile(join(soulDir, "state", "redaction_ledger.json"), "utf8"));
    return Array.isArray(value) ? value.length : isRecord(value) && Array.isArray(value.entries)
      ? value.entries.length : 0;
  } catch { return 0; }
}

function circadianAt(hour: number, anchors: CircadianAnchor[]): number {
  const ordered = [...anchors].sort((a, b) => a.hour - b.hour);
  if (!ordered.length) return 1;
  const extended = [{ ...ordered.at(-1)!, hour: ordered.at(-1)!.hour - 24 }, ...ordered,
    { ...ordered[0]!, hour: ordered[0]!.hour + 24 }];
  const right = extended.findIndex((item) => item.hour >= hour);
  const a = extended[Math.max(0, right - 1)]!, b = extended[Math.max(1, right)]!;
  return a.energy + (b.energy - a.energy) * ((hour - a.hour) / Math.max(1, b.hour - a.hour));
}

export function buildHomeostasisSamples(
  snapshot: ReturnType<AuthoritativeStateCoordinator["getSnapshot"]>, anchors: CircadianAnchor[]
) {
  const fast0 = snapshot.D2_CONTINUOUS_STATES.values.instant_valence;
  const slow0 = snapshot.D2_CONTINUOUS_STATES.values.mood_baseline_val;
  if (fast0 === undefined || slow0 === undefined) return [];
  return Array.from({ length: 24 }, (_, hour) => {
    const slowDecay = Math.exp((-Math.LN2 * hour) / 24);
    const fastDecay = Math.exp((-Math.LN2 * hour) / 0.5);
    const slowAffect = Math.max(-1, Math.min(1, slow0 * slowDecay));
    const fastAffect = Math.max(-1, Math.min(1, slowAffect + (fast0 - slow0) * fastDecay));
    return { hour, circadian: circadianAt(hour, anchors), fastAffect, slowAffect };
  });
}

function gateView(runtime: DaemonHandlerContext) {
  return { debounce_window_ms: runtime.state.debounceWindowMs,
    opportunity_pool: runtime.opportunityPool.list(), sensory_coverage: runtime.sensoryCoverage.list() };
}

async function listRollbackSnapshots(manager: SoulArchiveManager): Promise<string[]> {
  try {
    const entries = await readdir(manager.snapshotsDirectory, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name));
    const verified = await Promise.all(candidates.map(async ({ name }) => {
      const stateDir = join(manager.snapshotsDirectory, name, "state");
      const state = await lstat(stateDir).catch(() => undefined);
      if (!state?.isDirectory()) return undefined;
      const file = await lstat(join(stateDir, "soul_core.sqlite")).catch(() => undefined);
      return file?.isFile() ? name : undefined;
    }));
    return verified.filter((name): name is string => name !== undefined).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function createRealAdminHandlers(
  runtime: DaemonHandlerContext
): Partial<Record<AdminOperation, AdminRouteHandler>> {
  return {
    ...createLifecycleAdminHandlers(() => runtime.runtime),
    "blackboard.compilePreview": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      const audience = body.audience_scope === "only_owner" ? "only_owner" : "public_all";
      const requestPreview = await runtime.runtime.previewChannelRequest({ text: typeof body.text === "string" ? body.text : "",
        principalId: "owner:local", audience_scope: audience, venue_type: audience === "only_owner" ? "private_1on1" : "public_livestream",
        mode: context.target_instance === "live" ? "live" : "sandbox" }, readConsoleStudioConfig(runtime.runtime.soulDir));
      const source = isRecord(body.policy) ? body.policy : body;
      const policy: BlackboardPolicy = {
        max_total_tokens: finite(source.max_total_tokens, 2_200),
        tier0_safety_invariants: String(source.tier0_safety_invariants ??
          ""),
        ...(isRecord(source.slots) ? { slots: source.slots as BlackboardPolicy["slots"] } : {}),
        ...(typeof source.memory_projection_text === "string"
          ? { memory_projection_text: source.memory_projection_text } : {}),
        ...(typeof source.narrative_self_text === "string"
          ? { narrative_self_text: source.narrative_self_text } : {})
      };
      const snapshot = await backend.compiler.compile(backend.coordinator.getSnapshot(), policy, audience);
      return { ...snapshot, ...requestPreview, compiled_prompt_text: requestPreview.promptText };
    },
    "channels.topology": (_request, context) => ({
      active_sessions: runtime.channelGateway.listConnections(context.target_instance),
      channel_extensions: selected(runtime, context.target_instance).extensions.listPackages()
        .filter((item) => item.manifest.facets.includes("channel.bridge")),
      sensory_coverage: runtime.sensoryCoverage.list()
    }),
    "channels.thalamicGate": (request) => {
      const body = bodyOf(request.body);
      if (request.method !== "GET") {
        if (body.debounce_window_ms !== undefined)
          runtime.state.debounceWindowMs = Math.max(0, finite(body.debounce_window_ms, 1_200));
        if (isRecord(body.opportunity)) runtime.opportunityPool.add(body.opportunity as never);
        if (typeof body.opportunity_id === "string" && typeof body.lifecycle === "string")
          runtime.opportunityPool.transition(body.opportunity_id, body.lifecycle as never);
        if (isRecord(body.sensory_coverage))
          runtime.sensoryCoverage.upsert(body.sensory_coverage as unknown as SensoryCoverageUpdate);
      }
      return gateView(runtime);
    },
    "soul.distill": async (request, context) => {
      await runtime.refreshCapabilities();
      const body = bodyOf(request.body);
      return decodeProfileCard(selected(runtime, context.target_instance).extensions, body.asset ?? body.card ?? body,
        typeof body.format === "string" ? body.format : undefined, typeof body.provider === "string" ? body.provider : undefined);
    },
    "soul.lorebooks.simulate": async (request, context) => {
      await runtime.refreshCapabilities();
      const body = bodyOf(request.body), entries = Array.isArray(body.entries) ? body.entries : [];
      return { activated_entries: await decodeLorebookSimulation(selected(runtime, context.target_instance).extensions, entries, String(body.utterance ?? "")) };
    },
    "soul.homeostasis": (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      let mutation: unknown;
      if (request.method === "PATCH" && context.target_instance !== "live") {
        const snapshot = backend.coordinator.getSnapshot();
        mutation = backend.coordinator.submitProposal({ proposal_id: `admin:affect:${backend.clock.nowMs()}`,
          domain: "D2_CONTINUOUS_STATES", base_rev: snapshot.domain_revs.D2_CONTINUOUS_STATES,
          payload: bodyOf(body.impulse ?? body) });
      } else if (request.method === "PATCH" && Array.isArray(body.circadian_anchors)) {
        runtime.state.circadianAnchors = body.circadian_anchors.filter(isRecord).map((item) => ({
          hour: Math.max(0, Math.min(23, finite(item.hour, 0))),
          energy: Math.max(0, Math.min(1, finite(item.energy, 1))) }));
      }
      const snapshot = backend.coordinator.getSnapshot();
      return { current: snapshot.D2_CONTINUOUS_STATES.values,
        samples: buildHomeostasisSamples(snapshot, runtime.state.circadianAnchors),
        circadian_anchors: runtime.state.circadianAnchors, mutation };
    },
    "memory.lineage": async (_request, context) => {
      const storage = selected(runtime, context.target_instance).storage;
      const memories = rows(storage, "SELECT * FROM memories ORDER BY created_virtual_ts DESC");
      const events = rows(storage, "SELECT * FROM event_log ORDER BY event_seq DESC");
      return { nodes: [...memories.map((node) => ({ node_type: "memory", ...node })),
        ...events.map((node) => ({ node_type: "event", ...node }))],
        edges: rows(storage, "SELECT * FROM memory_lineage_edges ORDER BY child_memory_id, parent_id"),
        redaction_ledger_count: context.target_instance === "live"
          ? await readRedactionLedgerCount(runtime.soulDir) : 0 };
    },
    "memory.hardForget": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance), now = backend.clock.nowMs();
      const result = await backend.engine.execute({ target_event_ids: strings(body.target_event_ids),
        target_memory_ids: strings(body.target_memory_ids), virtualTsMs: now, redactedAtTsMs: now,
        ...(context.target_instance === "live" ? { soulDirPath: runtime.soulDir } : {}) });
      runtime.runtime.modelRequests[context.target_instance === "live" ? "live" : "sandbox"].clear();
      backend.coordinator.restoreCheckpoint();
      return result;
    },
    "memory.topicSeal": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance), now = backend.clock.nowMs();
      const result = await backend.engine.executeTopicSeal({ topic_description: String(body.topic_description ?? ""),
        target_event_ids: strings(body.target_event_ids), target_memory_ids: strings(body.target_memory_ids),
        virtualTsMs: now, redactedAtTsMs: now, created_virtual_ts: now,
        ...(context.target_instance === "live" ? { soulDirPath: runtime.soulDir } : {}) });
      runtime.runtime.modelRequests[context.target_instance === "live" ? "live" : "sandbox"].clear();
      backend.coordinator.restoreCheckpoint();
      return result;
    },
    "memory.knowledge.unmountGist": (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      const storage=context.target_instance==="live" || context.target_instance==="sandbox:console" ? backend.storage : runtime.state.sandboxForks.get(context.target_instance);
      if(!storage) return {status:404,body:{error:"沙盒不存在"}};
      prepareKnowledgeLibrary(storage);
      const cards = extractGistCardsBeforeUnmount(storage, String(body.collection_id ?? ""),
        backend.clock.nowMs(), backend.coordinator.getSnapshot().state_rev);
      return { gist_cards: cards.map((card) => ({ gist_id: card.memory_id,
        summary_under_150_chars: [...card.content_text].slice(0, 149).join("") })) };
    },
    "memory.relationship.releaseKnot": (request, context) => {
      const body = bodyOf(request.body), coordinator = selected(runtime, context.target_instance).coordinator;
      const before = coordinator.getSnapshot();
      const tensionId = typeof body.tension_id === "string" ? body.tension_id
        : before.D5_IDENTITY_NARRATIVE.active_tensions.find((item) => !item.resolved)?.id;
      const released = tensionId ? coordinator.releaseTensionByOwnerSovereignty(tensionId) : false;
      const snapshot = coordinator.getSnapshot();
      const audit = coordinator.submitProposal({ proposal_id: `one_click_release_knot:${Date.now()}`,
        domain: "D5_IDENTITY_NARRATIVE", base_rev: snapshot.domain_revs.D5_IDENTITY_NARRATIVE,
        payload: { operation: "one_click_release_knot", tension_id: tensionId ?? null } });
      return { released, tension_id: tensionId ?? null, audit };
    },
    "models.routing": (request, context) => {
      const body = bodyOf(request.body);
      const values = selected(runtime, context.target_instance).coordinator.getSnapshot().D2_CONTINUOUS_STATES.values;
      const metabolic = finite(body.metabolic_energy, values.metabolic_energy ?? 1);
      const circadian = finite(body.circadian_energy, values.circadian_energy ?? 1);
      return { regions: REGIONS.map((region) => ({ region,
        config: runtime.brainRegionRouter.getRegionConfig(region),
        route: runtime.brainRegionRouter.routeForRegion(region, metabolic, circadian) })),
        voice_drift: runtime.brainRegionRouter.evaluateVoiceDriftRadar(
          strings(body.baseline_samples), strings(body.candidate_samples)) };
    },
    "extensions.manage": (request, context) => {
      const body = bodyOf(request.body), host = selected(runtime, context.target_instance).extensions;
      if (request.method !== "GET" && typeof body.extension_id === "string" && typeof body.enabled === "boolean") {
        if (context.target_instance === "live") return { status: 403,
          body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
        if (!host.getPackage(body.extension_id)) return { status: 404, body: { error: "UNKNOWN_EXTENSION" } };
        host.setPackageEnabled(body.extension_id, body.enabled);
      }
      return { extensions: host.listPackages() };
    },
    "extensions.hotReload": async (request, context) => {
      const body = bodyOf(request.body), id = context.params.extensionId;
      const rev = await runtime.reloadExtension(id ?? "", context.target_instance === "live" ? "live" : "sandbox", bodyOf(body.config), finite(body.expected_rev, 0));
      return { extension_id: id, rev };
    },
    "extensions.market": async (request) => {
      const registryUrl = typeof request.query?.registry_url === "string" ? request.query.registry_url : undefined;
      const catalog = await runtime.pluginLoader.listMarketCatalog(registryUrl);
      return { entries: catalog };
    },
    "extensions.install": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const source = body.source === "local_path" || body.source === "manifest_bundle" || body.source === "market"
        ? body.source
        : undefined;
      if (!source) {
        return { status: 400, body: { error: "INVALID_INSTALL_SOURCE", message: "请指定安装来源 (local_path / manifest_bundle / market)" } };
      }
      try {
        const installed = await runtime.installExternalExtension({
          source,
          ...(typeof body.localPath === "string" ? { localPath: body.localPath } : {}),
          ...(isRecord(body.manifest) ? { manifest: body.manifest } : {}),
          ...(typeof body.marketEntryId === "string" ? { marketEntryId: body.marketEntryId } : {}),
          ...(typeof body.registryUrl === "string" ? { registryUrl: body.registryUrl } : {})
        });
        return {
          status: 201,
          body: {
            installed: runtime.pluginLoader.getDescriptor(installed.manifest.extension_id),
            revision: runtime.pluginLoader.revision
          }
        };
      } catch (err) {
        return {
          status: 400,
          body: { error: "EXTENSION_INSTALL_FAILED", message: err instanceof Error ? err.message : String(err) }
        };
      }
    },
    "extensions.reloadAll": async (_request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const res = await runtime.reloadAllExtensions();
      runtime.emitTelemetry("[SYS]", { action: "extensions_reloaded_all", ...res }, "live");
      return res;
    },
    "extensions.reloadOne": async (_request, context) => {
      const id = context.params.extensionId ?? "";
      if (!runtime.pluginLoader.getPlugin(id)) {
        return { status: 404, body: { error: "EXTENSION_NOT_FOUND" } };
      }
      const mode = context.target_instance === "live" ? "live" : "sandbox";
      const res = await runtime.reloadSingleExtension(id, mode);
      runtime.emitTelemetry("[SYS]", { action: "extension_reloaded", extensionId: id, ...res }, context.target_instance);
      return { extension_id: id, ...res };
    },
    "extensions.config": async (request, context) => {
      const id = context.params.extensionId ?? "";
      const plugin = runtime.pluginLoader.getPlugin(id);
      if (!plugin) return { status: 404, body: { error: "EXTENSION_NOT_FOUND" } };
      const mode = context.target_instance === "live" ? "live" : "sandbox";
      const host = mode === "live" ? runtime.extensionHost : runtime.sandboxExtensionHost;

      if (request.method === "GET") {
        const current = runtime.pluginLoader.getPluginConfig(host, id);
        return {
          extension_id: id,
          display_name: plugin.manifest.display_name,
          config_fields: plugin.manifest.console_contributions?.config_fields ?? [],
          config_schema: plugin.manifest.console_contributions?.config_schema,
          rev: current.rev,
          config: current.config
        };
      }

      const body = bodyOf(request.body);
      const nextConfig = isRecord(body.config) ? body.config : body;
      const expected = typeof body.expected_rev === "number" ? body.expected_rev : undefined;
      try {
        const rev = await runtime.reloadExtension(id, mode, nextConfig, expected);
        const updated = runtime.pluginLoader.getPluginConfig(host, id);
        runtime.emitTelemetry("[SYS]", { action: "extension_config_saved", extensionId: id, rev }, context.target_instance);
        return { extension_id: id, rev, config: updated.config };
      } catch (err) {
        return {
          status: 409,
          body: { error: "EXTENSION_CONFIG_UPDATE_FAILED", message: err instanceof Error ? err.message : String(err) }
        };
      }
    },
    "extensions.uninstall": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const id = context.params.extensionId ?? "";
      const keepConfig = request.query?.keep_config === "true";
      try {
        await runtime.uninstallExternalExtension(id, keepConfig);
        runtime.emitTelemetry("[SYS]", { action: "extension_uninstalled", extensionId: id, keepConfig }, "live");
        return { uninstalled: id, keepConfig };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("BUILTIN_PLUGIN_PROTECTED") ? 409 : 400;
        return { status, body: { error: status === 409 ? "BUILTIN_PLUGIN_PROTECTED" : "UNINSTALL_FAILED", message } };
      }
    },
    "extensions.mcp": async (request, context) => {
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      if (request.method === "GET") {
        return { mcpServers: infra.mcpServers };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const parsed = McpServerConfigSchema.safeParse({
        ...body,
        id: typeof body.id === "string" && body.id.trim()
          ? body.id.trim()
          : `mcp_${Date.now().toString(36)}`
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_MCP_SERVER", issues: parsed.error.issues } };
      }
      const saved = upsertMcpServerConfig(runtime.hostDir,
        withCurrentMcpDiscovery(parsed.data, infra.mcpServers.find(server => server.id === parsed.data.id)));
      await runtime.refreshCapabilities(true);
      runtime.emitTelemetry("[SYS]", { action: "mcp_server_upserted", serverId: parsed.data.id }, "live");
      return { status: 201, body: { server: saved.mcpServers.find((s) => s.id === parsed.data.id), mcpServers: saved.mcpServers } };
    },
    "extensions.mcpImportJson": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const payload = body.json ?? body.raw ?? request.body;
      try {
        const result = importMcpServersFromJson(runtime.hostDir, payload);
        await runtime.refreshCapabilities(true);
        runtime.emitTelemetry("[SYS]", { action: "mcp_servers_imported", count: result.imported.length }, "live");
        return { status: 201, body: { imported: result.imported, mcpServers: result.config.mcpServers } };
      } catch (err) {
        return { status: 400, body: { error: "MCP_JSON_IMPORT_FAILED", message: err instanceof Error ? err.message : String(err) } };
      }
    },
    "extensions.mcpItem": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const serverId = context.params.serverId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.mcpServers.find((s) => s.id === serverId);
      if (!existing) return { status: 404, body: { error: "MCP_SERVER_NOT_FOUND" } };

      if (request.method === "DELETE") {
        const saved = deleteMcpServerConfig(runtime.hostDir, serverId);
        await runtime.refreshCapabilities(true);
        runtime.emitTelemetry("[SYS]", { action: "mcp_server_deleted", serverId }, "live");
        return { deleted: serverId, mcpServers: saved.mcpServers };
      }

      const parsed = McpServerConfigSchema.safeParse({ ...existing, ...bodyOf(request.body), id: serverId });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_MCP_PATCH", issues: parsed.error.issues } };
      }
      const saved = upsertMcpServerConfig(runtime.hostDir, withCurrentMcpDiscovery(parsed.data, existing));
      await runtime.refreshCapabilities(true);
      runtime.emitTelemetry("[SYS]", { action: "mcp_server_updated", serverId }, "live");
      return { server: saved.mcpServers.find((s) => s.id === serverId), mcpServers: saved.mcpServers };
    },
    "extensions.mcpProbe": async (_request, context) => {
      if (context.target_instance !== "live") return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      const serverId = context.params.serverId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.mcpServers.find((s) => s.id === serverId);
      if (!existing) return { status: 404, body: { error: "MCP_SERVER_NOT_FOUND" } };
      const probe = await probeMcpServer(existing);
      const current = readHostInfrastructureConfig(runtime.hostDir).mcpServers.find(server => server.id === serverId);
      if (!current || !sameMcpConnection(existing, current)) return { status: 409, body: { error: "MCP_CONFIGURATION_CHANGED" } };
      const nextServer = McpServerConfigSchema.parse({
        ...current,
        status: probe.status,
        lastLatencyMs: probe.latencyMs,
        lastError: probe.ok ? undefined : probe.detail,
        lastProbedAt: new Date().toISOString(),
        discoveredTools: probe.ok ? probe.tools : existing.discoveredTools
      });
      upsertMcpServerConfig(runtime.hostDir, nextServer);
      await runtime.refreshCapabilities(true);
      runtime.emitTelemetry("[SYS]", { action: "mcp_server_probed", serverId, ok: probe.ok, toolCount: probe.tools.length }, context.target_instance);
      return { ...probe, server: nextServer };
    },
    "extensions.skills": async (request, context) => {
      if (request.method === "GET") {
        return { skills: listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir) };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      try {
        if (typeof body.rawMarkdown === "string" && body.rawMarkdown.trim()) {
          const imported = importUserSkillMarkdown(
            runtime.soulDir,
            body.rawMarkdown,
            typeof body.slug === "string" ? body.slug : undefined
          );
          await runtime.refreshCapabilities(true);
          runtime.emitTelemetry("[SYS]", { action: "skill_imported", skillId: imported.id }, "live");
          return { status: 201, body: { skill: imported, skills: listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir) } };
        }
        const displayName = String(body.displayName ?? "").trim();
        if (!displayName) {
          return { status: 400, body: { error: "INVALID_SKILL", message: "技能名称不能为空" } };
        }
        const risk =
          body.capabilityRisk === "low_read_and_scoped_write" || body.capabilityRisk === "high_side_effect_privileged"
            ? (body.capabilityRisk as CapabilityRisk)
            : "read_only_safe";
        const scopeParsed = AudienceScopeSchema.safeParse(body.maxAudienceScope ?? "only_owner");
        const created = saveUserAgentSkill(runtime.soulDir, {
          projections: CarrierProjectionSchema.array().optional().parse(body.projections),
          ...(typeof body.slug === "string" && body.slug.trim() ? { slug: body.slug.trim() } : {}),
          ...(typeof body.id === "string" && body.id.trim() ? { id: body.id.trim() } : {}),
          displayName,
          description: typeof body.description === "string" ? body.description : "",
          requiredMcpTools: strings(body.requiredMcpTools),
          requiredVaultSecrets: strings(body.requiredVaultSecrets),
          capabilityRisk: risk,
          maxAudienceScope: scopeParsed.success ? scopeParsed.data : "only_owner",
          inCharacterDemeanor: typeof body.inCharacterDemeanor === "string" ? body.inCharacterDemeanor : "",
          crystallizeAsEpisodicMemory: Boolean(body.crystallizeAsEpisodicMemory),
          bodyMarkdown: typeof body.bodyMarkdown === "string" ? body.bodyMarkdown : "",
          enabled: body.enabled !== false
        });
        await runtime.refreshCapabilities(true);
        runtime.emitTelemetry("[SYS]", { action: "skill_created", skillId: created.id }, "live");
        return { status: 201, body: { skill: created, skills: listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir) } };
      } catch (err) {
        return { status: 400, body: { error: "SKILL_SAVE_FAILED", message: err instanceof Error ? err.message : String(err) } };
      }
    },
    "extensions.skillItem": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const skillId = context.params.skillId ?? "";
      const all = listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir);
      const existing = all.find((s) => s.id === skillId || s.slug === skillId);
      if (!existing) return { status: 404, body: { error: "SKILL_NOT_FOUND" } };

      if (request.method === "DELETE") {
        try {
          deleteUserAgentSkill(runtime.soulDir, existing.id, runtime.bundledSkillsDir);
          await runtime.refreshCapabilities(true);
          runtime.emitTelemetry("[SYS]", { action: "skill_deleted", skillId: existing.id }, "live");
          return { deleted: existing.id, skills: listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir) };
        } catch (err) {
          return { status: 409, body: { error: "SKILL_READONLY", message: err instanceof Error ? err.message : String(err) } };
        }
      }

      const body = bodyOf(request.body);
      if (request.method === "PATCH" && typeof body.enabled === "boolean" && Object.keys(body).length === 1) {
        setAgentSkillEnabled(runtime.soulDir, existing.id, body.enabled);
        await runtime.refreshCapabilities(true);
        const skills = listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir);
        return { skill: skills.find((s) => s.id === existing.id), skills };
      }

      if (existing.readonly) {
        if (typeof body.enabled === "boolean") {
          setAgentSkillEnabled(runtime.soulDir, existing.id, body.enabled);
          await runtime.refreshCapabilities(true);
          const skills = listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir);
          return { skill: skills.find((s) => s.id === existing.id), skills };
        }
        return { status: 409, body: { error: "SKILL_READONLY", message: "内置技能为只读，请先复制为用户技能后再编辑内容" } };
      }

      const risk =
        body.capabilityRisk === "low_read_and_scoped_write" || body.capabilityRisk === "high_side_effect_privileged"
          ? (body.capabilityRisk as CapabilityRisk)
          : existing.capabilityRisk;
      const scopeParsed = AudienceScopeSchema.safeParse(body.maxAudienceScope ?? existing.maxAudienceScope);
      const projections = CarrierProjectionSchema.array().optional().safeParse(body.projections);
      if (!projections.success) return { status: 400, body: { error: "INVALID_SKILL_PROJECTIONS" } };
      const updated = saveUserAgentSkill(runtime.soulDir, {
        projections: projections.data ?? existing.projections,
        slug: existing.slug,
        id: existing.id,
        displayName: typeof body.displayName === "string" && body.displayName.trim() ? body.displayName : existing.displayName,
        description: typeof body.description === "string" ? body.description : existing.description,
        requiredMcpTools: Array.isArray(body.requiredMcpTools) ? strings(body.requiredMcpTools) : existing.requiredMcpTools,
        requiredVaultSecrets: Array.isArray(body.requiredVaultSecrets) ? strings(body.requiredVaultSecrets) : existing.requiredVaultSecrets,
        capabilityRisk: risk,
        maxAudienceScope: scopeParsed.success ? scopeParsed.data : existing.maxAudienceScope,
        inCharacterDemeanor: typeof body.inCharacterDemeanor === "string" ? body.inCharacterDemeanor : existing.inCharacterDemeanor,
        crystallizeAsEpisodicMemory:
          typeof body.crystallizeAsEpisodicMemory === "boolean"
            ? body.crystallizeAsEpisodicMemory
            : existing.crystallizeAsEpisodicMemory,
        bodyMarkdown: typeof body.bodyMarkdown === "string" ? body.bodyMarkdown : existing.bodyMarkdown,
        enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled
      });
      runtime.emitTelemetry("[SYS]", { action: "skill_updated", skillId: updated.id }, "live");
      await runtime.refreshCapabilities(true);
      return { skill: updated, skills: listAgentSkills(runtime.soulDir, runtime.bundledSkillsDir) };
    },
    "extensions.bundleExport": (request) => {
      const bundle = bundlePrivacyScrubbedCreatorAsset(bodyOf(request.body).asset ?? request.body);
      return { filename: bundle.filename, sha256: bundle.sha256, excluded_keys: bundle.excluded_keys };
    },
    "runtime.agent": async (request, context) => {
      if (context.target_instance !== "live" && context.target_instance !== "sandbox:console")
        return { status: 404, body: { error: "UNKNOWN_AGENT_HOST" } };
      const body = bodyOf(request.body);
      if (typeof body.text !== "string" || !body.text.trim() ||
          (body.modelPackageId !== undefined && (typeof body.modelPackageId !== "string" || !body.modelPackageId)))
        return { status: 400, body: { error: "INVALID_AGENT_REQUEST" } };
      return runtime.runtime.runAgent({
        mode: context.target_instance === "live" ? "live" : "sandbox",
        inputs: [{ source: "admin.owner", role: "user", content: body.text }],
        signal: request.signal ?? new AbortController().signal,
        bindings: { modelPackageId: body.modelPackageId as string | undefined }
      });
    },
    "runtime.modelRequest": (_request, context) => {
      if (context.target_instance !== "live" && context.target_instance !== "sandbox:console")
        return { status: 404, body: { error: "UNKNOWN_AGENT_HOST" } };
      return runtime.runtime.modelRequests[context.target_instance === "live" ? "live" : "sandbox"].read(context.params.stepId!)
        ?? { status: 404, body: { error: "MODEL_REQUEST_NOT_FOUND" } };
    },
    "runtime.traces": (request, context) => {
      const storage = selected(runtime, context.target_instance).storage;
      return { traces: storage.listDecisionTraces(finite(bodyOf(request.body).limit, 100)),
        telemetry_frames: runtime.coordinatorTraces.flatMap((trace) => trace.telemetry).slice(-400),
        admin_frames: runtime.state.telemetryFrames.slice(-200) };
    },
    "clock.advance": (request) => {
      const body = bodyOf(request.body), duration = body.duration_ms !== undefined
        ? finite(body.duration_ms, 0) : finite(body.hours, 0) * 3_600_000;
      const virtual_ts_ms = runtime.sandboxClock.advanceBy(duration,
        body.mode === "hibernation" ? "hibernation" : "active_unattended");
      runtime.state.virtualOffsetHours = (virtual_ts_ms - runtime.virtualClock.nowMs()) / 3_600_000;
      return { virtual_ts_ms, virtual_offset_hours: runtime.state.virtualOffsetHours };
    },
    "sandbox.fork": (request) => {
      const body = bodyOf(request.body), forkId = String(body.fork_id ?? body.fork_label ?? `console-${Date.now()}`);
      const fork = runtime.soulArchiveManager.forkSandboxInstance(forkId, {
        ...(typeof body.target_dir === "string" ? { targetDir: body.target_dir } : {}),
        ...(typeof body.source_snapshot_id === "string" ? { snapshotId: body.source_snapshot_id } : {}) });
      runtime.state.sandboxForks.set(fork.target_instance, fork.storage);
      return { target_instance: fork.target_instance, soul_dir: fork.soulDirPath };
    },
    "sandbox.inject": async (request, context) => {
      const body = bodyOf(request.body), perception = bodyOf(body.perception ?? body);
      const text = String(perception.summary_text ?? perception.text ?? ""), now = runtime.sandboxClock.nowMs();
      const eventId = String(perception.event_id ?? `evt_sandbox_${now}_${runtime.state.telemetryFrames.length}`);
      const venue = (perception.venue_type ?? "private_1on1") as VenueType;
      const audience = (perception.audience_scope ?? "only_owner") as AudienceScope;
      const modality = (perception.modality ?? "text") as SensorModality;
      return runtime.runtime.handleChannelTurn({
        mode: "sandbox", text, principalId: audience === "only_owner" ? "owner:local" : "sandbox:operator",
        channel_id: String(perception.channel_id ?? "sandbox.channel.default"), venue_type: venue, audience_scope: audience, modality
      }, { eventId });
    },
    "sandbox.scenarios.run": () => runScenarioPlaybook(GOLDEN_REGRESSION_SCENARIO_V1),
    "system.snapshots.rollback": async (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const manager = runtime.soulArchiveManager;
      const storage = runtime.storage;
      const snapshots = await listRollbackSnapshots(manager);
      if (request.method === "GET") return { snapshot_ids: snapshots };
      const body = bodyOf(request.body);
      if (body.snapshot_id !== undefined && typeof body.snapshot_id !== "string") {
        return { status: 400, body: { error: "INVALID_SNAPSHOT_ID" } };
      }
      const requested = typeof body.snapshot_id === "string" ? body.snapshot_id : undefined;
      if (requested !== undefined && !snapshots.includes(requested)) {
        return { status: 404, body: { error: "SNAPSHOT_NOT_FOUND" } };
      }
      if (runtime.state.rollbackInProgress || manager !== runtime.soulArchiveManager || storage !== runtime.storage)
        return { status: 409, body: { error: "SNAPSHOT_ROLLBACK_CONFLICT" } };
      runtime.state.rollbackInProgress = true;
      try {
        const safety = manager.createSnapshot(`pre-rollback-${Date.now()}`);
        const snapshotId = requested ?? safety.id;
        storage.close();
        const now = runtime.virtualClock.nowMs();
        try {
          const restored = await manager.rollbackToSnapshot(snapshotId,
            body.mode === "dream_bridge" || body.mode === "meta_reconciled" ? body.mode : "silent_hard", now);
          runtime.replaceLiveStorage?.(restored);
          return { rolled_back_to: snapshotId, safety_snapshot: safety, pragma_status: restored.getTablePragmaStatus() };
        } catch (error) {
          const restored = await manager.rollbackToSnapshot(safety.id, "silent_hard", now);
          runtime.replaceLiveStorage?.(restored);
          throw error;
        }
      } finally {
        runtime.state.rollbackInProgress = false;
      }
    },
    "system.safetySb243": (request, context) => {
      const body = bodyOf(request.body), storage = selected(runtime, context.target_instance).storage;
      const incremented = request.method === "POST" && body.increment_crisis_referral === true
        ? storage.incrementSb243CrisisCount(String(body.year_month ?? new Date().toISOString().slice(0, 7)))
        : undefined;
      return { metrics: storage.getSb243Metrics(), pragma_status: storage.getTablePragmaStatus(), incremented };
    },
    "integrations.sources": (request, context) => {
      if (request.method === "GET") {
        const infra = readHostInfrastructureConfig(runtime.hostDir);
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const sourceUsages = Object.fromEntries(
          infra.providerSources.map((src) => [src.id, findProviderReferences(src.id, soulProfiles)])
        );
        const modelUsages = Object.fromEntries(
          infra.modelInstances.map((mdl) => [mdl.id, findProviderReferences(mdl.sourceId, soulProfiles, mdl.modelId, mdl.id)])
        );
        return {
          sources: infra.providerSources,
          models: infra.modelInstances,
          templates: PROVIDER_VENDOR_TEMPLATES,
          sourceUsages,
          modelUsages
        };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const sourceId = typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : `src_${Date.now().toString(36)}`;
      const parsed = ProviderSourceSchema.safeParse({
        ...body,
        id: sourceId,
        apiKeys: [],
        discoveredModels: [],
        catalogSource: undefined,
        lastFetchedAt: undefined
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PROVIDER_SOURCE", issues: parsed.error.issues } };
      }
      let saved = upsertProviderSource(runtime.hostDir, parsed.data);
      const initialKey = typeof body.initialApiKey === "string" ? body.initialApiKey.trim() : typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (initialKey) {
        try {
          saved = addSourceApiKey(runtime.hostDir, sourceId, initialKey, "主密钥").config;
        } catch {
          // Allow source creation even if initial key was placeholder
        }
      }
      const initialModels = strings(body.initialModels);
      const defaultCap = parsed.data.supportedCapabilities[0] ?? "chat";
      for (const rawModelId of initialModels) {
        const modelId = rawModelId.trim();
        if (!modelId) continue;
        saved = upsertModelInstance(runtime.hostDir, {
          id: makeDefaultModelInstanceId(sourceId, modelId),
          sourceId,
          displayName: modelId,
          modelId,
          capabilityKind: defaultCap,
          enabled: true,
          capabilities: inferModelCapabilities(modelId, defaultCap),
          defaultTemperature: defaultCap === "chat" ? 0.75 : 0,
          defaultMaxTokens: defaultCap === "chat" ? 4096 : 512,
          customParams: {},
          health: { status: "untested", latencyMs: 0 }
        });
      }
      runtime.emitTelemetry("[SYS]", { action: "provider_source_created", sourceId }, "live");
      return {
        status: 201,
        body: {
          source: saved.providerSources.find((s) => s.id === sourceId),
          sources: saved.providerSources,
          models: saved.modelInstances
        }
      };
    },
    "integrations.sourceItem": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const sourceId = context.params.sourceId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.providerSources.find((s) => s.id === sourceId);
      if (!existing) return { status: 404, body: { error: "PROVIDER_SOURCE_NOT_FOUND" } };

      if (request.method === "DELETE") {
        const force = request.query?.force === "true";
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const usages = findProviderReferences(sourceId, soulProfiles);
        if (usages.length > 0 && !force) {
          return {
            status: 409,
            body: { error: "PROVIDER_IN_USE", message: "该服务来源下有模型正被配置文件或通用能力引用，请先解绑后再删除。", usages }
          };
        }
        const saved = deleteProviderSource(runtime.hostDir, sourceId);
        runtime.emitTelemetry("[SYS]", { action: "provider_source_deleted", sourceId }, "live");
        return { deleted: sourceId, sources: saved.providerSources, models: saved.modelInstances };
      }

      const body = bodyOf(request.body);
      const parsed = ProviderSourceSchema.safeParse({
        ...existing,
        ...body,
        id: sourceId,
        apiKeys: existing.apiKeys,
        discoveredModels: existing.discoveredModels,
        catalogSource: existing.catalogSource,
        lastFetchedAt: existing.lastFetchedAt
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PROVIDER_SOURCE_PATCH", issues: parsed.error.issues } };
      }
      const source = parsed.data;
      if (!sameProviderCatalogConnection(existing, source)) {
        source.discoveredModels = [];
        source.catalogSource = undefined;
        source.lastFetchedAt = undefined;
      }
      const saved = upsertProviderSource(runtime.hostDir, source);
      runtime.emitTelemetry("[SYS]", { action: "provider_source_updated", sourceId }, "live");
      return {
        source: saved.providerSources.find((s) => s.id === sourceId),
        sources: saved.providerSources,
        models: saved.modelInstances
      };
    },
    "integrations.sourceKeys": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const sourceId = context.params.sourceId ?? "";
      const body = bodyOf(request.body);
      const rawKey = String(body.apiKey ?? body.key ?? "").trim();
      const label = typeof body.label === "string" ? body.label : "";
      try {
        const { config, keyEntry } = addSourceApiKey(runtime.hostDir, sourceId, rawKey, label);
        runtime.emitTelemetry("[SYS]", { action: "provider_key_added", sourceId, kind: keyEntry.kind }, "live");
        return { status: 201, body: { keyEntry, source: config.providerSources.find((s) => s.id === sourceId) } };
      } catch (err) {
        return { status: 400, body: { error: "INVALID_API_KEY", message: err instanceof Error ? err.message : String(err) } };
      }
    },
    "integrations.sourceKeyItem": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const sourceId = context.params.sourceId ?? "";
      const keyId = context.params.keyId ?? "";
      try {
        if (request.method === "DELETE") {
          const saved = removeSourceApiKey(runtime.hostDir, sourceId, keyId);
          runtime.emitTelemetry("[SYS]", { action: "provider_key_deleted", sourceId, keyId }, "live");
          return { deleted: keyId, source: saved.providerSources.find((s) => s.id === sourceId) };
        }
        const body = bodyOf(request.body);
        const saved = updateSourceApiKey(runtime.hostDir, sourceId, keyId, {
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
          ...(typeof body.label === "string" ? { label: body.label } : {})
        });
        return { source: saved.providerSources.find((s) => s.id === sourceId) };
      } catch (err) {
        return { status: 404, body: { error: "PROVIDER_KEY_ERROR", message: err instanceof Error ? err.message : String(err) } };
      }
    },
    "integrations.sourceFetchModels": async (_request, context) => {
      const sourceId = context.params.sourceId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const source = infra.providerSources.find((s) => s.id === sourceId);
      if (!source) return { status: 404, body: { error: "PROVIDER_SOURCE_NOT_FOUND" } };
      const effectiveKeys = resolveEffectiveSourceApiKeys(runtime.hostDir, source);
      let result = await fetchUpstreamProviderModels({
        adapterType: source.adapterType,
        baseUrl: source.baseUrl,
        apiKeys: effectiveKeys,
        customHeaders: source.customHeaders,
        timeoutMs: Math.min(source.timeoutMs, 20000),
        fallbackCapability: source.supportedCapabilities[0] ?? "chat"
      });
      if (!result.ok && (!source.lastFetchedAt || source.catalogSource === "built_in") &&
          (result.httpStatus === undefined || result.httpStatus === 404 || result.httpStatus === 405)) {
        const localModels = localTemplateCatalog(source);
        if (localModels?.length) {
          result = { ...result, ok: true, models: localModels, catalogSource: "built_in", detail: "已加载本地预设目录，可添加模型后测试连接。" };
        }
      }
      let lastFetchedAt: string | undefined;
      if (result.ok && context.target_instance === "live") {
        const current = readHostInfrastructureConfig(runtime.hostDir)
          .providerSources.find((entry) => entry.id === sourceId);
        if (!current || !sameProviderCatalogConnection(current, source)) {
          result = { ...result, ok: false, models: [], catalogSource: undefined, detail: "拉取期间服务来源已变更，请重新拉取模型目录。" };
        } else {
          lastFetchedAt = new Date().toISOString();
          upsertProviderSource(runtime.hostDir, {
            ...current,
            discoveredModels: result.models,
            catalogSource: result.catalogSource,
            lastFetchedAt
          });
        }
      }
      runtime.emitTelemetry("[SYS]", { action: "provider_models_fetched", sourceId, ok: result.ok, count: result.models.length }, context.target_instance);
      return { ...result, lastFetchedAt };
    },
    "integrations.sourceImportModels": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const sourceId = context.params.sourceId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const source = infra.providerSources.find((entry) => entry.id === sourceId);
      if (!source) return { status: 404, body: { error: "PROVIDER_SOURCE_NOT_FOUND" } };

      const requested = bodyOf(request.body).modelIds;
      const ids = strings(requested);
      if (!Array.isArray(requested) || !ids.length || ids.length !== requested.length || ids.some((id) => !id.trim())) {
        return { status: 400, body: { error: "INVALID_MODEL_SELECTION", message: "请从目录选择至少一个模型。" } };
      }
      const selectedIds = [...new Set(ids)];
      const catalog = new Map(source.discoveredModels.map((entry) => [entry.modelId, entry]));
      const missingIds = selectedIds.filter((id) => !catalog.has(id));
      if (missingIds.length) {
        return { status: 400, body: { error: "MODEL_NOT_IN_CATALOG", message: "部分模型已不在此来源的目录中，请刷新后重新选择。", modelIds: missingIds } };
      }

      const existing = new Map(infra.modelInstances.filter((model) => model.sourceId === sourceId)
        .map((model) => [model.modelId, model]));
      const usedIds = new Set(infra.modelInstances.map((model) => model.id));
      const added: ModelInstance[] = [];
      const models = selectedIds.map((modelId) => {
        const configured = existing.get(modelId);
        if (configured) return configured;
        const entry = catalog.get(modelId)!;
        const capabilityKind = entry.inferredCapability;
        const defaultId = makeDefaultModelInstanceId(sourceId, modelId);
        const id = usedIds.has(defaultId) ? `${defaultId}_${randomUUID()}` : defaultId;
        const model = ModelInstanceSchema.parse({
          id,
          sourceId,
          modelId,
          displayName: modelId,
          capabilityKind,
          capabilities: entry.capabilities ?? inferModelCapabilities(modelId, capabilityKind),
          chatProtocol: entry.chatProtocol,
          supportsTemperature: entry.supportsTemperature,
          catalogContextWindow: entry.contextWindow,
          catalogContextWindowIsInputLimit: entry.contextWindowIsInputLimit,
          catalogMaxOutputTokens: entry.maxOutputTokens,
          useCatalogContextWindow: capabilityKind === "chat" && entry.contextWindow !== undefined ? true : undefined,
          useCatalogMaxOutputTokens: capabilityKind === "chat" && entry.maxOutputTokens !== undefined ? true : undefined,
          supportedReasoningEfforts: entry.supportedReasoningEfforts,
          defaultTemperature: capabilityKind === "chat" ? 0.75 : 0,
          defaultMaxTokens: capabilityKind === "chat" ? 4096 : 512
        });
        usedIds.add(id);
        added.push(model);
        return model;
      });
      if (added.length) {
        writeHostInfrastructureConfig(runtime.hostDir, { ...infra, modelInstances: [...infra.modelInstances, ...added] });
        runtime.emitTelemetry("[SYS]", { action: "provider_models_imported", sourceId, count: added.length }, "live");
      }
      return { models };
    },
    "integrations.models": (request, context) => {
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      if (request.method === "GET") {
        return { models: infra.modelInstances, sources: infra.providerSources };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const sourceId = String(body.sourceId ?? "").trim();
      const modelId = String(body.modelId ?? "").trim();
      const source = infra.providerSources.find((s) => s.id === sourceId);
      if (!source) return { status: 404, body: { error: "PROVIDER_SOURCE_NOT_FOUND" } };
      if (!modelId) return { status: 400, body: { error: "INVALID_MODEL_ID", message: "模型 ID 不能为空" } };
      const capKind = (typeof body.capabilityKind === "string" ? body.capabilityKind : source.supportedCapabilities[0] ?? "chat") as "chat" | "embedding" | "rerank" | "tts" | "stt" | "guard_lora";
      const instanceId =
        typeof body.id === "string" && body.id.trim()
          ? body.id.trim()
          : makeDefaultModelInstanceId(sourceId, modelId);
      const parsed = ModelInstanceSchema.safeParse({
        ...body,
        id: instanceId,
        sourceId,
        modelId,
        displayName: typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : modelId,
        capabilityKind: capKind,
        capabilities: isRecord(body.capabilities)
          ? body.capabilities
          : inferModelCapabilities(modelId, capKind)
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_MODEL_INSTANCE", issues: parsed.error.issues } };
      }
      const unsupported = unsupportedReasoningEffort(source, parsed.data) ?? unavailableCatalogLimit(source, parsed.data);
      if (unsupported) return unsupported;
      const saved = upsertModelInstance(runtime.hostDir, parsed.data);
      runtime.emitTelemetry("[SYS]", { action: "model_instance_created", instanceId, sourceId, modelId }, "live");
      return {
        status: 201,
        body: {
          model: saved.modelInstances.find((m) => m.id === instanceId),
          models: saved.modelInstances,
          sources: saved.providerSources
        }
      };
    },
    "integrations.modelItem": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const instanceId = context.params.instanceId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.modelInstances.find((m) => m.id === instanceId);
      if (!existing) return { status: 404, body: { error: "MODEL_INSTANCE_NOT_FOUND" } };

      if (request.method === "DELETE") {
        const force = request.query?.force === "true";
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const usages = findProviderReferences(existing.sourceId, soulProfiles, existing.modelId, existing.id);
        if (usages.length > 0 && !force) {
          return {
            status: 409,
            body: { error: "MODEL_IN_USE", message: "该模型实例正被配置文件或通用能力引用，请先解绑后再删除。", usages }
          };
        }
        const saved = deleteModelInstance(runtime.hostDir, instanceId);
        runtime.emitTelemetry("[SYS]", { action: "model_instance_deleted", instanceId }, "live");
        return { deleted: instanceId, models: saved.modelInstances };
      }

      const body = bodyOf(request.body);
      const parsed = ModelInstanceSchema.safeParse({
        ...existing,
        ...body,
        id: instanceId,
        sourceId: existing.sourceId,
        contextWindowOverride: body.contextWindowOverride === null ? undefined : body.contextWindowOverride ?? existing.contextWindowOverride,
        reasoningEffort: body.reasoningEffort === null ? undefined : body.reasoningEffort ?? existing.reasoningEffort,
        catalogContextWindow: existing.catalogContextWindow,
        catalogContextWindowIsInputLimit: existing.catalogContextWindowIsInputLimit,
        catalogMaxOutputTokens: existing.catalogMaxOutputTokens,
        supportedReasoningEfforts: existing.supportedReasoningEfforts
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_MODEL_PATCH", issues: parsed.error.issues } };
      }
      const model = parsed.data;
      const source = infra.providerSources.find((entry) => entry.id === model.sourceId);
      if (body.reasoningEffort !== undefined || model.modelId !== existing.modelId || model.capabilityKind !== existing.capabilityKind) {
        const unsupported = unsupportedReasoningEffort(source, model, existing);
        if (unsupported) return unsupported;
      }
      const unavailable = unavailableCatalogLimit(source, model, existing);
      if (unavailable) return unavailable;
      const saved = upsertModelInstance(runtime.hostDir, model);
      runtime.emitTelemetry("[SYS]", { action: "model_instance_updated", instanceId }, "live");
      return { model: saved.modelInstances.find((m) => m.id === instanceId), models: saved.modelInstances };
    },
    "integrations.modelTest": async (_request, context) => {
      const instanceId = context.params.instanceId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const model = infra.modelInstances.find((m) => m.id === instanceId);
      if (!model) return { status: 404, body: { error: "MODEL_INSTANCE_NOT_FOUND" } };
      const source = infra.providerSources.find((s) => s.id === model.sourceId);
      if (!source) return { status: 404, body: { error: "PROVIDER_SOURCE_NOT_FOUND" } };

      const apiKeys = resolveEffectiveSourceApiKeys(runtime.hostDir, source);
      const discoveredModel = getModelCatalogEntry(source, model.modelId, model);
      const probe = await probeUpstreamModelInstance({
        adapterType: source.adapterType,
        baseUrl: source.baseUrl,
        modelId: model.modelId,
        capabilityKind: model.capabilityKind,
        discoveredModel,
        reasoningEffort: model.reasoningEffort,
        maxTokens: (model.useCatalogMaxOutputTokens ? discoveredModel?.maxOutputTokens : undefined) ?? model.defaultMaxTokens,
        apiKeys,
        customHeaders: source.customHeaders,
        timeoutMs: Math.min(source.timeoutMs, 20000)
      });

      const nextHealth = {
        status: probe.status,
        latencyMs: probe.latencyMs,
        ...(probe.httpStatus !== undefined ? { httpStatus: probe.httpStatus } : {}),
        lastCheckedAt: new Date().toISOString(),
        detail: probe.detail,
        ...(probe.lastResponseSnippet ? { lastResponseSnippet: probe.lastResponseSnippet } : {})
      };
      if (context.target_instance === "live") {
        updateModelInstanceHealth(runtime.hostDir, instanceId, nextHealth);
      }
      runtime.emitTelemetry("[SYS]", { action: "model_instance_tested", instanceId, ok: probe.ok, latencyMs: probe.latencyMs }, context.target_instance);
      return { instanceId, ...probe, health: nextHealth };
    },
    "integrations.providers": (request, context) => {
      if (request.method === "GET") {
        const infra = readHostInfrastructureConfig(runtime.hostDir);
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const usages = Object.fromEntries(
          infra.providers.map((provider) => [provider.id, findProviderReferences(provider.id, soulProfiles)])
        );
        return { providers: infra.providers, templates: PROVIDER_VENDOR_TEMPLATES, usages };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const rawKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
      const parsed = ProviderInstanceSchema.safeParse({
        ...body,
        id: typeof body.id === "string" && body.id.trim()
          ? body.id.trim()
          : `prov_${Date.now().toString(36)}`
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PROVIDER", issues: parsed.error.issues } };
      }
      const saved = upsertProviderInstance(runtime.hostDir, parsed.data, rawKey);
      runtime.emitTelemetry("[SYS]", { action: "provider_upserted", providerId: parsed.data.id }, "live");
      return { status: 201, body: { provider: saved.providers.find((p) => p.id === parsed.data.id), providers: saved.providers } };
    },
    "integrations.providerItem": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const providerId = context.params.providerId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.providers.find((p) => p.id === providerId);
      if (!existing) return { status: 404, body: { error: "PROVIDER_NOT_FOUND" } };

      if (request.method === "DELETE") {
        const force = request.query?.force === "true";
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const usages = findProviderReferences(providerId, soulProfiles);
        if (usages.length > 0 && !force) {
          return {
            status: 409,
            body: { error: "PROVIDER_IN_USE", message: "该服务提供商正在被配置文件或通用能力引用，请先解绑后再删除。", usages }
          };
        }
        const saved = deleteProviderInstance(runtime.hostDir, providerId);
        runtime.emitTelemetry("[SYS]", { action: "provider_deleted", providerId }, "live");
        return { deleted: providerId, providers: saved.providers };
      }

      const body = bodyOf(request.body);
      const rawKey = typeof body.apiKey === "string" ? body.apiKey : undefined;
      const parsed = ProviderInstanceSchema.safeParse({ ...existing, ...body, id: providerId });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PROVIDER_PATCH", issues: parsed.error.issues } };
      }
      const saved = upsertProviderInstance(runtime.hostDir, parsed.data, rawKey);
      runtime.emitTelemetry("[SYS]", { action: "provider_updated", providerId }, "live");
      return { provider: saved.providers.find((p) => p.id === providerId), providers: saved.providers };
    },
    "integrations.providerPing": async (_request, context) => {
      const providerId = context.params.providerId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const provider = infra.providers.find((p) => p.id === providerId);
      if (!provider) return { status: 404, body: { error: "PROVIDER_NOT_FOUND" } };

      const started = Date.now();
      let latencyMs = 0;
      let status: "ready" | "configured" | "error" = "configured";
      let detail = "已配置接入参数；远端 API 需在真实对话调用时测量首字延迟";

      if (provider.adapterType === "builtin_local" || provider.baseUrl.startsWith("local://")) {
        status = "ready";
        latencyMs = 1;
        detail = "本地内建引擎就绪";
      } else if (URL.canParse(provider.baseUrl)) {
        const host = new URL(provider.baseUrl).hostname;
        if (["127.0.0.1", "localhost", "[::1]"].includes(host)) {
          try {
            const response = await fetch(provider.baseUrl, { method: "HEAD", signal: AbortSignal.timeout(900) });
            latencyMs = Date.now() - started;
            status = response.ok ? "ready" : "error";
            detail = `HTTP ${response.status}，本地端点响应耗时 ${latencyMs} ms`;
          } catch {
            status = "error";
            detail = "本地端点未响应，请检查服务是否启动";
          }
        }
      }

      const nextProvider = {
        ...provider,
        health: { status, latencyMs, lastCheckedAt: new Date().toISOString(), detail }
      };
      if (context.target_instance === "live") {
        upsertProviderInstance(runtime.hostDir, nextProvider);
      }
      return { providerId, status, latencyMs, detail, provider: nextProvider };
    },
    "integrations.platforms": (request, context) => {
      if (request.method === "GET") {
        const infra = readHostInfrastructureConfig(runtime.hostDir);
        const activeSessions = runtime.channelGateway.listConnections(context.target_instance);
        const channelExtensions = selected(runtime, context.target_instance).extensions.listPackages()
          .filter((item) => item.manifest.facets.includes("channel.bridge"));
        return {
          platforms: infra.platforms,
          templates: PLATFORM_ADAPTER_TEMPLATES,
          active_sessions: activeSessions,
          channel_extensions: channelExtensions
        };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const parsed = PlatformChannelInstanceSchema.safeParse({
        ...body,
        id: typeof body.id === "string" && body.id.trim()
          ? body.id.trim()
          : `platform_${Date.now().toString(36)}`
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PLATFORM", issues: parsed.error.issues } };
      }
      const saved = upsertPlatformChannelInstance(runtime.hostDir, parsed.data);
      runtime.emitTelemetry("[SYS]", { action: "platform_upserted", platformId: parsed.data.id }, "live");
      return { status: 201, body: { platform: saved.platforms.find((p) => p.id === parsed.data.id), platforms: saved.platforms } };
    },
    "integrations.platformItem": (request, context) => {
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const platformId = context.params.platformId ?? "";
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existing = infra.platforms.find((p) => p.id === platformId);
      if (!existing) return { status: 404, body: { error: "PLATFORM_NOT_FOUND" } };

      if (request.method === "DELETE") {
        if (existing.builtinPluginId) {
          return { status: 409, body: { error: "BUILTIN_PLATFORM_PROTECTED", message: "内置官方通道无法删除，请在插件管理中停用。" } };
        }
        const saved = deletePlatformChannelInstance(runtime.hostDir, platformId);
        runtime.emitTelemetry("[SYS]", { action: "platform_deleted", platformId }, "live");
        return { deleted: platformId, platforms: saved.platforms };
      }

      const body = bodyOf(request.body);
      const parsed = PlatformChannelInstanceSchema.safeParse({ ...existing, ...body, id: platformId });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_PLATFORM_PATCH", issues: parsed.error.issues } };
      }
      const saved = upsertPlatformChannelInstance(runtime.hostDir, parsed.data);
      runtime.emitTelemetry("[SYS]", { action: "platform_updated", platformId }, "live");
      return { platform: saved.platforms.find((p) => p.id === platformId), platforms: saved.platforms };
    },
    "config.profiles": (request, context) => {
      const current = readSoulProfileConfig(runtime.soulDir);
      if (request.method === "GET") return current;
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const nextProfiles = Array.isArray(body.profiles)
        ? body.profiles.map((item) => AgentConfigProfileSchema.parse(item))
        : current.profiles;
      const nextDefaultId = typeof body.defaultProfileId === "string" && nextProfiles.some((p) => p.id === body.defaultProfileId)
        ? body.defaultProfileId
        : nextProfiles[0]?.id ?? current.defaultProfileId;
      const saved = writeSoulProfileConfig(runtime.soulDir, {
        ...current,
        defaultProfileId: nextDefaultId,
        profiles: nextProfiles
      });
      const activeDefault = saved.profiles.find((p) => p.id === saved.defaultProfileId) ?? saved.profiles[0];
      if (activeDefault) {
        runtime.brainRegionRouter.updateRegions(toBrainRouterConfig(buildRegionBindingsFromProfile(activeDefault)));
        runtime.state.debounceWindowMs = activeDefault.conversationGate.debounceMs;
      }
      runtime.emitTelemetry("[SYS]", { action: "profiles_saved", defaultProfileId: saved.defaultProfileId, count: saved.profiles.length }, "live");
      return saved;
    },
    "config.routingRules": (request, context) => {
      const current = readSoulProfileConfig(runtime.soulDir);
      if (request.method === "GET") {
        return { defaultProfileId: current.defaultProfileId, routingRules: current.routingRules };
      }
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const body = bodyOf(request.body);
      const nextRules = Array.isArray(body.routingRules)
        ? body.routingRules.map((item) => UmoRoutingRuleSchema.parse(item))
        : current.routingRules;
      const saved = writeSoulProfileConfig(runtime.soulDir, { ...current, routingRules: nextRules });
      runtime.emitTelemetry("[SYS]", { action: "routing_rules_saved", count: saved.routingRules.length }, "live");
      return { defaultProfileId: saved.defaultProfileId, routingRules: saved.routingRules };
    },
    "config.routingRulesTest": (request) => {
      const body = bodyOf(request.body);
      const config = readSoulProfileConfig(runtime.soulDir);
      const channelId = String(body.channelId ?? "builtin.webchat").trim() || "builtin.webchat";
      const venueParsed = VenueTypeSchema.safeParse(body.venueType ?? "private_1on1");
      const venueType: VenueType = venueParsed.success ? venueParsed.data : "private_1on1";
      const sessionKey = String(body.sessionKey ?? "owner:local").trim() || "owner:local";
      const ceilingParsed = AudienceScopeSchema.safeParse(body.maxAudienceCeiling ?? "only_owner");
      const maxAudienceCeiling: AudienceScope = ceilingParsed.success ? ceilingParsed.data : "only_owner";
      const resolved = resolveSessionProfile({ channelId, venueType, sessionKey, maxAudienceCeiling, config });
      return { route: resolved.route, regionBindings: resolved.regionBindings };
    },
    "knowledge.library": knowledgeAdmin(runtime),
    "capabilities.knowledge": (request, context) => {
      const current = readSoulProfileConfig(runtime.soulDir);
      if (request.method === "GET") return current.capabilities.knowledge;
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const patch = bodyOf(request.body);
      const parsed = KnowledgeCapabilityConfigSchema.safeParse({
        ...current.capabilities.knowledge,
        ...patch,
        ...(patch.embeddingBinding === null ? {embeddingBinding: undefined} : {}),
        ...(patch.rerankBinding === null ? {rerankBinding: undefined} : {})
      });
      if (parsed.success && parsed.data.chunkOverlap >= parsed.data.chunkSize) return {status:400,body:{error:"分块重叠必须小于分块大小"}};
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_KNOWLEDGE_CAPABILITY", issues: parsed.error.issues } };
      }
      const saved = writeSoulProfileConfig(runtime.soulDir, {
        ...current,
        capabilities: { ...current.capabilities, knowledge: parsed.data }
      });
      runtime.emitTelemetry("[SYS]", { action: "knowledge_capability_saved" }, "live");
      return saved.capabilities.knowledge;
    },
    "capabilities.multimodal": (request, context) => {
      const current = readSoulProfileConfig(runtime.soulDir);
      if (request.method === "GET") return current.capabilities.multimodal;
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const parsed = MultimodalCapabilityConfigSchema.safeParse({
        ...current.capabilities.multimodal,
        ...bodyOf(request.body)
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_MULTIMODAL_CAPABILITY", issues: parsed.error.issues } };
      }
      const saved = writeSoulProfileConfig(runtime.soulDir, {
        ...current,
        capabilities: { ...current.capabilities, multimodal: parsed.data }
      });
      runtime.emitTelemetry("[SYS]", { action: "multimodal_capability_saved" }, "live");
      return saved.capabilities.multimodal;
    },
    "system.settings": (request, context) => {
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      if (request.method === "GET") return infra.systemSettings;
      if (context.target_instance !== "live") {
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      }
      const parsed = DaemonSystemSettingsSchema.safeParse({
        ...infra.systemSettings,
        ...bodyOf(request.body)
      });
      if (!parsed.success) {
        return { status: 400, body: { error: "INVALID_SYSTEM_SETTINGS", issues: parsed.error.issues } };
      }
      const saved = writeHostInfrastructureConfig(runtime.hostDir, {
        ...infra,
        systemSettings: parsed.data
      });
      runtime.emitTelemetry("[SYS]", { action: "system_settings_saved" }, "live");
      return saved.systemSettings;
    }
  } satisfies Partial<Record<AdminOperation, AdminRouteHandler>>;
}
