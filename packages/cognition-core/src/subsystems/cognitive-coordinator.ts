import type { ExtensionCoreHost } from "@ai0/extension-core";
import type { AudienceScope, StateDomain, TaintLevel } from "@ai0/protocol";
import { StateDomainArbiter } from "../kernel/state-domain-arbiter.js";
import type { IVirtualClock } from "../kernel/virtual-clock.js";
import { MountedContinuousStates, type ContinuousDomainSnapshot, type StateAttribution } from "./continuous-domain.js";
import {
  EpistemicMemoryFirewall,
  type EpistemicEventRecord,
  type VerifiedMemoryProjection
} from "./epistemic-firewall.js";
import { mountedProposalPolicies } from "./proposal-policies.js";

export type CoordinatorEventRecord = EpistemicEventRecord;
export type MemoryProjectionMutation = VerifiedMemoryProjection;
export type DomainRevisions = Record<StateDomain, number>;

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
  status: "running" | "waiting_owner_approval" | "completed" | "cancelled";
  rev: number;
  taint_level: TaintLevel;
}

export interface PendingApproval {
  approval_id: string;
  tier: "tier1_identity" | "tier2_narrative_high_impact" | "w2_tool_auth";
  summary: string;
  diff_payload: Record<string, unknown>;
  source_event_ids: string[];
  created_virtual_ts: number;
  status: "pending" | "approved" | "rejected";
}

export interface ActiveTension {
  id: string;
  reason: string;
  caused_by_event_id: string;
  intensity: number;
  half_life_h: number;
  created_ts: number;
  resolved?: boolean;
}

export interface ReadOnlyCognitiveSnapshot {
  readonly state_rev: number;
  readonly domain_revs: Readonly<DomainRevisions>;
  readonly D1_WORKING_TURN: Readonly<WorkingTurnState>;
  readonly D2_CONTINUOUS_STATES: ContinuousDomainSnapshot;
  readonly D3_MEMORY_PROJECTION: { readonly delegated_to_storage: true };
  readonly D4_COMMITMENTS_TASKS: { readonly active_tasks: Readonly<Record<string, ActiveTask>> };
  readonly D5_IDENTITY_NARRATIVE: {
    readonly pending_approvals: ReadonlyArray<PendingApproval>;
    readonly active_tensions: ReadonlyArray<ActiveTension>;
  };
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

export interface CoordinatorStorageMutator {
  getEventById(eventId: string): CoordinatorEventRecord | null | undefined;
  applyMemoryProjection?(memory: MemoryProjectionMutation): void;
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

export class AuthoritativeStateCoordinator {
  private readonly arbiter: StateDomainArbiter<StateMutationProposal>;
  private readonly firewall: EpistemicMemoryFirewall;
  private readonly owner = { canRead: () => true, canPropose: () => true, canUseEvidence: () => true };
  private readonly d1: WorkingTurnState = {
    active_focus_channel_id: "",
    recent_turns: [],
    unsaid_remainder: null,
    pending_opportunities: []
  };
  private readonly continuous: MountedContinuousStates;
  private readonly activeTasks: Record<string, ActiveTask> = {};
  private readonly pendingApprovals: PendingApproval[] = [];
  private readonly activeTensions: ActiveTension[] = [];

  private ownerTensionRelease?: string;
  private readonly initialSnapshot: ReadOnlyCognitiveSnapshot;

  constructor(
    private readonly clock: IVirtualClock,
    private readonly storage: CoordinatorStorageMutator,
    extensionHost?: ExtensionCoreHost,
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
      apply: ({ payload }) => {
        this.applyWorkingTurn(payload);
        return {};
      }
    });
    this.arbiter.register("D2_CONTINUOUS_STATES", {
      read: () => this.continuous.snapshot(),
      acceptsOlderRevision: merge,
      apply: ({ payload }) => this.applyContinuous(payload)
    });
    this.arbiter.register("D3_MEMORY_PROJECTION", {
      read: () => ({ delegated_to_storage: true }),
      acceptsOlderRevision: merge,
      apply: proposal => ({ reason: this.applyMemory(proposal, proposal.source_event_ids ?? []) })
    });
    this.arbiter.register("D4_COMMITMENTS_TASKS", {
      read: () => this.activeTasks,
      acceptsOlderRevision: merge,
      apply: proposal => {
        this.applyCommitment(proposal);
        return {};
      }
    });
    this.arbiter.register("D5_IDENTITY_NARRATIVE", {
      read: () => ({ pending_approvals: this.pendingApprovals, active_tensions: this.activeTensions }),
      acceptsOlderRevision: merge,
      apply: proposal => this.applyIdentity(proposal, proposal.source_event_ids ?? [], this.clock.nowMs())
    });
    this.initialSnapshot = this.getSnapshot();
    this.restoreCheckpoint();
  }

  restoreCheckpoint(): void {
    const saved = structuredClone(this.storage.loadCoordinatorState?.() ?? this.initialSnapshot);
    this.continuous.restore(saved.D2_CONTINUOUS_STATES ?? { values: {}, attributions: {} });
    this.arbiter.restore(Math.max(saved.state_rev, this.storage.latestStateRevision?.() ?? 0), {
      ...saved.domain_revs,
      D2_CONTINUOUS_STATES: saved.domain_revs.D2_CONTINUOUS_STATES ?? 0
    });
    Object.assign(this.d1, saved.D1_WORKING_TURN);
    for (const id of Object.keys(this.activeTasks)) delete this.activeTasks[id];
    Object.assign(this.activeTasks, saved.D4_COMMITMENTS_TASKS.active_tasks);
    this.pendingApprovals.splice(0, this.pendingApprovals.length, ...saved.D5_IDENTITY_NARRATIVE.pending_approvals);
    this.activeTensions.splice(0, this.activeTensions.length, ...saved.D5_IDENTITY_NARRATIVE.active_tensions);
  }

  getSnapshot(): ReadOnlyCognitiveSnapshot {
    const revisions = this.arbiter.revisions();
    return structuredClone<ReadOnlyCognitiveSnapshot>({
      state_rev: revisions.stateRev,
      domain_revs: revisions.domains as DomainRevisions,
      D1_WORKING_TURN: this.d1,
      D2_CONTINUOUS_STATES: this.continuous.snapshot(),
      D3_MEMORY_PROJECTION: { delegated_to_storage: true },
      D4_COMMITMENTS_TASKS: { active_tasks: this.activeTasks },
      D5_IDENTITY_NARRATIVE: { pending_approvals: this.pendingApprovals, active_tensions: this.activeTensions }
    });
  }

  canAutoInvokeSideEffectTool(triggerTaintLevel: TaintLevel): boolean {
    return triggerTaintLevel !== "untrusted_external";
  }

  releaseTensionByOwnerSovereignty(tensionId: string): boolean {
    const tension = this.activeTensions.find(x => x.id === tensionId);
    if (!tension) return false;
    this.ownerTensionRelease = tensionId;
    try {
      const result = this.arbiter.bind("D5_IDENTITY_NARRATIVE", this.owner).propose({
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
    const now = this.clock.nowMs();
    const decision = this.arbiter.bind(proposal.domain, this.owner).propose(proposal);
    if (decision.accepted) this.storage.checkpointCoordinatorState?.(this.getSnapshot());
    return this.audit(proposal, decision.accepted, decision.reason, decision.queued ?? false, now);
  }

  private applyWorkingTurn(p: Record<string, unknown>): void {
    if (p.is_barge_in === true || typeof p.spoken_char_offset === "number") {
      this.truncateSpokenTurn(Number(p.spoken_char_offset ?? 0));
    }
    if (typeof p.active_focus_channel_id === "string") this.d1.active_focus_channel_id = p.active_focus_channel_id;
    if (p.append_turn && typeof p.append_turn === "object") {
      this.d1.recent_turns.push(p.append_turn as WorkingTurnState["recent_turns"][number]);
    }
    if (p.unsaid_remainder === null) {
      this.d1.unsaid_remainder = null;
    }
    if (Array.isArray(p.pending_opportunities)) {
      this.d1.pending_opportunities = p.pending_opportunities as WorkingOpportunityItem[];
    }
  }

  private truncateSpokenTurn(offset: number): void {
    for (let i = this.d1.recent_turns.length - 1; i >= 0; i--) {
      const turn = this.d1.recent_turns[i];
      if (!turn || turn.role !== "assistant") continue;
      const characters = Array.from(turn.text);
      const cut = clamp(Math.trunc(offset), 0, characters.length);
      this.d1.unsaid_remainder = characters.slice(cut).join("") || null;
      turn.text = characters.slice(0, cut).join("");
      return;
    }
  }

  private applyContinuous(payload: Record<string, unknown>) {
    const numericMap = (value: unknown) => {
      if (value === undefined) return {};
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(Number.isFinite)) return undefined;
      return value as Record<string, number>;
    };
    const impulses = numericMap(payload.impulses);
    const values = numericMap(payload.values);
    if (!impulses || !values) return { reason: "INVALID_STATE_VALUE" };
    if (payload.attributions !== undefined && (typeof payload.attributions !== "object" || !payload.attributions || Array.isArray(payload.attributions)))
      return { reason: "INVALID_ATTRIBUTION" };
    const attributions: Record<string, StateAttribution> = Object.create(null);
    for (const [id, raw] of Object.entries(payload.attributions ?? {})) {
      const value = raw as Partial<StateAttribution> | null;
      if (
        !value ||
        typeof value.text !== "string" ||
        typeof value.audienceScope !== "string" ||
        !(value.audienceScope === "only_owner" || value.audienceScope === "public_all" || value.audienceScope.startsWith("group:")) ||
        !Array.isArray(value.sourceEventIds) ||
        !value.sourceEventIds.every(item => typeof item === "string")
      ) {
        return { reason: "INVALID_ATTRIBUTION" };
      }
      attributions[id] = value as { text: string; audienceScope: AudienceScope; sourceEventIds: string[] };
    }
    return this.continuous.apply(impulses, values, attributions);
  }

  private applyMemory(proposal: StateMutationProposal, ids: string[]): string | undefined {
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
    if (!verdict.accepted) return verdict.reason;
    this.storage.applyMemoryProjection?.(verdict.mutation);
    return undefined;
  }

  private applyCommitment(proposal: StateMutationProposal): void {
    const p = { ...proposal.payload };
    if (p.commitment_type === "curiosity_agenda" && proposal.proposer === "W3") p.taint_level = "untrusted_external";
    if (p.task && typeof p.task === "object") {
      const task = p.task as ActiveTask;
      this.activeTasks[task.task_id] = { ...task, taint_level: (p.taint_level as TaintLevel) ?? task.taint_level };
    }
    this.storage.saveProspectiveCommitment?.(p);
  }

  private applyIdentity(proposal: StateMutationProposal, ids: string[], now: number): { reason?: string; queued: boolean } {
    const p = proposal.payload;
    const text = JSON.stringify(p).toLowerCase();
    if (/missed[ _-]?login.*punish|punish.*missed[ _-]?login|未登录.{0,12}(惩罚|处罚)/i.test(text)) {
      return { reason: "DARK_PATTERN_PUNISHMENT_REJECTED", queued: false };
    }
    if (typeof p.release_tension === "string") {
      if (this.ownerTensionRelease !== p.release_tension) return { reason: "OWNER_REQUIRED", queued: false };
      const tension = this.activeTensions.find(item => item.id === p.release_tension);
      if (!tension) return { reason: "UNKNOWN_TENSION", queued: false };
      tension.intensity = 0;
      tension.resolved = true;
      return { queued: false };
    }
    const tier = p.identity_tier ?? p.tier ?? p.proposal_tier;
    const tier1 = tier === "tier1_identity" || p.target === "identity.yaml";
    const highImpact = p.high_impact_shift === true || p.change_type === "high_impact_shift";
    if (tier1 || highImpact) {
      this.pendingApprovals.push({
        approval_id: String(p.approval_id ?? proposal.proposal_id),
        tier: tier1 ? "tier1_identity" : "tier2_narrative_high_impact",
        summary: String(p.summary ?? "Identity or narrative revision"),
        diff_payload: p,
        source_event_ids: ids,
        created_virtual_ts: now,
        status: "pending"
      });
      return { queued: true };
    }
    if (p.tension && typeof p.tension === "object") {
      const tension = p.tension as ActiveTension;
      this.activeTensions.push({
        ...tension,
        half_life_h: clamp(tension.half_life_h, 0, 48),
        intensity: clamp(tension.intensity, 0, 1),
        created_ts: tension.created_ts ?? now
      });
    }
    this.storage.applyIdentityNarrativeRevision?.(p);
    return { queued: false };
  }

  private audit(
    p: StateMutationProposal,
    accepted: boolean,
    reason: string | undefined,
    queued: boolean,
    now: number
  ): StateMutationResult {
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
    const telemetry = tracks.map((track, i): TelemetryFrame => ({
      virtual_ts_ms: now,
      proposal_id: p.proposal_id,
      domain: p.domain,
      accepted,
      track,
      detail: details[i] ?? "evaluated"
    }));
    const revisions = this.arbiter.revisions();
    const trace: CoordinatorDecisionTrace = {
      trace_id: `${p.proposal_id}:${now}`,
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
