import {
  EmbodiedKeyframeSchema,
  ExpressionEnvelopeSchema,
  VerifiableTurnTraceSchema,
  type AudienceScope,
  type ShellTokenUsage,
  type KnowledgeSource, type KnowledgeCitation,
  type CapabilityRisk,
  type ExpressionEnvelope,
  type PrincipalTrust,
  type SensorModality,
  type TaintLevel,
  type VenueType,
  type VerifiableTurnTrace
} from "@ai0/protocol";

import type { IVirtualClock } from "../clock/virtual-clock.js";
import type {
  AuthoritativeStateCoordinator,
  ReadOnlyCognitiveSnapshot,
  StateMutationProposal
} from "../coordinator/authoritative-state-coordinator.js";
import type { RealizerVocabularyNegotiator } from "@ai0/expression-core";
import type { SensoryCoverageBucketManager } from "@ai0/perception-core";
import { evaluateCrisisGuard } from "../safety-l0/sb243-crisis-guard.js";

export type PolicyDecision =
  | "ALLOW"
  | "ALLOW_REDACTED"
  | "REQUIRE_OWNER_CONFIRM"
  | "DENY";

export interface KernelReadOnlyStorageView {
  listEvents(
    query?: Readonly<Record<string, unknown>>
  ): readonly Readonly<Record<string, unknown>>[];
  getEventById?(
    eventId: string
  ): Readonly<Record<string, unknown>> | null | undefined;
}

export interface RecalledMemoryItem {
  memory_id: string;
  memory_tier:
    | "episodic_experience"
    | "semantic_fact"
    | "relational_tacit"
    | "kb_crystallized_gist"
    | "topic_taboo_seal";
  epistemic_type:
    | "observed_firsthand"
    | "reported_hearsay"
    | "inferred_hypothesis"
    | "imagined_narrative";
  visibility_scope: AudienceScope;
  taint_level: TaintLevel;
  score: number;
  content_text: string;
  source_event_ids: string[];
}

export interface KernelMemoryRetriever {
  retrieve(
    query: string,
    snapshot: ReadOnlyCognitiveSnapshot,
    storage: KernelReadOnlyStorageView,
    context?: { principal: PrincipalTrust; audience_scope: AudienceScope }
  ):
    | readonly RecalledMemoryItem[]
    | {
        sql_audience_filter_enforced?: string;
        recalled_memories: readonly RecalledMemoryItem[];
      };
}

export class ThreeDimensionalPolicyEngine {
  evaluate(
    principalTrust: PrincipalTrust,
    audienceScope: AudienceScope,
    capabilityRisk: CapabilityRisk,
    triggerTaintLevel?: TaintLevel
  ): PolicyDecision {
    if (
      triggerTaintLevel === "untrusted_external" &&
      capabilityRisk !== "read_only_safe"
    ) {
      return "DENY";
    }
    if (principalTrust !== "owner_verified") {
      return capabilityRisk === "read_only_safe" &&
        audienceScope === "public_all"
        ? "ALLOW"
        : "DENY";
    }
    if (audienceScope !== "only_owner") {
      return capabilityRisk === "read_only_safe" ? "ALLOW_REDACTED" : "DENY";
    }
    if (capabilityRisk === "high_side_effect_privileged") {
      return "REQUIRE_OWNER_CONFIRM";
    }
    return "ALLOW";
  }
}

export interface W1TurnInput {
  target_shell_id?: string;
  knowledgeRecall?: (signal?: AbortSignal) => Promise<KnowledgeSource[]>;
  event_id: string;
  principal: PrincipalTrust;
  venue_type: VenueType;
  audience_scope: AudienceScope;
  modality: SensorModality;
  summary_text: string;
  debounce_merged_events?: number;
  liveStudioContext?: {
    personaName?: string;
    corePersonalityPrompt?: string;
    roleLabel?: string;
    catchphrases?: readonly string[];
    bannedCliches?: readonly string[];
    matchedLoreEntries?: readonly { title: string; content: string }[];
    compiledBlackboardOverride?: string;
    publicMask?: boolean;
    workingTurnText?: string;
    workingTurnHistory?: Iterable<string>;
    allowUnsaidRemainder?: boolean;
    dynamicLlmConfig?: LlmProviderConfig;
    maxTotalTokens?: number;
  };
}

import { ADDITIONAL_BLACKBOARD_SLOT_TOKENS, BlackboardCompiler, estimateBlackboardTokens } from "../blackboard/blackboard-compiler.js";
import type { CompiledBlackboard } from "../blackboard/blackboard-compiler.js";
import { PolymorphicExtensionHost } from "../extension-bus/polymorphic-extension-host.js";
import { BrainRegionRouter } from "../router/brain-region-router.js";
import type { RegionRoute } from "../router/brain-region-router.js";
import {
  UniversalLlmProviderClient,
  estimateDialogueInputTokens,
  planDialogueWindow,
  type LlmDialogueSynthesisInput,
  type LlmDialogueSynthesisOutput,
  type LlmProviderConfig
} from "../router/llm-provider-client.js";

export interface W1FastDialogueWorkerOptions {
  realizerNegotiator?: RealizerVocabularyNegotiator;
  allowDeterministicSandbox?: boolean;
  blackboardCompiler?: BlackboardCompiler;
  brainRouter?: BrainRegionRouter;
  llmClient?: UniversalLlmProviderClient;
  personaName?: string;
  extensionHost?: PolymorphicExtensionHost;
  onTraceCommitted?: (trace: VerifiableTurnTrace) => void;
}

export interface W1AsyncTurnResult {
  usage?: ShellTokenUsage;
  usedMemoryIds?: string[];
  usedKnowledge?: boolean;
  knowledgeSources?: KnowledgeCitation[];
  expression: ExpressionEnvelope;
  trace: VerifiableTurnTrace;
  compiledBlackboard: CompiledBlackboard;
  route: RegionRoute;
  provider?: { name: string; model: string };
}

export interface W1AsyncTurnOptions {
  signal?: AbortSignal;
  onReasoning?: (delta: string | null) => void;
  onStage?: (stage: "gate" | "recall" | "blackboard" | "generating") => void;
  deferDeliveryReceipt?: boolean;
}

const W1_SAFETY_INVARIANTS = "Tier 0 SB 243: Honest AI companion; zero exit-guilt; strict audience privacy boundary.";

function fitRecentHistory(newestFirst: Iterable<string>, tokenBudget: number): string {
  const selected: string[] = [];
  let remaining = tokenBudget;
  for (const turn of newestFirst) {
    if (remaining <= 0) break;
    const tokens = estimateBlackboardTokens(`${turn}\n`);
    if (tokens > remaining) break;
    selected.push(turn);
    remaining -= tokens;
  }
  return selected.reverse().join("\n");
}

export class W1FastDialogueWorker {
  private readonly blackboardCompiler: BlackboardCompiler;
  private readonly brainRouter: BrainRegionRouter;
  private readonly llmClient: UniversalLlmProviderClient;
  private readonly personaName: string;
  private readonly extensionHost?: PolymorphicExtensionHost;
  private readonly onTraceCommitted?: (trace: VerifiableTurnTrace) => void;
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly storage: KernelReadOnlyStorageView,
    private readonly memories: KernelMemoryRetriever,
    private readonly clock: IVirtualClock,
    private readonly options: W1FastDialogueWorkerOptions = {}
  ) {
    this.blackboardCompiler =
      options.blackboardCompiler ??
      new BlackboardCompiler(this.clock, {
        listEvents: () => this.storage.listEvents()
      });
    this.brainRouter =
      options.brainRouter ??
      new BrainRegionRouter({
        W1_fast_dialogue: { primary_model_id: "ai0-dialogue-fast", fallback_model_id: "ai0-compact" },
        W2_agency_planner: { primary_model_id: "ai0-agency-planner", fallback_model_id: "ai0-compact" },
        W3_sleep_curiosity: { primary_model_id: "ai0-sleep-reflect", fallback_model_id: "ai0-compact" },
        W4_multimodal: { primary_model_id: "ai0-vision-inspector", fallback_model_id: "ai0-compact" },
        L0_crisis_classifier: { primary_model_id: "safety-l0-guard", fallback_model_id: "safety-l0-guard" }
      });
    this.llmClient = options.llmClient ?? new UniversalLlmProviderClient(undefined, options.allowDeterministicSandbox);
    this.personaName = options.personaName ?? "Assistant";
    this.extensionHost = options.extensionHost;
    this.onTraceCommitted = options.onTraceCommitted;
  }

  recordInterruption(record: {
    intent_id: string;
    chunk_seq: number;
    spoken_char_offset: number;
    unsaid_remainder: string;
    interrupted_by_event_id?: string;
  }): void {
    const snapshot = this.coordinator.getSnapshot();
    this.submit({
      domain: "D1_WORKING_TURN",
      base_rev: snapshot.domain_revs.D1_WORKING_TURN,
      source_event_ids: record.interrupted_by_event_id
        ? [record.interrupted_by_event_id]
        : [],
      payload: {
        is_barge_in: true,
        intent_id: record.intent_id,
        chunk_seq: record.chunk_seq,
        spoken_char_offset: record.spoken_char_offset,
        unsaid_remainder: record.unsaid_remainder,
        interrupted_by_event_id: record.interrupted_by_event_id ?? null
      }
    });
  }

  runTurn(input: W1TurnInput): {
    expression: ExpressionEnvelope;
    trace: VerifiableTurnTrace;
  } {
    const preSnapshot = this.coordinator.getSnapshot();
    const stateRevBefore = preSnapshot.state_rev;
    const crisis = evaluateCrisisGuard(input.summary_text, this.clock);

    if (crisis.status === "INTERCEPTED_CRISIS") {
      const expression = this.buildExpression(input, crisis.supportive_text, true);
      const trace = this.buildTrace({
        input,
        preSnapshot,
        postSnapshot: preSnapshot,
        stateRevBefore,
        stateRevAfter: preSnapshot.state_rev,
        crisisStatus: "INTERCEPTED_CRISIS",
        sqlFilter: "SHORT_CIRCUITED_BY_L0_SB243",
        recalled: [],
        expression
      });
      this.onTraceCommitted?.(trace);
      return { expression, trace };
    }

    const { recalled, sqlFilter } = this.recallMemories(input, preSnapshot);
    const ownerPrivate = input.audience_scope === "only_owner" && input.principal === "owner_verified";
    const activeTasks = Object.values(preSnapshot.D4_COMMITMENTS_TASKS.active_tasks).filter(
      (task) => task.status === "running" || task.status === "waiting_owner_approval"
    );
    const progressSummary = activeTasks.map((task) => task.current_step_summary.slice(0, 100)).join("；");
    const affect = preSnapshot.D2_HOMEOSTASIS_AFFECT;
    const workingTurn = preSnapshot.D1_WORKING_TURN as typeof preSnapshot.D1_WORKING_TURN & {
      unsaid_remainder?: string | null;
    };
    const route = this.brainRouter.routeForRegion(
      "W1_fast_dialogue",
      affect.metabolic_energy,
      affect.circadian_energy
    );
    const synthesized = this.llmClient.synthesizeContextAwareResponse({
      userText: input.summary_text,
      compiledBlackboardText: [
        `mood=${affect.instant_valence.toFixed(2)}`,
        `energy=${affect.metabolic_energy.toFixed(2)}`,
        ownerPrivate && progressSummary ? `active_tasks=${progressSummary}` : "",
        recalled.map((item) => item.content_text).join("\n")
      ]
        .filter(Boolean)
        .join("\n"),
      personaName: this.personaName,
      venueType: input.venue_type,
      audienceScope: input.audience_scope,
      socialMaskActive: input.audience_scope !== "only_owner",
      moodValence: affect.instant_valence,
      metabolicEnergy: affect.metabolic_energy,
      drowsyDowngraded: route.drowsy_downgraded,
      recalledMemorySnippets: recalled.map((item) => item.content_text),
      unsaidRemainder: ownerPrivate ? workingTurn.unsaid_remainder ?? undefined : undefined,
      activeTaskSummary: ownerPrivate ? progressSummary || undefined : undefined,
      routedModelId: route.selected_model_id
    });

    return this.commitTurnResult(input, preSnapshot, stateRevBefore, recalled, sqlFilter, synthesized);
  }

  async runTurnAsync(input: W1TurnInput, options: W1AsyncTurnOptions = {}): Promise<W1AsyncTurnResult> {
    const { signal, onStage } = options;
    signal?.throwIfAborted();
    const preSnapshot = this.coordinator.getSnapshot();
    const stateRevBefore = preSnapshot.state_rev;
    const affect = preSnapshot.D2_HOMEOSTASIS_AFFECT;
    const route = this.brainRouter.routeForRegion(
      "W1_fast_dialogue",
      affect.metabolic_energy,
      affect.circadian_energy
    );
    const crisis = evaluateCrisisGuard(input.summary_text, this.clock);
    onStage?.("gate");
    const live = input.liveStudioContext;
    const ownerPrivate = input.audience_scope === "only_owner" && input.principal === "owner_verified";
    const publicMask = Boolean(live?.publicMask || !ownerPrivate);
    const dialogueBase: LlmDialogueSynthesisInput = {
      userText: input.summary_text,
      compiledBlackboardText: `[slot.tier0_safety_invariants]\n${W1_SAFETY_INVARIANTS}`,
      knowledgeEvidence: [],
      personaName: live?.personaName || this.personaName,
      corePersonalityPrompt: live?.corePersonalityPrompt,
      roleLabel: live?.roleLabel,
      catchphrases: live?.catchphrases,
      bannedCliches: live?.bannedCliches,
      dynamicLlmConfig: live?.dynamicLlmConfig,
      venueType: input.venue_type,
      audienceScope: input.audience_scope,
      socialMaskActive: publicMask,
      moodValence: publicMask ? affect.mood_baseline_val + 0.3 * (affect.instant_valence - affect.mood_baseline_val) : affect.instant_valence,
      metabolicEnergy: affect.metabolic_energy,
      drowsyDowngraded: route.drowsy_downgraded,
      recalledMemorySnippets: [],
      routedModelId: live?.dynamicLlmConfig?.model || route.selected_model_id
    };
    const profileBudget = live?.maxTotalTokens ?? 2200;
    const windowPlan = crisis.status !== "INTERCEPTED_CRISIS" ? planDialogueWindow(live?.dynamicLlmConfig, dialogueBase, profileBudget) : undefined;
    const mandatoryTokens = windowPlan ? estimateDialogueInputTokens(dialogueBase) : 0;
    const { recalled, sqlFilter } =
      crisis.status === "INTERCEPTED_CRISIS"
        ? { recalled: [] as readonly RecalledMemoryItem[], sqlFilter: "SHORT_CIRCUITED_BY_L0_SB243" }
        : this.recallMemories(input, preSnapshot);
    if (crisis.status !== "INTERCEPTED_CRISIS") onStage?.("recall");

    const organContributions: string[] = [];
    if (this.extensionHost && ownerPrivate && !input.liveStudioContext?.publicMask) {
      for (const ext of this.extensionHost.listExtensions()) {
        if (ext.buses.includes("ext.cognitive_organ")) {
          const item = await this.extensionHost.contributeOrgan(ext.id, preSnapshot, 120);
          signal?.throwIfAborted();
          if (item?.text) organContributions.push(`[${item.slot_id}] ${item.text}`);
        }
      }
    }

    const projectedMemories = live?.publicMask && input.audience_scope === "only_owner"
      ? recalled.filter(memory => memory.visibility_scope === "public_all") : recalled;
    const maxTokens = windowPlan ? Math.min(windowPlan.maxInputTokens - mandatoryTokens,
      windowPlan.useModelWindow ? Number.POSITIVE_INFINITY : profileBudget) : profileBudget;
    const candidates = crisis.status !== "INTERCEPTED_CRISIS" ? await input.knowledgeRecall?.(signal) ?? [] : [];
    signal?.throwIfAborted();
    // Reserve a bounded part of the same turn budget for external evidence, sent as data.
    let remaining = Math.floor(maxTokens * 2.5 / 3);
    const evidence: KnowledgeCitation[] = [];
    const wireEvidence: NonNullable<LlmDialogueSynthesisInput["knowledgeEvidence"]>[number][] = [];
    const referenceTokenLimit = mandatoryTokens + Math.floor(maxTokens / 3);
    for (const source of candidates) {
      const excerpt = source.excerpt.slice(0, Math.min(800, remaining - 100));
      if (remaining <= 130 || !excerpt) break;
      const entry = { marker: evidence.length + 1, excerpt, taint_level: source.taint_level };
      if (windowPlan && estimateDialogueInputTokens({ ...dialogueBase, knowledgeEvidence: [...wireEvidence, entry] }) > referenceTokenLimit) break;
      wireEvidence.push(entry);
      evidence.push({ ...source, ...entry });
      remaining -= excerpt.length + 100;
    }
    let matchedLoreEntries = live?.matchedLoreEntries;
    let unsaidRemainder = ownerPrivate && live?.allowUnsaidRemainder !== false
      ? preSnapshot.D1_WORKING_TURN.unsaid_remainder ?? undefined : undefined;
    let evidenceTokens = Math.ceil(evidence.reduce((tokens, item) => tokens + item.excerpt.length + 100, 0) / 2.5);
    if (windowPlan) {
      const withEvidence = { ...dialogueBase, knowledgeEvidence: wireEvidence };
      const fittingLore: NonNullable<LlmDialogueSynthesisInput["matchedLoreEntries"]>[number][] = [];
      for (const entry of matchedLoreEntries ?? []) {
        if (estimateDialogueInputTokens({ ...withEvidence, matchedLoreEntries: [...fittingLore, entry] }) > referenceTokenLimit) break;
        fittingLore.push(entry);
      }
      matchedLoreEntries = fittingLore;
      const withLore = { ...withEvidence, matchedLoreEntries };
      if (estimateDialogueInputTokens({ ...withLore, unsaidRemainder }) > referenceTokenLimit) unsaidRemainder = undefined;
      evidenceTokens = estimateDialogueInputTokens({ ...withLore, unsaidRemainder }) - mandatoryTokens;
    }
    const safetyTokens = estimateBlackboardTokens(W1_SAFETY_INVARIANTS);
    const workingContextTokens = Math.max(0, maxTokens - evidenceTokens - ADDITIONAL_BLACKBOARD_SLOT_TOKENS);
    const workingHistory = windowPlan && live?.workingTurnHistory
      ? fitRecentHistory(live.workingTurnHistory, workingContextTokens) : live?.workingTurnText;
    const compiledBlackboard = await this.blackboardCompiler.compile(
      preSnapshot,
      {
        max_total_tokens: windowPlan ? safetyTokens + workingContextTokens : Math.max(1, maxTokens - evidenceTokens),
        narrative_self_text: live?.compiledBlackboardOverride,
        slot_content: workingHistory !== undefined ? { "slot.tier1_working_turn": workingHistory } : undefined,
        slot_token_budgets: {
          "slot.tier2_narrative_self": Math.floor(maxTokens / 3),
          ...(windowPlan?.useModelWindow ? {
            "slot.tier1_working_turn": workingContextTokens,
            "slot.tier1_memory_projection": workingContextTokens
          } : {})
        },
        tier0_safety_invariants: W1_SAFETY_INVARIANTS,
        memory_projection_text: [
          ...projectedMemories.map((item) => `(${item.memory_tier}/${item.visibility_scope}) ${item.content_text}`),
          ...organContributions
        ].join("\n")
      },
      publicMask ? "public_all" : input.audience_scope
    );
    signal?.throwIfAborted();
    onStage?.("blackboard");

    if (crisis.status === "INTERCEPTED_CRISIS") {
      const expression = this.buildExpression(input, crisis.supportive_text, true);
      const trace = this.buildTrace({
        input,
        preSnapshot,
        postSnapshot: preSnapshot,
        stateRevBefore,
        stateRevAfter: preSnapshot.state_rev,
        crisisStatus: "INTERCEPTED_CRISIS",
        sqlFilter,
        recalled: [],
        expression,
        deferDeliveryReceipt: options.deferDeliveryReceipt
      });
      this.onTraceCommitted?.(trace);
      return { expression, trace, compiledBlackboard, route };
    }

    const activeTasks = Object.values(preSnapshot.D4_COMMITMENTS_TASKS.active_tasks).filter(
      (task) => task.status === "running" || task.status === "waiting_owner_approval"
    );
    const progressSummary = activeTasks.map((task) => task.current_step_summary.slice(0, 100)).join("；");
    const inputMemories = projectedMemories.filter(memory =>
      compiledBlackboard.slots.find(slot => slot.slot_id === "slot.tier1_memory_projection")?.content.includes(memory.content_text));
    onStage?.("generating");
    const synthesized = await this.llmClient.generateDialogue({
      ...dialogueBase,
      compiledBlackboardText: compiledBlackboard.compiled_prompt_text,
      knowledgeEvidence: wireEvidence,
      matchedLoreEntries,
      socialMaskActive: compiledBlackboard.social_mask_active,
      moodValence: compiledBlackboard.effective_mood_valence,
      recalledMemorySnippets: inputMemories.map(memory => memory.content_text),
      unsaidRemainder,
      activeTaskSummary: ownerPrivate ? progressSummary || undefined : undefined
    }, signal, options.onReasoning);
    signal?.throwIfAborted();

    const checked = {...synthesized, surface_utterance:synthesized.surface_utterance.replace(/\[K(\d+)\]/g,(marker,id:string)=>
      evidence.some(source=>source.marker===Number(id) && marker==="[K"+source.marker+"]")?marker:"").trim()};
    const committed = this.commitTurnResult(
      input,
      preSnapshot,
      stateRevBefore,
      recalled,
      sqlFilter,
      checked,
      options.deferDeliveryReceipt
    );
    return {
      ...committed,
      usedMemoryIds: inputMemories.map(memory => memory.memory_id),
      usage: synthesized.usage,
      usedKnowledge:evidence.length>0,
      knowledgeSources: evidence.filter(source=>committed.expression.fallback_text.includes("[K"+source.marker+"]")),
      compiledBlackboard,
      route,
      provider: { name: synthesized.provider_used, model: synthesized.model_used }
    };
  }

  private recallMemories(
    input: W1TurnInput,
    preSnapshot: ReadOnlyCognitiveSnapshot
  ): { recalled: readonly RecalledMemoryItem[]; sqlFilter: string } {
    const rawRecall = this.memories.retrieve(input.summary_text, preSnapshot, this.storage, {
      principal: input.principal,
      audience_scope: input.audience_scope
    });
    const recalled = "recalled_memories" in rawRecall ? rawRecall.recalled_memories : rawRecall;
    const sqlFilter =
      "recalled_memories" in rawRecall && rawRecall.sql_audience_filter_enforced
        ? rawRecall.sql_audience_filter_enforced
        : input.audience_scope === "only_owner" && input.principal === "owner_verified"
          ? "visibility_scope IN ('only_owner', 'group:*', 'public_all') AND invalidated_at_ts IS NULL"
          : input.audience_scope.startsWith("group:")
            ? `visibility_scope IN ('${input.audience_scope}', 'public_all') AND invalidated_at_ts IS NULL`
            : "visibility_scope = 'public_all' AND invalidated_at_ts IS NULL";
    return { recalled, sqlFilter };
  }

  private commitTurnResult(
    input: W1TurnInput,
    preSnapshot: ReadOnlyCognitiveSnapshot,
    stateRevBefore: number,
    recalled: readonly RecalledMemoryItem[],
    sqlFilter: string,
    synthesized: LlmDialogueSynthesisOutput,
    deferDeliveryReceipt = false
  ): { expression: ExpressionEnvelope; trace: VerifiableTurnTrace } {
    const expression = this.buildExpression(input, synthesized.surface_utterance, false, synthesized);

    this.submit({
      domain: "D1_WORKING_TURN",
      base_rev: preSnapshot.domain_revs.D1_WORKING_TURN,
      source_event_ids: [input.event_id],
      payload: {
        append_turn: {
          role: "user",
          text: input.summary_text,
          event_id: input.event_id
        }
      }
    });
    if (!deferDeliveryReceipt) this.submit({
      domain: "D1_WORKING_TURN",
      base_rev: this.coordinator.getSnapshot().domain_revs.D1_WORKING_TURN,
      source_event_ids: [input.event_id],
      payload: {
        append_turn: {
          role: "assistant",
          text: synthesized.surface_utterance,
          event_id: `${input.event_id}:w1`
        },
        unsaid_remainder: null
      }
    });
    this.submit({
      domain: "D2_HOMEOSTASIS_AFFECT",
      base_rev: preSnapshot.domain_revs.D2_HOMEOSTASIS_AFFECT,
      source_event_ids: [input.event_id],
      payload: {
        instant_valence_delta: synthesized.valence_impulse,
        drive_social_longing_delta: "-small"
      }
    });

    const postSnapshot = this.coordinator.getSnapshot();
    const trace = this.buildTrace({
      input,
      preSnapshot,
      postSnapshot,
      stateRevBefore,
      stateRevAfter: postSnapshot.state_rev,
      crisisStatus: "PASS",
      sqlFilter,
      recalled,
      expression,
      synthesized,
      deferDeliveryReceipt
    });
    this.onTraceCommitted?.(trace);
    return { expression, trace };
  }

  private buildExpression(
    input: W1TurnInput,
    fallbackText: string,
    isCrisis: boolean,
    synthesized?: LlmDialogueSynthesisOutput
  ): ExpressionEnvelope {
    const tag = isCrisis ? "concerned" : (synthesized?.facial_expression ?? "soft_smile");
    const negotiator = this.options.realizerNegotiator;
    if (input.target_shell_id && negotiator?.hasShell(input.target_shell_id)) {
      const intentId = `int_${input.event_id}`;
      const dispatch = negotiator.negotiate({
        intentId, correlationEventId: input.event_id, intent: "communicate",
        utterance: fallbackText, attentionTarget: "interlocutor",
        expressiveStance: { semanticCue: tag, intensity: 0.75 },
        deliveryConstraints: { audienceScope: input.audience_scope }
      }, input.target_shell_id);
      return ExpressionEnvelopeSchema.parse(dispatch.envelope ?? {
        intent_id: intentId, correlation_event_id: input.event_id, chunk_seq: 0,
        is_final: true, action_type: "explicit_silence", fallback_text: ""
      });
    }
    return ExpressionEnvelopeSchema.parse({
      intent_id: `int_${input.event_id}`,
      correlation_event_id: input.event_id,
      chunk_seq: 0,
      is_final: true,
      action_type: "speak",
      fallback_text: fallbackText,
      extensions: {
        "ext.affect.v1": {
          label: isCrisis ? "concerned" : (synthesized?.vocal_emotion_tag ?? "warm_attentive"),
          vad: { valence: isCrisis ? -0.1 : 0.45, arousal: 0.35, dominance: 0.5 }
        },
        "ext.rhythm.v1": {
          pre_delay_ms: 120,
          typing_indicator_ms: 320,
          pause_after_ms: 180
        },
        "ext.embodied.v1": EmbodiedKeyframeSchema.parse({
          sync_anchor: "pre_speech",
          attention: { target: "interlocutor", behavior: "locked" },
          expression: { tag, intensity: 0.75 },
          linger_ms: 420
        })
      }
    });
  }

  private buildTrace(params: {
    input: W1TurnInput;
    preSnapshot: ReadOnlyCognitiveSnapshot;
    postSnapshot: ReadOnlyCognitiveSnapshot;
    stateRevBefore: number;
    stateRevAfter: number;
    crisisStatus: "PASS" | "INTERCEPTED_CRISIS";
    sqlFilter: string;
    recalled: readonly RecalledMemoryItem[];
    expression: ExpressionEnvelope;
    synthesized?: LlmDialogueSynthesisOutput;
    deferDeliveryReceipt?: boolean;
  }): VerifiableTurnTrace {
    const {
      input,
      preSnapshot,
      postSnapshot,
      stateRevBefore,
      stateRevAfter,
      crisisStatus,
      sqlFilter,
      recalled,
      expression,
      synthesized,
      deferDeliveryReceipt
    } = params;
    return VerifiableTurnTraceSchema.parse({
      trace_id: `trc_${input.event_id}`,
      target_instance: this.clock.targetInstance,
      turn_event_id: input.event_id,
      virtual_ts_ms: this.clock.nowMs(),
      state_rev_before: stateRevBefore,
      state_rev_after: stateRevAfter,
      steps: {
        step1_perception: {
          event_id: input.event_id,
          principal: input.principal,
          venue_type: input.venue_type,
          audience_scope: input.audience_scope,
          modality: input.modality,
          summary_text: input.summary_text
        },
        step2_gate_safety: {
          l0_sb243_crisis_check: crisisStatus,
          salience_score: 0.92,
          debounce_merged_events: input.debounce_merged_events ?? 1,
          recognized_intent:
            crisisStatus === "INTERCEPTED_CRISIS"
              ? "l0_crisis_intervention"
              : (synthesized?.chosen_strategy ?? "companion_dialogue_turn")
        },
        step3_memory_recall: {
          sql_audience_filter_enforced: sqlFilter,
          recalled_memories: recalled.map((m) => ({
            memory_id: m.memory_id,
            memory_tier: m.memory_tier,
            epistemic_type: m.epistemic_type,
            visibility_scope: m.visibility_scope,
            taint_level: m.taint_level,
            score: m.score,
            content_text: m.content_text,
            source_event_ids: [...m.source_event_ids]
          }))
        },
        step4_homeostasis: {
          pre_state: {
            mood_valence: preSnapshot.D2_HOMEOSTASIS_AFFECT.instant_valence,
            metabolic_energy: preSnapshot.D2_HOMEOSTASIS_AFFECT.metabolic_energy,
            social_longing: preSnapshot.D2_HOMEOSTASIS_AFFECT.drive_social_longing
          },
          llm_proposed_impulse: {
            instant_valence_delta: synthesized?.valence_impulse ?? "none",
            drive_social_longing_delta: synthesized ? "-small" : "none"
          },
          code_clamped_post_state: {
            mood_valence: postSnapshot.D2_HOMEOSTASIS_AFFECT.instant_valence,
            metabolic_energy: postSnapshot.D2_HOMEOSTASIS_AFFECT.metabolic_energy,
            social_longing: postSnapshot.D2_HOMEOSTASIS_AFFECT.drive_social_longing
          }
        },
        step5_strategy_proposal: {
          chosen_strategy:
            crisisStatus === "INTERCEPTED_CRISIS"
              ? "l0_crisis_care_and_hotline"
              : (synthesized?.chosen_strategy ?? "warm_companion_response"),
          interaction_frame: synthesized?.interaction_frame ?? "gentle_support",
          model_reported_rationale: {
            authority_badge: "MODEL_SELF_REPORT_UNVERIFIED",
            text: `Synthesized via ${synthesized?.provider_used ?? "deterministic-sandbox"} (${synthesized?.model_used ?? "ai0-dialogue-fast"}) grounded in compiled blackboard.`
          },
          theatrical_subtext: {
            spoiler_mask_level: "shy_subtext",
            drives_embodied_channel: true,
            masked_placeholder:
              synthesized?.masked_placeholder ??
              "💭 她心里正在悄悄关注你的状态 [点击揭开剧透毛玻璃遮罩]",
            raw_text:
              synthesized?.theatrical_subtext ??
              "虽然嘴上说得轻松，但其实把你刚才说的每一句话都认真记在心里了。"
          }
        },
        step6_tool_auth: {
          prospective_commitment_registered: null,
          external_tool_invoked: null,
          auth_decision: "ALLOW"
        },
        step7_emitted_intent: {
          intent_id: expression.intent_id,
          action_type: expression.action_type,
          fallback_text: expression.fallback_text,
          chunks_count: 1,
          extensions_attached: Object.keys(expression.extensions)
        },
        step8_delivery_receipt: deferDeliveryReceipt ? null : {
          status: "completed",
          spoken_char_offset: Array.from(expression.fallback_text).length,
          degraded_extensions: []
        }
      }
    });
  }

  private submit(proposal: Omit<StateMutationProposal, "proposal_id">): void {
    this.coordinator.submitProposal({
      ...proposal,
      proposal_id: `w1:${this.clock.nowMs()}:${++this.proposalSequence}`
    });
  }
}

export type AgencyLifecycleStep =
  | "Step1_GoalComprehension"
  | "Step2_EnvObservation"
  | "Step3_StepwisePlanning"
  | "Step4_3DAuthorization"
  | "Step5_Actuation"
  | "Step6_PerceiveOutcome"
  | "Step7_VerifyAndAdapt"
  | "Step8_EpisodicCrystallization";

export interface AgencyTaskRecord {
  task_id: string;
  goal: string;
  source_event_id: string;
  principal: PrincipalTrust;
  audience_scope: AudienceScope;
  capability_risk: CapabilityRisk;
  lifecycle: AgencyLifecycleStep;
  cursor: number;
  status: "running" | "waiting_owner_approval" | "completed" | "cancelled";
  steps: Array<{ step_title: string; actuator_or_tool_id?: string }>;
}

export class W2AgencyTaskWorker {
  private readonly tasks = new Map<string, AgencyTaskRecord>();
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly policy: ThreeDimensionalPolicyEngine,
    private readonly clock: IVirtualClock
  ) {}

  startTask(
    params: Omit<AgencyTaskRecord, "lifecycle" | "cursor" | "status"> & {
      trigger_taint_level?: TaintLevel;
    }
  ): AgencyTaskRecord {
    const decision = this.policy.evaluate(
      params.principal,
      params.audience_scope,
      params.capability_risk,
      params.trigger_taint_level
    );
    const status =
      decision === "REQUIRE_OWNER_CONFIRM"
        ? "waiting_owner_approval"
        : decision === "DENY"
          ? "cancelled"
          : "running";
    const lifecycle: AgencyLifecycleStep =
      decision === "DENY" ? "Step7_VerifyAndAdapt" : "Step4_3DAuthorization";
    const task: AgencyTaskRecord = {
      task_id: params.task_id,
      goal: params.goal,
      source_event_id: params.source_event_id,
      principal: params.principal,
      audience_scope: params.audience_scope,
      capability_risk: params.capability_risk,
      steps: [...params.steps],
      lifecycle,
      cursor: 0,
      status
    };
    this.tasks.set(task.task_id, task);
    const initialSummary =
      decision === "DENY"
        ? "权限引擎拒绝该操作，转入角色内得体拒绝或替代方案"
        : status === "waiting_owner_approval"
          ? `0/${task.steps.length} 等待主人批准高风险操作`
          : `0/${task.steps.length} 已通过三维授权，开始执行`;
    this.publish(
      task,
      initialSummary,
      params.trigger_taint_level ??
        (params.principal === "owner_verified"
          ? "trusted_owner"
          : "untrusted_external")
    );
    return { ...task, steps: [...task.steps] };
  }

  advanceStep(
    taskId: string,
    progressSummary: string
  ): AgencyTaskRecord | { completed_episode_summary: string } {
    const task = this.requireTask(taskId);
    if (task.status !== "running") {
      return { ...task, steps: [...task.steps] };
    }
    task.cursor += 1;
    task.lifecycle =
      task.cursor >= task.steps.length
        ? "Step8_EpisodicCrystallization"
        : "Step5_Actuation";
    if (task.lifecycle !== "Step8_EpisodicCrystallization") {
      this.publish(
        task,
        `${task.cursor}/${task.steps.length} ${progressSummary}`
      );
      return { ...task, steps: [...task.steps] };
    }
    task.status = "completed";
    const summary = `${task.goal}：${progressSummary}`.slice(0, 100);
    this.publish(task, summary);
    const snapshot = this.coordinator.getSnapshot();
    this.submit({
      domain: "D2_HOMEOSTASIS_AFFECT",
      base_rev: snapshot.domain_revs.D2_HOMEOSTASIS_AFFECT,
      source_event_ids: [task.source_event_id],
      payload: {
        instant_valence_delta: "+medium",
        drive_curiosity_delta: "+small"
      }
    });
    return { completed_episode_summary: summary };
  }

  approveTask(taskId: string): AgencyTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "running";
    task.lifecycle = "Step5_Actuation";
    this.publish(task, "主人已批准，继续执行步骤", "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  cancelTask(taskId: string): AgencyTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "cancelled";
    task.lifecycle = "Step7_VerifyAndAdapt";
    this.publish(task, "任务已由主人中止", "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  private publish(
    task: AgencyTaskRecord,
    summary: string,
    taint_level: TaintLevel = "trusted_owner"
  ): void {
    const snapshot = this.coordinator.getSnapshot();
    this.submit({
      domain: "D4_COMMITMENTS_TASKS",
      base_rev: snapshot.domain_revs.D4_COMMITMENTS_TASKS,
      source_event_ids: [task.source_event_id],
      payload: {
        task: {
          task_id: task.task_id,
          goal: task.goal,
          current_step: task.cursor,
          current_step_summary: summary.slice(0, 100),
          status: task.status,
          rev: this.clock.nowMs(),
          taint_level
        }
      }
    });
  }

  private requireTask(id: string): AgencyTaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  private submit(proposal: Omit<StateMutationProposal, "proposal_id">): void {
    this.coordinator.submitProposal({
      ...proposal,
      proposal_id: `w2:${this.clock.nowMs()}:${++this.proposalSequence}`
    });
  }
}

type SleepEventRecord = Readonly<Record<string, unknown>> & {
  event_id?: string;
  generation_depth?: number;
  archived?: boolean;
  summary_text?: string;
};

export class W3SleepReflectionWorker {
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly storage: KernelReadOnlyStorageView,
    private readonly clock: IVirtualClock
  ) {}

  runSleepMemoryConsolidation(onAccepted?: (eventId: string) => void): number {
    const events = this.storage
      .listEvents({ level: 0, archived: false })
      .filter((raw) => {
        const event = raw as SleepEventRecord;
        return (
          event.archived !== true && (event.generation_depth ?? 0) <= 2
        );
      }) as SleepEventRecord[];

    let acceptedCount = 0;
    for (const event of events) {
      const res = this.propose(
        "D3_MEMORY_PROJECTION",
        [String(event.event_id)],
        {
          operation: "upsert_memory",
          content_text: event.summary_text ?? "Consolidated Level-0 experience",
          generation_depth: (event.generation_depth ?? 0) + 1
        },
        "trusted_owner",
        {
          memory_tier: "episodic_experience",
          epistemic_type: "observed_firsthand"
        }
      );
      if (res.accepted) { acceptedCount += 1; onAccepted?.(String(event.event_id)); }
    }
    return acceptedCount;
  }

  runBoundedCuriosityExploration(
    items: readonly { id: string; text: string; feed: string }[]
  ): number {
    for (const item of items) {
      this.propose(
        "D3_MEMORY_PROJECTION",
        [item.id],
        {
          operation: "upsert_memory",
          content_text: `[今日小发现:${item.feed}] ${item.text}`,
          taint_level: "untrusted_external"
        },
        "untrusted_external",
        {
          memory_tier: "episodic_experience",
          epistemic_type: "reported_hearsay"
        }
      );
      this.propose(
        "D4_COMMITMENTS_TASKS",
        [item.id],
        {
          commitment_type: "curiosity_agenda",
          summary: item.text.slice(0, 100),
          taint_level: "untrusted_external",
          zero_write_side_effect: true
        },
        "untrusted_external"
      );
    }
    return items.length;
  }

  evaluateMilestonesAndRituals(metrics: {
    days_together: number;
    trust: number;
    completed_tasks_count: number;
  }): string[] {
    const unlocked = [
      metrics.days_together >= 30 && "ms.companion_30_days",
      metrics.trust >= 0.8 && "ms.trust_breakthrough_80",
      metrics.completed_tasks_count >= 10 && "ms.joint_agency_10_tasks"
    ].filter((x): x is string => Boolean(x));

    for (const id of unlocked) {
      this.propose(
        "D5_IDENTITY_NARRATIVE",
        [],
        {
          change_type: "milestone_unlocked",
          milestone_id: id,
          positive_growth_only: true,
          created_virtual_ts: this.clock.nowMs()
        },
        "trusted_owner"
      );
    }
    return unlocked;
  }

  private propose(
    domain: StateMutationProposal["domain"],
    source_event_ids: string[],
    payload: Record<string, unknown>,
    taint_level: TaintLevel,
    metadata: { memory_tier?: string; epistemic_type?: string } = {}
  ) {
    const snapshot = this.coordinator.getSnapshot();
    return this.coordinator.submitProposal({
      domain,
      base_rev: snapshot.domain_revs[domain],
      source_event_ids,
      proposal_id: `w3:${this.clock.nowMs()}:${++this.proposalSequence}`,
      proposer: "W3",
      taint_level,
      payload,
      ...metadata
    });
  }
}

export class W4MultimodalAnalyzerWorker {
  constructor(
    private readonly coverage: SensoryCoverageBucketManager,
    private readonly clock: IVirtualClock
  ) {}

  analyzeAuthorizedSnapshot(params: {
    shell_id: string;
    source_key: string;
    high_res_observation: string;
    confidence: number;
  }) {
    return this.coverage.upsert({
      shell_id: params.shell_id,
      modality: "visual_semantic",
      source_key: params.source_key,
      coverage: "live_foveal",
      summary_text: params.high_res_observation,
      frame_span_ms: 0,
      freshness_ttl_ms: 30_000,
      updated_at_virtual_ts: this.clock.nowMs(),
      competing_hypotheses: [],
      perception_confidence: params.confidence
    });
  }
}
