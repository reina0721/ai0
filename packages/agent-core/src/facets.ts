import { defineFacetPoint } from "@ai0/extension-core";
import type { AgentToolCall, AgentToolResult } from "@ai0/protocol";
import type { AgentOptions } from "./agent-runtime.js";

export interface AgentToolProvider {
  tools: readonly { name: string; description: string;
    execute(call: AgentToolCall, signal: AbortSignal): AgentToolResult | Promise<AgentToolResult> }[];
}
export interface AgentSkillManual { id: string; instructions: string }
export interface AgentModelAdapter { model: AgentOptions["model"] }

export const agentToolProviderFacet = defineFacetPoint<AgentToolProvider>({
  owner: "agent", name: "tool_provider", version: 1,
  parse(raw) {
    const value = raw as AgentToolProvider | null;
    if (!Array.isArray(value?.tools) || !value.tools.every(tool => tool &&
      typeof tool.name === "string" && typeof tool.description === "string" && typeof tool.execute === "function")) {
      throw new TypeError("Invalid tool provider");
    }
    return value;
  }
});

export const agentSkillManualFacet = defineFacetPoint<AgentSkillManual>({
  owner: "agent", name: "skill_manual", version: 1,
  parse(raw) {
    const value = raw as AgentSkillManual | null;
    if (!value?.id || typeof value.id !== "string" || typeof value.instructions !== "string") {
      throw new TypeError("Invalid skill manual");
    }
    return value;
  }
});

export const agentModelAdapterFacet = defineFacetPoint<AgentModelAdapter>({
  owner: "agent", name: "model_adapter", version: 1,
  parse(raw) {
    const value = raw as AgentModelAdapter | null;
    if (typeof value?.model !== "function") throw new TypeError("Invalid model adapter");
    return value;
  }
});
