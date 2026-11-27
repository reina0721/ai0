import type { TaintLevel } from "@ai0/protocol";

export type EpistemicTier =
  | "observed_firsthand"
  | "reported_hearsay"
  | "inferred_hypothesis"
  | "imagined_narrative";

export type CommonGroundStatus = "proposed_presented" | "mutually_grounded";

export interface EpistemicEventRecord {
  event_id: string;
  redacted_at_ts_ms: number | null;
  principal_trust: string;
  event_type?: string;
  virtual_ts_ms?: number;
  payload?: Record<string, unknown>;
}

export interface EpistemicEventLookup {
  getEventById(eventId: string): EpistemicEventRecord | null | undefined;
}

export interface MemoryProjectionCandidate {
  interaction_frame?: string;
  memory_tier?: string;
  epistemic_type?: EpistemicTier | string;
  taint_level?: TaintLevel;
  source_event_ids: readonly string[];
  payload: Record<string, unknown>;
}

export interface VerifiedMemoryProjection {
  memory_tier?: string;
  epistemic_type?: string;
  grounding_status?: CommonGroundStatus;
  taint_level: TaintLevel;
  source_event_ids: string[];
  [key: string]: unknown;
}

export type EpistemicFirewallOutcome =
  | { accepted: true; mutation: VerifiedMemoryProjection }
  | { accepted: false; reason: "SOURCE_EVENT_REDACTED_OR_MISSING" | "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT" };

const DEFAULT_NON_LITERAL_FRAMES = new Set([
  "hypothetical",
  "non_literal",
  "playful_banter",
  "roleplay_fiction"
]);

/**
 * Universal 4-tier epistemic memory provenance firewall & CommonGround adoption state machine.
 * Prevents unverified/redacted events from entering memory, blocks non-literal frames from writing
 * firsthand semantic facts, forces untrusted taint propagation, and distinguishes presentation from adoption.
 */
export class EpistemicMemoryFirewall {
  private readonly nonLiteralFrames: ReadonlySet<string>;

  constructor(options: { nonLiteralFrames?: Iterable<string> } = {}) {
    this.nonLiteralFrames = options.nonLiteralFrames
      ? new Set(options.nonLiteralFrames)
      : DEFAULT_NON_LITERAL_FRAMES;
  }

  evaluate(candidate: MemoryProjectionCandidate, lookup: EpistemicEventLookup): EpistemicFirewallOutcome {
    const ids = [...candidate.source_event_ids];
    const events = ids.map(id => lookup.getEventById(id));
    if (events.some(event => !event || event.redacted_at_ts_ms !== null)) {
      return { accepted: false, reason: "SOURCE_EVENT_REDACTED_OR_MISSING" };
    }
    if (
      candidate.interaction_frame &&
      this.nonLiteralFrames.has(candidate.interaction_frame) &&
      candidate.memory_tier === "semantic_fact" &&
      candidate.epistemic_type === "observed_firsthand"
    ) {
      return { accepted: false, reason: "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT" };
    }

    const taintLevel: TaintLevel = events.some(event => event!.principal_trust !== "owner_verified")
      ? "untrusted_external"
      : (candidate.taint_level ?? "trusted_owner");

    const mutation: VerifiedMemoryProjection = {
      ...candidate.payload,
      memory_tier: candidate.memory_tier,
      epistemic_type: candidate.epistemic_type,
      source_event_ids: ids,
      taint_level: taintLevel
    };

    if (candidate.memory_tier === "relational_tacit") {
      mutation.grounding_status = "proposed_presented";
      const adoptionId = candidate.payload.owner_adoption_evidence_event_id;
      if (typeof adoptionId === "string" && adoptionId.trim()) {
        const evidence = lookup.getEventById(adoptionId);
        if (evidence && evidence.redacted_at_ts_ms === null && evidence.principal_trust === "owner_verified") {
          mutation.grounding_status = "mutually_grounded";
        }
      }
    }

    return { accepted: true, mutation };
  }
}
