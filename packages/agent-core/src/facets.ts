import { defineFacetPoint } from "@ai0/extension-core";
import {
  agentContextContributorContract, agentModelAdapterContract, agentSkillManualContract,
  agentToolDefinitionContract, agentToolProviderContract
} from "@ai0/protocol";

export const agentModelAdapterFacet = defineFacetPoint(agentModelAdapterContract);
export const agentContextContributorFacet = defineFacetPoint(agentContextContributorContract);
export const agentToolDefinitionFacet = defineFacetPoint(agentToolDefinitionContract);
export const agentToolProviderFacet = defineFacetPoint(agentToolProviderContract);
export const agentSkillManualFacet = defineFacetPoint(agentSkillManualContract);
export type { AgentModelAdapter, AgentToolProvider, AgentSkillManual } from "@ai0/protocol";
