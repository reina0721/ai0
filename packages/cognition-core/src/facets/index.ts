import { cognitionResponseContractPoint } from "@ai0/protocol";
import { defineFacetPoint } from "@ai0/extension-core";
import { cognitionProposalPolicyContract } from "@ai0/protocol";
export const cognitionProposalPolicyFacet = defineFacetPoint(cognitionProposalPolicyContract);
import { ContinuousStateDescriptorSchema, type ContinuousStateDescriptor } from "@ai0/protocol";

export interface CognitionContextContributor<Snapshot = Readonly<Record<string, unknown>>> {
  priority?: number;
  contributeToBlackboard(snapshot: Snapshot, maxTokens: number, request?: { text: string }):
    { slot_id: string; text: string } | null | Promise<{ slot_id: string; text: string } | null>;
}
export const cognitionStateDynamicsFacet = defineFacetPoint<{ descriptors: readonly ContinuousStateDescriptor[] }>({
  owner: "cognition", name: "state_dynamics", version: 1,
  parse(raw) {
    const value = raw as { descriptors?: unknown[] } | null;
    if (!Array.isArray(value?.descriptors)) throw new TypeError("Missing state descriptors");
    return { descriptors: value.descriptors.map(descriptor => ContinuousStateDescriptorSchema.parse(descriptor)) };
  }
});

export const cognitionContextContributorFacet = defineFacetPoint<CognitionContextContributor>({
  owner: "cognition", name: "context_contributor", version: 1,
  parse(raw) {
    const value = raw as CognitionContextContributor | null;
    if (typeof value?.contributeToBlackboard !== "function" ||
        (value.priority !== undefined && !Number.isFinite(value.priority))) throw new TypeError("Invalid context contributor");
    return value;
  }
});

export const cognitionResponseContractFacet = defineFacetPoint(cognitionResponseContractPoint);
