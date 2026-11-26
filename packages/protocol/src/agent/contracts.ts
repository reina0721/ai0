import type { AudienceScope } from "../core-v0/primitives.js";
import type { AgentRound, AgentToolCall, AgentToolResult, AuthorityRole } from "./index.js";

/** The serializable description and its executable boundary validator travel together. */
export interface AgentValueSchema {
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  parse(input: unknown): unknown;
}
export interface AgentOutputProfile {
  id: string;
  version: string;
  schema?: Readonly<Record<string, unknown>>;
  parse(text: string): unknown;
}
export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: AgentValueSchema;
  resultSchema: AgentValueSchema;
  execute(call: AgentToolCall, signal: AbortSignal, context?: { audience: AudienceScope }): AgentToolResult | Promise<AgentToolResult>;
  project(value: unknown): unknown;
}
export interface AgentToolDefinitions { tools: readonly AgentToolDefinition[] }
export interface AgentToolAdvertisement {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}
export interface AgentContextFragment {
  id: string;
  version: string;
  content: string;
  audience?: AudienceScope;
  maxChars?: number;
}
export interface AgentContextContributor {
  contribute(step: { step: number; audience: AudienceScope; signal: AbortSignal }):
    readonly AgentContextFragment[] | Promise<readonly AgentContextFragment[]>;
}
export type AgentRequestMessage =
  | { role: AuthorityRole; content: string }
  | { role: "assistant"; content: string; calls: readonly AgentToolCall[] }
  | { role: "tool"; callId: string; name: string; result: AgentToolResult };
export interface AgentFragmentTrace {
  id: string;
  source: string;
  version: string;
  role: AuthorityRole;
  reason: "included" | "trimmed" | "budget" | "audience" | "replaced" | "revoked";
  chars: number;
  fingerprint: string;
  sourceKind?: "input" | "extension";
  generation?: number;
  originalChars?: number;
  maxChars?: number;
  sentFingerprint?: string;
  messageIndex?: number;
}
export interface AgentStepManifest {
  /** Decisions made while projecting domain state into the request inputs. Body capture is separate. */
  projections?: readonly { id: string; source?: string; version: string; role: string; reason: string; fingerprint?: string; budget?: number }[];
  responseContract?: string;
  stepId: string;
  step: number;
  model: { id: string; generation?: number; requestedId?: string };
  contextBudgetChars?: number;
  fragments: readonly AgentFragmentTrace[];
  tools: readonly { name: string; packageId: string; generation: number }[];
  output?: { id: string; version: string; schema?: Readonly<Record<string, unknown>> };
  /** Hash of ordered input, history (including projected tool receipts), schemas and output contract. */
  fingerprint: string;
}
export interface PreparedAgentRequest {
  step: number;
  messages: readonly AgentRequestMessage[];
  tools: readonly AgentToolAdvertisement[];
  output?: AgentStepManifest["output"];
  manifest: AgentStepManifest;
  signal: AbortSignal;
  /** A host-provided transport records the serialized request for this exact step. */
  wrapFetch?: (provider: string, send?: typeof fetch) => typeof fetch;
  /** Compatibility projections for callback adapters. Both contain model-visible material only. */
  prompt: { system: string[]; developer: string[]; users: string[]; observations: { content: string }[] };
  rounds: readonly AgentRound[];
}
export type AgentModelEvent =
  | { kind: "delta"; text: string }
  | AgentToolCall
  | { kind: "finish" }
  | { kind: "error"; message: string; status?: number }
  | { kind: "cancelled"; reason?: string };
export interface AgentModelAdapter {
  capabilities?: { tools: boolean; structuredOutput: boolean };
  model(request: PreparedAgentRequest): AsyncIterable<AgentModelEvent>;
}
export interface AgentToolProvider {
  tools: readonly Pick<AgentToolDefinition, "name" | "description" | "execute">[];
}
export interface AgentSkillManual { id: string; instructions: string; allowedTools?: readonly string[] }

// Shared by the public author SDK and domain consumer without importing either implementation.
export const agentModelAdapterContract = {
  owner: "agent", name: "model_adapter", version: 1,
  parse(raw: unknown): AgentModelAdapter {
    const adapter = raw as AgentModelAdapter | null;
    if (typeof adapter?.model !== "function" || (adapter.capabilities !== undefined &&
      (typeof adapter.capabilities?.tools !== "boolean" || typeof adapter.capabilities?.structuredOutput !== "boolean"))) {
      throw new TypeError("Invalid agent.model_adapter");
    }
    return adapter;
  }
} as const;
export const agentToolProviderContract = {
  owner: "agent", name: "tool_provider", version: 1,
  parse(raw: unknown): AgentToolProvider {
    const provider = raw as AgentToolProvider | null;
    if (!Array.isArray(provider?.tools) || !provider.tools.every(tool => tool && typeof tool.name === "string" &&
      tool.name.length > 0 && typeof tool.description === "string" && typeof tool.execute === "function")) {
      throw new TypeError("Invalid agent.tool_provider");
    }
    return provider;
  }
} as const;
const isValueSchema = (value: AgentValueSchema) => value && typeof value.parse === "function" &&
  value.jsonSchema !== null && typeof value.jsonSchema === "object" && !Array.isArray(value.jsonSchema);
export const agentToolDefinitionContract = {
  owner: "agent", name: "tool_provider", version: 2,
  parse(raw: unknown): AgentToolDefinitions {
    agentToolProviderContract.parse(raw);
    const provider = raw as AgentToolDefinitions;
    if (!provider.tools.every(tool => isValueSchema(tool.inputSchema) && isValueSchema(tool.resultSchema) &&
      typeof tool.project === "function")) throw new TypeError("Invalid version 2 agent.tool_provider");
    return provider;
  }
} as const;
export const agentContextContributorContract = {
  owner: "agent", name: "context_contributor", version: 1,
  parse(raw: unknown): AgentContextContributor {
    const contributor = raw as AgentContextContributor | null;
    if (typeof contributor?.contribute !== "function") throw new TypeError("Invalid agent.context_contributor");
    return contributor;
  }
} as const;
export const agentSkillManualContract = {
  owner: "agent", name: "skill_manual", version: 1,
  parse(raw: unknown): AgentSkillManual {
    const skill = raw as AgentSkillManual | null;
    if (typeof skill?.id !== "string" || !skill.id || typeof skill.instructions !== "string" ||
      (skill.allowedTools !== undefined && (!Array.isArray(skill.allowedTools) || !skill.allowedTools.every(name => typeof name === "string")))) {
      throw new TypeError("Invalid agent.skill_manual");
    }
    return skill;
  }
} as const;
