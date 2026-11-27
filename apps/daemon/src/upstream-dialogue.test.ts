import { afterEach, expect, it, vi } from "vitest";
import type { CognitionResponseContract, DiscoveredRemoteModel, ProviderAdapterType, ReasoningEffort } from "@ai0/protocol";
import {
  fetchUpstreamProviderModels,
  probeUpstreamModelInstance,
  UpstreamInferenceError,
  UpstreamModelClient,
  type StructuredModelRequest
} from "@ai0/agent-core";
import { ProfiledInferenceClient } from "@ai0/cognition-core";
import {
  createW1DialogueProfile,
  planDialogueWindow,
  UniversalLlmProviderClient as ProfileClient,
  type LlmDialogueSynthesisInput
} from "./turn-coordinator.js";

const structuredContractFixture: CognitionResponseContract = {
  id: "fixture.structured_v1",
  version: "1",
  inputFormat: "bounded_observation",
  instructions: "Return JSON with surface_utterance and interaction_frame.",
  schema: {
    type: "object",
    required: [
      "surface_utterance",
      "theatrical_subtext",
      "masked_placeholder",
      "chosen_strategy",
      "interaction_frame",
      "vocal_emotion_tag",
      "facial_expression",
      "valence_impulse"
    ]
  },
  parse(raw) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.surface_utterance !== "string" || !parsed.surface_utterance) {
      throw new Error("Missing surface_utterance");
    }
    return parsed;
  },
  toOutput(value) {
    const v = value as Record<string, string>;
    return {
      surface_utterance: v.surface_utterance!,
      theatrical_subtext: v.theatrical_subtext,
      masked_placeholder: v.masked_placeholder,
      chosen_strategy: v.chosen_strategy,
      interaction_frame: v.interaction_frame as "gentle_support",
      vocal_emotion_tag: v.vocal_emotion_tag,
      facial_expression: v.facial_expression,
      valence_impulse: (v.valence_impulse as "none") ?? "none"
    };
  },
  sandboxResponse(obs) {
    return {
      surface_utterance: `回复：${String(obs.userText ?? "")}`,
      theatrical_subtext: "测试子文本",
      masked_placeholder: "遮罩",
      chosen_strategy: "fixture_reply",
      interaction_frame: "gentle_support",
      vocal_emotion_tag: "warm",
      facial_expression: "smile",
      valence_impulse: "none"
    };
  }
};

const structuredProfile = createW1DialogueProfile(structuredContractFixture);

class UniversalLlmProviderClient extends ProfileClient {
  constructor(config?: ConstructorParameters<typeof ProfileClient>[0], sandbox = false) {
    super(config, sandbox, structuredProfile);
  }
}

const input: LlmDialogueSynthesisInput = {
  userText: "你好",
  compiledBlackboardText: "",
  personaName: "Lin",
  venueType: "private_1on1",
  audienceScope: "only_owner",
  socialMaskActive: false,
  moodValence: 0,
  metabolicEnergy: 1,
  drowsyDowngraded: false,
  recalledMemorySnippets: [],
  routedModelId: "local-default"
};

function providerStream(model: string, parts: { content?: string; reasoning_content?: string }[], usage?: object): Response {
  const frame = (delta: object, finishReason: string | null) => ({
    id: "completion-test", model, created: 1, object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  });
  const frames = [...parts.map((part) => frame(part, null)), { ...frame({}, "stop"), usage }];
  return new Response(
    frames.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } }
  );
}

afterEach(() => vi.unstubAllGlobals());

it("replaces instructions and decoder together on the same transport without leaking compiledBlackboardText into system", async () => {
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
    compile: (raw: string) => ({ system: "Reply with an answer field.", observation: raw }),
    decode: value => typeof value.answer === "string" ? value.answer : undefined
  });
  await expect(generic.generate("6*7", { model: "same", stepId: "step-1" })).resolves.toMatchObject({ value: "42" });
  expect(requests[0]?.trace).toMatchObject({ stepId: "step-1", outputContract: "example.calculation@2" });

  const product = new ProfileClient(undefined, false, structuredProfile, transport);
  const untrustedInput: LlmDialogueSynthesisInput = {
    ...input,
    userText: "6*7",
    compiledBlackboardText: "UNTRUSTED_RECALLED_MEMORY_PAYLOAD",
    routedModelId: "same"
  };
  await expect(product.generateDialogue(untrustedInput)).rejects.toThrow("Invalid output for selected profile");
  expect(requests[1]?.system).not.toContain("UNTRUSTED_RECALLED_MEMORY_PAYLOAD");
  expect(requests[1]?.observation).toContain("UNTRUSTED_RECALLED_MEMORY_PAYLOAD");
  expect(requests[1]?.trace?.outputContract).toBe("fixture.structured_v1@1");
});

it("uses the official DeepSeek adapter, validates the assembled object, and discards provider reasoning", async () => {
  const output = JSON.stringify({
    surface_utterance: "真实回复 🌙",
    theatrical_subtext: "虚构角色提示",
    masked_placeholder: "表演提示",
    chosen_strategy: "自然回应",
    interaction_frame: "gentle_support",
    vocal_emotion_tag: "warm",
    facial_expression: "smile",
    valence_impulse: "none"
  });
  const fetchMock = vi.fn(async () => providerStream("deepseek-flash", [
    { reasoning_content: "provider-private reasoning" },
    { content: output.slice(0, 42) },
    { content: output.slice(42) }
  ]));
  vi.stubGlobal("fetch", fetchMock);
  const client = new UniversalLlmProviderClient({
    apiKey: "test-deepseek-key",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  });
  const result = await client.generateDialogue(input);
  expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/v1/chat/completions", expect.any(Object));
  expect(result).toMatchObject({
    surface_utterance: "真实回复 🌙",
    provider_used: "deepseek",
    model_used: "deepseek-flash"
  });
  expect(JSON.stringify(result)).not.toContain("provider-private reasoning");
});

it("streams reasoning separately, resets rejected attempts, and retains explicitly reported token counters", async () => {
  const output = JSON.stringify(new UniversalLlmProviderClient().synthesizeContextAwareResponse(input));
  const client = new UniversalLlmProviderClient({ baseUrl: "https://api.deepseek.com/v1", apiKeys: ["a", "b"],
    model: "deepseek-reasoner", contextWindow: 128000 });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(providerStream("deepseek-flash", [{ reasoning_content: "first" }, { content: "{}" }]))
    .mockResolvedValueOnce(providerStream("deepseek-flash", [{ reasoning_content: "second" }, { content: output }],
      { prompt_tokens: 12000, completion_tokens: 80, prompt_cache_hit_tokens: 9000 })));
  const changes: (string | null)[] = [];
  const turn = await client.generateDialogue(input, undefined, delta => changes.push(delta));
  expect(changes).toEqual(["first", null, "second"]);
  expect(turn.usage).toMatchObject({ inputTokens: 12000, outputTokens: 80, contextWindow: 128000, cachedInputTokens: 9000 });
  expect(turn.usage?.reasoningTokens).toBeUndefined();
});

it("surfaces invalid remote output even in sandbox and honors cancellation", async () => {
  const client = new UniversalLlmProviderClient({
    apiKey: "test-key",
    baseUrl: "https://compatible.example/v1"
  }, true);
  vi.stubGlobal("fetch", vi.fn(async () => providerStream("local-default", [{ content: "{}" }])));
  await expect(client.generateDialogue(input)).rejects.toBeInstanceOf(UpstreamInferenceError);

  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => {
    controller.abort(new Error("cancelled by the caller"));
    throw new DOMException("Aborted", "AbortError");
  }));
  await expect(client.generateDialogue(input, controller.signal)).rejects.toThrow("cancelled by the caller");
});

it("rotates and fails over across multiple API keys and probes hosted adapters", async () => {
  const validOutput = JSON.stringify(new UniversalLlmProviderClient().synthesizeContextAwareResponse(input));
  const seenAuth: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    seenAuth.push(auth);
    if (auth === "Bearer sk-key-1") {
      return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    }
    return providerStream("gpt-4.1-mini", [{ content: validOutput }]);
  }));

  const client = new UniversalLlmProviderClient({
    provider: "openai-compatible",
    sourceId: "src_multi",
    baseUrl: "https://relay.example/v1",
    apiKeys: ["sk-key-1", "sk-key-2"],
    keyRotationStrategy: "failover",
    model: "gpt-4.1-mini"
  });
  const result = await client.generateDialogue(input);
  expect(result.surface_utterance).toContain("你好");
  expect(seenAuth).toEqual(["Bearer sk-key-1", "Bearer sk-key-2"]);
});

it.each<{
  adapterType: ProviderAdapterType;
  baseUrl: string;
  modelId: string;
  effort: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  expected: Record<string, unknown>;
}>([
  { adapterType: "opencode_go", baseUrl: "https://opencode.ai/inference/go/openai/v1", modelId: "kimi-k3",
    effort: "max", supportedReasoningEfforts: ["max"], expected: { reasoning_effort: "max" } },
  { adapterType: "openrouter", baseUrl: "https://openrouter.ai/api/v1", modelId: "example/reasoning",
    effort: "high", supportedReasoningEfforts: ["low", "high"], expected: { reasoning: { effort: "high" } } },
  { adapterType: "deepseek", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-flash",
    effort: "high", expected: { reasoning_effort: "high", thinking: { type: "enabled" } } }
])("uses configured $effort on $adapterType in the probe and runtime", async ({
  adapterType, baseUrl, modelId, effort, supportedReasoningEfforts, expected
}) => {
  const discoveredModel: DiscoveredRemoteModel = { modelId, inferredCapability: "chat", supportedReasoningEfforts };
  const hostedOutput = JSON.stringify(new UniversalLlmProviderClient().synthesizeContextAwareResponse(input));
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject(expected);
    if (!request.stream) return Response.json({ choices: [{ message: { content: "OK" } }] });
    return providerStream(modelId, [{ content: hostedOutput }]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const config = { adapterType, baseUrl, discoveredModel, reasoningEffort: effort, maxTokens: 2048, apiKeys: ["test-key"] };
  await expect(probeUpstreamModelInstance({ ...config, modelId, capabilityKind: "chat" })).resolves.toMatchObject({ ok: true });
  await expect(new UniversalLlmProviderClient({ ...config, model: modelId }).generateDialogue(input)).resolves.toMatchObject({
    model_used: modelId
  });
});

it("plans independent Gemini input/output windows and Builtin local catalog without network", async () => {
  const plan = planDialogueWindow({
    model: "kimi-k3.1-pro", useCatalogContextWindow: true, useCatalogMaxOutputTokens: true,
    discoveredModel: { modelId: "kimi-k3.1-pro", inferredCapability: "chat", contextWindow: 1_048_576, maxOutputTokens: 1_048_576 }
  }, input, 8000);
  expect(plan?.maxInputTokens).toBeGreaterThan(8000);

  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchUpstreamProviderModels({ adapterType: "builtin_local", baseUrl: "local://guard" })).resolves.toMatchObject({
    ok: true, catalogSource: "built_in", models: [{ modelId: "safety-l0-guard-v1" }]
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
