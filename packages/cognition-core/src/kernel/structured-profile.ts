import { runKernelAgentTurn, singleStepDriver } from "@ai0/agent-core/kernel";
import type { LlmProviderConfig, PromptFragmentSource, StructuredModelRequest, StructuredModelResponse, UpstreamModelClient } from "@ai0/agent-core";

/** A profile owns the instructions and decoder that must agree on an output shape. */
export interface StructuredInferenceProfile<Input, Output> {
  id: string;
  version: string;
  outputSchema?: Readonly<Record<string, unknown>>;
  compile(input: Input): { system: string; observation: string; fragments?: readonly PromptFragmentSource[] };
  decode(value: Record<string, unknown>): Output | undefined;
}

export function prepareProfileRequest<I, O>(
  profile: StructuredInferenceProfile<I, O>,
  input: I,
  options: { model: string; stepId?: string; dynamicLlmConfig?: LlmProviderConfig }
): StructuredModelRequest<O> {
  const { system, observation, fragments } = profile.compile(input);
  return {
    outputSchema: profile.outputSchema,
    model: options.model,
    dynamicLlmConfig: options.dynamicLlmConfig,
    system,
    observation,
    trace: { stepId: options.stepId, fragments, outputContract: profile.id + "@" + profile.version },
    validate: value => profile.decode(value)
  };
}

export class ProfiledInferenceClient<I, O> {
  constructor(
    private readonly transport: Pick<UpstreamModelClient, "generateStructured">,
    readonly profile: StructuredInferenceProfile<I, O>
  ) {}

  async generate(
    input: I,
    options: { model: string; stepId?: string; dynamicLlmConfig?: LlmProviderConfig },
    signal?: AbortSignal,
    onReasoning?: (delta: string | null) => void
  ) {
    const request = prepareProfileRequest(this.profile, input, options);
    let response: StructuredModelResponse<O> | undefined;
    const transport = this.transport;
    await runKernelAgentTurn({
      runId: options.stepId,
      modelId: options.model,
      signal: signal ?? new AbortController().signal,
      maxSteps: 1,
      maxRetries: 0,
      driver: singleStepDriver,
      inputs: [
        { id: "instructions", role: "system_invariant", content: request.system, source: this.profile.id },
        { id: "observation", role: "untrusted_observation", content: request.observation, source: this.profile.id }
      ],
      profile: {
        id: this.profile.id,
        version: this.profile.version,
        schema: this.profile.outputSchema,
        parse: () => response?.value
      },
      adapter: {
        capabilities: { tools: false, structuredOutput: true },
        async *model(prepared) {
          const system = prepared.prompt.system.join("\n");
          const observation = prepared.prompt.observations.map(item => item.content).join("\n");
          response = await transport.generateStructured({ ...request, system, observation }, prepared.signal, onReasoning);
          yield { kind: "delta", text: JSON.stringify(response.value) ?? "" };
          yield { kind: "finish" };
        }
      }
    });
    if (!response) throw new Error("Structured model returned no result");
    return response;
  }
}
