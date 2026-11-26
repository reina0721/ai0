import type { Ai0DaemonRuntime } from "../index.js";
import { updateStudioConfig } from "../studio-service.js";

export function installStudioTestProfile(runtime: Ai0DaemonRuntime) {
  const agent = { name: "Reviewer", icon: "R", specialty: "Review documents",
    modelProviderId: "test-model", systemPrompt: "Review evidence.", allowedTools: ["rag.search_docs"], maxSteps: 2, enabled: true };
  updateStudioConfig(runtime, {
    agency: { subAgents: [{ ...agent, id: "sub_code_reviewer" },
      { ...agent, id: "sub_research_scholar", executor: { owner: "host.knowledge", name: "search", version: 1, provider: "host.knowledge" } }] },
    soulStudio: { promptBricks: [
      { id: "owner-note", title: "Private note", educationalTip: "", audienceMode: "private_only", maxTokens: 100, template: "Owner review checklist." },
      { id: "team-note", title: "Shared note", educationalTip: "", audienceMode: "all", maxTokens: 100, template: "Verify supporting evidence." }
    ] }
  });
}
