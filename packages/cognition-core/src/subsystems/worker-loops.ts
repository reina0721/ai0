import { runAgentTurn, type AgentRunResult, type ApprovedActionTurn } from "@ai0/agent-core";
import { sortFacetsByPriority, type ExtensionCoreHost } from "@ai0/extension-core";
import type {
  AgentModelAdapter,
  AgentOutputProfile,
  AgentPromptInput,
  AgentRound,
  AudienceScope,
  CapabilityRisk,
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
  cognitionContextContributorFacet,
  cognitionSleepOrganFacet,
  selectReadableSnapshot
} from "./facets.js";

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
  status: "running" | "waiting_owner_approval" | "completed" | "cancelled";
  steps: Array<{ step_title: string; actuator_or_tool_id?: string }>;
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
  private readonly tasks = new Map<string, AgencyTaskRecord>();
  private readonly taskControllers = new Map<string, AbortController>();
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly policy: CapabilityPolicyGate,
    private readonly clock: IVirtualClock,
    private readonly extensionHost?: ExtensionCoreHost,
    private readonly completionImpulses: Readonly<Record<string, number>> = { instant_valence: 0.2, drive_curiosity: 0.1 }
  ) {}

  executeApprovedAction(turn: ApprovedActionTurn) {
    return runAgentTurn(turn);
  }

  async executeToolLoopTask(options: ToolLoopTaskExecutionOptions): Promise<ToolLoopTaskExecutionResult> {
    const host = this.extensionHost;
    if (!host) throw new Error("ExtensionCoreHost is required for multi-step tool loop tasks");
    const task = this.requireTask(options.taskId);
    if (task.status !== "running") {
      throw new Error(`Task ${options.taskId} is not runnable (status=${task.status})`);
    }
    const maxSteps = options.maxSteps ?? 8;
    const controller = new AbortController();
    this.taskControllers.set(task.task_id, controller);
    const combinedSignal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const initialTaint: TaintLevel =
      options.initialTaint ?? (task.principal === "owner_verified" ? "trusted_owner" : "untrusted_external");

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
          allowsTool: (_packageId, name, meta) => {
            if (this.tasks.get(task.task_id)?.status !== "running") return false;
            if (options.allowedTools && !options.allowedTools.includes(name)) return false;
            const effectiveRisk: CapabilityRisk = meta.capabilityRisk ?? "high_side_effect_privileged";
            const decision = this.policy.evaluate(task.principal, task.audience_scope, effectiveRisk, meta.activeTurnTaint);
            if (decision === "ALLOW" || decision === "ALLOW_REDACTED") return true;
            if (decision === "REQUIRE_OWNER_CONFIRM") return options.highRiskOwnerApproved === true;
            return false;
          }
        },
        onStep: (manifest) => {
          if (this.tasks.get(task.task_id)?.status !== "running") return;
          task.cursor = manifest.step + 1;
          task.lifecycle = "Step5_Actuation";
          const toolSummary = manifest.tools.length > 0 ? manifest.tools.map((t) => t.name).join(", ") : "收敛结论";
          this.publish(task, `${task.cursor}/${maxSteps} 执行步骤 (${toolSummary})`, initialTaint);
        }
      });

      const verifiedToolCount = report.rounds
        .flatMap((round) => round.receipts)
        .filter((receipt) => receipt.result.status === "verified").length;

      if (this.tasks.get(task.task_id)?.status === "running") {
        task.lifecycle = "Step8_EpisodicCrystallization";
        task.status = report.stopReason === "finished" ? "completed" : "waiting_owner_approval";
        const finalSummary =
          report.stopReason === "finished"
            ? `${task.goal}：已完成（核验动作 ${verifiedToolCount} 项）`
            : `${task.goal}：达到步数上限，等待复核`;
        this.publish(task, finalSummary, initialTaint);
        if (task.status === "completed") {
          const snapshot = this.coordinator.getSnapshot();
          const impulses = Object.fromEntries(
            Object.entries(this.completionImpulses).filter(([id]) => Object.hasOwn(snapshot.D2_CONTINUOUS_STATES.values, id))
          );
          if (Object.keys(impulses).length) {
            this.submit({
              domain: "D2_CONTINUOUS_STATES",
              base_rev: snapshot.domain_revs.D2_CONTINUOUS_STATES,
              source_event_ids: [task.source_event_id],
              payload: { impulses }
            });
          }
        }
      }
      return { report, task: { ...task, steps: [...task.steps] }, verifiedToolCount };
    } finally {
      if (this.taskControllers.get(task.task_id) === controller) {
        this.taskControllers.delete(task.task_id);
      }
    }
  }

  async collectPlanningContext(taskId: string, maxTokens = 120): Promise<Array<{ slot_id: string; text: string }>> {
    const host = this.extensionHost;
    const task = this.requireTask(taskId);
    if (!host || task.status !== "running" || task.principal !== "owner_verified" ||
        task.audience_scope !== "only_owner" || !Number.isFinite(maxTokens) || maxTokens <= 0) return [];
    const entries = sortFacetsByPriority(host.listFacets(cognitionContextContributorFacet));
    if (!entries.length) return [];
    const snapshot = this.coordinator.getSnapshot();
    const contributions: Array<{ slot_id: string; text: string }> = [];
    let remainingChars = Math.floor(maxTokens * 2.5);
    for (const entry of entries) {
      if (remainingChars <= 0 || this.tasks.get(taskId) !== task || task.status !== "running") break;
      if (!host.allowsAudienceScope(entry.packageId, task.audience_scope, entry.facetId)) continue;
      const item = await host.invokeFacetAsync(entry, facet =>
        facet.contributeToBlackboard(selectReadableSnapshot(host, entry.packageId, snapshot), remainingChars / 2.5));
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
    const task = this.requireTask(taskId);
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
    this.publish(task, summary);
    const snapshot = this.coordinator.getSnapshot();
    const impulses = Object.fromEntries(
      Object.entries(this.completionImpulses).filter(([id]) => Object.hasOwn(snapshot.D2_CONTINUOUS_STATES.values, id))
    );
    if (Object.keys(impulses).length) {
      this.submit({
        domain: "D2_CONTINUOUS_STATES",
        base_rev: snapshot.domain_revs.D2_CONTINUOUS_STATES,
        source_event_ids: [task.source_event_id],
        payload: { impulses }
      });
    }
    return { completed_episode_summary: summary };
  }

  approveTask(taskId: string): AgencyTaskRecord {
    const task = this.requireTask(taskId);
    task.status = "running";
    task.lifecycle = "Step5_Actuation";
    this.publish(task, "所有者已批准，继续执行步骤", "trusted_owner");
    return { ...task, steps: [...task.steps] };
  }

  cancelTask(taskId: string): AgencyTaskRecord {
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

  private publish(task: AgencyTaskRecord, summary: string, taint_level: TaintLevel = "trusted_owner"): void {
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

export interface MilestoneThresholdRule {
  id: string;
  matches(metrics: Readonly<Record<string, number>>): boolean;
}

const DEFAULT_MILESTONE_RULES: readonly MilestoneThresholdRule[] = [
  { id: "ms.active_30_days", matches: m => (m.days_together ?? m.active_days ?? 0) >= 30 },
  { id: "ms.trust_breakthrough_80", matches: m => (m.trust ?? 0) >= 0.8 },
  { id: "ms.joint_agency_10_tasks", matches: m => (m.completed_tasks_count ?? 0) >= 10 }
];

export class SleepConsolidationWorker {
  private proposalSequence = 0;

  constructor(
    private readonly coordinator: AuthoritativeStateCoordinator,
    private readonly storage: ReadOnlyCognitiveEventView,
    private readonly clock: IVirtualClock,
    private readonly extensionHost?: ExtensionCoreHost,
    private readonly milestoneRules: readonly MilestoneThresholdRule[] = DEFAULT_MILESTONE_RULES
  ) {}

  async runSleepOrgans(events: readonly unknown[] = []): Promise<number> {
    const host = this.extensionHost;
    if (!host) return 0;
    let accepted = 0;
    for (const entry of host.listFacets(cognitionSleepOrganFacet)) {
      const snapshot = selectReadableSnapshot(host, entry.packageId, this.coordinator.getSnapshot());
      const proposals = await host.invokeFacetAsync(entry, facet =>
        facet.onSleepCycleWakeup(snapshot, host.allowsReadDomain(entry.packageId, "D1_WORKING_TURN") ? structuredClone(events) : []));
      for (const proposal of proposals ?? []) {
        if (host.allowsProposeDomain(entry.packageId, proposal.domain) && this.coordinator.submitProposal(proposal).accepted) {
          accepted++;
        }
      }
    }
    return accepted;
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
    for (const item of items) {
      this.propose(
        "D3_MEMORY_PROJECTION",
        [item.id],
        {
          operation: "upsert_memory",
          content_text: `[外部探索发现:${item.feed}] ${item.text}`,
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

  evaluateMilestonesAndRituals(metrics: Readonly<Record<string, number>>): string[] {
    const unlocked = this.milestoneRules.filter(rule => rule.matches(metrics)).map(rule => rule.id);
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

export {
  AgencyTaskWorker as W2AgencyTaskWorker,
  SleepConsolidationWorker as W3SleepReflectionWorker,
  type ReadOnlyCognitiveEventView as KernelReadOnlyStorageView,
  type CognitiveMemoryRetriever as KernelMemoryRetriever
};
