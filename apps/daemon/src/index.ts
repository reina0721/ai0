import { randomBytes } from "node:crypto";
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
  type KernelMemoryRetriever,
  type KernelReadOnlyStorageView,
  type LlmProviderConfig,
  type TargetInstance,
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

export interface DefaultDaemonOptions {
  soulDir?: string;
  ownerMasterToken?: string;
  targetInstance?: string;
  seedIfEmpty?: boolean;
  llmConfig?: LlmProviderConfig;
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

function mountStandardExtensions(host: PolymorphicExtensionHost): void {
  host.registerExtension({
    id: "builtin.webchat",
    carrier: "native_code_plugin",
    buses: ["ext.shell"],
    extension: {
      shellId: "builtin.webchat.default",
      stageRoute: "/shells/stage/builtin.webchat",
      source: "plugins/shells/webchat"
    }
  });
  host.registerExtension({
    id: "community.organ.dream-journal",
    carrier: "native_code_plugin",
    buses: ["ext.cognitive_organ"],
    readDomains: ["D2_HOMEOSTASIS_AFFECT", "D3_MEMORY_PROJECTION"],
    proposeDomains: ["D3_MEMORY_PROJECTION"],
    extension: {
      organId: "community.organ.dream-journal",
      defaultEnabled: true,
      source: "plugins/cognitive-organs/dream-journal",
      contributeToBlackboard: () => ({
        slot_id: "organ.dream_journal.residue",
        text: "梦境余温：昨夜海港天文台灯塔的微光仍留在潜意识里。"
      })
    }
  });
  host.registerExtension({
    id: "builtin.media.emotion-tts-sideband",
    carrier: "native_code_plugin",
    buses: ["ext.media_pipeline"],
    extension: {
      id: "builtin.media.emotion-tts-sideband",
      source: "plugins/media-pipelines/emotion-tts-sideband",
      getSupportedVocabulary: () => ({ voice_emotion_tags: ["warm_neutral", "bright", "soft_sleepy"] })
    }
  });
}

function createCoordinatorStorage(
  getStorage: () => CoordinatorStorageMutator,
  traces: KernelTurnTrace[]
): KernelCoordinatorStorageMutator {
  return {
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
    listEvents: () => getStorage().listEvents().map(record),
    getEventById: (eventId) => {
      const event = getStorage().getEventById(eventId);
      return event ? record(event) : undefined;
    }
  };
}

function createKernelRetriever(
  getRetriever: () => HybridMemoryRetriever,
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
          source_event_ids: []
        }))
      };
    }
  };
}

export class Ai0DaemonRuntime {
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
    readonly mutableState: DaemonMutableState
  ) {}

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

  async handleWebChatTurn(input: {
    text: string;
    venue_type?: VenueType;
    audience_scope?: AudienceScope;
    modality?: SensorModality;
    mode?: "live" | "sandbox";
  }) {
    const isSandbox = input.mode === "sandbox";
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const clock = isSandbox ? this.sandboxClock : this.virtualClock;
    const coordinator = isSandbox ? this.sandboxCoordinator : this.coordinator;
    const w1 = isSandbox ? this.sandboxW1 : this.workers.w1;
    const target: "live" | `sandbox:${string}` = isSandbox ? "sandbox:console" : "live";

    const venue: VenueType = input.venue_type ?? "private_1on1";
    const audience: AudienceScope =
      input.audience_scope ?? (venue === "public_livestream" ? "public_all" : "only_owner");
    const principal = audience === "only_owner" ? "owner_verified" : "stranger";
    const modality: SensorModality = input.modality ?? "text";
    const nowMs = clock.nowMs();
    const eventId = `evt_webchat_${nowMs}_${storage.listEvents({ limit: 1000 }).length + 1}`;

    storage.appendEvent({
      event_id: eventId,
      wall_ts_ms: Date.now(),
      virtual_ts_ms: nowMs,
      source_shell_id: "builtin.webchat.default",
      principal_id: principal === "owner_verified" ? "owner:local" : "guest:webchat",
      principal_trust: principal,
      venue_type: venue,
      audience_scope: audience,
      event_category: "perception_committed",
      modality,
      summary_text: input.text,
      payload_json: JSON.stringify({ venue, audience, modality }),
      state_rev_after: coordinator.getSnapshot().state_rev,
      active_modules_mask: 31
    });

    this.adminServer.broadcastTelemetry("[EVENT]", {
      event_id: eventId,
      shell_id: "builtin.webchat.default",
      venue_type: venue,
      audience_scope: audience,
      summary_text: input.text
    }, target, nowMs);

    const studioConfig = readConsoleStudioConfig(this.soulDir);
    const snapBefore = coordinator.getSnapshot();
    const primaryRoleMeta = ROLE_ARCHETYPE_PRESETS[studioConfig.soulStudio.primaryRole];
    const matchedLoreEntries = studioConfig.soulStudio.lorebooks
      .filter((entry) => entry.enabled && entry.keys.some((k) => k && input.text.includes(k)))
      .map((entry) => ({ title: entry.title, content: entry.content }));
    const compiledStudioPrompt = compileStudioPromptPreview(studioConfig, {
      audienceScope: audience === "public_all" ? "public_all" : "only_owner",
      venueType: venue,
      platform: "builtin.webchat.default",
      moodValence: snapBefore.D2_HOMEOSTASIS_AFFECT.instant_valence,
      circadianEnergy: snapBefore.D2_HOMEOSTASIS_AFFECT.circadian_energy,
      metabolicEnergy: snapBefore.D2_HOMEOSTASIS_AFFECT.metabolic_energy
    });

    const routedProviderId = studioConfig.brainRouting.W1_fast_dialogue.primaryId;
    const routedProvider = studioConfig.providers.find((p) => p.id === routedProviderId);
    const vaultApiKey = routedProvider ? readVaultProviderKey(this.soulDir, routedProvider.id) : undefined;
    const dynamicLlmConfig: LlmProviderConfig | undefined =
      routedProvider && vaultApiKey
        ? {
            provider: routedProvider.vendor.toLowerCase().includes("anthropic")
              ? "anthropic"
              : routedProvider.vendor.toLowerCase().includes("ollama")
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
    });

    this.lastIntentEventId.set(turn.expression.intent_id, eventId);
    storage.saveTurnDecisionTrace(turn.trace);

    if (audience === "only_owner" && input.text.trim().length >= 8 && !/(忘掉|遗忘|forget)/iu.test(input.text)) {
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

    return {
      event_id: eventId,
      expression: turn.expression,
      trace: turn.trace,
      compiledBlackboard: turn.compiledBlackboard,
      route: turn.route
    };
  }

  handleWebChatInterrupt(input: {
    intent_id: string;
    spoken_char_offset: number;
    full_text: string;
    mode?: "live" | "sandbox";
  }) {
    const isSandbox = input.mode === "sandbox";
    const storage = isSandbox ? this.sandboxStorage : this.liveStorage;
    const w1 = isSandbox ? this.sandboxW1 : this.workers.w1;
    const chars = Array.from(input.full_text);
    const offset = Math.max(0, Math.min(chars.length, Math.floor(input.spoken_char_offset)));
    const unsaidRemainder = chars.slice(offset).join("");
    const turnEventId = this.lastIntentEventId.get(input.intent_id);

    w1.recordInterruption({
      intent_id: input.intent_id,
      chunk_seq: 0,
      spoken_char_offset: offset,
      unsaid_remainder: unsaidRemainder,
      interrupted_by_event_id: turnEventId
    });

    if (turnEventId) {
      try {
        storage.updateTurnTraceDeliveryReceipt(turnEventId, {
          status: "interrupted",
          spoken_char_offset: offset,
          degraded_extensions: [],
          ...(unsaidRemainder ? { unsaid_remainder: unsaidRemainder } : {})
        } as never);
      } catch {
        // Ignore if trace was already redacted.
      }
    }

    this.adminServer.broadcastTelemetry(
      "[TRACE]",
      {
        event: "barge_in_interrupted",
        intent_id: input.intent_id,
        spoken_char_offset: offset,
        unsaid_remainder: unsaidRemainder
      },
      isSandbox ? "sandbox:console" : "live"
    );

    return {
      intent_id: input.intent_id,
      spoken_char_offset: offset,
      unsaid_remainder: unsaidRemainder
    };
  }

  clearWebChatTranscript(mode: "live" | "sandbox" = "live"): { ok: true; cleared: number } {
    const storage = mode === "sandbox" ? this.sandboxStorage : this.liveStorage;
    const countRow = storage.sqlite.prepare("SELECT COUNT(*) AS c FROM turn_decision_traces").get() as { c: number };
    storage.sqlite.prepare("DELETE FROM turn_decision_traces").run();
    return { ok: true, cleared: Number(countRow?.c ?? 0) };
  }

  async buildConsoleLiveSnapshot(mode: "live" | "sandbox" = "live"): Promise<ConsoleLiveSnapshot> {
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

    const kbRows = storage.sqlite
      .prepare(
        `SELECT collection_id, COUNT(*) AS documents, COALESCE(SUM(citation_count), 0) AS citations,
                MIN(content_text) AS sample_text
         FROM knowledge_chunks
         GROUP BY collection_id
         ORDER BY collection_id ASC`
      )
      .all() as Array<{ collection_id: string; documents: number; citations: number; sample_text: string }>;

    const traces = storage.listDecisionTraces(20);
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
    const milestones = storage.listMilestones(20).map((item) => ({
      id: item.milestone_id,
      title: item.title,
      moment: new Date(item.unlocked_virtual_ts).toISOString().slice(0, 10),
      note: item.category,
      completed: true,
      conditions: ["Repeated owner consent", "Positive growth only", "Audited in SQLite ledger"]
    }));

    const recentTranscript: ConsoleLiveSnapshot["recentTranscript"] = [];
    for (const trace of [...traces].reverse().slice(-6)) {
      recentTranscript.push({
        id: `${trace.turn_event_id}:u`,
        role: "user",
        text: trace.steps.step1_perception.summary_text,
        timestamp: new Date(trace.virtual_ts_ms).toISOString().slice(11, 19)
      });
      recentTranscript.push({
        id: `${trace.turn_event_id}:a`,
        role: "assistant",
        text: trace.steps.step7_emitted_intent.fallback_text,
        timestamp: new Date(trace.virtual_ts_ms).toISOString().slice(11, 19)
      });
    }

    const telemetryEntries: ConsoleLiveSnapshot["telemetryEntries"] = this.mutableState.telemetryFrames
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
      archiveConfig.narrative
    );
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
      eventsCount: events.length,
      memoriesCount: memories.length,
      tracesCount: traces.length,
      redactionLedgerCount: redactionCount,
      metabolicEnergy: snapshot.D2_HOMEOSTASIS_AFFECT.metabolic_energy,
      circadianEnergy: snapshot.D2_HOMEOSTASIS_AFFECT.circadian_energy,
      moodValence: snapshot.D2_HOMEOSTASIS_AFFECT.instant_valence,
      socialLonging: snapshot.D2_HOMEOSTASIS_AFFECT.drive_social_longing,
      frictionTension: snapshot.D5_IDENTITY_NARRATIVE.active_tensions.filter((t) => !t.resolved).length * 22,
      trustBond: 84,
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
      extensions: extHost.listExtensions().map((ext) => ({
        id: ext.id,
        carrier: ext.carrier,
        buses: [...ext.buses],
        enabled: (ext as { organEnabled?: boolean }).organEnabled !== false,
        rev: ext.rev,
        readDomains: [...(ext.readDomains ?? [])],
        proposeDomains: [...(ext.proposeDomains ?? [])]
      })),
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
  const virtualClock = new VirtualClock({ targetInstance: targetInstanceOf(options.targetInstance) });

  if (options.seedIfEmpty !== false) {
    seedDefaultSoulAwakeningData(liveStorage, virtualClock.nowMs());
  }

  const sandboxDir = mkdtempSync(join(tmpdir(), "ai0-sandbox-console-"));
  const sandboxSoulDir = join(sandboxDir, "sandbox.soul");
  const sandboxLayout = initializeSoulDirectory(sandboxSoulDir);
  const sandboxStorage = new CoordinatorStorageMutator(sandboxLayout.soulCoreDatabasePath);
  seedDefaultSoulAwakeningData(sandboxStorage, virtualClock.nowMs());

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

  const extensionHost = new PolymorphicExtensionHost();
  const sandboxExtensionHost = new PolymorphicExtensionHost();
  mountStandardExtensions(extensionHost);
  mountStandardExtensions(sandboxExtensionHost);

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
    activeShellSessions: new Map([
      [
        "builtin.webchat.default",
        {
          session_id: "sess_webchat_builtin",
          shell_id: "builtin.webchat.default",
          venue_type: "private_1on1",
          audience_scope: "only_owner",
          modality: "text",
          last_active_ts_ms: virtualClock.nowMs()
        }
      ]
    ]),
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
      createKernelRetriever(() => liveRetriever, virtualClock),
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
    createKernelRetriever(() => sandboxRetriever, sandboxClock),
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
      liveStorage = nextStorage;
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
    mutableState
  );
  return runtimeRef;
}

export * from "./admin-handlers.js";
export * from "./studio-service.js";
export * from "./cli.js";
