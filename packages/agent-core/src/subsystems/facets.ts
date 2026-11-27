import { defineFacetPoint } from "@ai0/extension-core";
import {
  agentContextContributorContract,
  agentExecutionGuardContract,
  agentModelAdapterContract,
  agentSkillManualContract,
  agentToolProviderContract
} from "@ai0/protocol";

export const agentModelAdapterFacet = defineFacetPoint(agentModelAdapterContract);
export const agentContextContributorFacet = defineFacetPoint(agentContextContributorContract);
export const agentToolProviderFacet = defineFacetPoint(agentToolProviderContract);
export const agentSkillManualFacet = defineFacetPoint(agentSkillManualContract);
export const agentExecutionGuardFacet = defineFacetPoint(agentExecutionGuardContract);
export type {
  AgentExecutionGuard,
  AgentExecutionGuardDecision,
  AgentModelAdapter,
  AgentToolProvider,
  AgentSkillManual
} from "@ai0/protocol";
