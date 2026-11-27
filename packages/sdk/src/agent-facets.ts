import { defineFacetPoint, defineServiceContract } from "@ai0/extension-core";
import {
  agentContextContributorContract,
  agentExecutionGuardContract,
  agentModelAdapterContract,
  agentSkillManualContract,
  agentToolProviderContract,
  TaskExecutorInputSchema,
  TaskExecutorReceiptSchema,
  type ExtensionServiceRef
} from "@ai0/protocol";

export const agentModelAdapterFacet = defineFacetPoint(agentModelAdapterContract);
export const agentContextContributorFacet = defineFacetPoint(agentContextContributorContract);
export const agentToolProviderFacet = defineFacetPoint(agentToolProviderContract);
export const agentSkillManualFacet = defineFacetPoint(agentSkillManualContract);
export const agentExecutionGuardFacet = defineFacetPoint(agentExecutionGuardContract);
/** Publish this service under the extension's own namespace and select its provider in the sub-agent profile. */
export function taskExecutorContract(ref: ExtensionServiceRef) {
  return defineServiceContract({ ...ref, access: "explicit",
    parseInput: input => TaskExecutorInputSchema.parse(input),
    parseOutput: result => TaskExecutorReceiptSchema.parse(result)
  });
}
export type {
  AgentToolProvider as SdkAgentToolProvider,
  AgentSkillManual as SdkAgentSkillManual,
  AgentExecutionGuard,
  AgentExecutionGuardDecision,
  AgentModelAdapter,
  AgentContextContributor,
  AgentToolDefinition,
  PreparedAgentRequest,
  AgentOutputProfile
} from "@ai0/protocol";
