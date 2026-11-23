import { ExtensionComposition } from "@ai0/sdk";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ConsoleLiveSnapshot } from "@ai0/console-webui";
import {
  PrivilegedAdminServer,
  ShellProtocolGateway,
  type AdminTelemetryFrame,
  type AdminTelemetryTrack
} from "@ai0/gateway";
import {
  AuthoritativeStateCoordinator,
  BlackboardCompiler,
  BrainRegionRouter,
  InteractionOpportunityPool,
  PolymorphicExtensionHost,
  SensoryCoverageBucketManager,
  ThreeDimensionalPolicyEngine,
  UniversalLlmProviderClient,
  VirtualClock,
  W1FastDialogueWorker,
  W2AgencyTaskWorker,
  W3SleepReflectionWorker,
  W4MultimodalAnalyzerWorker,
  type CoordinatorStorageMutator as KernelCoordinatorStorageMutator,
  type ReadOnlyCognitiveSnapshot,
  type KernelMemoryRetriever,
  type KernelReadOnlyStorageView,
  type LlmProviderConfig,
  type TargetInstance,
  type W1AsyncTurnOptions,
  type VerifiableTurnTrace as KernelTurnTrace
} from "@ai0/kernel";
import type { AudienceScope, SensorModality, VenueType } from "@ai0/protocol";
import {
  compileStudioPromptPreview,
  CoordinatorStorageMutator,
  HardForgetEngine,
  HybridMemoryRetriever,
  ROLE_ARCHETYPE_PRESETS,
  SoulArchiveManager,
  initializeSoulDirectory,
  labelLegacyDemoEvents,
  readConsoleStudioConfig,
  readSoulArchiveConfig,
  seedDefaultSoulAwakeningData
} from "@ai0/storage";

import {
  buildHomeostasisSamples,
  createRealAdminHandlers,
  readRedactionLedgerCount,
  type DaemonHandlerContext,
  type DaemonMutableState
} from "./admin-handlers.js";
import {
  buildConversationsList,
  buildLivePromptPreviews,
  listAvailableSoulInstances,
  readVaultProviderKey
} from "./studio-service.js";
import { RuntimePluginLoader } from "./plugin-loader.js";

export interface DefaultDaemonOptions {
  soulDir?: string;
  ownerMasterToken?: string;
  targetInstance?: string;
  seedIfEmpty?: boolean;
  llmConfig?: LlmProviderConfig;
  extraPluginDirs?: readonly string[];
  builtinPluginsDir?: string;
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
      if (data.format !== "ai0.coordinator.v1") return undefined;
      return data.snapshot as ReadOnlyCognitiveSnapshot;
    },
    checkpointCoordinatorState(snapshot) {
      const affect = snapshot.D2_HOMEOSTASIS_AFFECT;
      const eventId = snapshot.D1_WORKING_TURN.recent_turns.at(-1)?.event_id.replace(/:w1$/, "") ?? "";
      getStorage().saveCheckpoint({
        ...affect, mood_attr_scope: affect.mood_attr_scope === "public_all" || affect.mood_attr_scope === "public" ? "public_all" :
          affect.mood_attr_scope.startsWith("group:") ? affect.mood_attr_scope as AudienceScope : "only_owner",
        state_rev: snapshot.state_rev, virtual_ts_ms: getStorage().getEventById(eventId)?.virtual_ts_ms ?? 0,
        caused_by_event_id: eventId, relationship_json: "{}", user_model_json: "{}",
        working_memory_json: JSON.stringify({ format: "ai0.coordinator.v1", snapshot })
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
      ? getStorage().sqlite.prepare("SELECT e.* FROM event_log e WHERE COALESCE(json_extract(e.payload_json,'$.origin'),'') <> 'demo' AND event_category='perception_committed' AND redacted_at_ts_ms IS NULL AND NOT EXISTS (SELECT 1 FROM memories WHERE memory_id='mem_consolidated_' || e.event_id) ORDER BY event_seq").all()
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

export class Ai0DaemonRuntime {
  private readonly revoked = new Map<string, AbortController>();
  private readonly capabilityTimer: ReturnType<typeof setInterval>;
  generation(id: string, mode: "live" | "sandbox" = "live") {
    return this.pluginLoader.generation(mode === "live" ? this.extensionHost : this.sandboxExtensionHost, id);
  }
  private revoke(id: string, mode: "live" | "sandbox") {
    const key = JSON.stringify([id, mode]);
    this.revoked.get(key)?.abort();
    this.revoked.delete(key);
    this.shellGateway.disconnectPlugin(id, mode);
  }
  pluginSignal(pluginId: string, mode: "live" | "sandbox"): AbortSignal {
    const id = JSON.stringify([pluginId, mode]);
    let controller = this.revoked.get(id);
    if (!controller) { controller = new AbortController(); this.revoked.set(id, controller); }
    return controller.signal;
  }

  private lastIntentEventId = new Map<string, string>();

  constructor(
    readonly soulDir: string,
    readonly ownerMasterToken: string,
    private liveStorage: CoordinatorStorageMutator,
    readonly sandboxStorage: CoordinatorStorageMutator,
    readonly sandboxDir: string,
    readonly soulArchiveManager: SoulArchiveManager,
    private liveRetriever: HybridMemoryRetriever,
    private liveHardForget: HardForgetEngine,
    readonly virtualClock: VirtualClock,
    readonly sandboxClock: VirtualClock,
    readonly coordinator: AuthoritativeStateCoordinator,
    readonly sandboxCoordinator: AuthoritativeStateCoordinator,
    readonly blackboardCompiler: BlackboardCompiler,
    readonly sandboxBlackboardCompiler: BlackboardCompiler,
    readonly extensionHost: PolymorphicExtensionHost,
    readonly sandboxExtensionHost: PolymorphicExtensionHost,
    readonly brainRegionRouter: BrainRegionRouter,
    readonly workers: DaemonWorkers,
    readonly sandboxW1: W1FastDialogueWorker,
    readonly shellGateway: ShellProtocolGateway,
    readonly adminServer: PrivilegedAdminServer,
    readonly coordinatorTraces: KernelTurnTrace[],
    readonly mutableState: DaemonMutableState,
    readonly pluginLoader: RuntimePluginLoader,
    private readonly compositions: ExtensionComposition[]
  ) {
    this.capabilityTimer = setInterval(() => {
      void this.refreshCapabilities().catch(error => this.adminServer.broadcastTelemetry("[SYS]",
        { action: "capability_refresh_failed", error: String(error) }, "live", Date.now()));
    }, 2000);
    this.capabilityTimer.unref();
  }

  private pendingRefresh?: Promise<void>;
  async refreshCapabilities(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh;
    const before = this.pluginLoader.listPlugins();
    const revision = this.pluginLoader.revision;
    const config = readConsoleStudioConfig(this.soulDir);
    this.pluginLoader.reload(new Map(config.ecosystem.plugins.map(item => [item.id, item.enabled])));
    for (const prior of before) {
      if (prior.generation !== this.pluginLoader.getPlugin(prior.manifest.extension_id)?.generation) {
        this.revoke(prior.manifest.extension_id, "live");
        this.revoke(prior.manifest.extension_id, "sandbox");
      }
    }
    this.pendingRefresh = Promise.all([
      this.pluginLoader.mountIntoHost(this.extensionHost, this.compositions[0]!),
      this.pluginLoader.mountIntoHost(this.sandboxExtensionHost, this.compositions[1]!)
    ]).then(() => {
      if (revision !== this.pluginLoader.revision) this.adminServer.broadcastTelemetry("[SYS]",
        { action: "capabilities_changed", revision: this.pluginLoader.revision }, "live", Date.now());
    }).finally(() => { this.pendingRefresh = undefined; });
    return this.pendingRefresh;
  }

  async reloadExtension(id: string, mode: "live" | "sandbox", config: Readonly<Record<string, unknown>>, expected: number) {
    await this.refreshCapabilities();
    const host = mode === "live" ? this.extensionHost : this.sandboxExtensionHost;
    const rev = this.pluginLoader.configure(host, id, config, expected);
    this.revoke(id, mode);
    await this.refreshCapabilities();
    const error = this.pluginLoader.activationError(host, id);
    if (error) throw new Error(error);
    this.adminServer.broadcastTelemetry("[SYS]", { action: "capabilities_changed", revision: this.pluginLoader.revision }, mode === "live" ? "live" : "sandbox:console");
    return rev;
  }

  fallbackShellId(): string {
    return "shell.default";
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
    this.liveStorage = nextStorage;
    this.liveRetriever = new HybridMemoryRetriever(nextStorage);
    this.liveHardForget = new HardForgetEngine(nextStorage.sqlite);
  }

  async handleShellTurn(input: {
    principalId?: string;
    thread?: string;
    shell_id?: string;
    text: string;
    venue_type?: VenueType;
    audience_scope?: AudienceScope;
    modality?: SensorModality;
    mode?: "live" | "sandbox";
  }, options: W1AsyncTurnOptions & { eventId?: string } = {}) {
    options.signal?.throwIfAborted();
    const isSandbox = input.mode === "sandbox";
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const clock = isSandbox ? this.sandboxClock : this.virtualClock;
    const coordinator = isSandbox ? this.sandboxCoordinator : this.coordinator;
    const w1 = isSandbox ? this.sandboxW1 : this.workers.w1;
    const target: "live" | `sandbox:${string}` = isSandbox ? "sandbox:console" : "live";

    const shellId = input.shell_id?.trim() || this.fallbackShellId();
    const venue: VenueType = input.venue_type ?? "private_1on1";
    const audience: AudienceScope =
      input.audience_scope ?? (venue === "public_livestream" ? "public_all" : "only_owner");
    const principal = input.principalId === "owner:local" ? "owner_verified" : "stranger";
    const modality: SensorModality = input.modality ?? "text";
    const nowMs = clock.nowMs();
    const eventId = options.eventId ?? "evt_shell_" + randomUUID();

    storage.appendEvent({
      event_id: eventId,
      wall_ts_ms: Date.now(),
      virtual_ts_ms: nowMs,
      source_shell_id: shellId,
      principal_id: input.principalId ?? "unknown",
      principal_trust: principal,
      venue_type: venue,
      audience_scope: audience,
      event_category: "perception_committed",
      modality,
      summary_text: input.text,
      payload_json: JSON.stringify({ venue, audience, modality, thread: input.thread }),
      state_rev_after: coordinator.getSnapshot().state_rev,
      active_modules_mask: 31
    });

    this.adminServer.broadcastTelemetry("[EVENT]", {
      event_id: eventId,
      shell_id: shellId,
      venue_type: venue,
      audience_scope: audience,
      ...(options.eventId ? {} : { summary_text: input.text })
    }, target, nowMs);

    const studioConfig = readConsoleStudioConfig(this.soulDir);
    const snapBefore = coordinator.getSnapshot();
    const primaryRoleMeta = ROLE_ARCHETYPE_PRESETS[studioConfig.soulStudio.primaryRole];
    const matchedLoreEntries = studioConfig.soulStudio.lorebooks
      .filter((entry) => entry.enabled && entry.keys.some((k) => k && input.text.includes(k)))
      .map((entry) => ({ title: entry.title, content: entry.content }));
    const compiledStudioPrompt = compileStudioPromptPreview(studioConfig, {
      audienceScope: audience === "only_owner" && principal === "owner_verified" ? "only_owner" : "public_all",
      venueType: venue,
      platform: shellId,
      moodValence: snapBefore.D2_HOMEOSTASIS_AFFECT.instant_valence,
      circadianEnergy: snapBefore.D2_HOMEOSTASIS_AFFECT.circadian_energy,
      metabolicEnergy: snapBefore.D2_HOMEOSTASIS_AFFECT.metabolic_energy
    });

    const routedProviderId = studioConfig.brainRouting.W1_fast_dialogue.primaryId;
    const routedProvider = studioConfig.providers.find((p) => p.id === routedProviderId);
    const vaultApiKey = routedProvider ? readVaultProviderKey(this.soulDir, routedProvider.id) : undefined;
    const isOllama = routedProvider?.vendor.toLowerCase().includes("ollama");
    const dynamicLlmConfig: LlmProviderConfig | undefined =
      routedProvider?.enabled && (vaultApiKey || isOllama)
        ? {
            provider: routedProvider.vendor.toLowerCase().includes("anthropic")
              ? "anthropic"
              : isOllama
                ? "ollama"
                : "openai-compatible",
            baseUrl: routedProvider.baseUrl,
            apiKey: vaultApiKey,
            model: routedProvider.modelId
          }
        : undefined;

    const turn = await w1.runTurnAsync({
      event_id: eventId,
      principal,
      venue_type: venue,
      audience_scope: audience,
      modality,
      summary_text: input.text,
      liveStudioContext: {
        personaName: studioConfig.soulStudio.displayName,
        corePersonalityPrompt: studioConfig.soulStudio.corePersonalityPrompt,
        roleLabel: primaryRoleMeta?.label,
        catchphrases: studioConfig.soulStudio.catchphrases,
        bannedCliches: studioConfig.soulStudio.bannedCliches,
        matchedLoreEntries,
        compiledBlackboardOverride: compiledStudioPrompt.promptText,
        dynamicLlmConfig,
        maxTotalTokens: studioConfig.soulStudio.maxBlackboardTokens
      }
    }, { ...options, deferDeliveryReceipt: true });

    storage.runInTransaction(() => {
      storage.saveTurnDecisionTrace(turn.trace);
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
      trace: turn.trace,
      compiledBlackboard: turn.compiledBlackboard,
      route: turn.route,
      provider: turn.provider
    };
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
      if (receipt.spoken_char_offset) coordinator.submitProposal({
        proposal_id: "delivery:" + eventId, domain: "D1_WORKING_TURN",
        base_rev: coordinator.getSnapshot().domain_revs.D1_WORKING_TURN, source_event_ids: [eventId],
        payload: { append_turn: { event_id: eventId + ":w1", role: "assistant",
          text: text.slice(0, receipt.spoken_char_offset).join("") } }
      });
    });
    return receipt;
  }

  handleShellInterrupt(input: {
    shell_id?: string;
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
    const receipt = this.commitDelivery(isSandbox ? "sandbox" : "live", turnEventId, "interrupted", input.spoken_char_offset);
    const offset = receipt.spoken_char_offset;
    const unsaidRemainder = Array.from(trace.steps.step7_emitted_intent.fallback_text).slice(offset).join("");

    this.adminServer.broadcastTelemetry(
      "[TRACE]",
      {
        event: "barge_in_interrupted",
        ...(input.shell_id ? { shell_id: input.shell_id } : {}),
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

  clearShellTranscript(_shellId?: string, _mode: "live" | "sandbox" = "live"): { ok: true; cleared: number } {
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

    const events = storage.listEvents({ limit: 50 }).filter(event => storage.includeDemoData || JSON.parse(event.payload_json).origin !== "demo");
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

    const kbRows = storage.sqlite
      .prepare(
        `SELECT collection_id, COUNT(*) AS documents, COALESCE(SUM(citation_count), 0) AS citations,
                MIN(content_text) AS sample_text
         FROM knowledge_chunks
         GROUP BY collection_id
         ORDER BY collection_id ASC`
      )
      .all() as Array<{ collection_id: string; documents: number; citations: number; sample_text: string }>;

    const traces = storage.listDecisionTraces(20).filter(trace => storage.includeDemoData || JSON.parse(storage.getEventById(trace.turn_event_id)?.payload_json ?? "{}").origin !== "demo");
    const compiled = await compiler.compile(
      snapshot,
      {
        max_total_tokens: 2_200,
        tier0_safety_invariants:
          "Tier 0 SB 243: Honest cyber-life companion; strict audience scope isolation; zero exit-guilt.",
        narrative_self_text: archiveConfig.narrative,
        memory_projection_text: memories.slice(0, 4).map((m) => m.content_text).join("\n")
      },
      "only_owner"
    );

    const redactionCount = await readRedactionLedgerCount(this.soulDir);
    const milestones = storage.listMilestones(20).filter(item => storage.includeDemoData || JSON.parse(storage.getEventById(item.trigger_event_id ?? "")?.payload_json ?? "{}").origin !== "demo").map((item) => ({
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
          message: `[${evt.source_shell_id}/${evt.audience_scope}] ${evt.summary_text}`
        });
      }
    }

    const studioConfig = readConsoleStudioConfig(this.soulDir, archiveConfig.identity.display_name);
    const { promptPreviewPrivate, promptPreviewPublic } = buildLivePromptPreviews(
      this,
      studioConfig,
      memories,
      archiveConfig.narrative,
      mode
    );
    for (const plugin of this.pluginLoader.listPlugins()) {
      const manifest = plugin.manifest;
      if (!studioConfig.ecosystem.plugins.some(item => item.id === manifest.extension_id)) {
        studioConfig.ecosystem.plugins.push({ id: manifest.extension_id, name: manifest.display_name,
          version: manifest.version, bus: manifest.dimension, carrier: manifest.carrier_kind,
          enabled: plugin.enabled, description: "", configFields: [] });
      }
    }
    const connections = this.shellGateway.listConnections(mode);
    const conversations = buildConversationsList(storage, studioConfig);
    const availableSouls = listAvailableSoulInstances(this.soulDir);

    return {
      soulId: archiveConfig.manifest.soul_id,
      personaName: studioConfig.soulStudio.displayName || archiveConfig.identity.display_name,
      soulDir: this.soulDir,
      targetInstance: isSandbox ? "sandbox:console" : "live",
      stateRev: snapshot.state_rev,
      virtualTsMs: clock.nowMs(),
      virtualOffsetHours: isSandbox ? this.mutableState.virtualOffsetHours : 0,
      capabilityRevision: this.pluginLoader.revision,
      activeConnections: connections.length,
      connectedShellIds: [...new Set(connections.map(session => session.shell_id))],
      eventsCount: Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM event_log WHERE redacted_at_ts_ms IS NULL AND (? OR COALESCE(json_extract(payload_json,'$.origin'),'') <> 'demo')").get(Number(storage.includeDemoData))?.n),
      memoriesCount: Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM memories WHERE invalidated_at_ts IS NULL AND (? OR memory_id NOT IN (SELECT memory_id FROM demo_derived_memories))").get(Number(storage.includeDemoData))?.n),
      tracesCount: Number(storage.sqlite.prepare("SELECT COUNT(*) AS n FROM turn_decision_traces").get()?.n),
      redactionLedgerCount: redactionCount,
      metabolicEnergy: snapshot.D2_HOMEOSTASIS_AFFECT.metabolic_energy,
      circadianEnergy: snapshot.D2_HOMEOSTASIS_AFFECT.circadian_energy,
      moodValence: snapshot.D2_HOMEOSTASIS_AFFECT.instant_valence,
      socialLonging: snapshot.D2_HOMEOSTASIS_AFFECT.drive_social_longing,
      frictionTension: snapshot.D5_IDENTITY_NARRATIVE.active_tensions.filter((t) => !t.resolved).length,

      blackboardSlots: compiled.slots.map((slot, idx) => ({
        id: slot.slot_id,
        label: slot.slot_id.replace(/^slot\./, "").replaceAll("_", " "),
        tokenCount: slot.tokens,
        quotaTokens: Math.max(slot.tokens + 80, 260),
        priority: idx + 1,
        summary: slot.content.slice(0, 96) || "Empty slot",
        locked: slot.locked
      })),
      compiledBlackboardPrompt: promptPreviewPrivate.promptText || compiled.compiled_prompt_text,
      totalBlackboardTokens: promptPreviewPrivate.totalTokens || compiled.total_tokens,
      maxBlackboardTokens: studioConfig.soulStudio.maxBlackboardTokens || compiled.max_total_tokens,
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
      knowledgePacks: kbRows.map((row) => ({
        id: row.collection_id,
        name: row.collection_id.replace(/^kb\./, "").replaceAll("_", " "),
        mounted: true,
        documents: Number(row.documents),
        citations: Number(row.citations),
        sampleText: row.sample_text
      })),
      milestones,
      extensions: this.pluginLoader.listPlugins().map(plugin => {
        const id = plugin.manifest.extension_id;
        const mounted = extHost.listExtensions().find(item => item.id === id);
        return { id, displayName: plugin.manifest.display_name, version: plugin.manifest.version,
          origin: plugin.origin, pages: plugin.pages, moduleUrls: plugin.moduleUrls, uiSlots: [...plugin.uiSlots], missingAssets: plugin.missingAssets,
          generation: this.generation(id, mode), activationError: this.pluginLoader.activationError(extHost, id), carrier: plugin.manifest.carrier_kind,
          buses: mounted ? [...mounted.buses] : [plugin.manifest.dimension], enabled: !!mounted,
          rev: mounted?.rev ?? 0, readDomains: [...plugin.manifest.permissions.read_blackboard_domains],
          proposeDomains: [...plugin.manifest.permissions.propose_mutation_domains] };
      }),
      sleepJournal: isSandbox
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
      studioConfig,
      promptPreviewPrivate,
      promptPreviewPublic,
      conversations,
      availableSouls,
      narrativeText: archiveConfig.narrative
    };
  }

  close(): void {
    clearInterval(this.capabilityTimer);
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
  const soulDir = resolve(options.soulDir ?? "souls/default.soul");
  const layout = initializeSoulDirectory(soulDir);
  let liveStorage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);
  liveStorage.includeDemoData = options.seedIfEmpty === true;
  const virtualClock = new VirtualClock({ targetInstance: targetInstanceOf(options.targetInstance) });

  labelLegacyDemoEvents(liveStorage);
  if (options.seedIfEmpty === true) {
    seedDefaultSoulAwakeningData(liveStorage, virtualClock.nowMs());
  }

  const sandboxDir = mkdtempSync(join(tmpdir(), "ai0-sandbox-console-"));
  const sandboxSoulDir = join(sandboxDir, "sandbox.soul");
  const sandboxLayout = initializeSoulDirectory(sandboxSoulDir);
  const sandboxStorage = new CoordinatorStorageMutator(sandboxLayout.soulCoreDatabasePath);
  sandboxStorage.includeDemoData = options.seedIfEmpty === true;
  if (options.seedIfEmpty) seedDefaultSoulAwakeningData(sandboxStorage, virtualClock.nowMs());

  const soulArchiveManager = new SoulArchiveManager(soulDir);
  let liveRetriever = new HybridMemoryRetriever(liveStorage);
  let liveHardForget = new HardForgetEngine(liveStorage.sqlite);
  const sandboxRetriever = new HybridMemoryRetriever(sandboxStorage);
  const sandboxHardForget = new HardForgetEngine(sandboxStorage.sqlite);
  const sandboxClock = new VirtualClock({
    targetInstance: "sandbox:console",
    initialVirtualTsMs: virtualClock.nowMs()
  });

  const coordinatorTraces: KernelTurnTrace[] = [];
  const coordinator = new AuthoritativeStateCoordinator(
    virtualClock,
    createCoordinatorStorage(() => liveStorage, coordinatorTraces)
  );
  const sandboxCoordinator = new AuthoritativeStateCoordinator(
    sandboxClock,
    createCoordinatorStorage(() => sandboxStorage, coordinatorTraces)
  );

  const readOnlyView = createReadOnlyView(() => liveStorage);
  const sandboxReadOnlyView = createReadOnlyView(() => sandboxStorage);
  const blackboardCompiler = new BlackboardCompiler(virtualClock, {
    listEvents: () => liveStorage.listEvents().map((e) => ({ ...e }))
  });
  const sandboxBlackboardCompiler = new BlackboardCompiler(sandboxClock, {
    listEvents: () => sandboxStorage.listEvents().map((e) => ({ ...e }))
  });

  const pluginLoader = new RuntimePluginLoader({
    soulDir,
    ...(options.builtinPluginsDir ? { builtinPluginsDir: options.builtinPluginsDir } : {}),
    ...(options.extraPluginDirs ? { extraPluginDirs: options.extraPluginDirs } : {})
  });
  const extensionHost = new PolymorphicExtensionHost();
  const sandboxExtensionHost = new PolymorphicExtensionHost();
  const compositions = [new ExtensionComposition(), new ExtensionComposition()];


  const brainRegionRouter = new BrainRegionRouter({
    W1_fast_dialogue: { primary_model_id: "ai0-dialogue-fast", fallback_model_id: "ai0-compact" },
    W2_agency_planner: { primary_model_id: "ai0-agency-planner", fallback_model_id: "ai0-compact" },
    W3_sleep_curiosity: { primary_model_id: "ai0-sleep-reflect", fallback_model_id: "ai0-compact" },
    W4_multimodal: { primary_model_id: "ai0-vision-inspector", fallback_model_id: "ai0-compact" },
    L0_crisis_classifier: { primary_model_id: "safety-l0-guard", fallback_model_id: "safety-l0-guard" }
  });

  const llmClient = new UniversalLlmProviderClient(options.llmConfig);
  const sensoryCoverage = new SensoryCoverageBucketManager(virtualClock);
  const opportunityPool = new InteractionOpportunityPool(virtualClock);
  const ownerMasterToken = options.ownerMasterToken ?? randomBytes(32).toString("base64url");
  if (!ownerMasterToken) throw new TypeError("ownerMasterToken must not be empty.");

  const mutableState: DaemonMutableState = {
    virtualOffsetHours: 0,
    debounceWindowMs: 1_200,
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

  const workers: DaemonWorkers = {
    w1: new W1FastDialogueWorker(
      coordinator,
      readOnlyView,
      createKernelRetriever(() => liveRetriever, () => liveStorage, virtualClock),
      virtualClock,
      {
        blackboardCompiler,
        brainRouter: brainRegionRouter,
        llmClient,
        personaName: "Mio",
        extensionHost,
        onTraceCommitted: (trace) => emitTelemetry("[TRACE]", { trace_id: trace.trace_id, rev: trace.state_rev_after }, "live")
      }
    ),
    w2: new W2AgencyTaskWorker(coordinator, new ThreeDimensionalPolicyEngine(), virtualClock),
    w3: new W3SleepReflectionWorker(coordinator, readOnlyView, virtualClock),
    w4: new W4MultimodalAnalyzerWorker(sensoryCoverage, virtualClock)
  };

  const sandboxW1 = new W1FastDialogueWorker(
    sandboxCoordinator,
    sandboxReadOnlyView,
    createKernelRetriever(() => sandboxRetriever, () => sandboxStorage, sandboxClock),
    sandboxClock,
    {
      blackboardCompiler: sandboxBlackboardCompiler,
      brainRouter: brainRegionRouter,
      llmClient,
      personaName: "Mio (Sandbox)",
      extensionHost: sandboxExtensionHost,
      onTraceCommitted: (trace) =>
        emitTelemetry("[TRACE]", { trace_id: trace.trace_id, rev: trace.state_rev_after }, "sandbox:console")
    }
  );

  const shellGateway = new ShellProtocolGateway({
    clock: virtualClock,
    w1: {
      recordInterruption(record) {
        workers.w1.recordInterruption(record);
      }
    }
  });

  let runtimeRef: Ai0DaemonRuntime | undefined;
  const handlerContext: DaemonHandlerContext = {
    reloadExtension: (id, mode, config, expected) => runtimeRef!.reloadExtension(id, mode, config, expected),
    shellGateway,
    soulDir,
    get storage() { return liveStorage; },
    sandboxStorage,
    get hardForgetEngine() { return liveHardForget; },
    sandboxHardForgetEngine: sandboxHardForget,
    soulArchiveManager,
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
      nextStorage.includeDemoData = liveStorage.includeDemoData;
      liveStorage = nextStorage;
      coordinator.restoreCheckpoint();
      liveRetriever = new HybridMemoryRetriever(nextStorage);
      liveHardForget = new HardForgetEngine(nextStorage.sqlite);
      runtimeRef?.replaceLiveStorage(nextStorage);
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
    shellGateway,
    adminServer,
    coordinatorTraces,
    mutableState,
    pluginLoader,
    compositions
  );
  return runtimeRef;
}

export * from "./admin-handlers.js";
export * from "./studio-service.js";
export * from "./plugin-loader.js";
export * from "./cli.js";
