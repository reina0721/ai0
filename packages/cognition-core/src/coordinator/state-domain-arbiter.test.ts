import { expect, it } from "vitest";
import { StateDomainArbiter, type StateProposal } from "./state-domain-arbiter.js";

it("binds independent domain owners, evidence, current grants and revisions without product domains", () => {
  const arbiter = new StateDomainArbiter<StateProposal & { answer: string }>();
  let allowed = true;
  const domain = "community.review";
  const remove = arbiter.registerValue(domain, { accepted: [] as string[] }, (state, proposal) => {
    state.accepted.push(proposal.answer);
    return proposal.answer ? { value: state } : { reason: "EMPTY" };
  });
  const writer = arbiter.bind(domain, { canRead: () => true, canPropose: () => allowed, canUseEvidence: id => id === "seen" });
  const proposal = { domain, base_rev: 0, answer: "ok", source_event_ids: ["seen"] };
  expect(writer.propose({ ...proposal, source_event_ids: ["missing"] }).reason).toBe("SOURCE_EVENT_REDACTED_OR_MISSING");
  expect(writer.propose({ ...proposal, answer: "" }).reason).toBe("EMPTY");
  expect(writer.read()).toEqual({revision: 0, value: {accepted: []}});
  expect(writer.propose(proposal)).toMatchObject({accepted: true, domainRev: 1});
  expect(writer.propose(proposal).reason).toBe("REVISION_CONFLICT");
  allowed = false;
  expect(writer.propose({ ...proposal, base_rev: 1 }).reason).toBe("DOMAIN_WRITE_DENIED");
  const snapshot = writer.read()!.value as { accepted: string[] };
  snapshot.accepted.push("injected");
  expect(writer.read()?.value).toEqual({ accepted: ["ok"] });
  remove();
  arbiter.registerValue(domain, null, () => ({ value: null }));
  expect(writer.propose(proposal).reason).toBe("DOMAIN_UNAVAILABLE");
});
