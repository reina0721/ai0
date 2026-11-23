import type { IVirtualClock } from "../clock/virtual-clock.js";
import type { InteractionOpportunity } from "../gate/thalamic-gate.js";

export type AudienceScope = "only_owner" | `group:${string}` | "public_all" | "trusted_private" | "shared" | "public";
export type TaintLevel = "trusted_owner" | "semi_trusted_friend" | "trusted_system" | "untrusted_external";
export type StateDomain =
  | "D1_WORKING_TURN" | "D2_HOMEOSTASIS_AFFECT" | "D3_MEMORY_PROJECTION"
  | "D4_COMMITMENTS_TASKS" | "D5_IDENTITY_NARRATIVE";
export type DomainRevisions = Record<StateDomain, number>;

export interface WorkingTurnState {
  active_focus_shell_id: string;
  recent_turns: Array<{ role: "user" | "assistant"; text: string; event_id: string }>;
  unsaid_remainder: string | null;
  pending_opportunities: InteractionOpportunity[];
}
export interface HomeostasisAffectState {
  instant_valence: number; instant_arousal: number; mood_baseline_val: number;
  mood_attribution: string | null; mood_attr_scope: AudienceScope;
  circadian_energy: number; metabolic_energy: number;
  drive_social_longing: number; drive_curiosity: number;
}
export interface ActiveTask {
  task_id: string; goal: string; current_step: number; current_step_summary: string;
  status: "running" | "waiting_owner_approval" | "completed" | "cancelled";
  rev: number; taint_level: TaintLevel;
}
export interface PendingApproval {
  approval_id: string;
  tier: "tier1_identity" | "tier2_narrative_high_impact" | "w2_tool_auth";
  summary: string; diff_payload: Record<string, unknown>; source_event_ids: string[];
  created_virtual_ts: number; status: "pending" | "approved" | "rejected";
}
export interface ActiveTension {
  id: string; reason: string; caused_by_event_id: string; intensity: number;
  half_life_h: number; created_ts: number; resolved?: boolean;
}
export interface ReadOnlyCognitiveSnapshot {
  readonly state_rev: number; readonly domain_revs: Readonly<DomainRevisions>;
  readonly D1_WORKING_TURN: Readonly<WorkingTurnState>;
  readonly D2_HOMEOSTASIS_AFFECT: Readonly<HomeostasisAffectState>;
  readonly D3_MEMORY_PROJECTION: { readonly delegated_to_storage: true };
  readonly D4_COMMITMENTS_TASKS: { readonly active_tasks: Readonly<Record<string, ActiveTask>> };
  readonly D5_IDENTITY_NARRATIVE: {
    readonly pending_approvals: ReadonlyArray<PendingApproval>;
    readonly active_tensions: ReadonlyArray<ActiveTension>;
  };
}

export interface CoordinatorEventRecord {
  event_id: string; redacted_at_ts_ms: number | null;
  principal_trust: "owner_verified" | "system_trusted" | "untrusted_external" | string;
  event_type?: string; virtual_ts_ms?: number; payload?: Record<string, unknown>;
}
export interface MemoryProjectionMutation {
  memory_tier?: string; epistemic_type?: string; grounding_status?: string;
  taint_level: TaintLevel; source_event_ids: string[]; [key: string]: unknown;
}
export interface CoordinatorStorageMutator {
  getEventById(eventId: string): CoordinatorEventRecord | null | undefined;
  applyMemoryProjection?(memory: MemoryProjectionMutation): void;
  saveProspectiveCommitment?(commitment: Record<string, unknown>): void;
  applyIdentityNarrativeRevision?(revision: Record<string, unknown>): void;
  saveTurnDecisionTrace(trace: VerifiableTurnTrace): void;
  latestStateRevision?(): number;
  loadCoordinatorState?(): ReadOnlyCognitiveSnapshot | undefined;
  checkpointCoordinatorState?(snapshot: ReadOnlyCognitiveSnapshot): void;
}
export interface TelemetryFrame {
  virtual_ts_ms: number; proposal_id: string; domain: StateDomain;
  accepted: boolean; track: "track1_protocol_frames" | "track2_mvcc_homeostasis"
    | "track3_firewall_pragmatics" | "track4_sql_audience_guard";
  detail: string;
}
export interface VerifiableTurnTrace {
  trace_id: string; proposal_id: string; virtual_ts_ms: number; domain: StateDomain;
  base_rev: number; resulting_state_rev: number; accepted: boolean; reason?: string;
  telemetry: TelemetryFrame[]; source_event_ids: string[];
}
export interface StateMutationProposal {
  proposal_id: string; domain: StateDomain; base_rev: number;
  payload: Record<string, unknown>; source_event_ids?: string[];
  proposer?: "W1" | "W2" | "W3" | string;
  interaction_frame?: "playful_banter" | "roleplay_fiction" | string;
  memory_tier?: string; epistemic_type?: string; taint_level?: TaintLevel;
}
export interface StateMutationResult {
  accepted: boolean; reason?: string; queued_for_approval?: boolean;
  state_rev: number; domain_rev: number; trace: VerifiableTurnTrace;
}

export const QUALITATIVE_IMPULSE_MAP: Record<string, number> = {
  "+very_high": .45, "+high": .35, "+medium": .2, "+small": .1,
  positive_high: .35, positive_moderate: .2, slight_up: .1, neutral: 0,
  slight_down: -.1, negative_moderate: -.2, negative_high: -.35,
  "-small": -.1, "-medium": -.2, "-high": -.35, "-very_high": -.45,
};
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export function accumulateAffectValenceAbelian(vCurrent: number, deltaImpulse: number): number {
  const v = clamp(vCurrent, -.999999, .999999), t = Math.tanh(deltaImpulse);
  return clamp((v + t) / (1 + v * t), -.999999, .999999);
}
export function accumulateDriveSigmoidAbelian(dCurrent: number, deltaImpulse: number): number {
  const d = clamp(dCurrent, 1e-6, 1 - 1e-6), z = Math.log(d / (1 - d)) + deltaImpulse;
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const ez = Math.exp(z); return ez / (1 + ez);
}

const DOMAINS: StateDomain[] = ["D1_WORKING_TURN", "D2_HOMEOSTASIS_AFFECT",
  "D3_MEMORY_PROJECTION", "D4_COMMITMENTS_TASKS", "D5_IDENTITY_NARRATIVE"];

export class AuthoritativeStateCoordinator {
  private stateRev = 0;
  private readonly domainRevs = Object.fromEntries(DOMAINS.map(d => [d, 0])) as DomainRevisions;
  private readonly d1: WorkingTurnState = {
    active_focus_shell_id: "", recent_turns: [], unsaid_remainder: null, pending_opportunities: [],
  };
  private readonly d2: HomeostasisAffectState = {
    instant_valence: 0, instant_arousal: 0, mood_baseline_val: 0,
    mood_attribution: null, mood_attr_scope: "only_owner", circadian_energy: 1,
    metabolic_energy: 1, drive_social_longing: .5, drive_curiosity: .5,
  };
  private readonly activeTasks: Record<string, ActiveTask> = {};
  private readonly pendingApprovals: PendingApproval[] = [];
  private readonly activeTensions: ActiveTension[] = [];

  private readonly initialSnapshot: ReadOnlyCognitiveSnapshot;

  constructor(private readonly clock: IVirtualClock, private readonly storage: CoordinatorStorageMutator) {
    this.initialSnapshot = this.getSnapshot();
    this.restoreCheckpoint();
  }

  restoreCheckpoint(): void {
    const saved = this.storage.loadCoordinatorState?.() ?? this.initialSnapshot;
    this.stateRev = Math.max(saved.state_rev, this.storage.latestStateRevision?.() ?? 0);
    Object.assign(this.domainRevs, saved.domain_revs);
    Object.assign(this.d1, saved.D1_WORKING_TURN);
    Object.assign(this.d2, saved.D2_HOMEOSTASIS_AFFECT);
    for (const id of Object.keys(this.activeTasks)) delete this.activeTasks[id];
    Object.assign(this.activeTasks, saved.D4_COMMITMENTS_TASKS.active_tasks);
    this.pendingApprovals.splice(0, this.pendingApprovals.length, ...saved.D5_IDENTITY_NARRATIVE.pending_approvals);
    this.activeTensions.splice(0, this.activeTensions.length, ...saved.D5_IDENTITY_NARRATIVE.active_tensions);
  }

  getSnapshot(): ReadOnlyCognitiveSnapshot {
    return {
      state_rev: this.stateRev, domain_revs: { ...this.domainRevs },
      D1_WORKING_TURN: { ...this.d1, recent_turns: this.d1.recent_turns.map(x => ({ ...x })),
        pending_opportunities: this.d1.pending_opportunities.map(x => ({ ...x })) },
      D2_HOMEOSTASIS_AFFECT: { ...this.d2 }, D3_MEMORY_PROJECTION: { delegated_to_storage: true },
      D4_COMMITMENTS_TASKS: { active_tasks: Object.fromEntries(Object.entries(this.activeTasks)
        .map(([k, v]) => [k, { ...v }])) },
      D5_IDENTITY_NARRATIVE: { pending_approvals: this.pendingApprovals.map(x => ({ ...x,
        diff_payload: { ...x.diff_payload }, source_event_ids: [...x.source_event_ids] })),
        active_tensions: this.activeTensions.map(x => ({ ...x })) },
    };
  }

  canAutoInvokeSideEffectTool(triggerTaintLevel: TaintLevel): boolean {
    return triggerTaintLevel !== "untrusted_external";
  }

  releaseTensionByOwnerSovereignty(tensionId: string): boolean {
    const tension = this.activeTensions.find(x => x.id === tensionId);
    if (!tension) return false;
    tension.intensity = 0; tension.resolved = true;
    this.bump("D5_IDENTITY_NARRATIVE"); this.storage.checkpointCoordinatorState?.(this.getSnapshot());
    return true;
  }

  submitProposal(proposal: StateMutationProposal): StateMutationResult {
    const now = this.clock.nowMs();
    let reason: string | undefined, queued = false;
    const p = proposal.payload, sources = proposal.source_event_ids ?? [];
    if (proposal.domain === "D1_WORKING_TURN") {
      const stale = proposal.base_rev < this.domainRevs.D1_WORKING_TURN;
      const barge = p.is_barge_in === true || typeof p.spoken_char_offset === "number";
      if (stale && !barge) reason = "STALE_TURN";
      else {
        if (barge) this.truncateSpokenTurn(Number(p.spoken_char_offset ?? 0));
        if (typeof p.active_focus_shell_id === "string") this.d1.active_focus_shell_id = p.active_focus_shell_id;
        if (p.append_turn && typeof p.append_turn === "object") this.d1.recent_turns.push(p.append_turn as WorkingTurnState["recent_turns"][number]);
        if (Array.isArray(p.pending_opportunities)) this.d1.pending_opportunities = p.pending_opportunities as InteractionOpportunity[];
      }
    } else if (proposal.domain === "D2_HOMEOSTASIS_AFFECT") {
      this.applyHomeostasis(p);
    } else if (proposal.domain === "D3_MEMORY_PROJECTION") {
      reason = this.applyMemory(proposal, sources);
    } else if (proposal.domain === "D4_COMMITMENTS_TASKS") {
      this.applyCommitment(proposal);
    } else {
      const outcome = this.applyIdentity(proposal, sources, now); reason = outcome.reason; queued = outcome.queued;
    }
    const accepted = !reason;
    if (accepted) { this.bump(proposal.domain); this.storage.checkpointCoordinatorState?.(this.getSnapshot()); }
    return this.audit(proposal, accepted, reason, queued, now);
  }

  private truncateSpokenTurn(offset: number): void {
    for (let i = this.d1.recent_turns.length - 1; i >= 0; i--) {
      const turn = this.d1.recent_turns[i];
      if (!turn || turn.role !== "assistant") continue;
      const cut = clamp(Math.trunc(offset), 0, turn.text.length);
      this.d1.unsaid_remainder = turn.text.slice(cut) || null; turn.text = turn.text.slice(0, cut); return;
    }
  }

  private impulse(value: unknown): number {
    const raw = typeof value === "string" ? (QUALITATIVE_IMPULSE_MAP[value] ?? 0) : Number(value ?? 0);
    return clamp(Number.isFinite(raw) ? raw : 0, -.45, .45);
  }

  private applyHomeostasis(p: Record<string, unknown>): void {
    this.d2.instant_valence = accumulateAffectValenceAbelian(this.d2.instant_valence, this.impulse(p.instant_valence_delta));
    this.d2.instant_arousal = accumulateAffectValenceAbelian(this.d2.instant_arousal, this.impulse(p.instant_arousal_delta));
    this.d2.mood_baseline_val = accumulateAffectValenceAbelian(this.d2.mood_baseline_val, this.impulse(p.mood_baseline_delta));
    this.d2.drive_social_longing = accumulateDriveSigmoidAbelian(this.d2.drive_social_longing, this.impulse(p.drive_social_longing_delta));
    this.d2.drive_curiosity = accumulateDriveSigmoidAbelian(this.d2.drive_curiosity, this.impulse(p.drive_curiosity_delta));
    for (const key of ["circadian_energy", "metabolic_energy"] as const)
      if (p[key] !== undefined) this.d2[key] = clamp(Number(p[key]), 0, 1);
    if (typeof p.mood_attribution === "string" || p.mood_attribution === null) this.d2.mood_attribution = p.mood_attribution as string | null;
    if (typeof p.mood_attr_scope === "string") this.d2.mood_attr_scope = p.mood_attr_scope as AudienceScope;
  }

  private applyMemory(proposal: StateMutationProposal, ids: string[]): string | undefined {
    const events = ids.map(id => this.storage.getEventById(id));
    if (events.some(e => !e || e.redacted_at_ts_ms !== null)) return "SOURCE_EVENT_REDACTED_OR_MISSING";
    if ((proposal.interaction_frame === "playful_banter" || proposal.interaction_frame === "roleplay_fiction")
      && proposal.memory_tier === "semantic_fact" && proposal.epistemic_type === "observed_firsthand")
      return "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT";
    const memory: MemoryProjectionMutation = { ...proposal.payload,
      memory_tier: proposal.memory_tier, epistemic_type: proposal.epistemic_type,
      source_event_ids: ids, taint_level: events.some(e => e!.principal_trust !== "owner_verified")
        ? "untrusted_external" : (proposal.taint_level ?? "trusted_owner") };
    if (proposal.memory_tier === "relational_tacit") {
      memory.grounding_status = "proposed_presented";
      const adoptionId = proposal.payload.owner_adoption_evidence_event_id;
      if (typeof adoptionId === "string") {
        const evidence = this.storage.getEventById(adoptionId);
        if (evidence?.redacted_at_ts_ms === null && evidence.principal_trust === "owner_verified")
          memory.grounding_status = "mutually_grounded";
      }
    }
    this.storage.applyMemoryProjection?.(memory); return undefined;
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
    const p = proposal.payload, text = JSON.stringify(p).toLowerCase();
    if (/missed[ _-]?login.*punish|punish.*missed[ _-]?login|未登录.{0,12}(惩罚|处罚)/i.test(text))
      return { reason: "DARK_PATTERN_PUNISHMENT_REJECTED", queued: false };
    const tier = p.identity_tier ?? p.tier ?? p.proposal_tier;
    const tier1 = tier === "tier1_identity" || p.target === "identity.yaml";
    const highImpact = p.high_impact_shift === true || p.change_type === "high_impact_shift";
    if (tier1 || highImpact) {
      this.pendingApprovals.push({ approval_id: String(p.approval_id ?? proposal.proposal_id),
        tier: tier1 ? "tier1_identity" : "tier2_narrative_high_impact",
        summary: String(p.summary ?? "Identity or narrative revision"), diff_payload: p,
        source_event_ids: ids, created_virtual_ts: now, status: "pending" });
      return { queued: true };
    }
    if (p.tension && typeof p.tension === "object") {
      const tension = p.tension as ActiveTension;
      this.activeTensions.push({ ...tension, half_life_h: clamp(tension.half_life_h, 0, 48),
        intensity: clamp(tension.intensity, 0, 1), created_ts: tension.created_ts ?? now });
    }
    this.storage.applyIdentityNarrativeRevision?.(p);
    return { queued: false };
  }

  private bump(domain: StateDomain): void { this.stateRev++; this.domainRevs[domain]++; }

  private audit(p: StateMutationProposal, accepted: boolean, reason: string | undefined,
    queued: boolean, now: number): StateMutationResult {
    const details = ["protocol proposal received",
      p.domain === "D2_HOMEOSTASIS_AFFECT" ? "abelian accumulation applied" : "domain MVCC evaluated",
      reason ?? (queued ? "approval firewall queued" : "pragmatic firewalls passed"),
      "storage lineage and audience guards evaluated"];
    const tracks = ["track1_protocol_frames", "track2_mvcc_homeostasis",
      "track3_firewall_pragmatics", "track4_sql_audience_guard"] as const;
    const telemetry = tracks.map((track, i): TelemetryFrame => ({ virtual_ts_ms: now,
      proposal_id: p.proposal_id, domain: p.domain, accepted, track, detail: details[i] ?? "evaluated" }));
    const trace: VerifiableTurnTrace = { trace_id: `${p.proposal_id}:${now}`, proposal_id: p.proposal_id,
      virtual_ts_ms: now, domain: p.domain, base_rev: p.base_rev, resulting_state_rev: this.stateRev,
      accepted, reason, telemetry, source_event_ids: p.source_event_ids ?? [] };
    this.storage.saveTurnDecisionTrace(trace);
    return { accepted, reason, queued_for_approval: queued || undefined, state_rev: this.stateRev,
      domain_rev: this.domainRevs[p.domain], trace };
  }
}
