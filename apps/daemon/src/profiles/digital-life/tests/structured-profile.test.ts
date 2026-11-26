import { companionProfile } from "./companion-fixture.js";
import { expect, it } from "vitest";
import { UpstreamModelClient, type StructuredModelRequest } from "@ai0/agent-core";
import { UniversalLlmProviderClient, type LlmDialogueSynthesisInput } from "../dialogue.js";
import { ProfiledInferenceClient } from "@ai0/cognition-core";

it("replaces the digital-life instructions and decoder together on the same transport", async () => {
  const requests: Array<Pick<StructuredModelRequest<unknown>, "system" | "observation" | "trace" | "outputSchema">> = [];
  const transport: Pick<UpstreamModelClient, "generateStructured"> = {
    async generateStructured<T>(request: StructuredModelRequest<T>) {
      requests.push(request);
      const result = request.validate({ answer: "42" });
      if (result === undefined) throw new Error("Invalid output for selected profile");
      return { value: result, model_used: "same", provider_used: "controlled", usage: {} };
    }
  };
  const generic = new ProfiledInferenceClient(transport, {
    id: "example.calculation", version: "2",
    compile: (input: string) => ({ system: "Reply with an answer field.", observation: input }),
    decode: value => typeof value.answer === "string" ? value.answer : undefined
  });
  await expect(generic.generate("6*7", { model: "same", stepId: "step-1" })).resolves.toMatchObject({ value: "42" });
  expect(requests[0]?.system).not.toContain("theatrical_subtext");
  expect(requests[0]?.trace).toMatchObject({stepId: "step-1", outputContract: "example.calculation@2"});

  const product = new UniversalLlmProviderClient(undefined, false, companionProfile, transport);
  const input: LlmDialogueSynthesisInput = { userText: "6*7", compiledBlackboardText: "Named character", personaName: "optional",
    venueType: "private_1on1", audienceScope: "only_owner", socialMaskActive: false,
    moodValence: 0, metabolicEnergy: 1, drowsyDowngraded: false, recalledMemorySnippets: [], routedModelId: "same" };
  await expect(product.generateDialogue(input)).rejects.toThrow("Invalid output for selected profile");
  expect(requests[1]?.outputSchema).toMatchObject({ required: expect.arrayContaining(["interaction_frame", "theatrical_subtext"]) });
  expect(requests[1]?.system).toContain("theatrical_subtext");
  expect(requests[1]?.trace?.outputContract).toBe("companion.structured_v1@1");
});
