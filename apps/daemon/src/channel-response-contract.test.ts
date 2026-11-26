import { expect, it } from "vitest";
import { createDefaultConsoleStudioConfig } from "@ai0/storage";
import { type AgentModelAdapter, type Ai0ExtensionManifest } from "@ai0/protocol";
import { agentModelAdapterFacet, cognitionResponseContractFacet, ExtensionCoreHost } from "@ai0/sdk";
import { UpstreamModelClient } from "@ai0/agent-core";
import { channelInference, selectResponseContract } from "./channel-inference.js";
import type { LlmDialogueSynthesisInput } from "./profiles/digital-life/dialogue.js";

const manifest = (id: string, facets: Ai0ExtensionManifest["facets"]): Ai0ExtensionManifest => ({
  manifest_version: "2.0.0", extension_id: id, display_name: id, version: "1", author: "third-party",
  carrier_kind: "native_code_plugin", facets, permissions: { read_blackboard_domains: [], propose_mutation_domains: [],
    max_audience_scope: "only_owner", network_access: false }
});

it("selects an unseen response format from an SDK plugin with its model, permission ceiling and lifetime", async () => {
  const host = new ExtensionCoreHost();
  const studio = createDefaultConsoleStudioConfig();
  studio.soulStudio.responseContract = "reviews.answer";
  let wire: Parameters<AgentModelAdapter["model"]>[0] | undefined;
  host.mountPackage({ manifest: manifest("independent.model", [agentModelAdapterFacet.id]), activate(scope) {
    scope.contributeFacet(agentModelAdapterFacet, { capabilities: { tools: true, structuredOutput: true },
      async *model(request) { wire = request; yield { kind: "delta", text: '{"answer":"42"}' }; yield { kind: "finish" }; } });
  } });
  host.mountPackage({ manifest: manifest("independent.projection", [cognitionResponseContractFacet.id]), activate(scope) {
    scope.contributeFacet(cognitionResponseContractFacet, { id: "reviews.answer", version: "2",
      instructions: "Use the answer field.", schema: { type: "object", required: ["answer"] },
      parse: JSON.parse, toOutput: value => ({ surface_utterance: String((value as {answer: string}).answer) }),
      stateImpulses: () => ({ unrelated: .5 })
    });
  } });
  expect(() => selectResponseContract(host, "reviews.answer", "public_all")).toThrow("unavailable");
  const run = channelInference({ studio, host, modelPackageId: "independent.model",
    response: selectResponseContract(host, "reviews.answer", "only_owner"), upstream: new UpstreamModelClient(), sandboxFallback: false });
  const input: LlmDialogueSynthesisInput = { userText: "6*7", stepId: "review", compiledBlackboardText: "", personaName: "",
    venueType: "private_1on1", audienceScope: "only_owner", socialMaskActive: false, moodValence: 0, metabolicEnergy: 1,
    drowsyDowngraded: false, recalledMemorySnippets: [], routedModelId: "test" };
  const result = await run(input);
  expect(result.surface_utterance).toBe("42");
  expect(result.projectStateImpulses?.({ unrelated: .1 })).toEqual({});
  expect(wire?.output?.schema).toMatchObject({ required: ["answer"] });
  expect(wire?.messages.flatMap(message => message.role === "developer_frame" ? [message.content] : [])).toContain("Use the answer field.");
  expect(JSON.stringify(wire?.messages)).not.toMatch(/theatrical_subtext|metabolicEnergy/);
  host.unmountPackage("independent.projection");
  expect(() => selectResponseContract(host, "reviews.answer", "only_owner")).toThrow("unavailable");
});
