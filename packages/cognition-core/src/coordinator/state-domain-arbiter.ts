/** A host binds authenticated callers to these ports. The caller cannot choose its own grant. */
export interface StateProposal {
  domain: string;
  base_rev: number;
  source_event_ids?: readonly string[];
  payload?: unknown;
}
export type ProposalReview<P> = { proposal: P } | { reason: string };
export interface StateAccess {
  canRead(domain: string): boolean;
  canPropose(domain: string): boolean;
  canUseEvidence?(eventId: string): boolean;
}
export interface StateDomainHandler<P extends StateProposal> {
  read(): unknown;
  apply(proposal: P): { reason?: string; queued?: boolean };
  /** Reducers that merge concurrent updates may explicitly accept an older revision. */
  acceptsOlderRevision?(proposal: P): boolean;
  conflictReason?: string;
}
export interface DomainDecision {
  accepted: boolean;
  stateRev: number;
  domainRev: number;
  reason?: string;
  queued?: boolean;
}

export class StateDomainArbiter<P extends StateProposal = StateProposal> {
  constructor(private readonly review?: (proposal: P) => ProposalReview<P>) {}
  private readonly domains = new Map<string, { revision: number; handler: StateDomainHandler<P> }>();
  private revision = 0;
  private applying = false;
  private epoch = 0;

  register(id: string, handler: StateDomainHandler<P>) {
    if (this.applying) throw new Error("Registration cannot change during a proposal");
    if (!id || this.domains.has(id)) throw new Error("Duplicate or empty state domain: " + id);
    const entry = { handler, revision: 0 };
    this.domains.set(id, entry);
    return () => {
      if (this.applying) throw new Error("Registration cannot change during a proposal");
      if (this.domains.get(id) === entry) this.domains.delete(id);
    };
  }

  /** Private extension state can stay local. Register a reducer when other consumers need a shared revision. */
  registerValue<S>(id: string, initial: S, reduce: (snapshot: S, proposal: P) => { value: S } | { reason: string }) {
    let state = structuredClone(initial);
    return this.register(id, {
      read: () => state,
      apply: proposal => {
        const result = reduce(structuredClone(state), proposal);
        if ("reason" in result) return { reason: result.reason };
        state = structuredClone(result.value);
        return {};
      }
    });
  }

  revisions() {
    return { stateRev: this.revision, domains: Object.fromEntries([...this.domains].map(([id, entry]) => [id, entry.revision])) };
  }

  /** Used by the owning host while loading a consistent checkpoint. */
  restore(stateRev: number, domains: Readonly<Record<string, number>>) {
    if (this.applying || !Number.isSafeInteger(stateRev) || stateRev < 0) throw new TypeError("Invalid state checkpoint");
    for (const id of this.domains.keys()) {
      const rev = domains[id] ?? 0;
      if (!Number.isSafeInteger(rev) || rev < 0 || rev > stateRev) throw new TypeError("Invalid domain revision: " + id);
    }
    this.revision = stateRev;
    this.epoch++;
    for (const [id, entry] of this.domains) entry.revision = domains[id] ?? 0;
  }

  bind(id: string, access: StateAccess) {
    const entry = this.domains.get(id);
    const epoch = this.epoch;
    const available = () => !!entry && this.epoch === epoch && this.domains.get(id) === entry;
    const reject = (reason: string): DomainDecision => ({
      accepted: false, reason, stateRev: this.revision, domainRev: available() && access.canRead(id) ? entry!.revision : 0
    });
    return {
      read: () => available() && access.canRead(id)
        ? { revision: entry!.revision, value: structuredClone(entry!.handler.read()) } : undefined,
      propose: (proposal: P): DomainDecision => {
        if (!entry || !available()) return reject("DOMAIN_UNAVAILABLE");
        if (proposal.domain !== id || !access.canPropose(id)) return reject("DOMAIN_WRITE_DENIED");
        if (proposal.source_event_ids?.some(key => !access.canUseEvidence?.(key)))
          return reject("SOURCE_EVENT_REDACTED_OR_MISSING");
        if (this.applying) return reject("PROPOSAL_IN_PROGRESS");
        if (!Number.isSafeInteger(proposal.base_rev) || proposal.base_rev < 0 || proposal.base_rev > entry.revision ||
            (proposal.base_rev < entry.revision && !entry.handler.acceptsOlderRevision?.(proposal)))
          return reject(entry.handler.conflictReason ?? "REVISION_CONFLICT");
        this.applying = true;
        try {
          const admitted = structuredClone(proposal);
          const reviewed = this.review?.(admitted) ?? { proposal: admitted };
          if ("reason" in reviewed) return reject(reviewed.reason);
          const outcome = entry.handler.apply(reviewed.proposal);
          if (outcome.reason) return reject(outcome.reason);
          return { accepted: true, queued: outcome.queued, stateRev: ++this.revision, domainRev: ++entry.revision };
        } finally { this.applying = false; }
      }
    };
  }
}
