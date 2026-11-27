import { allowedCollections, mountedCollectionIds, profileMounts, searchKnowledge } from "./knowledge-service.js";
import { countDeliveredSources, listKnowledgeCollections, turnKnowledgeSources } from "@ai0/storage";
import { ExtensionCoreHost, ExtensionComposition, cognitionStateDynamicsFacet, cognitionAttentionArbitratorFacet } from "@ai0/sdk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConsoleLiveSnapshot } from "@ai0/console-webui";
import {
  PrivilegedAdminServer,
  ChannelProtocolGateway,
  type AdminTelemetryFrame,
  type AdminTelemetryTrack
} from "@ai0/gateway";
import {
  InteractionOpportunityPool
} from "@ai0/expression-core";
import {
  SensoryCoverageBucketManager,
  type HypothesisRevisionPolicy
} from "@ai0/perception-core";
import {
  AuthoritativeStateCoordinator,
  BlackboardCompiler,
  buildRegionBindingsFromProfile,
  ContinuousStateMetaEngine,
  evaluateCrisisGuard,
  MetabolicRegionRouter as BrainRegionRouter,
  resolveSessionProfile,
  ThreeDimensionalPolicyEngine,
  toBrainRouterConfig,
  VirtualClock,
  W2AgencyTaskWorker,
  W3SleepReflectionWorker,
  type CoordinatorDecisionTrace as KernelTurnTrace,
  type CoordinatorStorageMutator as KernelCoordinatorStorageMutator,
  type KernelReadOnlyStorageView,
  type ReadOnlyCognitiveSnapshot,
  type TargetInstance
} from "@ai0/cognition-core";
import { AgentCoreRuntime, ModelRequestJournal, UpstreamModelClient, getEffectiveModelContextWindow, registeredModelTransport, tracePreparedRequest,
  ProviderNotConfiguredError, type AgentBindings, type AgentOptions, type LlmProviderConfig } from "@ai0/agent-core";
import type { AudienceScope, DeploymentReadinessReport, HostInfrastructureConfig, ModelSlotBinding, SensorModality, VenueType } from "@ai0/protocol";
import {
  compileStudioPrompt,
  CoordinatorStorageMutator,
  deleteExtensionRuntimeState,
  ensureOrthogonalStoresMigrated,
  findProviderReferences,
  getModelCatalogEntry,
  HardForgetEngine,
  HybridMemoryRetriever,
  listAgentSkills,
  listHostCharacterCards,
  readExtensionsState,
  readHostInfrastructureConfig,
  readHostOwnerClaim,
  readSoulProfileConfig,
  writeSoulProfileConfig,
  resolveEffectiveSourceApiKeys,
  resolveHostInfrastructureDir,
  resolveHostDefaultChatBinding,
  resolveRolePreset,
  resolveSoulTurnModelBinding,
  SoulArchiveManager,
  initializeSoulDirectory,
  readConsoleStudioConfig,
  isTaskExecutionApproved,
  readSoulArchiveConfig,
  writeExtensionRuntimeConfig
} from "@ai0/storage";
import { renderEmbodiedPresentation } from "./embodied-presentation.js";
import {
  createW1DialogueProfile,
  UniversalLlmProviderClient,
  W1FastDialogueWorker,
  W4MultimodalAnalyzerWorker,
  type KernelMemoryRetriever,
  type W1AsyncTurnOptions
} from "./turn-coordinator.js";

import {
  buildHomeostasisSamples,
  createRealAdminHandlers,
  readRedactionLedgerCount,
  type DaemonHandlerContext,
  type DaemonMutableState
} from "./admin-handlers.js";
import {
  buildConversationsList,
  discoverSoulDirectories,
  listAvailableSoulInstances,
  readVaultProviderKey
} from "./studio-service.js";
import { mountKnowledgeTaskExecutor } from "./task-executors.js";
import { channelInference, selectResponseContract, ChannelRequestPreview } from "./channel-inference.js";
import type { SoulConsoleStudioConfig } from "@ai0/storage";
import { RuntimePluginLoader, type InstallExternalPluginInput } from "./plugin-loader.js";

export { ProviderNotConfiguredError };

export interface DefaultDaemonOptions {
  soulDir?: string;
  soulsRoot?: string;
  ownerMasterToken?: string;
  targetInstance?: string;
  allowDeterministicSandbox?: boolean;
  capturePromptBodies?: boolean;
  dialogueModelPackageId?: string;
  llmConfig?: LlmProviderConfig;
  extraPluginDirs?: readonly string[];
  builtinPluginsDir?: string;
  userPluginsDir?: string;
}

export class SoulNotAwakenedError extends Error {
  readonly code = "SOUL_NOT_AWAKENED";
  constructor() {
    super("No .soul archive has been awakened yet.");
    this.name = "SoulNotAwakenedError";
  }
}

export interface DaemonWorkers {
  w1: W1FastDialogueWorker;
  w2: W2AgencyTaskWorker;
  w3: W3SleepReflectionWorker;
  w4: W4MultimodalAnalyzerWorker;
}

function targetInstanceOf(value = "live"): TargetInstance {
  if (value === "live" || /^sandbox:.+$/.test(value)) return value as TargetInstance;
  throw new TypeError("targetInstance must be 'live' or start with 'sandbox:'.");
}

function createCoordinatorStorage(
  getStorage: () => CoordinatorStorageMutator,
  traces: KernelTurnTrace[]
): KernelCoordinatorStorageMutator {
  return {
    latestStateRevision() {
      const db = getStorage().sqlite;
      return Number(db.prepare("SELECT MAX(rev) AS n FROM (SELECT MAX(state_rev_after) AS rev FROM event_log UNION ALL SELECT MAX(state_rev) FROM cognitive_state_checkpoints)").get()?.n ?? 0);
    },
    loadCoordinatorState() {
      const cp = getStorage().getLatestCheckpoint();
      if (!cp) return undefined;
      const data = JSON.parse(cp.working_memory_json);
      if (data.format !== "ai0.coordinator.v1" && data.format !== "ai0.coordinator.v2") return undefined;
      return data.snapshot as ReadOnlyCognitiveSnapshot;
    },
    checkpointCoordinatorState(snapshot) {
      const eventId = snapshot.D1_WORKING_TURN.recent_turns.at(-1)?.event_id.replace(/:w1$/, "") ?? "";
      getStorage().saveCheckpoint({
        state_rev: snapshot.state_rev,
        virtual_ts_ms: getStorage().getEventById(eventId)?.virtual_ts_ms ?? 0,
        caused_by_event_id: eventId,
        continuous_states_json: JSON.stringify(snapshot.D2_CONTINUOUS_STATES.values),
        state_attributions_json: JSON.stringify(snapshot.D2_CONTINUOUS_STATES.attributions),
        relationship_json: "{}",
        user_model_json: "{}",
        working_memory_json: JSON.stringify({ format: "ai0.coordinator.v2", snapshot }),
        hibernation_intervals_json: "[]"
      });
    },
    applyMemoryProjection(proposal) {
      if (!proposal.source_event_ids.length || typeof proposal.content_text !== "string") return;
      const event = getStorage().getEventById(proposal.source_event_ids[0]!);
      if (!event || event.redacted_at_ts_ms !== null) return;
      const firsthand = proposal.epistemic_type === "observed_firsthand";
      const id = (firsthand ? "mem_consolidated_" : "mem_reported_") + event.event_id;
      if (getStorage().sqlite.prepare("SELECT 1 FROM memories WHERE memory_id=?").get(id)) return;
      getStorage().insertMemoryWithLineage({
        memory_id: id, memory_tier: "episodic_experience", epistemic_type: firsthand ? "observed_firsthand" : "reported_hearsay",
        attributed_principal: event.principal_id, visibility_scope: event.audience_scope,
        taint_level: firsthand && event.principal_trust === "owner_verified" ? "trusted_owner" : "untrusted_external",
        content_text: proposal.content_text, created_virtual_ts: event.virtual_ts_ms,
        last_recalled_ts: event.virtual_ts_ms, valid_from_virtual_ts: event.virtual_ts_ms, created_at_rev: event.state_rev_after
      }, proposal.source_event_ids.map(parent_id => ({ parent_type: "event", parent_id, relation_type: "derived_from" })));
    },
    getEventById(eventId) {
      const event = getStorage().getEventById(eventId);
      return event && {
        event_id: event.event_id,
        redacted_at_ts_ms: event.redacted_at_ts_ms,
        principal_trust: event.principal_trust,
        event_type: event.event_category,
        virtual_ts_ms: event.virtual_ts_ms,
        payload: { summary_text: event.summary_text }
      };
    },
    saveTurnDecisionTrace(trace) {
      traces.push(trace);
    }
  };
}

function createReadOnlyView(getStorage: () => CoordinatorStorageMutator): KernelReadOnlyStorageView {
  const record = (value: object): Readonly<Record<string, unknown>> =>
    Object.fromEntries(Object.entries(value));
  return {
    listEvents: query => query?.archived === false
      ? getStorage().sqlite.prepare("SELECT e.* FROM event_log e WHERE event_category='perception_committed' AND redacted_at_ts_ms IS NULL AND NOT EXISTS (SELECT 1 FROM memories WHERE memory_id='mem_consolidated_' || e.event_id) ORDER BY event_seq").all()
      : getStorage().listEvents().filter(event => event.redacted_at_ts_ms === null).map(record),
    getEventById: (eventId) => {
      const event = getStorage().getEventById(eventId);
      return event ? record(event) : undefined;
    }
  };
}

function createKernelRetriever(
  getRetriever: () => HybridMemoryRetriever,
  storage: () => CoordinatorStorageMutator,
  clock: VirtualClock
): KernelMemoryRetriever {
  return {
    retrieve(query, _snapshot, _storage, context) {
      const result = getRetriever().retrieve({
        query_text: query,
        audience_scope: context?.audience_scope ?? "only_owner",
        principal_trust: context?.principal ?? "owner_verified",
        current_virtual_ts: clock.nowMs()
      });
      return {
        sql_audience_filter_enforced: result.sql_audience_filter_enforced,
        recalled_memories: result.recalled_memories.map((memory) => ({
          memory_id: memory.memory_id,
          memory_tier: memory.memory_tier,
          epistemic_type: memory.epistemic_type,
          visibility_scope: memory.visibility_scope,
          taint_level: memory.taint_level,
          score: memory.score,
          content_text: memory.content_text,
          source_event_ids: storage().getMemoryLineage(memory.memory_id).filter(edge => edge.child_memory_id === memory.memory_id && edge.parent_type === "event").map(edge => edge.parent_id)
        }))
      };
    }
  };
}

function resolveProviderConfig(infrastructure: HostInfrastructureConfig, routedBinding: ModelSlotBinding | undefined,
  hostDir: string, soulDir?: string, sessionId?: string): LlmProviderConfig | undefined {
  const matchedModel = routedBinding && (
    (routedBinding.modelInstanceId
      ? infrastructure.modelInstances.find((m) => m.id === routedBinding.modelInstanceId)
      : undefined) ??
    infrastructure.modelInstances.find(
      (m) => m.sourceId === routedBinding.providerId && m.modelId === routedBinding.modelId
    ));
  const routedSource = routedBinding && (
    infrastructure.providerSources.find((s) => s.id === (matchedModel?.sourceId ?? routedBinding.providerId)) ??
    infrastructure.providerSources.find((s) => routedBinding.providerId.startsWith(`${s.id}__`)));
  const resolvedKeys = routedSource ? resolveEffectiveSourceApiKeys(hostDir, routedSource) : [];
  const fallbackLegacyKey = soulDir && routedSource && routedSource.apiKeys.length === 0 && resolvedKeys.length === 0
    ? readVaultProviderKey(soulDir, routedSource.id) : undefined;
  const effectiveApiKeys = resolvedKeys.length > 0 ? resolvedKeys : (fallbackLegacyKey ? [fallbackLegacyKey] : []);
  const isOllama = routedSource?.adapterType === "ollama";
  const modelId = routedBinding?.modelId || matchedModel?.modelId;
  const settingsModel = matchedModel?.modelId === modelId ? matchedModel : infrastructure.modelInstances.find(
    (model) => model.sourceId === routedSource?.id && model.modelId === modelId
  );
  const keylessEndpoint = isOllama || (routedSource?.adapterType === "custom_http" &&
    settingsModel?.health.status === "ready" && Boolean(routedSource.baseUrl.trim()));
  const discoveredModel = routedSource && modelId ? getModelCatalogEntry(routedSource, modelId, settingsModel) : undefined;
  return routedSource?.enabled && (settingsModel?.enabled ?? true) && (effectiveApiKeys.length > 0 || keylessEndpoint)
      ? {
          provider: routedSource.adapterType === "anthropic"
            ? "anthropic"
            : isOllama
              ? "ollama"
              : "openai-compatible",
          adapterType: routedSource.adapterType,
          sourceId: routedSource.id,
          baseUrl: routedSource.baseUrl,
          apiKey: effectiveApiKeys[0],
          apiKeys: effectiveApiKeys,
          keyRotationStrategy: routedSource.keyRotationStrategy,
          customHeaders: routedSource.customHeaders,
          timeoutMs: routedSource.timeoutMs,
          temperature: settingsModel?.defaultTemperature,
          maxTokens: settingsModel?.defaultMaxTokens,
          contextWindow: discoveredModel?.contextWindow ?? settingsModel?.contextWindow,
          contextWindowOverride: settingsModel?.contextWindowOverride,
          useCatalogContextWindow: settingsModel?.useCatalogContextWindow,
          useCatalogMaxOutputTokens: settingsModel?.useCatalogMaxOutputTokens,
          reasoningEffort: settingsModel?.reasoningEffort,
          model: modelId,
          discoveredModel,
          sessionId: routedSource.adapterType === "opencode_go"
            ? sessionId
            : undefined
        }
      : undefined;
}

export class Ai0DaemonRuntime {
  readonly channelUpstream: UpstreamModelClient;
  private readonly attention = new Map<string, { channelId: string | null; switchedAt: number }>();

  getContinuousStates(mode: "live" | "sandbox" = "live"): Record<string, number> {
    return (mode === "live" ? this.coordinator : this.sandboxCoordinator).getSnapshot().D2_CONTINUOUS_STATES.values;
  }

  private readonly revoked = new Map<string, AbortController>();
  private readonly capabilityTimer: ReturnType<typeof setInterval>;
  generation(id: string, mode: "live" | "sandbox" = "live") {
    return this.pluginLoader.generation(mode === "live" ? this.extensionHost : this.sandboxExtensionHost, id);
  }
  private revoke(id: string, mode: "live" | "sandbox") {
    const key = JSON.stringify([id, mode]);
    this.revoked.get(key)?.abort();
    this.revoked.delete(key);
    this.channelGateway.disconnectPlugin(id, mode);
  }
  pluginSignal(pluginId: string, mode: "live" | "sandbox"): AbortSignal {
    const id = JSON.stringify([pluginId, mode]);
    let controller = this.revoked.get(id);
    if (!controller) { controller = new AbortController(); this.revoked.set(id, controller); }
    return controller.signal;
  }

  private lastIntentEventId = new Map<string, string>();
  private archiveLifetime = new AbortController();

  constructor(
    private activeSoulDir: string,
    readonly soulsRoot: string,
    readonly hostDir: string,
    private awakened: boolean,
    private readonly hasExplicitLlmConfig: boolean,
    private readonly allowDeterministicSandbox: boolean,
    readonly ownerMasterToken: string,
    private liveStorage: CoordinatorStorageMutator,
    readonly sandboxStorage: CoordinatorStorageMutator,
    readonly sandboxDir: string,
    private archiveManager: SoulArchiveManager,
    private liveRetriever: HybridMemoryRetriever,
    private liveHardForget: HardForgetEngine,
    readonly virtualClock: VirtualClock,
    readonly sandboxClock: VirtualClock,
    readonly coordinator: AuthoritativeStateCoordinator,
    readonly sandboxCoordinator: AuthoritativeStateCoordinator,
    readonly blackboardCompiler: BlackboardCompiler,
    readonly sandboxBlackboardCompiler: BlackboardCompiler,
    readonly extensionHost: ExtensionCoreHost,
    readonly sandboxExtensionHost: ExtensionCoreHost,
    readonly brainRegionRouter: BrainRegionRouter,
    readonly workers: DaemonWorkers,
    readonly sandboxW1: W1FastDialogueWorker,
    readonly channelGateway: ChannelProtocolGateway,
    readonly adminServer: PrivilegedAdminServer,
    readonly coordinatorTraces: KernelTurnTrace[],
    readonly mutableState: DaemonMutableState,
    readonly pluginLoader: RuntimePluginLoader,
    private readonly compositions: ExtensionComposition[],
    readonly bundledSkillsDir: string,
    readonly modelRequests: Record<"live" | "sandbox", ModelRequestJournal>,
    private readonly hostModelConfig?: LlmProviderConfig,
    private readonly dialogueModelPackageId?: string
  ) {
    this.channelUpstream = new UpstreamModelClient(hostModelConfig);
    this.capabilityTimer = setInterval(() => {
      void this.refreshCapabilities().catch(error => this.adminServer.broadcastTelemetry("[SYS]",
        { action: "capability_refresh_failed", error: String(error) }, "live", Date.now()));
    }, 2000);
    this.capabilityTimer.unref();
  }

  get soulDir(): string { return this.activeSoulDir; }
  get archiveSignal(): AbortSignal { return this.archiveLifetime.signal; }
  get hasAwakenedSoul(): boolean { return this.awakened; }
  get soulArchiveManager(): SoulArchiveManager { return this.archiveManager; }

  listSoulInstances() {
    return listAvailableSoulInstances(this.soulsRoot, false)
      .map(instance => ({ ...instance, active: this.awakened && instance.path === this.activeSoulDir }));
  }

  activateSoulDirectory(nextSoulDir: string): void {
    if (this.mutableState.rollbackInProgress) throw new Error("SNAPSHOT_ROLLBACK_IN_PROGRESS");
    if (this.awakened && resolve(nextSoulDir) === this.activeSoulDir) return;
    const layout = initializeSoulDirectory(nextSoulDir);
    const studio = readConsoleStudioConfig(layout.rootPath);
    const { soulProfiles } = ensureOrthogonalStoresMigrated(layout.rootPath, this.hostDir);
    const profile = soulProfiles.profiles.find(item => item.id === soulProfiles.defaultProfileId) ?? soulProfiles.profiles[0]!;
    const nextManager = new SoulArchiveManager(layout.rootPath);
    const nextStorage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);
    const previousStorage = this.liveStorage;
    try {
      this.replaceLiveStorage(nextStorage);
    } catch (error) {
      nextStorage.close();
      this.replaceLiveStorage(previousStorage);
      throw error;
    }
    this.archiveLifetime.abort();
    this.archiveLifetime = new AbortController();
    this.channelGateway.disconnectTarget("live");
    for (const controller of this.revoked.values()) controller.abort();
    this.revoked.clear();
    previousStorage.close();
    this.activeSoulDir = layout.rootPath;
    this.awakened = true;
    this.archiveManager = nextManager;
    this.lastIntentEventId.clear();
    this.coordinatorTraces.length = 0;
    this.mutableState.telemetryFrames.length = 0;
    this.mutableState.debounceWindowMs = profile.conversationGate.debounceMs;
    this.mutableState.circadianAnchors = studio.soulStudio.circadianAnchors;
    this.brainRegionRouter.updateRegions(toBrainRouterConfig(buildRegionBindingsFromProfile(profile)));
    this.pluginLoader.setSoulDirectory(layout.rootPath);
    void this.refreshCapabilities().catch(error => this.adminServer.broadcastTelemetry("[SYS]",
      { action: "capability_refresh_failed", error: String(error) }, "live"));
  }

  computeReadiness(): DeploymentReadinessReport {
    const claim = readHostOwnerClaim(this.hostDir);
    const infrastructure = readHostInfrastructureConfig(this.hostDir);
    const hostDefaultChat = resolveHostDefaultChatBinding(infrastructure);
    const providerReady = Boolean(hostDefaultChat || this.hasExplicitLlmConfig || this.allowDeterministicSandbox);
    const soulAwakened = this.hasAwakenedSoul;
    const manifest = soulAwakened ? readSoulArchiveConfig(this.soulDir).manifest : undefined;
    const bindingValid = manifest ? Boolean(
      resolveSoulTurnModelBinding(manifest, readSoulProfileConfig(this.soulDir), infrastructure).consciousness ||
      this.hasExplicitLlmConfig || this.allowDeterministicSandbox
    ) : false;
    const liveConnections = this.channelGateway.listConnections("live");
    const prerequisites = [
      { met: claim.claimed, name: "host_owner_claim", stage: "L0_UNCLAIMED" },
      { met: providerReady, name: "verified_chat_provider", stage: "L1_CLAIMED_NO_PROVIDER" },
      { met: soulAwakened, name: "awakened_soul_archive", stage: "L2_PROVIDER_READY_NO_SOUL" },
      { met: bindingValid, name: "soul_consciousness_model_binding", stage: "L3_SOUL_AWAKENED_CONFIG_NEEDED" },
      { met: liveConnections.length > 0, name: "connected_compliant_channel", stage: "L4_SOUL_AWAKENED_NO_CHANNEL" }
    ] as const;
    const missing = prerequisites.filter(item => !item.met);
    const stage = missing[0]?.stage ?? "L5_LIVE_READY";
    return {
      ready: stage === "L5_LIVE_READY",
      stage,
      missing_prerequisites: missing.map(item => item.name),
      checks: {
        hostClaimed: claim.claimed,
        deploymentMode: claim.deploymentMode,
        providerReady,
        defaultChatModel: hostDefaultChat?.modelId ?? null,
        soulAwakened,
        activeSoulId: manifest?.soul_id ?? null,
        bindingValid,
        activeChannelConnections: liveConnections.length,
        hostCardsCount: listHostCharacterCards(this.hostDir).length
      }
    };
  }

  private pendingRefresh?: Promise<void>;
  private refreshingSoulDir?: string;
  async refreshCapabilities(changed = false): Promise<void> {
    if (this.pendingRefresh) {
      if (!changed && this.refreshingSoulDir === this.soulDir) return this.pendingRefresh;
      await this.pendingRefresh;
      return this.refreshCapabilities(true);
    }
    this.refreshingSoulDir = this.soulDir;
    const before = this.pluginLoader.listPlugins();
    const revision = this.pluginLoader.revision;
    const config = readConsoleStudioConfig(this.soulDir);
    const persistedExtState = readExtensionsState(this.soulDir);
    const overrides = new Map<string, boolean>(config.ecosystem.plugins.map(item => [item.id, item.enabled]));
    for (const [extId, entry] of Object.entries(persistedExtState.extensions)) {
      if (typeof entry.enabled === "boolean") overrides.set(extId, entry.enabled);
      if (entry.config_values && Object.keys(entry.config_values).length > 0) {
        this.pluginLoader.seedPersistedConfig(this.extensionHost, extId, entry.config_values);
        this.pluginLoader.seedPersistedConfig(this.sandboxExtensionHost, extId, entry.config_values);
      }
    }
    this.pluginLoader.reload(overrides, { servers: readHostInfrastructureConfig(this.hostDir).mcpServers,
      skills: listAgentSkills(this.soulDir, this.bundledSkillsDir),
      grants: Object.fromEntries(Object.entries(persistedExtState.extensions).map(([id, item]) => [id, item.permission_overrides]))
    });
    for (const prior of before) {
      if (prior.generation !== this.pluginLoader.getPlugin(prior.manifest.extension_id)?.generation) {
        this.revoke(prior.manifest.extension_id, "live");
        this.revoke(prior.manifest.extension_id, "sandbox");
      }
    }
    this.pendingRefresh = Promise.all([
      this.pluginLoader.mountIntoHost(this.extensionHost, this.compositions[0]!, {
        admitObservation: evidence => this.workers.w4.admitCarrierObservation(evidence)
      }),
      this.pluginLoader.mountIntoHost(this.sandboxExtensionHost, this.compositions[1]!, { allowMcp: false })
    ]).then(() => {
      if (revision !== this.pluginLoader.revision) this.adminServer.broadcastTelemetry("[SYS]",
        { action: "capabilities_changed", revision: this.pluginLoader.revision }, "live", Date.now());
    }).finally(() => { this.pendingRefresh = undefined; });
    return this.pendingRefresh;
  }

  async reloadExtension(id: string, mode: "live" | "sandbox", config: Readonly<Record<string, unknown>>, expected?: number) {
    await this.refreshCapabilities();
    const host = mode === "live" ? this.extensionHost : this.sandboxExtensionHost;
    const rev = this.pluginLoader.configure(host, id, config, expected);
    if (mode === "live") {
      const plugin = this.pluginLoader.getPlugin(id);
      writeExtensionRuntimeConfig(this.soulDir, id, { ...config }, {
        carrier_kind: plugin?.manifest.carrier_kind,
        facets: plugin?.manifest.facets,
        enabled: plugin?.enabled ?? true,
        permissions: plugin?.manifest.permissions
      });
    }
    this.revoke(id, mode);
    await this.refreshCapabilities();
    const error = this.pluginLoader.activationError(host, id);
    if (error) throw new Error(error);
    this.adminServer.broadcastTelemetry("[SYS]", { action: "capabilities_changed", revision: this.pluginLoader.revision }, mode === "live" ? "live" : "sandbox:console");
    return rev;
  }

  async reloadSingleExtension(id: string, mode: "live" | "sandbox") {
    this.pluginLoader.forceReload(id);
    this.revoke(id, mode);
    await this.refreshCapabilities();
    const host = mode === "live" ? this.extensionHost : this.sandboxExtensionHost;
    const rev = this.pluginLoader.getPluginConfig(host, id).rev;
    return { rev, generation: this.generation(id, mode) };
  }

  async reloadAllExtensions() {
    this.pluginLoader.forceReload();
    for (const plugin of this.pluginLoader.listPlugins()) {
      this.revoke(plugin.manifest.extension_id, "live");
      this.revoke(plugin.manifest.extension_id, "sandbox");
    }
    await this.refreshCapabilities();
    return { count: this.pluginLoader.listPlugins().length, revision: this.pluginLoader.revision };
  }

  async installExternalExtension(input: InstallExternalPluginInput) {
    const installed = await this.pluginLoader.installExternalPlugin(input);
    await this.refreshCapabilities();
    this.adminServer.broadcastTelemetry("[SYS]", { action: "extension_installed", extensionId: installed.manifest.extension_id }, "live");
    return installed;
  }

  async uninstallExternalExtension(id: string, keepConfig: boolean) {
    this.revoke(id, "live");
    this.revoke(id, "sandbox");
    this.pluginLoader.uninstallExternalPlugin(id);
    if (!keepConfig) {
      deleteExtensionRuntimeState(this.soulDir, id);
    }
    await this.refreshCapabilities();
  }

  fallbackChannelId(): string {
    return "channel.default";
  }

  get storage(): CoordinatorStorageMutator {
    return this.liveStorage;
  }

  get hybridMemoryRetriever(): HybridMemoryRetriever {
    return this.liveRetriever;
  }

  get hardForgetEngine(): HardForgetEngine {
    return this.liveHardForget;
  }

  replaceLiveStorage(nextStorage: CoordinatorStorageMutator): void {
    this.modelRequests.live.clear();
    this.modelRequests.sandbox.clear();
    this.liveStorage = nextStorage;
    this.liveRetriever = new HybridMemoryRetriever(nextStorage);
    this.liveHardForget = new HardForgetEngine(nextStorage.sqlite);
    this.coordinator.restoreCheckpoint();
  }

  async runAgent(input: Omit<AgentOptions, "bindings" | "adapter" | "model" | "executeTool"> & {
    bindings?: Omit<AgentBindings, "host">; mode?: "live" | "sandbox"
  }) {
    const { mode = "live", bindings, onStep, ...options } = input;
    const host = mode === "live" ? this.extensionHost : this.sandboxExtensionHost;
    const trace = this.modelRequests[mode].lease();
    const signal = AbortSignal.any([options.signal, this.archiveLifetime.signal]);
    let adapter;
    if (!bindings?.modelPackageId) {
      const infrastructure = readHostInfrastructureConfig(this.hostDir);
      const config = resolveProviderConfig(infrastructure, resolveHostDefaultChatBinding(infrastructure), this.hostDir) ?? this.hostModelConfig;
      if (!config?.model) throw new ProviderNotConfiguredError();
      adapter = new UpstreamModelClient(config).asModelAdapter(config.model, trace);
    }
    return new AgentCoreRuntime().runTurn({ ...options, adapter, signal, bindings: { ...bindings, host },
      wrapFetch: (request, provider, send) => tracePreparedRequest(trace, request, provider, send),
      onStep(manifest) {
        trace({ stepId: manifest.stepId, assembly: manifest, attempts: [], model: manifest.model.id }, [], manifest.model.id);
        onStep?.(manifest);
      }
    });
  }

  async previewChannelRequest(input: Parameters<Ai0DaemonRuntime["handleChannelTurn"]>[0], config: SoulConsoleStudioConfig) {
    try {
      await this.handleChannelTurn(input, { preview: config, eventId: "preview" });
    } catch (error) {
      if (error instanceof ChannelRequestPreview) {
        const promptText = error.request.messages.map(message => JSON.stringify(message)).join("\n");
        return { ...error.request, promptText, totalTokens: Math.ceil(promptText.length / 2.5), maxTokens: config.soulStudio.maxBlackboardTokens,
          bricks: error.request.manifest.fragments.map(part => ({ id: part.id, title: part.source, icon: "",
            tokens: Math.ceil(part.chars / 2.5), maxTokens: config.soulStudio.maxBlackboardTokens, included: part.messageIndex !== undefined,
            reason: part.reason, rendered: part.messageIndex === undefined ? "" : JSON.stringify(error.request.messages[part.messageIndex]) })) };
      }
      throw error;
    }
    throw new Error("No model request for this input");
  }

  async handleChannelTurn(input: {
    principalId?: string;
    thread?: string;
    channel_id?: string;
    text: string;
    venue_type?: VenueType;
    audience_scope?: AudienceScope;
    modality?: SensorModality;
    mode?: "live" | "sandbox";
  }, options: W1AsyncTurnOptions & { eventId?: string; preview?: SoulConsoleStudioConfig } = {}) {
    const isSandbox = input.mode === "sandbox";
    const traceLease = this.modelRequests[isSandbox ? "sandbox" : "live"].lease();
    if (!options.preview && !isSandbox && !this.hasAwakenedSoul) throw new SoulNotAwakenedError();
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.archiveLifetime.signal])
      : this.archiveLifetime.signal;
    signal.throwIfAborted();
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const clock = isSandbox ? this.sandboxClock : this.virtualClock;
    const coordinator = isSandbox ? this.sandboxCoordinator : this.coordinator;
    const w1 = isSandbox ? this.sandboxW1 : this.workers.w1;
    const target: "live" | `sandbox:${string}` = isSandbox ? "sandbox:console" : "live";

    const channelId = input.channel_id?.trim() || this.fallbackChannelId();
    const venue: VenueType = input.venue_type ?? "private_1on1";
    const requestedCeiling: AudienceScope =
      input.audience_scope ?? (venue === "public_livestream" ? "public_all" : "only_owner");
    const principal = input.principalId === "owner:local" ? "owner_verified" : "stranger";
    const modality: SensorModality = input.modality ?? "text";
    const nowMs = clock.nowMs();
    const eventId = options.eventId ?? "evt_channel_" + randomUUID();

    // Orthogonal UMO -> Profile -> Provider resolution (AstrBot-style routing + fail-closed ceiling)
    const { infrastructure, soulProfiles } = ensureOrthogonalStoresMigrated(this.soulDir, this.hostDir);
    const sessionKey = input.thread ?? input.principalId ?? "owner:local";
    const resolved = resolveSessionProfile({
      channelId,
      venueType: venue,
      sessionKey,
      maxAudienceCeiling: requestedCeiling,
      config: soulProfiles
    });
    const audience: AudienceScope = resolved.route.effectiveAudienceScope;
    const { manifest } = readSoulArchiveConfig(this.soulDir);
    const useArchiveBinding = manifest.module_overrides?.consciousness?.mode === "Override" ||
      resolved.route.primaryChat.providerId === "unconfigured";
    const routedBinding = useArchiveBinding
      ? resolveSoulTurnModelBinding(manifest, soulProfiles, infrastructure).consciousness
      : resolved.route.primaryChat;

    if (!options.preview) storage.appendEvent({
      event_id: eventId,
      wall_ts_ms: Date.now(),
      virtual_ts_ms: nowMs,
      source_channel_id: channelId,
      principal_id: input.principalId ?? "unknown",
      principal_trust: principal,
      venue_type: venue,
      audience_scope: audience,
      event_category: "perception_committed",
      modality,
      summary_text: input.text,
      payload_json: JSON.stringify({
        venue,
        audience,
        modality,
        thread: input.thread,
        profile_id: resolved.route.profileId,
        matched_rule_id: resolved.route.matchedRuleId
      }),
      state_rev_after: coordinator.getSnapshot().state_rev,
      active_modules_mask: 31
    });

    if (!options.preview) this.adminServer.broadcastTelemetry("[EVENT]", {
      event_id: eventId,
      channel_id: channelId,
      venue_type: venue,
      audience_scope: audience,
      profile_id: resolved.route.profileId,
      routed_model: routedBinding?.modelId ?? null,
      ...(options.eventId ? {} : { summary_text: input.text })
    }, target, nowMs);

    const studioConfig = options.preview ?? readConsoleStudioConfig(this.soulDir);
    const snapBefore = coordinator.getSnapshot();
    const primaryRoleMeta = resolveRolePreset(
      resolved.profile.roleArchetype || studioConfig.soulStudio.primaryRole
    );
    const effectivePublicMask = resolved.route.socialMaskActive || audience !== "only_owner" || principal !== "owner_verified";
    const host = isSandbox ? this.sandboxExtensionHost : this.extensionHost;
    const response = selectResponseContract(host, studioConfig.soulStudio.responseContract, audience);
    const continuous = this.getContinuousStates(isSandbox ? "sandbox" : "live");
    const lorebook = effectivePublicMask ? undefined : { book_id: "studio", title: "Lorebook",
      entries: studioConfig.soulStudio.lorebooks.map(item => ({
        entry_id: item.id, keys: item.keys, secondary_keys: item.secondaryKeys, content: item.content, enabled: item.enabled,
        priority: item.priority, recursive_depth: 3, max_token_budget: item.tokenBudget
      })) };
    const previousFocus = this.attention.get(target);
    const policy = !options.preview && host.listFacets(cognitionAttentionArbitratorFacet)[0];
    const focus = policy && host.invokeFacet(policy, facet => facet.arbitrate({
      candidates: [...new Set([channelId, ...this.channelGateway.listConnections(isSandbox ? "sandbox" : "live").map(connection => connection.channel_id)])]
        .map(id => ({ channel_id: id, salience: Number(id === channelId),
          l0_crisis: id === channelId && evaluateCrisisGuard(input.text, clock).status === "INTERCEPTED_CRISIS" })),
      current_channel_id: previousFocus?.channelId ?? null,
      last_switch_ts_ms: previousFocus?.switchedAt ?? nowMs,
      now_ts_ms: nowMs,
      events: [{ channel_id: channelId, event_type: "perception_committed" }]
    }));
    if (focus && focus.switched) {
      this.attention.set(target, { channelId: focus.selected_channel_id, switchedAt: nowMs });
      this.adminServer.broadcastTelemetry("[SYS]", { action: "attention_focus", ...focus }, target, nowMs);
    }
    const compiledStudioPrompt = compileStudioPrompt(studioConfig, {
      audienceScope: effectivePublicMask ? "public_all" : "only_owner",
      venueType: venue,
      platform: channelId,
      moodValence: effectivePublicMask ? undefined : continuous.instant_valence,
      circadianEnergy: effectivePublicMask ? undefined : continuous.circadian_energy,
      metabolicEnergy: effectivePublicMask ? undefined : continuous.metabolic_energy
    });

    const sessionId = createHash("sha256").update(JSON.stringify([manifest.soul_id, target, channelId, sessionKey])).digest("hex");
    const dynamicLlmConfig = resolveProviderConfig(infrastructure, routedBinding, this.hostDir, this.soulDir, sessionId);
    // D1 is shared across channels. Only replay this session's turns; knowledge is recalled
    // afresh under the current mounts and audience instead of replaying an old quotation.
    const history = snapBefore.D1_WORKING_TURN.recent_turns;
    const modelWindow = getEffectiveModelContextWindow(dynamicLlmConfig);
    const canReplay = (turn: typeof history[number]) => {
      const event = storage.getEventById(turn.event_id.replace(/:w1$/, ""));
      if (!event || event.redacted_at_ts_ms !== null || event.source_channel_id !== channelId ||
          event.principal_id !== input.principalId || event.audience_scope !== audience) return false;
      try {
        const meta = JSON.parse(event.payload_json);
        return !meta?.channel_process_redacted && meta?.thread === input.thread && meta?.profile_id === resolved.profile.id &&
          !(turn.role === "assistant" && meta.knowledge_consulted);
      } catch {
        return false;
      }
    };
    function* recentSessionHistory(): Iterable<string> {
      if (effectivePublicMask) return;
      for (let index = history.length - 1; index >= 0; index--) {
        const turn = history[index]!;
        if (canReplay(turn)) yield `${turn.role}: ${turn.text}`;
      }
    }
    const visibleTurns = !effectivePublicMask && modelWindow === undefined ? history.slice(-24).filter(canReplay) : [];
    const latestTurn = history.at(-1);
    if (options.preview && evaluateCrisisGuard(input.text, clock).status === "INTERCEPTED_CRISIS")
      throw new Error("Local intervention handles this input without model inference");
    const turn = await w1.runTurnAsync({
      event_id: eventId,
      target_channel_id: this.channelGateway.listConnections(isSandbox ? "sandbox" : "live")
        .some(connection => connection.channel_id === channelId) ? channelId : undefined,
      principal,
      venue_type: venue,
      audience_scope: audience,
      modality,
      summary_text: input.text,
      knowledgeRecall: async signal => {
        const collections=allowedCollections(storage,profileMounts(storage,resolved.profile),audience,principal==="owner_verified");
        const allowed = () => options.preview ? collections : this.eventKnowledgeCollections(storage,eventId);
        const hits = input.text ? await searchKnowledge(this,storage,input.text,collections,signal,allowed) : { results: [] };
        const currentAllowed = allowed();
        return hits.results.filter(h=>currentAllowed.includes(h.collectionId) && h.score>=soulProfiles.capabilities.knowledge.honestForgetThreshold);
      },
      liveStudioContext: {
        dialogueProfile: response?.implementation.inputFormat === "bounded_observation" ? createW1DialogueProfile(response.implementation) : undefined,
        publicMask: effectivePublicMask,
        workingTurnText: visibleTurns.map((turn) => `${turn.role}: ${turn.text}`).join("\n"),
        workingTurnHistory: modelWindow === undefined ? undefined : recentSessionHistory(),
        allowUnsaidRemainder: Boolean(!effectivePublicMask && latestTurn &&
          (modelWindow === undefined ? visibleTurns.at(-1) === latestTurn : canReplay(latestTurn))),
        personaName: studioConfig.soulStudio.displayName,
        corePersonalityPrompt: studioConfig.soulStudio.corePersonalityPrompt,
        roleLabel: primaryRoleMeta?.label,
        catchphrases: studioConfig.soulStudio.catchphrases,
        bannedCliches: studioConfig.soulStudio.bannedCliches,
        lorebook,
        promptSources: compiledStudioPrompt.bricks.map(brick => ({ id: "studio/" + brick.id,
          version: createHash("sha256").update(studioConfig.soulStudio.promptBricks.find(item => item.id === brick.id)!.template).digest("hex"),
          field: "system", authority: "host_profile", source: brick.source, text: brick.rendered, budget: brick.maxTokens,
          disposition: brick.reason ?? "included" })),
        configuredInstructions: compiledStudioPrompt.bricks.filter(brick => brick.included)
          .map(brick => "### " + brick.title + "\n" + brick.rendered).join("\n\n"),
        dynamicLlmConfig: { ...dynamicLlmConfig, traceLease },
        maxTotalTokens: resolved.route.maxContextTokens
      }
    }, { ...options, signal, deferDeliveryReceipt: true, infer: channelInference({ studio: studioConfig,
      host, response, currentStudio: options.preview ? undefined : () => readConsoleStudioConfig(this.soulDir), upstream: this.channelUpstream, modelPackageId: this.dialogueModelPackageId, sandboxFallback: this.allowDeterministicSandbox,
      preview: Boolean(options.preview), trace: options.preview ? undefined : traceLease }) });
    signal.throwIfAborted();

    storage.runInTransaction(() => {
      storage.saveTurnDecisionTrace(turn.trace);
      if (turn.usedMemoryIds) storage.sqlite.prepare(
        "UPDATE event_log SET payload_json=json_set(payload_json,'$.used_memory_ids',json(?)) WHERE event_id=?"
      ).run(JSON.stringify(turn.usedMemoryIds), eventId);
      if(turn.usedKnowledge) storage.sqlite.prepare("UPDATE event_log SET payload_json=json_set(payload_json,'$.knowledge_consulted',1) WHERE event_id=?").run(eventId);
      for (const s of turn.knowledgeSources ?? []) storage.sqlite.prepare(
        "INSERT OR IGNORE INTO knowledge_turn_sources(event_id,chunk_id,marker) SELECT ?,chunk_id,? FROM knowledge_chunks WHERE chunk_id=?"
      ).run(eventId,s.marker,s.chunkId);
      if (principal === "owner_verified" && audience === "only_owner" && input.text.trim().length >= 8 && !/(忘掉|遗忘|forget)/iu.test(input.text)) {
        storage.insertMemoryWithLineage(
          {
            memory_id: `mem_${eventId}`,
            memory_tier: "episodic_experience",
            epistemic_type: "observed_firsthand",
            attributed_principal: "owner:local",
            visibility_scope: "only_owner",
            taint_level: "trusted_owner",
            content_text: `对话记录：${input.text.slice(0, 140)}`,
            created_virtual_ts: nowMs,
            last_recalled_ts: nowMs,
            valid_from_virtual_ts: nowMs,
            created_at_rev: coordinator.getSnapshot().state_rev
          },
          [{ parent_type: "event", parent_id: eventId, relation_type: "derived_from" }]
        );
      }
    });
    if (!options.eventId) this.lastIntentEventId.set(turn.expression.intent_id, eventId);

    return {
      event_id: eventId,
      expression: turn.expression,
      modelRequestId: [eventId, eventId + "/0"].find(id => this.modelRequests[isSandbox ? "sandbox" : "live"].has(id)),
      sources: this.knowledgeSources(isSandbox ? "sandbox" : "live",eventId),
      trace: turn.trace,
      compiledBlackboard: turn.compiledBlackboard,
      route: turn.route,
      provider: turn.provider,
      usage: turn.usage,
      resolvedRoute: { ...resolved.route, primaryChat: routedBinding ?? resolved.route.primaryChat }
    };
  }

  private eventKnowledgeCollections(storage: CoordinatorStorageMutator, eventId:string) {
    const event=storage.getEventById(eventId);
    if(!event || event.redacted_at_ts_ms!==null) return [];
    const config=readSoulProfileConfig(this.soulDir);
    const profile=config.profiles.find(p=>p.id===JSON.parse(event.payload_json).profile_id);
    return allowedCollections(storage,profile ? profileMounts(storage,profile) : [],event.audience_scope,event.principal_trust==="owner_verified");
  }

  knowledgeSources(mode:"live"|"sandbox",eventId:string) {
    const storage=mode==="live"?this.storage:this.sandboxStorage;
    return turnKnowledgeSources(storage,eventId,this.eventKnowledgeCollections(storage,eventId));
  }

  commitDelivery(mode: "live" | "sandbox", eventId: string, status: "completed" | "interrupted", offset: number) {
    const storage = mode === "live" ? this.storage : this.sandboxStorage;
    const coordinator = mode === "live" ? this.coordinator : this.sandboxCoordinator;
    const event = storage.getEventById(eventId);
    const trace = storage.getDecisionTraceByEvent(eventId);
    if (!event || event.redacted_at_ts_ms !== null || !trace) throw new Error("UNKNOWN_TURN");
    const existing = trace.steps.step8_delivery_receipt;
    if (existing) return existing;
    const text = Array.from(trace.steps.step7_emitted_intent.fallback_text);
    const receipt = { status, spoken_char_offset: Math.min(text.length, Math.max(0, offset)), degraded_extensions: [] };
    storage.runInTransaction(() => {
      storage.updateTurnTraceDeliveryReceipt(eventId, receipt);
      if(status==="completed") countDeliveredSources(storage,eventId,text.slice(0,receipt.spoken_char_offset).join(""),Date.now());
      if (receipt.spoken_char_offset) coordinator.submitProposal({
        proposal_id: "delivery:" + eventId, domain: "D1_WORKING_TURN",
        base_rev: coordinator.getSnapshot().domain_revs.D1_WORKING_TURN, source_event_ids: [eventId],
        payload: { append_turn: { event_id: eventId + ":w1", role: "assistant",
          text: text.slice(0, receipt.spoken_char_offset).join("") } }
      });
    });
    return receipt;
  }

  handleChannelInterrupt(input: {
    channel_id?: string;
    intent_id: string;
    spoken_char_offset: number;
    full_text: string;
    mode?: "live" | "sandbox";
  }, eventId?: string) {
    const isSandbox = input.mode === "sandbox";
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const turnEventId = eventId ?? this.lastIntentEventId.get(input.intent_id);
    const trace = turnEventId ? storage.getDecisionTraceByEvent(turnEventId) : undefined;
    if (!turnEventId || !trace || trace.steps.step7_emitted_intent.intent_id !== input.intent_id) throw new Error("UNKNOWN_TURN");
    const length=Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
    const receipt = this.commitDelivery(isSandbox ? "sandbox" : "live", turnEventId,
      input.spoken_char_offset >= length ? "completed" : "interrupted", input.spoken_char_offset);
    const offset = receipt.spoken_char_offset;
    const unsaidRemainder = Array.from(trace.steps.step7_emitted_intent.fallback_text).slice(offset).join("");

    this.adminServer.broadcastTelemetry(
      "[TRACE]",
      {
        event: "barge_in_interrupted",
        ...(input.channel_id ? { channel_id: input.channel_id } : {}),
        intent_id: input.intent_id,
        spoken_char_offset: offset,
        ...(eventId ? {} : { unsaid_remainder: unsaidRemainder })
      },
      isSandbox ? "sandbox:console" : "live"
    );

    return {
      intent_id: input.intent_id,
      spoken_char_offset: offset,
      unsaid_remainder: unsaidRemainder
    };
  }

  clearChannelTranscript(_channelId?: string, _mode: "live" | "sandbox" = "live"): { ok: true; cleared: number } {
    return { ok: true, cleared: 0 };
  }

  async buildConsoleLiveSnapshot(mode: "live" | "sandbox" = "live"): Promise<ConsoleLiveSnapshot> {
    await this.refreshCapabilities();
    const isSandbox = mode === "sandbox";
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const clock = isSandbox ? this.sandboxClock : this.virtualClock;
    const coordinator = isSandbox ? this.sandboxCoordinator : this.coordinator;
    const compiler = isSandbox ? this.sandboxBlackboardCompiler : this.blackboardCompiler;
    const extHost = isSandbox ? this.sandboxExtensionHost : this.extensionHost;
    const snapshot = coordinator.getSnapshot();
    const archiveConfig = readSoulArchiveConfig(this.soulDir);

    const events = storage.listEvents({ limit: 50 });
    const memories = storage.queryMemoriesWithAudienceGuard({
      audience_scope: "only_owner",
      principal_trust: "owner_verified",
      current_virtual_ts: clock.nowMs(),
      limit: 50
    });
    const edgeRows = storage.sqlite
      .prepare("SELECT child_memory_id, parent_id FROM memory_lineage_edges")
      .all() as Array<{ child_memory_id: string; parent_id: string }>;
    const edgesByChild = new Map<string, string[]>();
    for (const row of edgeRows) {
      const list = edgesByChild.get(row.child_memory_id) ?? [];
      list.push(row.parent_id);
      edgesByChild.set(row.child_memory_id, list);
    }

    const kbRows = listKnowledgeCollections(storage);
    const collectionIds = kbRows.map(c=>c.id);

    const traces = storage.listDecisionTraces(20);
    const compiled = await compiler.compile(
      snapshot,
      {
        max_total_tokens: 2_200,
        tier0_safety_invariants:
          "",
        narrative_self_text: archiveConfig.narrative,
        memory_projection_text: memories.slice(0, 4).map((m) => m.content_text).join("\n")
      },
      "only_owner"
    );

    const redactionCount = await readRedactionLedgerCount(this.soulDir);
    if (!isSandbox && storage !== this.liveStorage) return this.buildConsoleLiveSnapshot(mode);
    const milestones = storage.listMilestones(20).map((item) => ({
      id: item.milestone_id,
      title: item.title,
      moment: new Date(item.unlocked_virtual_ts).toISOString().slice(0, 10),
      note: item.category,
      completed: true,
      conditions: []
    }));

    const recentTranscript: ConsoleLiveSnapshot["recentTranscript"] = [];
    for (const trace of [...traces].reverse().slice(-6)) {
      const delivered = trace.steps.step8_delivery_receipt;
      const generated = trace.steps.step7_emitted_intent.fallback_text;
      recentTranscript.push({
        id: `${trace.turn_event_id}:u`,
        role: "user",
        text: trace.steps.step1_perception.summary_text,
        timestamp: new Date(trace.virtual_ts_ms).toISOString().slice(11, 19)
      });
      if (!delivered || !["completed", "interrupted"].includes(delivered.status) || !delivered.spoken_char_offset) continue;
      recentTranscript.push({
        id: `${trace.turn_event_id}:a`,
        role: "assistant",
        text: Array.from(generated).slice(0, delivered.spoken_char_offset).join(""),
        timestamp: new Date(trace.virtual_ts_ms).toISOString().slice(11, 19)
      });
    }

    const telemetryEntries: ConsoleLiveSnapshot["telemetryEntries"] = this.mutableState.telemetryFrames
      .filter(frame => frame.target_instance === (isSandbox ? "sandbox:console" : "live"))
      .slice(-40)
      .map((frame) => ({
        id: `tel_${frame.sequence}`,
        track: frame.track.replace(/[\[\]]/g, "") as "EVENT" | "TRACE" | "AGENCY" | "SYS",
        timestamp: new Date(frame.timestamp_ms).toISOString().slice(11, 19),
        message: typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload)
      }));
    if (telemetryEntries.length === 0) {
      for (const evt of events.slice(0, 8)) {
        telemetryEntries.push({
          id: evt.event_id,
          track: evt.event_category === "sleep_consolidation_run" ? "AGENCY" : "EVENT",
          timestamp: new Date(evt.virtual_ts_ms).toISOString().slice(11, 19),
          message: `[${evt.source_channel_id}/${evt.audience_scope}] ${evt.summary_text}`
        });
      }
    }

    const { infrastructure, soulProfiles } = ensureOrthogonalStoresMigrated(this.soulDir, this.hostDir);
    const profiles = soulProfiles.profiles.map(p => ({...p, knowledgeCollectionIds:profileMounts(storage,p,collectionIds)}));
    const mountedCollections = new Set(profiles.flatMap(p=>p.knowledgeCollectionIds));
    const providerUsages = Object.fromEntries(
      infrastructure.providerSources.map((src) => [src.id, findProviderReferences(src.id, soulProfiles)])
    );
    const modelUsages = Object.fromEntries(
      infrastructure.modelInstances.map((mdl) => [mdl.id, findProviderReferences(mdl.sourceId, soulProfiles, mdl.modelId, mdl.id)])
    );
    const skills = listAgentSkills(this.soulDir, this.bundledSkillsDir);
    const studioConfig = readConsoleStudioConfig(this.soulDir, archiveConfig.identity.display_name);
    const unawakened = !isSandbox && !this.hasAwakenedSoul;
    // Keep legacy studio projection synchronized with orthogonal SSOT stores
    studioConfig.systemSettings = { ...infrastructure.systemSettings };
    studioConfig.ragSettings = {
      chunkSize: soulProfiles.capabilities.knowledge.chunkSize,
      chunkOverlap: soulProfiles.capabilities.knowledge.chunkOverlap,
      topK: soulProfiles.capabilities.knowledge.topK,
      denseWeight: soulProfiles.capabilities.knowledge.denseWeight,
      bm25Weight: soulProfiles.capabilities.knowledge.bm25Weight,
      honestForgetThreshold: soulProfiles.capabilities.knowledge.honestForgetThreshold
    };
    const activeDefaultProfile =
      soulProfiles.profiles.find((p) => p.id === soulProfiles.defaultProfileId) ?? soulProfiles.profiles[0];
    if (activeDefaultProfile) {
      studioConfig.metabolicPolicy = { ...activeDefaultProfile.metabolicPolicy };
      studioConfig.attentionPolicy = {
        focusHysteresisMs: activeDefaultProfile.conversationGate.focusHysteresisMs,
        neverBroadcastAll: activeDefaultProfile.conversationGate.neverBroadcastAll,
        retractDraftAwareness: activeDefaultProfile.conversationGate.retractDraftAwareness,
        habituationDecayRate: activeDefaultProfile.conversationGate.habituationDecayRate
      };
    }
    for (const plugin of this.pluginLoader.listPlugins()) {
      const manifest = plugin.manifest;
      if (!studioConfig.ecosystem.plugins.some(item => item.id === manifest.extension_id)) {
        studioConfig.ecosystem.plugins.push({ id: manifest.extension_id, name: manifest.display_name,
          version: manifest.version, bus: manifest.facets[0] ?? "extension.service", carrier: manifest.carrier_kind,
          enabled: plugin.enabled, description: "", configFields: [] });
      }
    }
    const connections = this.channelGateway.listConnections(mode);
    const conversations = buildConversationsList(storage, studioConfig, soulProfiles);
    const availableSouls = unawakened ? [] : this.listSoulInstances();

    return {
      hasAwakenedSoul: this.hasAwakenedSoul,
      readiness: this.computeReadiness(),
      hostCards: listHostCharacterCards(this.hostDir).map(({ cardId, card }) => ({
        cardId, name: card.data.name, description: card.data.description, creator: card.data.creator || undefined, tags: card.data.tags
      })),
      soulId: unawakened ? "" : archiveConfig.manifest.soul_id,
      personaName: unawakened ? "未唤醒" : studioConfig.soulStudio.displayName || archiveConfig.identity.display_name,
      soulDir: unawakened ? "" : this.soulDir,
      targetInstance: isSandbox ? "sandbox:console" : "live",
      stateRev: snapshot.state_rev,
      virtualTsMs: clock.nowMs(),
      virtualOffsetHours: isSandbox ? this.mutableState.virtualOffsetHours : 0,
      capabilityRevision: this.pluginLoader.revision,
      activeConnections: connections.length,
      connectedChannelIds: [...new Set(connections.map(session => session.channel_id))],
      eventsCount: unawakened ? 0 : Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM event_log WHERE redacted_at_ts_ms IS NULL").get()?.n),
      memoriesCount: unawakened ? 0 : Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM memories WHERE invalidated_at_ts IS NULL").get()?.n),
      tracesCount: unawakened ? 0 : Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM turn_decision_traces").get()?.n),
      redactionLedgerCount: redactionCount,
      metabolicEnergy: snapshot.D2_CONTINUOUS_STATES.values.metabolic_energy,
      circadianEnergy: snapshot.D2_CONTINUOUS_STATES.values.circadian_energy,
      moodValence: snapshot.D2_CONTINUOUS_STATES.values.instant_valence,
      socialLonging: snapshot.D2_CONTINUOUS_STATES.values.drive_social_longing,
      frictionTension: snapshot.D5_IDENTITY_NARRATIVE.active_tensions.filter((t) => !t.resolved).length,

      blackboardSlots: unawakened ? [] : compiled.slots.map((slot, idx) => ({
        id: slot.slot_id,
        label: slot.slot_id.replace(/^slot\./, "").replaceAll("_", " "),
        tokenCount: slot.tokens,
        quotaTokens: Math.max(slot.tokens + 80, 260),
        priority: idx + 1,
        summary: slot.content.slice(0, 96) || "Empty slot",
        locked: slot.locked
      })),
      compiledBlackboardPrompt: unawakened ? "" : compiled.compiled_prompt_text,
      totalBlackboardTokens: unawakened ? 0 : compiled.total_tokens,
      maxBlackboardTokens: unawakened ? 0 : studioConfig.soulStudio.maxBlackboardTokens || compiled.max_total_tokens,
      lineageNodes: memories.map((memory) => ({
        id: memory.memory_id,
        label: memory.content_text.slice(0, 22),
        memoryTier: memory.memory_tier,
        visibilityScope: memory.visibility_scope,
        taintLevel: memory.taint_level,
        contentText: memory.content_text,
        parentIds: edgesByChild.get(memory.memory_id) ?? [],
        sealed: memory.memory_tier === "topic_taboo_seal"
      })),
      knowledgePacks: kbRows.map(row => ({id:row.id,name:row.name,documents:row.documents,citations:row.citations,
        mounted:mountedCollections.has(row.id),
        sampleText:""})),
      milestones,
      extensions: this.pluginLoader.listPlugins().map(plugin => {
        const id = plugin.manifest.extension_id;
        const mounted = extHost.getPackage(id);
        const cfgState = this.pluginLoader.getPluginConfig(extHost, id);
        return {
          id,
          displayName: plugin.manifest.display_name,
          description: plugin.manifest.description,
          author: plugin.manifest.author,
          tags: plugin.manifest.tags,
          version: plugin.manifest.version,
          origin: plugin.origin,
          pages: plugin.pages,
          moduleUrls: plugin.moduleUrls,
          uiSlots: this.pluginLoader.uiSlotsFor(plugin, extHost),
          missingAssets: plugin.missingAssets,
          generation: this.generation(id, mode),
          activationError: this.pluginLoader.activationError(extHost, id),
          carrier: plugin.manifest.carrier_kind,
          facets: plugin.manifest.facets,
          enabled: mounted?.status === "active",
          rev: cfgState.rev,
          readDomains: [...plugin.manifest.permissions.read_blackboard_domains],
          proposeDomains: [...plugin.manifest.permissions.propose_mutation_domains],
          maxAudienceScope: plugin.manifest.permissions.max_audience_scope,
          networkAccess: plugin.manifest.permissions.network_access,
          configFields: plugin.manifest.console_contributions?.config_fields,
          currentConfig: cfgState.config
        };
      }),
      sleepJournal: unawakened ? [] : isSandbox
        ? events.filter(event => event.event_category === "sleep_consolidation_run").map(event => ({
            title: "睡眠整理", date: new Date(event.wall_ts_ms).toISOString(), content: event.summary_text }))
        : studioConfig.evolution.dreamJournal.map(({ title, date, content }) => ({ title, date, content })),
      recentTraces: traces,
      latestTrace: traces[0],
      telemetryEntries,
      homeostasisSamples: buildHomeostasisSamples(snapshot, studioConfig.soulStudio.circadianAnchors),
      sb243Metrics: storage.getSb243Metrics(),
      pragmaStatus: storage.getTablePragmaStatus(),
      recentTranscript,
      studioConfig: unawakened ? undefined : { ...studioConfig, agency: { ...studioConfig.agency,
        activeTasks: studioConfig.agency.activeTasks.map(task => ({ ...task,
          approvalCurrent: isTaskExecutionApproved(task, studioConfig.agency.subAgents.find(agent => agent.id === task.subAgentId))
        })) } },
      infrastructure,
      soulProfiles: {...soulProfiles,profiles},
      providerUsages,
      modelUsages,
      skills,
      conversations,
      availableSouls,
      narrativeText: unawakened ? undefined : archiveConfig.narrative
    };
  }

  close(): void {
    this.modelRequests.live.clear();
    this.modelRequests.sandbox.clear();
    clearInterval(this.capabilityTimer);
    this.archiveLifetime.abort();
    for (const controller of this.revoked.values()) controller.abort();
    for (const composition of this.compositions) void composition.dispose();
    this.liveStorage.close();
    this.sandboxStorage.close();
    for (const forkStorage of this.mutableState.sandboxForks.values()) {
      forkStorage.close();
    }
    rmSync(this.sandboxDir, { recursive: true, force: true });
  }
}

export function createDefaultDaemonRuntime(
  options: DefaultDaemonOptions = {}
): Ai0DaemonRuntime {
  const sandboxDir = mkdtempSync(join(tmpdir(), "ai0-sandbox-console-"));
  const openedStores: CoordinatorStorageMutator[] = [];
  try {
    return composeDaemonRuntime(options, sandboxDir, path => {
      const storage = new CoordinatorStorageMutator(path);
      openedStores.push(storage);
      return storage;
    });
  } catch (error) {
    for (const storage of openedStores) storage.close();
    rmSync(sandboxDir, { recursive: true, force: true });
    throw error;
  }
}

function composeDaemonRuntime(
  options: DefaultDaemonOptions,
  sandboxDir: string,
  openStorage: (path: string) => CoordinatorStorageMutator
): Ai0DaemonRuntime {
  const explicitSoul = options.soulDir === undefined ? undefined : resolve(options.soulDir);
  const soulsRoot = resolve(options.soulsRoot ?? (explicitSoul ? dirname(explicitSoul) : "souls"));
  const hostDir = explicitSoul ? resolveHostInfrastructureDir(explicitSoul) : join(soulsRoot, "host");
  const discovered = explicitSoul ? undefined : discoverSoulDirectories(soulsRoot)[0];
  const soulDir = explicitSoul ?? (discovered ? join(soulsRoot, discovered) : join(sandboxDir, "unawakened-placeholder.soul"));
  const allowDeterministicSandbox = options.allowDeterministicSandbox === true;
  const hasAwakenedSoul = Boolean(explicitSoul || discovered);
  const layout = initializeSoulDirectory(soulDir, hasAwakenedSoul ? {} : { displayName: "未唤醒" });
  if (!hasAwakenedSoul) readConsoleStudioConfig(soulDir, "未唤醒");
  const initialOrthogonal = ensureOrthogonalStoresMigrated(soulDir, hostDir);
  const initialDefaultProfile =
    initialOrthogonal.soulProfiles.profiles.find((p) => p.id === initialOrthogonal.soulProfiles.defaultProfileId) ??
    initialOrthogonal.soulProfiles.profiles[0]!;
  const liveStorage = openStorage(layout.soulCoreDatabasePath);
  const virtualClock = new VirtualClock({ targetInstance: targetInstanceOf(options.targetInstance) });

  const libraryIds=listKnowledgeCollections(liveStorage).map(c=>c.id);
  const config=initialOrthogonal.soulProfiles;
  const profiles=config.profiles.map(p=>({...p,knowledgeCollectionIds:p.knowledgeCollectionIds.map(id=>{
    const [resolved]=mountedCollectionIds([id],libraryIds);
    return resolved && libraryIds.includes(resolved) ? resolved : id;
  })}));
  if(profiles.some((p,i)=>p.knowledgeCollectionIds.some((id,j)=>id!==config.profiles[i]?.knowledgeCollectionIds[j])))
    writeSoulProfileConfig(soulDir,{...config,profiles});
  const sandboxSoulDir = join(sandboxDir, "sandbox.soul");
  const sandboxLayout = initializeSoulDirectory(sandboxSoulDir);
  const sandboxStorage = openStorage(sandboxLayout.soulCoreDatabasePath);

  const soulArchiveManager = new SoulArchiveManager(soulDir);
  const liveRetriever = new HybridMemoryRetriever(liveStorage);
  const liveHardForget = new HardForgetEngine(liveStorage.sqlite);
  const sandboxRetriever = new HybridMemoryRetriever(sandboxStorage);
  const sandboxHardForget = new HardForgetEngine(sandboxStorage.sqlite);
  const sandboxClock = new VirtualClock({
    targetInstance: "sandbox:console",
    initialVirtualTsMs: virtualClock.nowMs()
  });

  const extensionHost = new ExtensionCoreHost();
  const sandboxExtensionHost = new ExtensionCoreHost();
  const coordinatorTraces: KernelTurnTrace[] = [];
  let runtimeRef: Ai0DaemonRuntime | undefined;
  const getLiveStorage = () => runtimeRef?.storage ?? liveStorage;
  const coordinator = new AuthoritativeStateCoordinator(
    virtualClock,
    createCoordinatorStorage(getLiveStorage, coordinatorTraces), extensionHost
  );
  const sandboxCoordinator = new AuthoritativeStateCoordinator(
    sandboxClock,
    createCoordinatorStorage(() => sandboxStorage, coordinatorTraces), sandboxExtensionHost
  );

  const readOnlyView = createReadOnlyView(getLiveStorage);
  const sandboxReadOnlyView = createReadOnlyView(() => sandboxStorage);
  const blackboardCompiler = new BlackboardCompiler(virtualClock, {
    listEvents: () => getLiveStorage().listEvents().map((e) => ({ ...e }))
  });
  const sandboxBlackboardCompiler = new BlackboardCompiler(sandboxClock, {
    listEvents: () => sandboxStorage.listEvents().map((e) => ({ ...e }))
  });

  const repoPluginsRoot = resolve(
    options.builtinPluginsDir ?? fileURLToPath(new URL("../../../plugins", import.meta.url))
  );
  const bundledSkillsDir = join(repoPluginsRoot, "skills-and-mcp");
  const pluginLoader = new RuntimePluginLoader({
    soulDir,
    ...(options.builtinPluginsDir ? { builtinPluginsDir: options.builtinPluginsDir } : {}),
    ...(options.userPluginsDir ? { userPluginsDir: options.userPluginsDir } : {}),
    ...(options.extraPluginDirs ? { extraPluginDirs: options.extraPluginDirs } : {})
  });
  const compositions = [new ExtensionComposition(), new ExtensionComposition()];


  const brainRegionRouter = new BrainRegionRouter(toBrainRouterConfig(buildRegionBindingsFromProfile(initialDefaultProfile)));

  const dialogueClient = (host: ExtensionCoreHost) => new UniversalLlmProviderClient(options.llmConfig, allowDeterministicSandbox,
    undefined, options.dialogueModelPackageId ? registeredModelTransport(host, options.dialogueModelPackageId) : undefined);
  const defaultHypothesisRevision: HypothesisRevisionPolicy = (update, hypotheses) =>
    update.perception_confidence !== undefined && update.perception_confidence >= 0.8
      ? hypotheses.find(hypothesis => hypothesis.confidence < 0.5 && hypothesis.text.trim() !== update.summary_text.trim())
      : undefined;
  const sensoryCoverage = new SensoryCoverageBucketManager(virtualClock, defaultHypothesisRevision);
  const opportunityPool = new InteractionOpportunityPool(virtualClock);
  const ownerMasterToken = options.ownerMasterToken ?? randomBytes(32).toString("base64url");
  if (!ownerMasterToken) throw new TypeError("ownerMasterToken must not be empty.");

  const mutableState: DaemonMutableState = {
    virtualOffsetHours: 0,
    debounceWindowMs: initialDefaultProfile.conversationGate.debounceMs,
    circadianAnchors: [
      { hour: 8, energy: 0.8 },
      { hour: 14, energy: 1.0 },
      { hour: 23, energy: 0.32 }
    ],
    telemetryFrames: [],
    sandboxForks: new Map()
  };

  let adminServerRef: PrivilegedAdminServer | undefined;
  const emitTelemetry = (
    track: AdminTelemetryTrack,
    payload: unknown,
    target: "live" | `sandbox:${string}` = "live",
    timestampMs = Date.now()
  ): void => {
    const frame: AdminTelemetryFrame | undefined = adminServerRef?.broadcastTelemetry(
      track,
      payload,
      target,
      timestampMs
    );
    if (frame) mutableState.telemetryFrames.push(frame);
  };

  const channelGateway = new ChannelProtocolGateway({
    renderPresentation: renderEmbodiedPresentation,
    extensionHost,
    clock: virtualClock,
    w1: {
      recordInterruption(record) { workers.w1.recordInterruption(record); }
    }
  });
  const workers: DaemonWorkers = {
    w1: new W1FastDialogueWorker(
      coordinator,
      readOnlyView,
      createKernelRetriever(() => runtimeRef?.hybridMemoryRetriever ?? liveRetriever, getLiveStorage, virtualClock),
      virtualClock,
      {
        blackboardCompiler,
        brainRouter: brainRegionRouter,
        llmClient: dialogueClient(extensionHost),
        allowDeterministicSandbox,
        realizerNegotiator: channelGateway.negotiator,
        extensionHost,
        onTraceCommitted: (trace) => emitTelemetry("[TRACE]", { trace_id: trace.trace_id, rev: trace.state_rev_after }, "live")
      }
    ),
    w2: new W2AgencyTaskWorker(coordinator, new ThreeDimensionalPolicyEngine(), virtualClock, extensionHost),
    w3: new W3SleepReflectionWorker(coordinator, readOnlyView, virtualClock, extensionHost),
    w4: new W4MultimodalAnalyzerWorker(sensoryCoverage, virtualClock, extensionHost)
  };

  const sandboxW1 = new W1FastDialogueWorker(
    sandboxCoordinator,
    sandboxReadOnlyView,
    createKernelRetriever(() => sandboxRetriever, () => sandboxStorage, sandboxClock),
    sandboxClock,
    {
      blackboardCompiler: sandboxBlackboardCompiler,
      brainRouter: brainRegionRouter,
      llmClient: dialogueClient(sandboxExtensionHost),
      allowDeterministicSandbox,
      realizerNegotiator: channelGateway.negotiator,
      extensionHost: sandboxExtensionHost,
      onTraceCommitted: (trace) =>
        emitTelemetry("[TRACE]", { trace_id: trace.trace_id, rev: trace.state_rev_after }, "sandbox:console")
    }
  );

  const handlerContext: DaemonHandlerContext = {
    get runtime() { return runtimeRef!; },
    refreshCapabilities: changed => runtimeRef!.refreshCapabilities(changed),
    reloadExtension: (id, mode, config, expected) => runtimeRef!.reloadExtension(id, mode, config, expected),
    reloadSingleExtension: (id, mode) => runtimeRef!.reloadSingleExtension(id, mode),
    reloadAllExtensions: () => runtimeRef!.reloadAllExtensions(),
    installExternalExtension: (input) => runtimeRef!.installExternalExtension(input),
    uninstallExternalExtension: (id, keepConfig) => runtimeRef!.uninstallExternalExtension(id, keepConfig),
    pluginLoader,
    bundledSkillsDir,
    channelGateway,
    get soulDir() { return runtimeRef!.soulDir; },
    hostDir,
    get storage() { return getLiveStorage(); },
    sandboxStorage,
    get hardForgetEngine() { return runtimeRef!.hardForgetEngine; },
    sandboxHardForgetEngine: sandboxHardForget,
    get soulArchiveManager() { return runtimeRef!.soulArchiveManager; },
    virtualClock,
    sandboxClock,
    coordinator,
    sandboxCoordinator,
    blackboardCompiler,
    sandboxBlackboardCompiler,
    brainRegionRouter,
    extensionHost,
    sandboxExtensionHost,
    sensoryCoverage,
    opportunityPool,
    sandboxW1,
    coordinatorTraces,
    state: mutableState,
    emitTelemetry,
    replaceLiveStorage(nextStorage) {
      runtimeRef!.replaceLiveStorage(nextStorage);
    }
  };

  const adminServer = new PrivilegedAdminServer({
    ownerToken: ownerMasterToken,
    handlers: createRealAdminHandlers(handlerContext)
  });
  adminServerRef = adminServer;
  adminServer.subscribeTelemetry((frame) => {
    if (mutableState.telemetryFrames.at(-1)?.sequence !== frame.sequence) {
      mutableState.telemetryFrames.push(frame);
      if (mutableState.telemetryFrames.length > 400) mutableState.telemetryFrames.shift();
    }
  });

  runtimeRef = new Ai0DaemonRuntime(
    soulDir,
    soulsRoot,
    hostDir,
    hasAwakenedSoul,
    Boolean(options.llmConfig),
    allowDeterministicSandbox,
    ownerMasterToken,
    liveStorage,
    sandboxStorage,
    sandboxDir,
    soulArchiveManager,
    liveRetriever,
    liveHardForget,
    virtualClock,
    sandboxClock,
    coordinator,
    sandboxCoordinator,
    blackboardCompiler,
    sandboxBlackboardCompiler,
    extensionHost,
    sandboxExtensionHost,
    brainRegionRouter,
    workers,
    sandboxW1,
    channelGateway,
    adminServer,
    coordinatorTraces,
    mutableState,
    pluginLoader,
    compositions,
    bundledSkillsDir,
    { live: new ModelRequestJournal({ captureBodies: options.capturePromptBodies, now: Date.now }),
      sandbox: new ModelRequestJournal({ captureBodies: options.capturePromptBodies, now: Date.now }) },
    options.llmConfig, options.dialogueModelPackageId
  );
  mountKnowledgeTaskExecutor(extensionHost, runtimeRef);
  return runtimeRef;
}

export * from "./admin-handlers.js";
export * from "./studio-service.js";
export * from "./plugin-loader.js";
export * from "./cli.js";
