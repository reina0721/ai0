import type { ExtensionCoreHost } from "@ai0/extension-core";
import { randomUUID } from "node:crypto";
import { singleStepDriver } from "../kernel/turn-runtime.js";
import { runAgentTurn } from "./request-assembly.js";
import { extractStructuredJson, type StructuredModelRequest, type StructuredModelResponse } from "./upstream-model-client.js";
import { traceStructuredRequest } from "./model-request-trace.js";

/** Adapt a structured caller to the same selected, generation-checked model as ordinary agent runs. */
export function registeredModelTransport(host: ExtensionCoreHost, packageId: string) {
  return {
    async generateStructured<T>(input: StructuredModelRequest<T>, signal = new AbortController().signal): Promise<StructuredModelResponse<T>> {
      const lease = input.dynamicLlmConfig?.traceLease;
      const runId = input.trace?.stepId ?? randomUUID();
      const stepId = runId + "/0";
      const prepared = { ...input, trace: { ...input.trace, stepId } };
      const outputId = input.trace?.outputContract ?? "structured";
      const result = await runAgentTurn({
        runId, signal, driver: singleStepDriver, maxSteps: 1, modelId: input.model,
        bindings: { host, modelPackageId: packageId, allowsContext: () => false },
        inputs: [
          { id: "instructions", role: "system_invariant", content: input.system, source: outputId },
          { id: "observation", role: "untrusted_observation", content: input.observation, source: outputId }
        ],
        profile: { id: outputId, version: "1", schema: input.outputSchema, parse(text) {
          const json = extractStructuredJson(text);
          const value = json && input.validate(json);
          if (value === undefined || !json) throw new TypeError("Invalid structured model response");
          return value;
        } },
        onStep(manifest) {
          traceStructuredRequest(lease, packageId, input.model, prepared);
          lease?.({ stepId, assembly: manifest, attempts: [], model: input.model }, [], packageId);
        },
        wrapFetch: lease && ((_request, provider, send) => traceStructuredRequest(lease, provider, input.model, prepared, send)!)
      });
      return { value: result.output as T, provider_used: packageId, model_used: input.model, usage: {} };
    }
  };
}
