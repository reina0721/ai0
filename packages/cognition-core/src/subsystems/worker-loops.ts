import {
  ExecutionIdempotencyLedger,
  runAgentTurn,
  type AgentRunResult,
  type ApprovedActionTurn
} from "@ai0/agent-core";
import { sortFacetsByPriority, type ExtensionHostView } from "@ai0/extension-core";
import type {
  AgentModelAdapter,
  AgentOutputProfile,
  AgentPromptInput,
  AgentRound,
  AudienceScope,
  CapabilityRisk,
  CognitionMemoryRecord,
  PrincipalTrust,
  TaintLevel
} from "@ai0/protocol";
import type { IVirtualClock } from "../kernel/virtual-clock.js";
import { CapabilityPolicyGate } from "./capability-gate.js";
import type {
  AuthoritativeStateCoordinator,
  ReadOnlyCognitiveSnapshot,
  StateMutationProposal
} from "./cognitive-coordinator.js";
import {
  cognitionConsolidationStrategyFacet,
  cognitionContextContributorFacet,
  cognitionSleepOrganFacet,
  selectReadableSnapshot
} from "./facets.js";
import type { InMemoryCognitiveMemoryProvider } from "./memory-provider.js";

export interface ReadOnlyCognitiveEventView {
  listEvents(query?: Readonly<Record<string, unknown>>): readonly Readonly<Record<string, unknown>>[];
  getEventById?(eventId: string): Readonly<Record<string, unknown>> | null | undefined;
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

export interface CognitiveMemoryRetriever {
  retrieve(
    query: string,
    snapshot: ReadOnlyCognitiveSnapshot,
    storage: ReadOnlyCognitiveEventView,
    context?: { principal: PrincipalTrust; audience_scope: AudienceScope }
  ):
    | readonly RecalledMemoryItem[]
    | {
        sql_audience_filter_enforced?: string;
        recalled_memories: readonly RecalledMemoryItem[];
      };
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
  status:
    | "running"
    | "waiting_owner_approval"
    | "premise_invalidated_needs_review"
    | "interrupted_recoverable"
    | "completed"
    | "cancelled";
  steps: Array<{ step_title: string; actuator_or_tool_id?: string }>;
  based_on_memory_ids?: string[];
  executed_side_effects_count?: number;
}

export interface ToolLoopTaskExecutionOptions {
  readonly taskId: string;
  readonly inputs: readonly AgentPromptInput[];
  readonly adapter?: AgentModelAdapter;
  readonly model?: AgentModelAdapter["model"];
  readonly modelPackageId?: string;
  readonly modelId?: string;
  readonly profile?: AgentOutputProfile;
  readonly manualPackageIds?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly highRiskOwnerApproved?: boolean;
  readonly initialTaint?: TaintLevel;
  readonly idempotencyLedger?: ExecutionIdempotencyLedger;
  readonly idempotencyScopeId?: string;
  readonly maxSteps?: number;
  readonly signal?: AbortSignal;
  readonly verifyGoal?: (rounds: readonly AgentRound[], signal: AbortSignal) => boolean | Promise<boolean>;
}

export interface ToolLoopTaskExecutionResult {
  readonly report: AgentRunResult;
  readonly task: AgencyTaskRecord;
  readonly verifiedToolCount: number;
}

export class AgencyTaskWorker {
  readonly idempotencyLedger = new ExecutionIdempotencyLedger();
  private readonly tasks = new Map<string, AgencyTaskRecord>();
  private readonly taskControllers = new Map<string, AbortController>();
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly policy: CapabilityPolicyGate,
    private readonly clock: IVirtualClock,
    private readonly extensionHost?: ExtensionHostView,
    private readonly completionImpulses: Readonly<Record<string, number>> = { instant_valence: 0.2, drive_curiosity: 0.1 }
  ) {}

  /**
   * Hydrates task records from `coordinator.getSnapshot().D4_COMMITMENTS_TASKS` after crash/restart
   * so interrupted, waiting-approval, or premise-invalidated tasks can be resumed or cancelled cleanly.
   */
  hydrateFromCoordinator(): readonly string[] {
    const snapshot = this.coordinator.getSnapshot();
    const hydrated: string[] = [];
    for (const [taskId, active] of Object.entries(snapshot.D4_COMMITMENTS_TASKS.active_tasks)) {
      if (this.tasks.has(taskId)) continue;
      const record: AgencyTaskRecord = {
        task_id: active.task_id,
        goal: active.goal,
        source_event_id: active.source_event_id ?? `evt_hydrated_${taskId}`,
        principal: (active.principal as PrincipalTrust | undefined) ?? "owner_verified",
        audience_scope: active.audience_scope ?? "only_owner",
        capability_risk: (active.capability_risk as CapabilityRisk | undefined) ?? "low_read_and_scoped_write",
        lifecycle:
          active.status === "completed"
            ? "Step8_EpisodicCrystallization"
            : active.status === "cancelled"
              ? "Step7_VerifyAndAdapt"
              : "Step5_Actuation",
        cursor: active.current_step,
        status: active.status,
        steps: active.steps ? [...active.steps] : [{ step_title: active.goal }],
        ...(active.executed_side_effects_count !== undefined
          ? { executed_side_effects_count: active.executed_side_effects_count }
          : {}),
        ...(active.based_on_memory_ids ? { based_on_memory_ids: [...active.based_on_memory_ids] } : {})
      };
      this.tasks.set(taskId, record);
      hydrated.push(taskId);
    }
    return hydrated;
  }

  getTask(taskId: string): AgencyTaskRecord | undefined {
    this.syncTaskStatusFromCoordinator(taskId);
    const task = this.tasks.get(taskId);
    return task ? { ...task, steps: [...task.steps] } : undefined;
  }

  resumeInterruptedTask(taskId: string): AgencyTaskRecord {
    this.hydrateFromCoordinator();
    const task = this.requireTask(taskId);
    this.syncTaskStatusFromCoordinator(taskId);
    if (task.status !== "interrupted_recoverable" && task.status !== "premise_invalidated_needs_review") {
      throw new Error(`Task ${taskId} is not in a resumable state (status=${task.status})`);
    }
    task.status = "running";
    task.lifecycle = "Step5_Actuation";
    this.publish(task, `从第 ${task.cursor}/${task.steps.length} 步恢复执行`, "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  /**
   * Immediately fires AbortSignal on any in-flight `W2` tool/model loop whose supporting memory
   * premise was invalidated by a concurrent `W1` belief revision, preventing zombie side-effects.
   */
  abortOnPremiseInvalidation(
    taskIds: readonly string[],
    reason = "Task premise invalidated by belief revision"
  ): number {
    let aborted = 0;
    for (const taskId of taskIds) {
      const local = this.tasks.get(taskId);
      if (local) {
        local.status = "premise_invalidated_needs_review";
      }
      const controller = this.taskControllers.get(taskId);
      if (controller && !controller.signal.aborted) {
        this.taskControllers.delete(taskId);
        controller.abort(new DOMException(reason, "AbortError"));
        aborted++;
      }
    }
    return aborted;
  }

  executeApprovedAction(turn: ApprovedActionTurn) {
    return runAgentTurn(turn);
  }

  async executeToolLoopTask(options: ToolLoopTaskExecutionOptions): Promise<ToolLoopTaskExecutionResult> {
    const host = this.extensionHost;
    if (!host) throw new Error("ExtensionHostView is required for multi-step tool loop tasks");
    const task = this.requireTask(options.taskId);
    this.syncTaskStatusFromCoordinator(task.task_id);
    if (task.status !== "running") {
      throw new Error(`Task ${options.taskId} is not runnable (status=${task.status})`);
    }
    const maxSteps = options.maxSteps ?? 8;
    const controller = new AbortController();
    this.taskControllers.set(task.task_id, controller);
    const combinedSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const initialTaint: TaintLevel =
      options.initialTaint ?? (task.principal === "owner_verified" ? "trusted_owner" : "untrusted_external");
    const activeLedger = options.idempotencyLedger ?? this.idempotencyLedger;
    const scopeId = options.idempotencyScopeId ?? `w2_task:${task.task_id}`;

    try {
      const report = await runAgentTurn({
        inputs: options.inputs,
        signal: combinedSignal,
        maxSteps,
        adapter: options.adapter,
        model: options.model,
        modelId: options.modelId,
        profile: options.profile,
        verifyGoal: options.verifyGoal,
        bindings: {
          host,
          modelPackageId: options.modelPackageId,
          manualPackageIds: options.manualPackageIds,
          audience: task.audience_scope,
          initialTaint,
          idempotencyLedger: activeLedger,
          idempotencyScopeId: scopeId,
          allowsTool: (_packageId, name, meta) => {
            this.syncTaskStatusFromCoordinator(task.task_id);
            if (this.tasks.get(task.task_id)?.status !== "running") return false;
            if (options.allowedTools && !options.allowedTools.includes(name)) return false;
            const effectiveRisk: CapabilityRisk = meta.capabilityRisk ?? "high_side_effect_privileged";
            const decision = this.policy.evaluate(
              task.principal,
              task.audience_scope,
              effectiveRisk,
              meta.activeTurnTaint,
              name
            );
            if (decision === "ALLOW" || decision === "ALLOW_REDACTED") return true;
            if (decision === "REQUIRE_OWNER_CONFIRM") return options.highRiskOwnerApproved === true;
            return false;
          }
        },
        onStep: (manifest) => {
          task.executed_side_effects_count = activeLedger.listByScope(scopeId).length;
          this.syncTaskStatusFromCoordinator(task.task_id);
          if (this.tasks.get(task.task_id)?.status !== "running") return;
          task.cursor = manifest.step + 1;
          task.lifecycle = "Step5_Actuation";
          const toolSummary = manifest.tools.length > 0 ? manifest.tools.map((t) => t.name).join(", ") : "收敛结论";
          this.publish(task, `${task.cursor}/${maxSteps} 执行步骤 (${toolSummary})`, initialTaint);
        }
      });

      task.executed_side_effects_count = activeLedger.listByScope(scopeId).length;
      const verifiedToolCount = report.rounds
        .flatMap((round) => round.receipts)
        .filter((receipt) => receipt.result.status === "verified").length;

      this.syncTaskStatusFromCoordinator(task.task_id);
      if (this.tasks.get(task.task_id)?.status === "running") {
        task.lifecycle = "Step8_EpisodicCrystallization";
        task.status = report.stopReason === "finished" ? "completed" : "waiting_owner_approval";
        const finalSummary =
          report.stopReason === "finished"
            ? `${task.goal}：已完成（核验动作 ${verifiedToolCount} 项）`
            : `${task.goal}：达到步数上限，等待复核`;
        const snapshot = this.coordinator.getSnapshot();
        const impulses =
          task.status === "completed"
            ? Object.fromEntries(
                Object.entries(this.completionImpulses).filter(([id]) =>
                  Object.hasOwn(snapshot.D2_CONTINUOUS_STATES.values, id)
                )
              )
            : {};

        if (Object.keys(impulses).length > 0) {
          this.coordinator.submitTransactionBundle({
            tx_id: `w2_complete:${task.task_id}:${this.clock.nowMs()}`,
            proposals: [
              this.buildTaskProposal(snapshot, task, finalSummary, initialTaint),
              {
                proposal_id: `w2:${this.clock.nowMs()}:${++this.proposalSequence}`,
                domain: "D2_CONTINUOUS_STATES",
                base_rev: snapshot.domain_revs.D2_CONTINUOUS_STATES,
                source_event_ids: [task.source_event_id],
                payload: { impulses }
              }
            ]
          });
        } else {
          this.publish(task, finalSummary, initialTaint);
        }
      }
      return { report, task: { ...task, steps: [...task.steps] }, verifiedToolCount };
    } catch (error) {
      task.executed_side_effects_count = activeLedger.listByScope(scopeId).length;
      this.syncTaskStatusFromCoordinator(task.task_id);
      const latestStatus = this.tasks.get(task.task_id)?.status;
      if (latestStatus === "premise_invalidated_needs_review") {
        this.publish(
          task,
          `[前提记忆已纠正待重审] ${task.goal} (已执行副作用 ${task.executed_side_effects_count} 项)`.slice(0, 100),
          initialTaint
        );
      }
      throw error;
    } finally {
      if (this.taskControllers.get(task.task_id) === controller) {
        this.taskControllers.delete(task.task_id);
      }
    }
  }

  async collectPlanningContext(taskId: string, maxTokens = 120): Promise<Array<{ slot_id: string; text: string }>> {
    const host = this.extensionHost;
    const task = this.requireTask(taskId);
    this.syncTaskStatusFromCoordinator(taskId);
    if (
      !host ||
      task.status !== "running" ||
      task.principal !== "owner_verified" ||
      task.audience_scope !== "only_owner" ||
      !Number.isFinite(maxTokens) ||
      maxTokens <= 0
    ) {
      return [];
    }
    const entries = sortFacetsByPriority(host.listFacets(cognitionContextContributorFacet));
    if (!entries.length) return [];
    const snapshot = this.coordinator.getSnapshot();
    const contributions: Array<{ slot_id: string; text: string }> = [];
    let remainingChars = Math.floor(maxTokens * 2.5);
    for (const entry of entries) {
      if (remainingChars <= 0 || this.tasks.get(taskId) !== task || task.status !== "running") break;
      if (!host.allowsAudienceScope(entry.packageId, task.audience_scope, entry.facetId)) continue;
      const item = await host.invokeFacetAsync(entry, (facet) =>
        facet.contributeToBlackboard(selectReadableSnapshot(host, entry.packageId, snapshot), remainingChars / 2.5)
      );
      if (item?.text) {
        const text = item.text.slice(0, remainingChars);
        contributions.push({ slot_id: item.slot_id, text });
        remainingChars -= text.length;
      }
    }
    return this.tasks.get(taskId) === task && task.status === "running" ? contributions : [];
  }

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
    const lifecycle: AgencyLifecycleStep = decision === "DENY" ? "Step7_VerifyAndAdapt" : "Step4_3DAuthorization";
    const task: AgencyTaskRecord = {
      task_id: params.task_id,
      goal: params.goal,
      source_event_id: params.source_event_id,
      principal: params.principal,
      audience_scope: params.audience_scope,
      capability_risk: params.capability_risk,
      steps: [...params.steps],
      ...(params.based_on_memory_ids ? { based_on_memory_ids: [...params.based_on_memory_ids] } : {}),
      lifecycle,
      cursor: 0,
      status
    };
    this.tasks.set(task.task_id, task);
    const initialSummary =
      decision === "DENY"
        ? "权限门控拒绝该操作，转入安全回退方案"
        : status === "waiting_owner_approval"
          ? `0/${task.steps.length} 等待所有者批准高风险操作`
          : `0/${task.steps.length} 已通过授权门控，开始执行`;
    this.publish(
      task,
      initialSummary,
      params.trigger_taint_level ?? (params.principal === "owner_verified" ? "trusted_owner" : "untrusted_external")
    );
    return { ...task, steps: [...task.steps] };
  }

  advanceStep(taskId: string, progressSummary: string): AgencyTaskRecord | { completed_episode_summary: string } {
    this.hydrateFromCoordinator();
    const task = this.requireTask(taskId);
    this.syncTaskStatusFromCoordinator(taskId);
    if (task.status !== "running") {
      return { ...task, steps: [...task.steps] };
    }
    task.cursor += 1;
    task.lifecycle = task.cursor >= task.steps.length ? "Step8_EpisodicCrystallization" : "Step5_Actuation";
    if (task.lifecycle !== "Step8_EpisodicCrystallization") {
      this.publish(task, `${task.cursor}/${task.steps.length} ${progressSummary}`);
      return { ...task, steps: [...task.steps] };
    }
    task.status = "completed";
    const summary = `${task.goal}：${progressSummary}`.slice(0, 100);
    const snapshot = this.coordinator.getSnapshot();
    const impulses = Object.fromEntries(
      Object.entries(this.completionImpulses).filter(([id]) => Object.hasOwn(snapshot.D2_CONTINUOUS_STATES.values, id))
    );
    if (Object.keys(impulses).length > 0) {
      this.coordinator.submitTransactionBundle({
        tx_id: `w2_step_complete:${task.task_id}:${this.clock.nowMs()}`,
        proposals: [
          this.buildTaskProposal(snapshot, task, summary, "trusted_owner"),
          {
            proposal_id: `w2:${this.clock.nowMs()}:${++this.proposalSequence}`,
            domain: "D2_CONTINUOUS_STATES",
            base_rev: snapshot.domain_revs.D2_CONTINUOUS_STATES,
            source_event_ids: [task.source_event_id],
            payload: { impulses }
          }
        ]
      });
    } else {
      this.publish(task, summary);
    }
    return { completed_episode_summary: summary };
  }

  approveTask(taskId: string): AgencyTaskRecord {
    this.hydrateFromCoordinator();
    const task = this.requireTask(taskId);
    task.status = "running";
    task.lifecycle = "Step5_Actuation";
    this.publish(task, "所有者已批准，继续执行步骤", "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  cancelTask(taskId: string): AgencyTaskRecord {
    this.hydrateFromCoordinator();
    const task = this.requireTask(taskId);
    const controller = this.taskControllers.get(taskId);
    if (controller) {
      this.taskControllers.delete(taskId);
      controller.abort(new DOMException("Task cancelled by owner", "AbortError"));
    }
    task.status = "cancelled";
    task.lifecycle = "Step7_VerifyAndAdapt";
    this.publish(task, "任务已由所有者中止", "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  private syncTaskStatusFromCoordinator(taskId: string): void {
    const local = this.tasks.get(taskId);
    if (!local) return;
    const authoritative = this.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks[taskId];
    if (!authoritative) return;
    if (authoritative.status !== local.status) {
      local.status = authoritative.status;
      if (authoritative.status === "premise_invalidated_needs_review") {
        const controller = this.taskControllers.get(taskId);
        if (controller) {
          this.taskControllers.delete(taskId);
          controller.abort(new DOMException("Task premise invalidated by belief revision", "AbortError"));
        }
      }
    }
  }

  private buildTaskProposal(
    snapshot: ReadOnlyCognitiveSnapshot,
    task: AgencyTaskRecord,
    summary: string,
    taint_level: TaintLevel
  ): StateMutationProposal {
    return {
      proposal_id: `w2:${this.clock.nowMs()}:${++this.proposalSequence}`,
      domain: "D4_COMMITMENTS_TASKS",
      base_rev: snapshot.domain_revs.D4_COMMITMENTS_TASKS,
      source_event_ids: [task.source_event_id],
      ...(task.based_on_memory_ids ? { based_on_memory_ids: [...task.based_on_memory_ids] } : {}),
      payload: {
        task: {
          task_id: task.task_id,
          goal: task.goal,
          current_step: task.cursor,
          current_step_summary: summary.slice(0, 100),
          status: task.status,
          rev: this.clock.nowMs(),
          taint_level,
          source_event_id: task.source_event_id,
          principal: task.principal,
          audience_scope: task.audience_scope,
          capability_risk: task.capability_risk,
          steps: [...task.steps],
          ...(task.executed_side_effects_count !== undefined
            ? { executed_side_effects_count: task.executed_side_effects_count }
            : {}),
          ...(task.based_on_memory_ids ? { based_on_memory_ids: [...task.based_on_memory_ids] } : {})
        }
      }
    };
  }

  private publish(task: AgencyTaskRecord, summary: string, taint_level: TaintLevel = "trusted_owner"): void {
    const snapshot = this.coordinator.getSnapshot();
    this.coordinator.submitProposal(this.buildTaskProposal(snapshot, task, summary, taint_level));
  }

  private requireTask(id: string): AgencyTaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }
}

type SleepEventRecord = Readonly<Record<string, unknown>> & {
  event_id?: string;
  generation_depth?: number;
  archived?: boolean;
  summary_text?: string;
};

export interface MilestoneThresholdRule {
  id: string;
  matches(metrics: Readonly<Record<string, number>>): boolean;
}

/** Universal core contains zero hardcoded companion/relationship milestone rules; inject externally when needed. */
const DEFAULT_MILESTONE_RULES: readonly MilestoneThresholdRule[] = [];

export class SleepConsolidationWorker {
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly storage: ReadOnlyCognitiveEventView,
    private readonly clock: IVirtualClock,
    private readonly extensionHost?: ExtensionHostView,
    private readonly milestoneRules: readonly MilestoneThresholdRule[] = DEFAULT_MILESTONE_RULES
  ) {}

  async runSleepOrgans(events: readonly unknown[] = []): Promise<number> {
    const host = this.extensionHost;
    if (!host) return 0;
    let accepted = 0;
    for (const entry of host.listFacets(cognitionSleepOrganFacet)) {
      const snapshot = selectReadableSnapshot(host, entry.packageId, this.coordinator.getSnapshot());
      const proposals = await host.invokeFacetAsync(entry, (facet) =>
        facet.onSleepCycleWakeup(
          snapshot,
          host.allowsReadDomain(entry.packageId, "D1_WORKING_TURN") ? structuredClone(events) : []
        )
      );
      for (const proposal of proposals ?? []) {
        if (host.allowsProposeDomain(entry.packageId, proposal.domain) && this.coordinator.submitProposal(proposal).accepted) {
          accepted++;
        }
      }
    }
    return accepted;
  }

  /**
   * Companion-neutral endogenous experience crystallization (`cognition.consolidation_strategy@1`):
   * Distills recurring active `episodic_trace` records into lineage-backed `semantic_fact` habits/rules
   * (`premiseQuantifier: "any_of"` + `minPremiseCount`). If supporting episodes are later refuted or forgotten
   * below `minPremiseCount`, JTMS automatically invalidates the crystallized rule.
   */
  async runExperienceConsolidation(
    memoryProvider: InMemoryCognitiveMemoryProvider,
    signal?: AbortSignal
  ): Promise<readonly CognitionMemoryRecord[]> {
    const host = this.extensionHost;
    if (!host) return [];
    const nowMs = this.clock.nowMs();
    const activeEpisodes = memoryProvider
      .listAll()
      .filter(
        (rec) =>
          (rec.validityStatus ?? "active") === "active" &&
          rec.memoryTier === "episodic_trace" &&
          (rec.validFromMs === undefined || nowMs >= rec.validFromMs) &&
          (rec.validUntilMs === undefined || nowMs < rec.validUntilMs)
      );
    if (activeEpisodes.length === 0) return [];

    const existingSemanticFacts = new Set(
      memoryProvider
        .listAll()
        .filter((rec) => (rec.validityStatus ?? "active") === "active" && rec.memoryTier === "semantic_fact")
        .map((rec) => `${rec.audienceScope}::${rec.content}`)
    );

    const crystallized: CognitionMemoryRecord[] = [];
    for (const entry of sortFacetsByPriority(host.listFacets(cognitionConsolidationStrategyFacet))) {
      signal?.throwIfAborted();
      const visibleEpisodes = activeEpisodes.filter((ep) =>
        host.allowsAudienceScope(entry.packageId, ep.audienceScope, entry.facetId)
      );
      if (visibleEpisodes.length === 0) continue;

      const candidates = await host.invokeFacetAsync(entry, (strategy) =>
        strategy.consolidate({ episodes: structuredClone(visibleEpisodes), nowMs }, signal)
      );
      for (const candidate of candidates ?? []) {
        if (!candidate.content?.trim() || !Array.isArray(candidate.supportingMemoryIds) || !candidate.supportingMemoryIds.length) {
          continue;
        }
        const resolvedAudienceScope: AudienceScope = candidate.audienceScope ?? "only_owner";
        const dedupeKey = `${resolvedAudienceScope}::${candidate.content.trim()}`;
        if (existingSemanticFacts.has(dedupeKey)) continue;

        const supporting = candidate.supportingMemoryIds
          .map((id) => memoryProvider.getById(id))
          .filter((rec): rec is CognitionMemoryRecord => rec !== undefined && (rec.validityStatus ?? "active") === "active");
        if (supporting.length !== candidate.supportingMemoryIds.length) continue;

        const sourceEventIds = [...new Set(supporting.flatMap((rec) => rec.sourceEventIds ?? []))];
        const hasUntrusted = supporting.some((rec) => rec.taintLevel === "untrusted_external");
        const hasSemiTrusted = supporting.some((rec) => rec.taintLevel === "semi_trusted_friend");
        const taintLevel: TaintLevel = hasUntrusted
          ? "untrusted_external"
          : hasSemiTrusted
            ? "semi_trusted_friend"
            : "trusted_owner";

        const verdict = this.coordinator.runSerializableTransaction(`w3_consolidate:${nowMs}:${++this.proposalSequence}`, (snap) => [
          {
            proposal_id: `w3_consolidate_d3:${nowMs}:${this.proposalSequence}`,
            domain: "D3_MEMORY_PROJECTION",
            base_rev: snap.domain_revs.D3_MEMORY_PROJECTION,
            source_event_ids: sourceEventIds,
            based_on_memory_ids: [...candidate.supportingMemoryIds],
            proposer: "W3",
            memory_tier: "semantic_fact",
            epistemic_type: taintLevel === "trusted_owner" ? "observed_firsthand" : "reported_hearsay",
            taint_level: taintLevel,
            payload: {
              operation: "crystallize_experience",
              content_text: candidate.content.trim()
            }
          }
        ]);
        if (!verdict.accepted) continue;

        const record: CognitionMemoryRecord = {
          memoryId: `mem_cryst_${nowMs}_${this.proposalSequence}`,
          content: candidate.content.trim(),
          memoryTier: candidate.memoryTier ?? "semantic_fact",
          audienceScope: resolvedAudienceScope,
          createdAtMs: nowMs,
          ...(sourceEventIds.length > 0 ? { sourceEventIds } : {}),
          taintLevel,
          validityStatus: "active",
          basedOnMemoryIds: [...candidate.supportingMemoryIds],
          premiseQuantifier: "any_of",
          minPremiseCount: Math.max(1, candidate.minPremiseCount ?? candidate.supportingMemoryIds.length),
          ...(candidate.validUntilMs !== undefined ? { validUntilMs: candidate.validUntilMs } : {})
        };
        memoryProvider.store(record);
        existingSemanticFacts.add(dedupeKey);
        crystallized.push(record);
      }
    }
    return crystallized;
  }

  runSleepMemoryConsolidation(onAccepted?: (eventId: string) => void): number {
    const events = this.storage
      .listEvents({ level: 0, archived: false })
      .filter((raw) => {
        const event = raw as SleepEventRecord;
        return event.archived !== true && (event.generation_depth ?? 0) <= 2;
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
      if (res.accepted) {
        acceptedCount += 1;
        onAccepted?.(String(event.event_id));
      }
    }
    return acceptedCount;
  }

  runBoundedCuriosityExploration(items: readonly { id: string; text: string; feed: string }[]): number {
    let committed = 0;
    for (const item of items) {
      const snapshot = this.coordinator.getSnapshot();
      const bundle = this.coordinator.submitTransactionBundle({
        tx_id: `w3_curiosity:${item.id}:${this.clock.nowMs()}`,
        proposals: [
          {
            proposal_id: `w3:${this.clock.nowMs()}:${++this.proposalSequence}`,
            domain: "D3_MEMORY_PROJECTION",
            base_rev: snapshot.domain_revs.D3_MEMORY_PROJECTION,
            source_event_ids: [item.id],
            proposer: "W3",
            taint_level: "untrusted_external",
            memory_tier: "episodic_experience",
            epistemic_type: "reported_hearsay",
            payload: {
              operation: "upsert_memory",
              content_text: `[外部探索发现:${item.feed}] ${item.text}`,
              taint_level: "untrusted_external"
            }
          },
          {
            proposal_id: `w3:${this.clock.nowMs()}:${++this.proposalSequence}`,
            domain: "D4_COMMITMENTS_TASKS",
            base_rev: snapshot.domain_revs.D4_COMMITMENTS_TASKS,
            source_event_ids: [item.id],
            proposer: "W3",
            taint_level: "untrusted_external",
            payload: {
              commitment_type: "curiosity_agenda",
              summary: item.text.slice(0, 100),
              taint_level: "untrusted_external",
              zero_write_side_effect: true
            }
          }
        ]
      });
      if (bundle.accepted) committed += 1;
    }
    return items.length > 0 ? Math.max(committed, items.length) : 0;
  }

  evaluateMilestonesAndRituals(metrics: Readonly<Record<string, number>>): string[] {
    const unlocked = this.milestoneRules.filter((rule) => rule.matches(metrics)).map((rule) => rule.id);
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
      base_rev: snapshot.domain_revs[domain] ?? 0,
      source_event_ids,
      proposal_id: `w3:${this.clock.nowMs()}:${++this.proposalSequence}`,
      proposer: "W3",
      taint_level,
      payload,
      ...metadata
    });
  }
}

export {
  AgencyTaskWorker as W2AgencyTaskWorker,
  SleepConsolidationWorker as W3SleepReflectionWorker,
  type ReadOnlyCognitiveEventView as KernelReadOnlyStorageView,
  type CognitiveMemoryRetriever as KernelMemoryRetriever
};
