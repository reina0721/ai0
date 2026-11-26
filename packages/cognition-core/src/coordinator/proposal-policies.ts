import type { ExtensionCoreHost } from "@ai0/extension-core";
import { cognitionProposalPolicyFacet } from "../facets/index.js";
import type { ProposalReview, StateProposal } from "./state-domain-arbiter.js";

/** Grants and reducer validation stay with the host. A policy may veto or refine only this domain's payload. */
export function mountedProposalPolicies<P extends StateProposal>(host: ExtensionCoreHost,
  allows: (packageId: string, domain: string) => boolean) {
  return (proposal: P): ProposalReview<P> => {
    let next = proposal;
    const entries = host.listFacets(cognitionProposalPolicyFacet)
      .filter(entry => entry.implementation.domain === proposal.domain && allows(entry.packageId, proposal.domain))
      .sort((a, b) => a.packageId.localeCompare(b.packageId));
    for (const entry of entries) {
      if (!allows(entry.packageId, proposal.domain)) return { reason: "PROPOSAL_POLICY_UNAVAILABLE" };
      const verdict = host.invokeFacet(entry, policy => policy.review(structuredClone({
        domain: proposal.domain, base_rev: proposal.base_rev, payload: next.payload,
        source_event_ids: proposal.source_event_ids ?? []
      })));
      if (!verdict || !allows(entry.packageId, proposal.domain)) return { reason: "PROPOSAL_POLICY_UNAVAILABLE" };
      if (verdict.action === "reject") return { reason: String(verdict.reason || "PROPOSAL_POLICY_REJECTED") };
      if (verdict.action === "replace_payload") {
        if (!verdict.payload || typeof verdict.payload !== "object" || Array.isArray(verdict.payload))
          return { reason: "INVALID_PROPOSAL_POLICY_RESULT" };
        next = { ...next, payload: structuredClone(verdict.payload) };
      } else if (verdict.action !== "allow") return { reason: "INVALID_PROPOSAL_POLICY_RESULT" };
    }
    return { proposal: next };
  };
}
