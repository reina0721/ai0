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
export interface StagedDomainMutation {
  readonly commit: () => void;
  readonly queued?: boolean;
}
export interface StateDomainHandler<P extends StateProposal> {
  read(): unknown;
  apply(proposal: P): { reason?: string; queued?: boolean };
  /** Pure dry-run preparation used by two-phase cross-domain atomic transactions. */
  stage?(proposal: P): StagedDomainMutation | { reason: string };
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
export interface BatchProposalItem<P extends StateProposal> {
  readonly proposal: P;
  readonly access: StateAccess;
}
export interface BatchProposalItemOutcome {
  readonly domain: string;
  readonly accepted: boolean;
  readonly domainRev: number;
  readonly queued?: boolean;
  readonly reason?: string;
}
export interface BatchDomainDecision {
  readonly accepted: boolean;
  readonly stateRev: number;
  readonly domainRevs: Readonly<Record<string, number>>;
  readonly failedIndex?: number;
  readonly failedDomain?: string;
  readonly reason?: string;
  readonly results: ReadonlyArray<BatchProposalItemOutcome>;
}

export class StateDomainArbiter<P extends StateProposal = StateProposal> {
  constructor(private readonly review?: (proposal: P) => ProposalReview<P>) {}
  private readonly domains = new Map<string, { revision: number; handler: StateDomainHandler<P> }>();
  private revision = 0;
  private applying = false;
  private epoch = 0;

  hasDomain(id: string): boolean {
    return this.domains.has(id);
  }

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
  registerValue<S>(
    id: string,
    initial: S,
    reduce: (snapshot: S, proposal: P) => { value: S } | { reason: string },
    options?: { acceptsOlderRevision?: (proposal: P) => boolean; conflictReason?: string }
  ) {
    let state = structuredClone(initial);
    return this.register(id, {
      read: () => state,
      ...(options?.acceptsOlderRevision ? { acceptsOlderRevision: options.acceptsOlderRevision } : {}),
      ...(options?.conflictReason ? { conflictReason: options.conflictReason } : {}),
      stage: proposal => {
        const result = reduce(structuredClone(state), proposal);
        if ("reason" in result) return { reason: result.reason };
        const nextValue = structuredClone(result.value);
        return {
          commit: () => {
            state = nextValue;
          }
        };
      },
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

  /**
   * Two-phase all-or-nothing atomic batch transaction across multiple state domains.
   * Phase 1 validates permissions, evidence lineage, MVCC base revisions, proposal policies,
   * and pure staged domain transitions without mutating any live domain state.
   * If any item fails, zero domains mutate and revisions remain completely unchanged.
   */
  proposeBatch(items: ReadonlyArray<BatchProposalItem<P>>): BatchDomainDecision {
    const snapshotRevs = () => this.revisions().domains;
    if (this.applying) {
      return {
        accepted: false,
        stateRev: this.revision,
        domainRevs: snapshotRevs(),
        failedIndex: 0,
        failedDomain: items[0]?.proposal.domain,
        reason: "PROPOSAL_IN_PROGRESS",
        results: items.map((item) => ({
          domain: item.proposal.domain,
          accepted: false,
          domainRev: this.domains.get(item.proposal.domain)?.revision ?? 0,
          reason: "PROPOSAL_IN_PROGRESS"
        }))
      };
    }
    if (items.length === 0) {
      return {
        accepted: true,
        stateRev: this.revision,
        domainRevs: snapshotRevs(),
        results: []
      };
    }

    this.applying = true;
    try {
      const simulatedRevs = new Map<string, number>(
        [...this.domains.entries()].map(([id, entry]) => [id, entry.revision])
      );
      const staged: Array<{
        domain: string;
        entry: { revision: number; handler: StateDomainHandler<P> };
        commit: () => void;
        queued?: boolean;
        nextDomainRev: number;
      }> = [];

      const abortAt = (index: number, domain: string, reason: string): BatchDomainDecision => ({
        accepted: false,
        stateRev: this.revision,
        domainRevs: snapshotRevs(),
        failedIndex: index,
        failedDomain: domain,
        reason,
        results: items.map((item, idx) => ({
          domain: item.proposal.domain,
          accepted: false,
          domainRev: item.access.canRead(item.proposal.domain)
            ? (this.domains.get(item.proposal.domain)?.revision ?? 0)
            : 0,
          ...(idx === index ? { reason } : { reason: "ABORTED_BY_TRANSACTION_ROLLBACK" })
        }))
      });

      for (let i = 0; i < items.length; i++) {
        const { proposal, access } = items[i]!;
        const domain = proposal.domain;
        const entry = this.domains.get(domain);
        if (!entry) return abortAt(i, domain, "DOMAIN_UNAVAILABLE");
        if (!access.canPropose(domain)) return abortAt(i, domain, "DOMAIN_WRITE_DENIED");
        if (proposal.source_event_ids?.some((key) => !access.canUseEvidence?.(key))) {
          return abortAt(i, domain, "SOURCE_EVENT_REDACTED_OR_MISSING");
        }
        const currentDomainRev = simulatedRevs.get(domain)!;
        if (
          !Number.isSafeInteger(proposal.base_rev) ||
          proposal.base_rev < 0 ||
          proposal.base_rev > currentDomainRev ||
          (proposal.base_rev < currentDomainRev && !entry.handler.acceptsOlderRevision?.(proposal))
        ) {
          return abortAt(i, domain, entry.handler.conflictReason ?? "REVISION_CONFLICT");
        }
        const admitted = structuredClone(proposal);
        const reviewed = this.review?.(admitted) ?? { proposal: admitted };
        if ("reason" in reviewed) return abortAt(i, domain, reviewed.reason);

        if (!entry.handler.stage) {
          return abortAt(i, domain, "DOMAIN_NOT_TRANSACTION_STAGEABLE");
        }
        const prepared = entry.handler.stage(reviewed.proposal);
        if ("reason" in prepared) {
          return abortAt(i, domain, prepared.reason);
        }
        const nextDomainRev = currentDomainRev + 1;
        simulatedRevs.set(domain, nextDomainRev);
        staged.push({
          domain,
          entry,
          commit: prepared.commit,
          queued: prepared.queued,
          nextDomainRev
        });
      }

      let maxNextDomainRev = 0;
      for (const op of staged) {
        op.commit();
        op.entry.revision = op.nextDomainRev;
        if (op.nextDomainRev > maxNextDomainRev) maxNextDomainRev = op.nextDomainRev;
      }
      this.revision = Math.max(this.revision + 1, maxNextDomainRev);

      return {
        accepted: true,
        stateRev: this.revision,
        domainRevs: snapshotRevs(),
        results: staged.map((op) => ({
          domain: op.domain,
          accepted: true,
          domainRev: op.nextDomainRev,
          ...(op.queued !== undefined ? { queued: op.queued } : {})
        }))
      };
    } finally {
      this.applying = false;
    }
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
          if (entry.handler.stage) {
            const prepared = entry.handler.stage(reviewed.proposal);
            if ("reason" in prepared) return reject(prepared.reason);
            prepared.commit();
            return { accepted: true, queued: prepared.queued, stateRev: ++this.revision, domainRev: ++entry.revision };
          }
          const outcome = entry.handler.apply(reviewed.proposal);
          if (outcome.reason) return reject(outcome.reason);
          return { accepted: true, queued: outcome.queued, stateRev: ++this.revision, domainRev: ++entry.revision };
        } finally { this.applying = false; }
      }
    };
  }
}
