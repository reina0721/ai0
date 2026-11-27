import type { ExtensionActivationScope, ExtensionCoreHost, ExtensionHostView } from "@ai0/extension-core";
import type {
  AudienceScope,
  CognitionMemoryTier,
  CognitionStateDomainDeclaration,
  CustomStateDomain,
  StateDomain,
  TaintLevel,
  WellKnownStateDomain
} from "@ai0/protocol";
import { StateDomainArbiter, type StateAccess } from "../kernel/state-domain-arbiter.js";
import type { IVirtualClock } from "../kernel/virtual-clock.js";
import { MountedContinuousStates, type ContinuousDomainSnapshot, type StateAttribution } from "./continuous-domain.js";
import {
  EpistemicMemoryFirewall,
  type EpistemicEventRecord,
  type VerifiedMemoryProjection
} from "./epistemic-firewall.js";
import { cognitionStateDomainFacet } from "./facets.js";
import { mountedProposalPolicies } from "./proposal-policies.js";

export type CoordinatorEventRecord = EpistemicEventRecord;
export type MemoryProjectionMutation = VerifiedMemoryProjection;
export type DomainRevisions = Record<WellKnownStateDomain, number> & Record<string, number>;

export interface WorkingOpportunityItem {
  id: string;
  lifecycle: "candidate" | "eligible" | "selected" | "consumed" | "expired" | "withdrawn";
  expires_virtual_ts: number;
  topic_key?: string;
  payload?: unknown;
}

export interface WorkingTurnState {
  active_focus_channel_id: string;
  recent_turns: Array<{ role: "user" | "assistant"; text: string; event_id: string }>;
  unsaid_remainder: string | null;
  pending_opportunities: WorkingOpportunityItem[];
}

export interface ActiveTask {
  task_id: string;
  goal: string;
  current_step: number;
  current_step_summary: string;
  status:
    | "running"
    | "waiting_owner_approval"
    | "premise_invalidated_needs_review"
    | "interrupted_recoverable"
    | "completed"
    | "cancelled";
  rev: number;
  taint_level: TaintLevel;
  based_on_memory_ids?: string[];
  source_event_id?: string;
  principal?: string;
  audience_scope?: AudienceScope;
  capability_risk?: string;
  steps?: Array<{ step_title: string; actuator_or_tool_id?: string }>;
}

export interface PendingApproval {
  approval_id: string;
  tier: "tier1_identity" | "tier2_narrative_high_impact" | "w2_tool_auth";
  summary: string;
  diff_payload: Record<string, unknown>;
  source_event_ids: string[];
  based_on_memory_ids?: string[];
  tx_id?: string;
  premise_invalidated?: boolean;
  created_virtual_ts: number;
  status: "pending" | "approved" | "rejected";
}

export interface ActiveTension {
  id: string;
  reason: string;
  caused_by_event_id: string;
  based_on_memory_ids?: string[];
  premise_invalidated?: boolean;
  intensity: number;
  half_life_h: number;
  created_ts: number;
  resolved?: boolean;
}

export interface ReadOnlyCognitiveSnapshot {
  readonly state_rev: number;
  readonly last_committed_tx_id?: string | null;
  readonly domain_revs: Readonly<DomainRevisions>;
  readonly D1_WORKING_TURN: Readonly<WorkingTurnState>;
  readonly D2_CONTINUOUS_STATES: ContinuousDomainSnapshot;
  readonly D3_MEMORY_PROJECTION: { readonly delegated_to_storage: true };
  readonly D4_COMMITMENTS_TASKS: { readonly active_tasks: Readonly<Record<string, ActiveTask>> };
  readonly D5_IDENTITY_NARRATIVE: {
    readonly pending_approvals: ReadonlyArray<PendingApproval>;
    readonly active_tensions: ReadonlyArray<ActiveTension>;
  };
  readonly custom_domains?: Readonly<Record<string, unknown>>;
}

export interface TelemetryFrame {
  virtual_ts_ms: number;
  proposal_id: string;
  domain: StateDomain;
  accepted: boolean;
  track:
    | "track1_protocol_frames"
    | "track2_mvcc_homeostasis"
    | "track3_firewall_pragmatics"
    | "track4_sql_audience_guard";
  detail: string;
}

export interface CoordinatorDecisionTrace {
  trace_id: string;
  tx_id?: string;
  proposal_id: string;
  virtual_ts_ms: number;
  domain: StateDomain;
  base_rev: number;
  resulting_state_rev: number;
  accepted: boolean;
  reason?: string;
  telemetry: TelemetryFrame[];
  source_event_ids: string[];
}

export interface StorageBeliefRevisionBridgeInput {
  readonly target_memory_id: string;
  readonly relation: "supersedes" | "contradicts";
  readonly replacement_memory?: {
    readonly memory_id: string;
    readonly content_text: string;
    readonly memory_tier: string;
    readonly epistemic_type: string;
    readonly visibility_scope: AudienceScope;
    readonly taint_level: TaintLevel;
    readonly attributed_principal?: string;
    readonly source_event_ids: readonly string[];
  };
  readonly virtual_ts_ms: number;
  readonly state_rev: number;
}

export interface CoordinatorStorageMutator {
  getEventById(eventId: string): CoordinatorEventRecord | null | undefined;
  runInTransaction?<T>(operation: () => T): T;
  applyMemoryProjection?(memory: MemoryProjectionMutation): void;
  reviseBeliefLineage?(input: StorageBeliefRevisionBridgeInput): {
    readonly invalidated_memory_ids: readonly string[];
    readonly affected_commitment_ids: readonly string[];
  };
  saveProspectiveCommitment?(commitment: Record<string, unknown>): void;
  applyIdentityNarrativeRevision?(revision: Record<string, unknown>): void;
  saveTurnDecisionTrace(trace: CoordinatorDecisionTrace): void;
  latestStateRevision?(): number;
  loadCoordinatorState?(): ReadOnlyCognitiveSnapshot | undefined;
  checkpointCoordinatorState?(snapshot: ReadOnlyCognitiveSnapshot): void;
}

export interface StateMutationProposal {
  proposal_id: string;
  domain: StateDomain;
  base_rev: number;
  payload: Record<string, unknown>;
  source_event_ids?: string[];
  based_on_memory_ids?: string[];
  tx_id?: string;
  proposer?: string;
  interaction_frame?: string;
  memory_tier?: string;
  epistemic_type?: string;
  taint_level?: TaintLevel;
}

export interface StateMutationResult {
  accepted: boolean;
  reason?: string;
  queued_for_approval?: boolean;
  state_rev: number;
  domain_rev: number;
  trace: CoordinatorDecisionTrace;
}

export interface StateTransactionBundle {
  readonly tx_id: string;
  readonly proposals: readonly StateMutationProposal[];
  readonly proposer_package_id?: string;
  readonly require_committed_events?: boolean;
}

export interface StateTransactionBundleResult {
  readonly accepted: boolean;
  readonly tx_id: string;
  readonly state_rev: number;
  readonly domain_revs: Readonly<DomainRevisions>;
  readonly failed_index?: number;
  readonly failed_domain?: StateDomain;
  readonly reason?: string;
  readonly results: ReadonlyArray<{
    readonly proposal_id: string;
    readonly domain: StateDomain;
    readonly accepted: boolean;
    readonly domain_rev: number;
    readonly queued_for_approval?: boolean;
    readonly reason?: string;
  }>;
}

export interface BeliefRevisionRequest {
  readonly target_memory_id: string;
  readonly relation: "supersedes" | "contradicts";
  readonly reason?: string;
  readonly source_event_ids?: readonly string[];
  readonly interaction_frame?: string;
  readonly taint_level?: TaintLevel;
  readonly extra_invalidated_memory_ids?: readonly string[];
  readonly replacement_memory?: {
    readonly memoryId: string;
    readonly content: string;
    readonly memoryTier: CognitionMemoryTier;
    readonly audienceScope: AudienceScope;
  };
}

export interface BeliefRevisionResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly tx_id: string;
  readonly state_rev: number;
  readonly invalidated_memory_ids: readonly string[];
  readonly paused_task_ids: readonly string[];
  readonly flagged_approval_ids: readonly string[];
  readonly affected_commitment_ids: readonly string[];
  readonly replacement_memory_id?: string;
}

export const QUALITATIVE_IMPULSE_MAP: Record<string, number> = {
  "+very_high": 0.45,
  "+high": 0.35,
  "+medium": 0.2,
  "+small": 0.1,
  positive_high: 0.35,
  positive_moderate: 0.2,
  slight_up: 0.1,
  neutral: 0,
  slight_down: -0.1,
  negative_moderate: -0.2,
  negative_high: -0.35,
  "-small": -0.1,
  "-medium": -0.2,
  "-high": -0.35,
  "-very_high": -0.45
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function accumulateAffectValenceAbelian(vCurrent: number, deltaImpulse: number): number {
  const v = clamp(vCurrent, -0.999999, 0.999999);
  const t = Math.tanh(deltaImpulse);
  return clamp((v + t) / (1 + v * t), -0.999999, 0.999999);
}

export function accumulateDriveSigmoidAbelian(dCurrent: number, deltaImpulse: number): number {
  const d = clamp(dCurrent, 1e-6, 1 - 1e-6);
  const z = Math.log(d / (1 - d)) + deltaImpulse;
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

interface CustomDomainCell {
  readonly packageId: string;
  readonly generation: number;
  readonly domain: CustomStateDomain;
  state: unknown;
  readonly unregister: () => void;
}

export class AuthoritativeStateCoordinator {
  private readonly arbiter: StateDomainArbiter<StateMutationProposal>;
  private readonly firewall: EpistemicMemoryFirewall;
  private d1: WorkingTurnState = {
    active_focus_channel_id: "",
    recent_turns: [],
    unsaid_remainder: null,
    pending_opportunities: []
  };
  private readonly continuous: MountedContinuousStates;
  private activeTasks: Record<string, ActiveTask> = {};
  private pendingApprovals: PendingApproval[] = [];
  private activeTensions: ActiveTension[] = [];
  private lastCommittedTxId: string | null = null;

  private readonly customDomainCells = new Map<CustomStateDomain, CustomDomainCell>();
  private savedCustomDomainSeeds: Record<string, unknown> = {};
  private savedCustomDomainRevs: Record<string, number> = {};

  private ownerTensionRelease?: string;
  private stagedStorageEffects: Array<() => void> | null = null;
  private readonly initialSnapshot: ReadOnlyCognitiveSnapshot;

  constructor(
    private readonly clock: IVirtualClock,
    private readonly storage: CoordinatorStorageMutator,
    private readonly extensionHost?: ExtensionHostView,
    options: { nonLiteralFrames?: Iterable<string> } = {}
  ) {
    this.firewall = new EpistemicMemoryFirewall({ nonLiteralFrames: options.nonLiteralFrames });
    this.arbiter = new StateDomainArbiter(
      extensionHost &&
        mountedProposalPolicies(extensionHost, (id, domain) =>
          extensionHost.allowsReadDomain(id, domain as StateDomain) &&
          extensionHost.allowsProposeDomain(id, domain as StateDomain)
        )
    );
    this.continuous = new MountedContinuousStates(extensionHost, () => clock.nowMs());
    const merge = () => true;

    this.arbiter.register("D1_WORKING_TURN", {
      read: () => this.d1,
      conflictReason: "STALE_TURN",
      acceptsOlderRevision: ({ payload }) => payload.is_barge_in === true || typeof payload.spoken_char_offset === "number",
      stage: ({ payload }) => {
        const nextD1 = structuredClone(this.d1);
        this.computeWorkingTurnOnTarget(nextD1, payload);
        return {
          commit: () => {
            this.d1 = nextD1;
          }
        };
      },
      apply: ({ payload }) => {
        const nextD1 = structuredClone(this.d1);
        this.computeWorkingTurnOnTarget(nextD1, payload);
        this.d1 = nextD1;
        return {};
      }
    });

    this.arbiter.register("D2_CONTINUOUS_STATES", {
      read: () => this.continuous.snapshot(),
      acceptsOlderRevision: merge,
      stage: ({ payload }) => {
        const parsed = this.validateContinuousPayload(payload);
        if ("reason" in parsed) return { reason: parsed.reason };
        // Dry-run against registered state cells without mutating live continuous cells
        const currentSnap = this.continuous.snapshot();
        const ids = [
          ...Object.keys(parsed.impulses),
          ...Object.keys(parsed.values),
          ...Object.keys(parsed.attributions)
        ];
        if (!ids.length || ids.some((id) => !Object.hasOwn(currentSnap.values, id))) {
          return { reason: "STATE_NOT_REGISTERED" };
        }
        return {
          commit: () => {
            this.continuous.apply(parsed.impulses, parsed.values, parsed.attributions);
          }
        };
      },
      apply: ({ payload }) => {
        const parsed = this.validateContinuousPayload(payload);
        if ("reason" in parsed) return { reason: parsed.reason };
        return this.continuous.apply(parsed.impulses, parsed.values, parsed.attributions);
      }
    });

    this.arbiter.register("D3_MEMORY_PROJECTION", {
      read: () => ({ delegated_to_storage: true }),
      acceptsOlderRevision: merge,
      stage: (proposal) => {
        const evaluated = this.evaluateMemoryProposal(proposal, proposal.source_event_ids ?? []);
        if ("reason" in evaluated) return { reason: evaluated.reason };
        return {
          commit: () => {
            this.enqueueOrRunStorageEffect(() => {
              this.storage.applyMemoryProjection?.(evaluated.mutation);
            });
          }
        };
      },
      apply: (proposal) => {
        const evaluated = this.evaluateMemoryProposal(proposal, proposal.source_event_ids ?? []);
        if ("reason" in evaluated) return { reason: evaluated.reason };
        this.enqueueOrRunStorageEffect(() => {
          this.storage.applyMemoryProjection?.(evaluated.mutation);
        });
        return {};
      }
    });

    this.arbiter.register("D4_COMMITMENTS_TASKS", {
      read: () => this.activeTasks,
      acceptsOlderRevision: merge,
      stage: (proposal) => {
        const prepared = this.prepareCommitmentMutation(proposal);
        if ("reason" in prepared) return { reason: prepared.reason };
        return {
          commit: () => {
            this.activeTasks = prepared.nextTasks;
            this.enqueueOrRunStorageEffect(() => {
              this.storage.saveProspectiveCommitment?.(prepared.storagePayload);
            });
          }
        };
      },
      apply: (proposal) => {
        const prepared = this.prepareCommitmentMutation(proposal);
        if ("reason" in prepared) return { reason: prepared.reason };
        this.activeTasks = prepared.nextTasks;
        this.enqueueOrRunStorageEffect(() => {
          this.storage.saveProspectiveCommitment?.(prepared.storagePayload);
        });
        return {};
      }
    });

    this.arbiter.register("D5_IDENTITY_NARRATIVE", {
      read: () => ({ pending_approvals: this.pendingApprovals, active_tensions: this.activeTensions }),
      acceptsOlderRevision: merge,
      stage: (proposal) => {
        const prepared = this.prepareIdentityMutation(proposal, proposal.source_event_ids ?? [], this.clock.nowMs());
        if ("reason" in prepared) return { reason: prepared.reason };
        return {
          queued: prepared.queued,
          commit: () => {
            this.pendingApprovals = prepared.nextApprovals;
            this.activeTensions = prepared.nextTensions;
            if (prepared.applyStoragePayload) {
              const payloadToSave = prepared.applyStoragePayload;
              this.enqueueOrRunStorageEffect(() => {
                this.storage.applyIdentityNarrativeRevision?.(payloadToSave);
              });
            }
          }
        };
      },
      apply: (proposal) => {
        const prepared = this.prepareIdentityMutation(proposal, proposal.source_event_ids ?? [], this.clock.nowMs());
        if ("reason" in prepared) return { reason: prepared.reason, queued: false };
        this.pendingApprovals = prepared.nextApprovals;
        this.activeTensions = prepared.nextTensions;
        if (prepared.applyStoragePayload) {
          const payloadToSave = prepared.applyStoragePayload;
          this.enqueueOrRunStorageEffect(() => {
            this.storage.applyIdentityNarrativeRevision?.(payloadToSave);
          });
        }
        return { queued: prepared.queued };
      }
    });

    this.synchronizeCustomDomains();
    this.initialSnapshot = this.getSnapshot();
    this.restoreCheckpoint();
  }

  private enqueueOrRunStorageEffect(effect: () => void): void {
    if (this.stagedStorageEffects !== null) {
      this.stagedStorageEffects.push(effect);
    } else {
      effect();
    }
  }

  private buildCallerAccess(options?: {
    proposerPackageId?: string;
    requireCommittedEvents?: boolean;
  }): StateAccess {
    const pkgId = options?.proposerPackageId;
    const host = this.extensionHost;
    return {
      canRead: (domain: string) => (pkgId && host ? host.allowsReadDomain(pkgId, domain as StateDomain) : true),
      canPropose: (domain: string) => (pkgId && host ? host.allowsProposeDomain(pkgId, domain as StateDomain) : true),
      canUseEvidence: (eventId: string) => {
        const ev = this.storage.getEventById(eventId);
        if (ev && ev.redacted_at_ts_ms !== null) return false;
        if (options?.requireCommittedEvents && !ev) return false;
        return true;
      }
    };
  }

  synchronizeCustomDomains(): void {
    const host = this.extensionHost;
    const active = new Map<
      CustomStateDomain,
      { packageId: string; generation: number; declaration: CognitionStateDomainDeclaration } | null
    >();
    for (const entry of host?.listFacets(cognitionStateDomainFacet) ?? []) {
      const domain = entry.implementation.domain;
      active.set(
        domain,
        active.has(domain)
          ? null
          : { packageId: entry.packageId, generation: entry.generation, declaration: entry.implementation }
      );
    }

    for (const [domain, cell] of [...this.customDomainCells.entries()]) {
      const wanted = active.get(domain);
      if (!wanted || wanted.packageId !== cell.packageId || wanted.generation !== cell.generation) {
        cell.unregister();
        this.customDomainCells.delete(domain);
      }
    }

    for (const [domain, wanted] of active.entries()) {
      if (!wanted || this.customDomainCells.has(domain) || this.arbiter.hasDomain(domain)) continue;
      const seed = Object.hasOwn(this.savedCustomDomainSeeds, domain)
        ? structuredClone(this.savedCustomDomainSeeds[domain])
        : structuredClone(wanted.declaration.initialState);
      const cellRef: { state: unknown } = { state: seed };
      const unregister = this.arbiter.register(domain, {
        read: () => cellRef.state,
        ...(wanted.declaration.acceptsOlderRevision
          ? {
              acceptsOlderRevision: (p) =>
                wanted.declaration.acceptsOlderRevision!({
                  domain: p.domain,
                  base_rev: p.base_rev,
                  payload: p.payload
                })
            }
          : {}),
        stage: (proposal) => {
          const reduced = wanted.declaration.reduce(structuredClone(cellRef.state), {
            domain: proposal.domain,
            base_rev: proposal.base_rev,
            source_event_ids: proposal.source_event_ids,
            payload: structuredClone(proposal.payload)
          });
          if ("reason" in reduced) return { reason: reduced.reason };
          const nextState = structuredClone(reduced.value);
          return {
            commit: () => {
              cellRef.state = nextState;
            }
          };
        },
        apply: (proposal) => {
          const reduced = wanted.declaration.reduce(structuredClone(cellRef.state), {
            domain: proposal.domain,
            base_rev: proposal.base_rev,
            source_event_ids: proposal.source_event_ids,
            payload: structuredClone(proposal.payload)
          });
          if ("reason" in reduced) return { reason: reduced.reason };
          cellRef.state = structuredClone(reduced.value);
          return {};
        }
      });

      const fullCell: CustomDomainCell = {
        packageId: wanted.packageId,
        generation: wanted.generation,
        domain,
        get state() {
          return cellRef.state;
        },
        set state(v: unknown) {
          cellRef.state = v;
        },
        unregister
      };
      this.customDomainCells.set(domain, fullCell);
      delete this.savedCustomDomainSeeds[domain];
    }
  }

  private restoreInMemorySnapshot(snapshot: ReadOnlyCognitiveSnapshot): void {
    this.synchronizeCustomDomains();
    this.continuous.restore(snapshot.D2_CONTINUOUS_STATES ?? { values: {}, attributions: {} });
    this.savedCustomDomainSeeds = structuredClone((snapshot.custom_domains ?? {}) as Record<string, unknown>);
    this.savedCustomDomainRevs = { ...snapshot.domain_revs };
    for (const [domain, cell] of this.customDomainCells.entries()) {
      if (Object.hasOwn(this.savedCustomDomainSeeds, domain)) {
        cell.state = structuredClone(this.savedCustomDomainSeeds[domain]);
        delete this.savedCustomDomainSeeds[domain];
      }
    }
    const maxDomainRev = Math.max(0, ...Object.values(snapshot.domain_revs).filter(Number.isFinite));
    const targetStateRev = Math.max(snapshot.state_rev, this.storage.latestStateRevision?.() ?? 0, maxDomainRev);
    this.arbiter.restore(targetStateRev, {
      ...snapshot.domain_revs,
      D2_CONTINUOUS_STATES: snapshot.domain_revs.D2_CONTINUOUS_STATES ?? 0
    });
    this.d1 = structuredClone(snapshot.D1_WORKING_TURN) as WorkingTurnState;
    this.activeTasks = structuredClone(snapshot.D4_COMMITMENTS_TASKS.active_tasks) as Record<string, ActiveTask>;
    this.pendingApprovals = structuredClone(snapshot.D5_IDENTITY_NARRATIVE.pending_approvals) as PendingApproval[];
    this.activeTensions = structuredClone(snapshot.D5_IDENTITY_NARRATIVE.active_tensions) as ActiveTension[];
    this.lastCommittedTxId = snapshot.last_committed_tx_id ?? null;
  }

  restoreCheckpoint(): void {
    const saved = structuredClone(this.storage.loadCoordinatorState?.() ?? this.initialSnapshot);
    this.restoreInMemorySnapshot(saved);
  }

  /**
   * Crash-recovery reconciliation: any D4 task persisted as `"running"` from a terminated/crashed
   * process epoch is deterministically transitioned to `"interrupted_recoverable"` so it never
   * lingers as an unaddressable zombie task.
   */
  reconcileInterruptedWorkOnRestore(): readonly string[] {
    const interruptedIds: string[] = [];
    for (const [taskId, task] of Object.entries(this.activeTasks)) {
      if (task.status === "running") {
        interruptedIds.push(taskId);
      }
    }
    if (interruptedIds.length === 0) return [];

    const now = this.clock.nowMs();
    const current = this.getSnapshot();
    const nextTasks = structuredClone(this.activeTasks);
    for (const taskId of interruptedIds) {
      const task = nextTasks[taskId]!;
      task.status = "interrupted_recoverable";
      if (!task.current_step_summary.startsWith("[中断待恢复]")) {
        task.current_step_summary = `[中断待恢复] ${task.current_step_summary}`.slice(0, 100);
      }
      task.rev = now;
    }

    const res = this.submitProposal({
      proposal_id: `crash_reconcile:${now}`,
      domain: "D4_COMMITMENTS_TASKS",
      base_rev: current.domain_revs.D4_COMMITMENTS_TASKS,
      payload: { replace_active_tasks: nextTasks }
    });
    return res.accepted ? interruptedIds : [];
  }

  getSnapshot(): ReadOnlyCognitiveSnapshot {
    this.synchronizeCustomDomains();
    const revisions = this.arbiter.revisions();
    const customDomains: Record<string, unknown> = {};
    for (const [domain, cell] of this.customDomainCells.entries()) {
      customDomains[domain] = structuredClone(cell.state);
    }
    return structuredClone<ReadOnlyCognitiveSnapshot>({
      state_rev: revisions.stateRev,
      ...(this.lastCommittedTxId !== null ? { last_committed_tx_id: this.lastCommittedTxId } : {}),
      domain_revs: revisions.domains as DomainRevisions,
      D1_WORKING_TURN: this.d1,
      D2_CONTINUOUS_STATES: this.continuous.snapshot(),
      D3_MEMORY_PROJECTION: { delegated_to_storage: true },
      D4_COMMITMENTS_TASKS: { active_tasks: this.activeTasks },
      D5_IDENTITY_NARRATIVE: { pending_approvals: this.pendingApprovals, active_tensions: this.activeTensions },
      ...(Object.keys(customDomains).length > 0 ? { custom_domains: customDomains } : {})
    });
  }

  canAutoInvokeSideEffectTool(triggerTaintLevel: TaintLevel): boolean {
    return triggerTaintLevel !== "untrusted_external";
  }

  releaseTensionByOwnerSovereignty(tensionId: string): boolean {
    const tension = this.activeTensions.find((x) => x.id === tensionId);
    if (!tension) return false;
    this.ownerTensionRelease = tensionId;
    try {
      const result = this.arbiter.bind("D5_IDENTITY_NARRATIVE", this.buildCallerAccess()).propose({
        proposal_id: "release:" + tensionId,
        domain: "D5_IDENTITY_NARRATIVE",
        base_rev: this.arbiter.revisions().domains.D5_IDENTITY_NARRATIVE!,
        payload: { release_tension: tensionId }
      });
      if (result.accepted) this.storage.checkpointCoordinatorState?.(this.getSnapshot());
      return result.accepted;
    } finally {
      this.ownerTensionRelease = undefined;
    }
  }

  submitProposal(proposal: StateMutationProposal): StateMutationResult {
    this.synchronizeCustomDomains();
    const now = this.clock.nowMs();
    const preSnapshot = this.getSnapshot();
    const effects: Array<() => void> = [];
    this.stagedStorageEffects = effects;
    let decision: ReturnType<ReturnType<StateDomainArbiter<StateMutationProposal>["bind"]>["propose"]>;
    try {
      decision = this.arbiter.bind(proposal.domain, this.buildCallerAccess()).propose(proposal);
    } finally {
      this.stagedStorageEffects = null;
    }

    if (!decision.accepted) {
      return this.audit(proposal, false, decision.reason, false, now);
    }

    if (proposal.tx_id) {
      this.lastCommittedTxId = proposal.tx_id;
    }
    const persistAll = () => {
      for (const runEffect of effects) runEffect();
      this.storage.checkpointCoordinatorState?.(this.getSnapshot());
    };
    try {
      if (this.storage.runInTransaction) {
        this.storage.runInTransaction(persistAll);
      } else {
        persistAll();
      }
    } catch (storageError) {
      this.restoreInMemorySnapshot(preSnapshot);
      throw storageError;
    }

    return this.audit(proposal, true, decision.reason, decision.queued ?? false, now);
  }

  /**
   * Two-phase cross-domain atomic unit-of-work (`all_or_nothing`).
   * Validates and stages every proposal in the causal bundle across `D1..D5` and `custom.*` domains;
   * if any proposal fails validation, firewall checks, or MVCC base_rev checks, the entire bundle
   * rolls back with zero memory or SQLite residue.
   */
  submitTransactionBundle(bundle: StateTransactionBundle): StateTransactionBundleResult {
    this.synchronizeCustomDomains();
    const now = this.clock.nowMs();
    const preSnapshot = this.getSnapshot();
    const callerAccess = this.buildCallerAccess({
      proposerPackageId: bundle.proposer_package_id,
      requireCommittedEvents: bundle.require_committed_events
    });

    const effects: Array<() => void> = [];
    this.stagedStorageEffects = effects;
    let batchDecision: ReturnType<StateDomainArbiter<StateMutationProposal>["proposeBatch"]>;
    try {
      batchDecision = this.arbiter.proposeBatch(
        bundle.proposals.map((proposal) => ({
          proposal: { ...proposal, tx_id: bundle.tx_id },
          access: callerAccess
        }))
      );
    } finally {
      this.stagedStorageEffects = null;
    }

    if (!batchDecision.accepted) {
      const failedProposal =
        batchDecision.failedIndex !== undefined ? bundle.proposals[batchDecision.failedIndex] : bundle.proposals[0];
      if (failedProposal) {
        this.audit(
          { ...failedProposal, tx_id: bundle.tx_id },
          false,
          batchDecision.reason,
          false,
          now
        );
      }
      return {
        accepted: false,
        tx_id: bundle.tx_id,
        state_rev: preSnapshot.state_rev,
        domain_revs: preSnapshot.domain_revs,
        ...(batchDecision.failedIndex !== undefined ? { failed_index: batchDecision.failedIndex } : {}),
        ...(batchDecision.failedDomain !== undefined
          ? { failed_domain: batchDecision.failedDomain as StateDomain }
          : {}),
        ...(batchDecision.reason !== undefined ? { reason: batchDecision.reason } : {}),
        results: batchDecision.results.map((res, idx) => ({
          proposal_id: bundle.proposals[idx]?.proposal_id ?? `tx_item_${idx}`,
          domain: res.domain as StateDomain,
          accepted: false,
          domain_rev: res.domainRev,
          ...(res.reason !== undefined ? { reason: res.reason } : {})
        }))
      };
    }

    this.lastCommittedTxId = bundle.tx_id;
    const postSnapshot = this.getSnapshot();
    const persistAll = () => {
      for (const runEffect of effects) runEffect();
      this.storage.checkpointCoordinatorState?.(postSnapshot);
      for (let i = 0; i < bundle.proposals.length; i++) {
        const p = bundle.proposals[i]!;
        const r = batchDecision.results[i]!;
        this.recordDecisionTraceOnly({ ...p, tx_id: bundle.tx_id }, true, undefined, r.queued ?? false, now);
      }
    };

    try {
      if (this.storage.runInTransaction) {
        this.storage.runInTransaction(persistAll);
      } else {
        persistAll();
      }
    } catch (storageError) {
      this.restoreInMemorySnapshot(preSnapshot);
      throw storageError;
    }

    const committedSnapshot = this.getSnapshot();
    return {
      accepted: true,
      tx_id: bundle.tx_id,
      state_rev: committedSnapshot.state_rev,
      domain_revs: committedSnapshot.domain_revs,
      results: batchDecision.results.map((res, idx) => ({
        proposal_id: bundle.proposals[idx]!.proposal_id,
        domain: res.domain as StateDomain,
        accepted: true,
        domain_rev: res.domainRev,
        ...(res.queued ? { queued_for_approval: true } : {})
      }))
    };
  }

  /**
   * Epistemic Belief Revision (Lightweight JTMS):
   * Distinct from privacy HardForget, preserves historical falsified records for audit while
   * marking target + derived child memories invalidated and automatically pausing dependent
   * active D4 tasks/commitments and flagging dependent D5 pending approvals.
   */
  reviseMemoryBelief(request: BeliefRevisionRequest): BeliefRevisionResult {
    this.synchronizeCustomDomains();
    const now = this.clock.nowMs();
    const txId = `belief_rev:${request.target_memory_id}:${now}`;
    const sourceEventIds = [...(request.source_event_ids ?? [])];
    const access = this.buildCallerAccess();
    if (sourceEventIds.some((id) => !access.canUseEvidence?.(id))) {
      const snap = this.getSnapshot();
      return {
        accepted: false,
        reason: "SOURCE_EVENT_REDACTED_OR_MISSING",
        tx_id: txId,
        state_rev: snap.state_rev,
        invalidated_memory_ids: [],
        paused_task_ids: [],
        flagged_approval_ids: [],
        affected_commitment_ids: []
      };
    }

    if (request.replacement_memory && request.interaction_frame) {
      const firewallCheck = this.firewall.evaluate(
        {
          interaction_frame: request.interaction_frame,
          memory_tier: request.replacement_memory.memoryTier,
          epistemic_type:
            (request.taint_level ?? "trusted_owner") === "trusted_owner" ? "observed_firsthand" : "reported_hearsay",
          taint_level: request.taint_level,
          source_event_ids: sourceEventIds.filter((id) => Boolean(this.storage.getEventById(id))),
          payload: { content_text: request.replacement_memory.content }
        },
        this.storage
      );
      if (!firewallCheck.accepted) {
        const snap = this.getSnapshot();
        return {
          accepted: false,
          reason: firewallCheck.reason,
          tx_id: txId,
          state_rev: snap.state_rev,
          invalidated_memory_ids: [],
          paused_task_ids: [],
          flagged_approval_ids: [],
          affected_commitment_ids: []
        };
      }
    }

    const preSnapshot = this.getSnapshot();
    let storageInvalidatedIds: readonly string[] = [];
    let storageCommitmentIds: readonly string[] = [];

    const executeRevision = (): BeliefRevisionResult => {
      if (this.storage.reviseBeliefLineage) {
        const storageOutcome = this.storage.reviseBeliefLineage({
          target_memory_id: request.target_memory_id,
          relation: request.relation,
          virtual_ts_ms: now,
          state_rev: preSnapshot.state_rev + 1,
          ...(request.replacement_memory
            ? {
                replacement_memory: {
                  memory_id: request.replacement_memory.memoryId,
                  content_text: request.replacement_memory.content,
                  memory_tier:
                    request.replacement_memory.memoryTier === "semantic_fact"
                      ? "semantic_fact"
                      : "episodic_experience",
                  epistemic_type:
                    (request.taint_level ?? "trusted_owner") === "trusted_owner"
                      ? "observed_firsthand"
                      : "reported_hearsay",
                  visibility_scope: request.replacement_memory.audienceScope,
                  taint_level: request.taint_level ?? "trusted_owner",
                  source_event_ids: sourceEventIds
                }
              }
            : {})
        });
        storageInvalidatedIds = storageOutcome.invalidated_memory_ids;
        storageCommitmentIds = storageOutcome.affected_commitment_ids;
      }

      const invalidatedSet = new Set<string>([
        request.target_memory_id,
        ...(request.extra_invalidated_memory_ids ?? []),
        ...storageInvalidatedIds
      ]);

      const pausedTaskIds: string[] = [];
      const nextTasks = structuredClone(this.activeTasks);
      for (const [taskId, task] of Object.entries(nextTasks)) {
        if (task.status !== "running" && task.status !== "waiting_owner_approval") continue;
        if (task.based_on_memory_ids?.some((memId) => invalidatedSet.has(memId))) {
          task.status = "premise_invalidated_needs_review";
          task.current_step_summary = `[前提记忆已纠正待重审] ${task.goal}`.slice(0, 100);
          task.rev = now;
          pausedTaskIds.push(taskId);
        }
      }

      const flaggedApprovalIds: string[] = [];
      const nextApprovals = structuredClone(this.pendingApprovals);
      for (const approval of nextApprovals) {
        if (approval.status !== "pending") continue;
        if (approval.based_on_memory_ids?.some((memId) => invalidatedSet.has(memId))) {
          approval.premise_invalidated = true;
          flaggedApprovalIds.push(approval.approval_id);
        }
      }
      const nextTensions = structuredClone(this.activeTensions);
      for (const tension of nextTensions) {
        if (!tension.resolved && tension.based_on_memory_ids?.some((memId) => invalidatedSet.has(memId))) {
          tension.premise_invalidated = true;
        }
      }

      const bundleProposals: StateMutationProposal[] = [
        {
          proposal_id: `${txId}:d3`,
          domain: "D3_MEMORY_PROJECTION",
          base_rev: preSnapshot.domain_revs.D3_MEMORY_PROJECTION,
          payload: {
            operation: "belief_revision_marker",
            target_memory_id: request.target_memory_id,
            relation: request.relation,
            invalidated_memory_ids: [...invalidatedSet]
          }
        }
      ];
      if (pausedTaskIds.length > 0) {
        bundleProposals.push({
          proposal_id: `${txId}:d4`,
          domain: "D4_COMMITMENTS_TASKS",
          base_rev: preSnapshot.domain_revs.D4_COMMITMENTS_TASKS,
          payload: { replace_active_tasks: nextTasks }
        });
      }
      if (flaggedApprovalIds.length > 0 || nextTensions.some((t, i) => t.premise_invalidated !== this.activeTensions[i]?.premise_invalidated)) {
        bundleProposals.push({
          proposal_id: `${txId}:d5`,
          domain: "D5_IDENTITY_NARRATIVE",
          base_rev: preSnapshot.domain_revs.D5_IDENTITY_NARRATIVE,
          payload: { replace_identity_queues: { pending_approvals: nextApprovals, active_tensions: nextTensions } }
        });
      }

      const bundleRes = this.submitTransactionBundle({
        tx_id: txId,
        proposals: bundleProposals
      });
      if (!bundleRes.accepted) {
        throw new Error(bundleRes.reason ?? "BELIEF_REVISION_BUNDLE_REJECTED");
      }

      return {
        accepted: true,
        tx_id: txId,
        state_rev: bundleRes.state_rev,
        invalidated_memory_ids: [...invalidatedSet],
        paused_task_ids: pausedTaskIds,
        flagged_approval_ids: flaggedApprovalIds,
        affected_commitment_ids: [...storageCommitmentIds],
        ...(request.replacement_memory ? { replacement_memory_id: request.replacement_memory.memoryId } : {})
      };
    };

    try {
      return this.storage.runInTransaction ? this.storage.runInTransaction(executeRevision) : executeRevision();
    } catch (error) {
      this.restoreInMemorySnapshot(preSnapshot);
      return {
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
        tx_id: txId,
        state_rev: preSnapshot.state_rev,
        invalidated_memory_ids: [],
        paused_task_ids: [],
        flagged_approval_ids: [],
        affected_commitment_ids: []
      };
    }
  }

  private computeWorkingTurnOnTarget(target: WorkingTurnState, p: Record<string, unknown>): void {
    if (p.is_barge_in === true || typeof p.spoken_char_offset === "number") {
      this.truncateSpokenTurnOnTarget(target, Number(p.spoken_char_offset ?? 0));
    }
    if (typeof p.active_focus_channel_id === "string") target.active_focus_channel_id = p.active_focus_channel_id;
    if (typeof p.active_focus_channel === "string") target.active_focus_channel_id = p.active_focus_channel;
    if (p.append_turn && typeof p.append_turn === "object") {
      target.recent_turns.push(structuredClone(p.append_turn) as WorkingTurnState["recent_turns"][number]);
    }
    if (p.unsaid_remainder === null || p.interrupted_remainder === null) {
      target.unsaid_remainder = null;
    }
    if (Array.isArray(p.pending_opportunities)) {
      target.pending_opportunities = structuredClone(p.pending_opportunities) as WorkingOpportunityItem[];
    }
  }

  private truncateSpokenTurnOnTarget(target: WorkingTurnState, offset: number): void {
    for (let i = target.recent_turns.length - 1; i >= 0; i--) {
      const turn = target.recent_turns[i];
      if (!turn || turn.role !== "assistant") continue;
      const characters = Array.from(turn.text);
      const cut = clamp(Math.trunc(offset), 0, characters.length);
      target.unsaid_remainder = characters.slice(cut).join("") || null;
      turn.text = characters.slice(0, cut).join("");
      return;
    }
  }

  private validateContinuousPayload(
    payload: Record<string, unknown>
  ):
    | {
        impulses: Record<string, number>;
        values: Record<string, number>;
        attributions: Record<string, StateAttribution>;
      }
    | { reason: string } {
    const numericMap = (value: unknown) => {
      if (value === undefined) return {};
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(Number.isFinite))
        return undefined;
      return value as Record<string, number>;
    };
    const impulses = numericMap(payload.impulses);
    const values = numericMap(payload.values);
    if (!impulses || !values) return { reason: "INVALID_STATE_VALUE" };
    if (
      payload.attributions !== undefined &&
      (typeof payload.attributions !== "object" || !payload.attributions || Array.isArray(payload.attributions))
    ) {
      return { reason: "INVALID_ATTRIBUTION" };
    }
    const attributions: Record<string, StateAttribution> = Object.create(null);
    for (const [id, raw] of Object.entries(payload.attributions ?? {})) {
      const value = raw as Partial<StateAttribution> | null;
      if (
        !value ||
        typeof value.text !== "string" ||
        typeof value.audienceScope !== "string" ||
        !(
          value.audienceScope === "only_owner" ||
          value.audienceScope === "public_all" ||
          value.audienceScope.startsWith("group:")
        ) ||
        !Array.isArray(value.sourceEventIds) ||
        !value.sourceEventIds.every((item) => typeof item === "string")
      ) {
        return { reason: "INVALID_ATTRIBUTION" };
      }
      attributions[id] = value as { text: string; audienceScope: AudienceScope; sourceEventIds: string[] };
    }
    return { impulses, values, attributions };
  }

  private evaluateMemoryProposal(
    proposal: StateMutationProposal,
    ids: string[]
  ): { mutation: VerifiedMemoryProjection } | { reason: string } {
    if (proposal.payload.operation === "belief_revision_marker") {
      return {
        mutation: {
          ...proposal.payload,
          taint_level: proposal.taint_level ?? "trusted_owner",
          source_event_ids: ids
        }
      };
    }
    const verdict = this.firewall.evaluate(
      {
        interaction_frame: proposal.interaction_frame,
        memory_tier: proposal.memory_tier,
        epistemic_type: proposal.epistemic_type,
        taint_level: proposal.taint_level,
        source_event_ids: ids,
        payload: proposal.payload
      },
      this.storage
    );
    if (!verdict.accepted) return { reason: verdict.reason };
    return { mutation: verdict.mutation };
  }

  private prepareCommitmentMutation(
    proposal: StateMutationProposal
  ): { nextTasks: Record<string, ActiveTask>; storagePayload: Record<string, unknown> } | { reason: string } {
    const p = structuredClone(proposal.payload);
    if (p.invalid_commitment === true || p.reject_reason) {
      return { reason: String(p.reject_reason ?? "INVALID_COMMITMENT_PAYLOAD") };
    }
    if (p.replace_active_tasks && typeof p.replace_active_tasks === "object" && !Array.isArray(p.replace_active_tasks)) {
      return {
        nextTasks: structuredClone(p.replace_active_tasks as Record<string, ActiveTask>),
        storagePayload: p
      };
    }
    if (p.commitment_type === "curiosity_agenda" && proposal.proposer === "W3") {
      p.taint_level = "untrusted_external";
    }
    const nextTasks = structuredClone(this.activeTasks);
    if (p.task && typeof p.task === "object") {
      const task = p.task as ActiveTask;
      if (!task.task_id || typeof task.goal !== "string" || !task.goal.trim()) {
        return { reason: "INVALID_TASK_SPECIFICATION" };
      }
      const inheritedMemoryIds = proposal.based_on_memory_ids ?? task.based_on_memory_ids;
      nextTasks[task.task_id] = {
        ...task,
        taint_level: (p.taint_level as TaintLevel) ?? task.taint_level,
        ...(inheritedMemoryIds ? { based_on_memory_ids: [...inheritedMemoryIds] } : {})
      };
    } else if (typeof p.task_id === "string" && typeof p.current_step_summary === "string") {
      const existing = nextTasks[p.task_id];
      const inheritedMemoryIds = proposal.based_on_memory_ids ?? existing?.based_on_memory_ids;
      nextTasks[p.task_id] = {
        task_id: p.task_id,
        goal: typeof p.goal === "string" ? p.goal : (existing?.goal ?? p.current_step_summary),
        current_step: typeof p.progress_cursor === "number" ? p.progress_cursor : (existing?.current_step ?? 0),
        current_step_summary: p.current_step_summary,
        status: (p.status as ActiveTask["status"]) ?? existing?.status ?? "running",
        rev: this.clock.nowMs(),
        taint_level: proposal.taint_level ?? existing?.taint_level ?? "trusted_owner",
        ...(inheritedMemoryIds ? { based_on_memory_ids: [...inheritedMemoryIds] } : {})
      };
    }
    if (proposal.based_on_memory_ids) {
      p.based_on_memory_ids = [...proposal.based_on_memory_ids];
    }
    return { nextTasks, storagePayload: p };
  }

  private prepareIdentityMutation(
    proposal: StateMutationProposal,
    ids: string[],
    now: number
  ):
    | {
        queued: boolean;
        nextApprovals: PendingApproval[];
        nextTensions: ActiveTension[];
        applyStoragePayload?: Record<string, unknown>;
      }
    | { reason: string } {
    const p = proposal.payload;
    if (
      p.replace_identity_queues &&
      typeof p.replace_identity_queues === "object" &&
      !Array.isArray(p.replace_identity_queues)
    ) {
      const queues = p.replace_identity_queues as {
        pending_approvals: PendingApproval[];
        active_tensions: ActiveTension[];
      };
      return {
        queued: false,
        nextApprovals: structuredClone(queues.pending_approvals),
        nextTensions: structuredClone(queues.active_tensions)
      };
    }
    const text = JSON.stringify(p).toLowerCase();
    if (/missed[ _-]?login.*punish|punish.*missed[ _-]?login|未登录.{0,12}(惩罚|处罚)/i.test(text)) {
      return { reason: "DARK_PATTERN_PUNISHMENT_REJECTED" };
    }
    const nextApprovals = structuredClone(this.pendingApprovals);
    const nextTensions = structuredClone(this.activeTensions);

    if (typeof p.release_tension === "string") {
      if (this.ownerTensionRelease !== p.release_tension) return { reason: "OWNER_REQUIRED" };
      const tension = nextTensions.find((item) => item.id === p.release_tension);
      if (!tension) return { reason: "UNKNOWN_TENSION" };
      tension.intensity = 0;
      tension.resolved = true;
      return { queued: false, nextApprovals, nextTensions };
    }
    const tier = p.identity_tier ?? p.tier ?? p.proposal_tier;
    const tier1 = tier === "tier1_identity" || p.target === "identity.yaml";
    const highImpact = p.high_impact_shift === true || p.change_type === "high_impact_shift";
    if (tier1 || highImpact) {
      nextApprovals.push({
        approval_id: String(p.approval_id ?? proposal.proposal_id),
        tier: tier1 ? "tier1_identity" : "tier2_narrative_high_impact",
        summary: String(p.summary ?? "Identity or narrative revision"),
        diff_payload: structuredClone(p),
        source_event_ids: [...ids],
        ...(proposal.based_on_memory_ids ? { based_on_memory_ids: [...proposal.based_on_memory_ids] } : {}),
        ...(proposal.tx_id ? { tx_id: proposal.tx_id } : {}),
        created_virtual_ts: now,
        status: "pending"
      });
      return { queued: true, nextApprovals, nextTensions };
    }
    if (p.tension && typeof p.tension === "object") {
      const tension = p.tension as ActiveTension;
      nextTensions.push({
        ...tension,
        ...(proposal.based_on_memory_ids
          ? { based_on_memory_ids: [...proposal.based_on_memory_ids] }
          : tension.based_on_memory_ids
            ? { based_on_memory_ids: [...tension.based_on_memory_ids] }
            : {}),
        half_life_h: clamp(tension.half_life_h, 0, 48),
        intensity: clamp(tension.intensity, 0, 1),
        created_ts: tension.created_ts ?? now
      });
    }
    return {
      queued: false,
      nextApprovals,
      nextTensions,
      applyStoragePayload: structuredClone(p)
    };
  }

  private recordDecisionTraceOnly(
    p: StateMutationProposal,
    accepted: boolean,
    reason: string | undefined,
    queued: boolean,
    now: number
  ): CoordinatorDecisionTrace {
    const details = [
      "protocol proposal received",
      p.domain === "D2_CONTINUOUS_STATES" ? "abelian accumulation applied" : "domain MVCC evaluated",
      reason ?? (queued ? "approval firewall queued" : "pragmatic firewalls passed"),
      "storage lineage and audience guards evaluated"
    ];
    const tracks = [
      "track1_protocol_frames",
      "track2_mvcc_homeostasis",
      "track3_firewall_pragmatics",
      "track4_sql_audience_guard"
    ] as const;
    const telemetry = tracks.map(
      (track, i): TelemetryFrame => ({
        virtual_ts_ms: now,
        proposal_id: p.proposal_id,
        domain: p.domain,
        accepted,
        track,
        detail: details[i] ?? "evaluated"
      })
    );
    const revisions = this.arbiter.revisions();
    const trace: CoordinatorDecisionTrace = {
      trace_id: `${p.proposal_id}:${now}`,
      ...(p.tx_id ? { tx_id: p.tx_id } : {}),
      proposal_id: p.proposal_id,
      virtual_ts_ms: now,
      domain: p.domain,
      base_rev: p.base_rev,
      resulting_state_rev: revisions.stateRev,
      accepted,
      reason,
      telemetry,
      source_event_ids: p.source_event_ids ?? []
    };
    this.storage.saveTurnDecisionTrace(trace);
    return trace;
  }

  private audit(
    p: StateMutationProposal,
    accepted: boolean,
    reason: string | undefined,
    queued: boolean,
    now: number
  ): StateMutationResult {
    const trace = this.recordDecisionTraceOnly(p, accepted, reason, queued, now);
    const revisions = this.arbiter.revisions();
    return {
      accepted,
      reason,
      queued_for_approval: queued || undefined,
      state_rev: revisions.stateRev,
      domain_rev: revisions.domains[p.domain] ?? 0,
      trace
    };
  }
}

export function bindCustomStateDomainToDynamicContract(
  scope: Pick<ExtensionActivationScope, "contributeFacet" | "registerDynamicContract">,
  declaration: CognitionStateDomainDeclaration
): void {
  const parts = declaration.domain.split(".");
  const namespace = parts[1] ?? "custom";
  const name = parts.slice(2).join("_") || "state";
  scope.registerDynamicContract({
    kind: "cognition_protocol",
    namespace,
    name,
    version: 1,
    ...(declaration.description ? { description: declaration.description } : {}),
    jsonSchema: declaration.jsonSchema ?? { type: "object" },
    parse: (raw) => raw
  });
  scope.contributeFacet(cognitionStateDomainFacet, declaration);
}
