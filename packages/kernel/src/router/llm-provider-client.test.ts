import { afterEach, expect, it, vi } from "vitest";

import type { DiscoveredRemoteModel, ProviderAdapterType, ReasoningEffort } from "@ai0/protocol";

import {
  UniversalLlmProviderClient,
  fetchUpstreamProviderModels,
  planDialogueWindow,
  probeUpstreamModelInstance,
  type LlmDialogueSynthesisInput
} from "./llm-provider-client.js";

const input: LlmDialogueSynthesisInput = {
  userText: "你好",
  compiledBlackboardText: "",
  personaName: "Mio",
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

it("uses the official DeepSeek adapter, validates the assembled object, and discards provider reasoning", async () => {
  const output = JSON.stringify({
    surface_utterance: "真实回复 🌙",
    theatrical_subtext: "虚构角色提示",
    masked_placeholder: "表演提示",
    chosen_strategy: "自然回应",
    interaction_frame: "gentle_support",
    vocal_emotion_tag: "warm",
    facial_expression: "smile",
    valence_impulse: "none",
    provider_used: "ignored-provider-claim",
    model_used: "ignored-model-claim"
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
  for (const count of [undefined, 0]) {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("deepseek-flash", [{ content: output }],
      { prompt_tokens: 12, completion_tokens: 3, prompt_cache_hit_tokens: count })));
    expect((await client.generateDialogue(input)).usage?.cachedInputTokens).toBe(count);
  }
});

it("falls back on invalid remote output but stops an explicitly cancelled provider request", async () => {
  const client = new UniversalLlmProviderClient({
    apiKey: "test-key",
    baseUrl: "https://compatible.example/v1"
  });
  vi.stubGlobal("fetch", vi.fn(async () => providerStream("local-default", [{ content: "{}" }])));
  await expect(client.generateDialogue(input)).resolves.toMatchObject({ provider_used: "local-persona-synthesizer" });

  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => {
    controller.abort(new Error("cancelled by the caller"));
    throw new DOMException("Aborted", "AbortError");
  }));
  await expect(client.generateDialogue(input, controller.signal)).rejects.toThrow("cancelled by the caller");
});

it("rotates and fails over across multiple API keys in UniversalLlmProviderClient", async () => {
  const validOutput = JSON.stringify({
    surface_utterance: "第二把密钥成功回复",
    theatrical_subtext: "主 Key 限流后自动故障转移",
    masked_placeholder: "遮罩",
    chosen_strategy: "failover_ok",
    interaction_frame: "gentle_support",
    vocal_emotion_tag: "warm",
    facial_expression: "smile",
    valence_impulse: "none",
    provider_used: "openai-compatible",
    model_used: "gpt-4.1-mini"
  });
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
  expect(result.surface_utterance).toBe("第二把密钥成功回复");
  expect(seenAuth).toEqual(["Bearer sk-key-1", "Bearer sk-key-2"]);
});

it("fetches remote models from OpenAI /models and Ollama /api/tags and probes model instances", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "deepseek-reasoner", owned_by: "deepseek" },
            { id: "BAAI/bge-m3", owned_by: "baai" }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/api/tags")) {
      return new Response(
        JSON.stringify({ models: [{ name: "qwen2.5:7b-instruct" }, { name: "nomic-embed-text" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/chat/completions")) {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth === "Bearer sk-bad") {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/embeddings")) {
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  }));

  const openaiFetch = await fetchUpstreamProviderModels({
    adapterType: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    apiKeys: ["sk-good"]
  });
  expect(openaiFetch.ok).toBe(true);
  expect(openaiFetch.models.find((m) => m.modelId === "deepseek-reasoner")?.capabilities?.reasoning).toBe(true);
  expect(openaiFetch.models.find((m) => m.modelId === "BAAI/bge-m3")?.inferredCapability).toBe("embedding");

  const ollamaFetch = await fetchUpstreamProviderModels({
    adapterType: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1"
  });
  expect(ollamaFetch.ok).toBe(true);
  expect(ollamaFetch.models.map((m) => m.modelId)).toEqual(["nomic-embed-text", "qwen2.5:7b-instruct"]);

  const chatProbe = await probeUpstreamModelInstance({
    adapterType: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    modelId: "gpt-4.1-mini",
    capabilityKind: "chat",
    apiKeys: ["sk-bad", "sk-good"]
  });
  expect(chatProbe.ok).toBe(true);
  expect(chatProbe.status).toBe("ready");
  expect(chatProbe.lastResponseSnippet).toBe("OK");

  const embedProbe = await probeUpstreamModelInstance({
    adapterType: "openai_compatible",
    baseUrl: "https://api.example.com/v1",
    modelId: "bge-m3",
    capabilityKind: "embedding",
    apiKeys: ["sk-good"]
  });
  expect(embedProbe.ok).toBe(true);
  expect(embedProbe.detail).toContain("4 维");
});

const hostedOutput = JSON.stringify({
  surface_utterance: "独立上游回复",
  theatrical_subtext: "角色的简短内心活动",
  masked_placeholder: "遮罩",
  chosen_strategy: "hosted_reply",
  interaction_frame: "gentle_support",
  vocal_emotion_tag: "warm",
  facial_expression: "smile",
  valence_impulse: "none",
  provider_used: "ignored",
  model_used: "ignored"
});

it.each([
  {
    adapterType: "opencode_go" as const,
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    catalogUrl: "https://opencode.ai/inference/go/v1/models",
    entry: {
      id: "kimi-k3", type: "chat", modalities: { input: ["image/png"] },
      capabilities: { reasoning: { supported: true }, tools: { supported: false }, temperature: false }
    },
    ignored: [{ id: "decision", type: "decision" }, { id: "text-embedding-3-small", type: "embedding" }],
    vision: true,
    sentTemperature: undefined,
    tokenParameter: "max_tokens",
    reasoningEffort: undefined
  },
  {
    adapterType: "command_code" as const,
    baseUrl: "https://api.commandcode.ai/provider/v1",
    catalogUrl: "https://api.commandcode.ai/provider/v1/models",
    entry: { id: "deepseek/deepseek-v4-flash", supported_endpoints: ["/responses", "/chat/completions"] },
    ignored: [{ id: "responses-only", supported_endpoints: ["/responses"] }],
    vision: false,
    sentTemperature: undefined,
    tokenParameter: "max_tokens",
    reasoningEffort: undefined
  },
  {
    adapterType: "openrouter" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    catalogUrl: "https://openrouter.ai/api/v1/models",
    entry: {
      id: "example/text-model", endpoints: ["/api/v1/chat/completions"],
      architecture: { input_modalities: ["image"], output_modalities: ["text"] }, supported_parameters: ["tools", "temperature"]
    },
    ignored: [
      { id: "only-image", architecture: { output_modalities: ["image"] } },
      { id: "responses-only", endpoints: ["/api/v1/responses"] }
    ],
    vision: true,
    sentTemperature: 0.75,
    tokenParameter: "max_tokens",
    reasoningEffort: undefined
  },
  {
    adapterType: "moonshot" as const,
    baseUrl: "https://api.moonshot.cn/v1",
    catalogUrl: "https://api.moonshot.cn/v1/models",
    entry: { id: "kimi-k3.1-pro", supports_image_in: true, supports_reasoning: true },
    ignored: [],
    vision: true,
    sentTemperature: undefined,
    tokenParameter: "max_completion_tokens",
    reasoningEffort: "low"
  },
  {
    adapterType: "zhipu" as const,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    catalogUrl: "https://open.bigmodel.cn/api/paas/v4/models",
    entry: { id: "glm-5.3" },
    ignored: [{ id: "embedding-3" }, { id: "anything", type: "video" }],
    vision: false,
    sentTemperature: 0.75,
    tokenParameter: "max_tokens",
    reasoningEffort: "low"
  }
])("discovers, probes and routes $adapterType models", async ({
  adapterType, baseUrl, catalogUrl, entry, ignored, vision, sentTemperature, tokenParameter, reasoningEffort
}) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    if (init?.method === "GET") {
      expect(url).toBe(catalogUrl);
      return Response.json({ data: [entry, ...ignored] });
    }
    expect(url).toBe(`${baseUrl}/chat/completions`);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(entry.id);
    expect(body.reasoning_effort).toBe(reasoningEffort);
    if (adapterType === "opencode_go") {
      expect(headers.get("user-agent")).toContain("ai0-runtime/");
      expect(headers.get("x-opencode-session")).toMatch(/^ses_/u);
    }
    if (!body.stream) {
      expect(body[tokenParameter]).toBe(1024);
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    }
    expect(body[tokenParameter]).toBe(256);
    expect(body.temperature).toBe(sentTemperature);
    if (adapterType === "moonshot") expect(body).not.toHaveProperty("max_tokens");
    if (adapterType === "opencode_go") expect(headers.get("x-opencode-session")).toBe("ses_test_dialogue");
    return providerStream(entry.id, [{ content: hostedOutput }]);
  });
  vi.stubGlobal("fetch", fetchMock);

  const catalog = await fetchUpstreamProviderModels({ adapterType, baseUrl, apiKeys: ["test-key"] });
  expect(catalog).toMatchObject({ ok: true, catalogSource: "upstream" });
  expect(catalog.models).toEqual([expect.objectContaining({
    modelId: entry.id, inferredCapability: "chat", capabilities: expect.objectContaining({ vision })
  })]);
  const [discoveredModel] = catalog.models;

  await expect(probeUpstreamModelInstance({
    adapterType, baseUrl, modelId: entry.id, capabilityKind: "chat", discoveredModel, apiKeys: ["test-key"]
  })).resolves.toMatchObject({ ok: true, lastResponseSnippet: "OK" });

  const client = new UniversalLlmProviderClient({
    adapterType, baseUrl, model: entry.id, apiKey: "test-key",
    discoveredModel, sessionId: "ses_test_dialogue", temperature: 0.75, maxTokens: 256
  });
  await expect(client.generateDialogue(input)).resolves.toMatchObject({
    provider_used: adapterType, model_used: entry.id, surface_utterance: "独立上游回复"
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
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
  { adapterType: "moonshot", baseUrl: "https://api.moonshot.cn/v1", modelId: "kimi-k3.1-pro",
    effort: "high", expected: { reasoning_effort: "high" } },
  { adapterType: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelId: "glm-5.3",
    effort: "max", expected: { reasoning_effort: "max" } },
  { adapterType: "deepseek", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-flash",
    effort: "high", expected: { reasoning_effort: "high", thinking: { type: "enabled" } } },
  { adapterType: "deepseek", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-flash",
    effort: "none", expected: { thinking: { type: "disabled" } } },
  { adapterType: "command_code", baseUrl: "https://api.commandcode.ai/provider/v1", modelId: "gpt-5.5",
    effort: "xhigh", expected: { reasoning_effort: "xhigh", max_completion_tokens: 2048 } }
])("uses configured $effort on $adapterType in the probe and runtime", async ({
  adapterType, baseUrl, modelId, effort, supportedReasoningEfforts, expected
}) => {
  const discoveredModel: DiscoveredRemoteModel = { modelId, inferredCapability: "chat", supportedReasoningEfforts };
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject(expected);
    if (!request.stream) {
      expect(request.max_completion_tokens ?? request.max_tokens).toBe(2048);
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    }
    return providerStream(modelId, [{ content: hostedOutput }]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const config = { adapterType, baseUrl, discoveredModel, reasoningEffort: effort, maxTokens: 2048, apiKeys: ["test-key"] };
  await expect(probeUpstreamModelInstance({ ...config, modelId, capabilityKind: "chat" })).resolves.toMatchObject({ ok: true });
  await expect(new UniversalLlmProviderClient({ ...config, model: modelId }).generateDialogue(input)).resolves.toMatchObject({
    model_used: modelId, surface_utterance: "独立上游回复"
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("reads real provider catalog metadata without replacing the configured context window", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{
      id: "kimi-k3", type: "chat", limit: { context: 1048576, output: 1048576 },
      capabilities: { reasoning: { supported: true, effort: ["max", "default", "max"] } }
    }] }))
    .mockResolvedValueOnce(Response.json({ data: [{
      id: "google/gemini-4-neon", context_length: 1048576, top_provider: { max_completion_tokens: 65536 },
      reasoning: { supported_efforts: ["none", "low", "high"], mandatory: true }
    }] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchUpstreamProviderModels({ adapterType: "opencode_go", baseUrl: "https://opencode.ai/inference/go/openai/v1" }))
    .resolves.toMatchObject({ models: [{ contextWindow: 1048576, maxOutputTokens: 1048576, supportedReasoningEfforts: ["max"] }] });
  await expect(fetchUpstreamProviderModels({ adapterType: "openai_compatible", baseUrl: "https://openrouter.ai/api/v1" }))
    .resolves.toMatchObject({ models: [{ contextWindow: 1048576, maxOutputTokens: 65536, supportedReasoningEfforts: ["low", "high"] }] });
});

const geminiOpenAiBase = "https://generativelanguage.googleapis.com/v1beta/openai";
const geminiNativeCatalog = "https://generativelanguage.googleapis.com/v1beta/models";

it("keeps Gemini's published input and output limits independent in real requests", async () => {
  const model = "gemini-3.8-flash";
  const output = JSON.stringify(new UniversalLlmProviderClient().synthesizeContextAwareResponse(input));
  const requests = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 2048 });
    return providerStream(model, [{ content: output }]);
  });
  vi.stubGlobal("fetch", requests);
  const config = {
    adapterType: "gemini" as const, baseUrl: geminiOpenAiBase, apiKey: "test-key", model,
    useCatalogContextWindow: true, useCatalogMaxOutputTokens: true,
    discoveredModel: { modelId: model, inferredCapability: "chat" as const,
      contextWindow: 1200, contextWindowIsInputLimit: true, maxOutputTokens: 2048 }
  };
  expect(planDialogueWindow(config, input, 8000)).toEqual({ maxInputTokens: 1200, useModelWindow: true });
  const client = new UniversalLlmProviderClient(config);
  await expect(client.generateDialogue(input)).resolves.toMatchObject({ model_used: model });
  await expect(client.generateDialogue({ ...input, userText: "text ".repeat(1000) }))
    .rejects.toMatchObject({ code: "MODEL_CONTEXT_LIMIT" });
  expect(requests).toHaveBeenCalledTimes(1);
});

it("retains room for history when catalog output can occupy the entire context window", () => {
  const modelId = "kimi-k3.1-pro";
  const plan = planDialogueWindow({
    model: modelId, useCatalogContextWindow: true, useCatalogMaxOutputTokens: true,
    discoveredModel: { modelId, inferredCapability: "chat", contextWindow: 1_048_576, maxOutputTokens: 1_048_576 }
  }, input, 8000);
  expect(plan?.maxInputTokens).toBeGreaterThan(8000);
});

it("discovers official Gemini models through the native paginated interface", async () => {
  const catalogFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("gemini-test-key");
    expect(headers.get("authorization")).toBeNull();
    expect(init?.redirect).toBe("error");
    if (url === geminiNativeCatalog) return Response.json({
      models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
        { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.0-flash-live", supportedGenerationMethods: ["bidiGenerateContent"] },
        { name: "models/veo-3.1-generate-preview", supportedGenerationMethods: ["predictLongRunning"] }
      ],
      nextPageToken: "page&2"
    });
    expect(url).toBe(`${geminiNativeCatalog}?pageToken=page%262`);
    return Response.json({ models: [
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 },
      { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"], inputTokenLimit: 2_048, outputTokenLimit: 1 }
    ] });
  });
  vi.stubGlobal("fetch", catalogFetch);

  const result = await fetchUpstreamProviderModels({ adapterType: "gemini", baseUrl: `${geminiOpenAiBase}/`, apiKeys: ["gemini-test-key"] });
  expect(result).toMatchObject({ ok: true, models: [
    { modelId: "gemini-3.8-flash", inferredCapability: "chat", contextWindow: 1_048_576, contextWindowIsInputLimit: true, maxOutputTokens: 65_536 },
    { modelId: "gemini-embedding-001", inferredCapability: "embedding", contextWindow: 2_048, contextWindowIsInputLimit: true }
  ] });
  expect(catalogFetch).toHaveBeenCalledTimes(2);
});

it("falls back to the official Gemini compatibility directory after native authentication fails", async () => {
  const catalogFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url === geminiNativeCatalog) {
      expect(headers.get("x-goog-api-key")).toBe("gemini-test-key");
      return new Response(null, { status: 403 });
    }
    expect(url).toBe(`${geminiOpenAiBase}/models`);
    expect(headers.get("authorization")).toBe("Bearer gemini-test-key");
    expect(headers.get("x-goog-api-key")).toBeNull();
    return Response.json({ data: [{ id: "gemini-flash", context_length: 65_536, max_output_tokens: 8_192 }] });
  });
  vi.stubGlobal("fetch", catalogFetch);

  const result = await fetchUpstreamProviderModels({ adapterType: "gemini", baseUrl: geminiOpenAiBase, apiKeys: ["gemini-test-key"] });
  expect(result).toMatchObject({ ok: true, models: [{ modelId: "gemini-flash", contextWindow: 65_536, maxOutputTokens: 8_192 }] });
  expect(result.models[0]?.contextWindowIsInputLimit).toBeUndefined();
  expect(catalogFetch).toHaveBeenCalledTimes(2);
});

it("leaves discovery for a custom Gemini endpoint on its configured compatibility path", async () => {
  const baseUrl = "https://custom-gemini.example/v1";
  const catalogFetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe(`${baseUrl}/models`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gemini-test-key");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
    return Response.json({ data: [{ id: "gemini-custom-model" }] });
  });
  vi.stubGlobal("fetch", catalogFetch);
  await expect(fetchUpstreamProviderModels({ adapterType: "gemini", baseUrl, apiKeys: ["gemini-test-key"] }))
    .resolves.toMatchObject({ ok: true, models: [{ modelId: "gemini-custom-model" }] });
  expect(catalogFetch).toHaveBeenCalledTimes(1);
});

it("distinguishes known unsupported Go effort from degraded catalog metadata", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [
    { id: "degraded" },
    { id: "unsupported", capabilities: { reasoning: { supported: false } } },
    { id: "budget-only", capabilities: { reasoning: { supported: true, budget: { max: 8192 } } } },
    { id: "toggle-only", capabilities: { reasoning: { supported: true, toggle: true } } },
    { id: "selectable", capabilities: { reasoning: { supported: true, effort: ["max"] } } }
  ] })));
  const result = await fetchUpstreamProviderModels({ adapterType: "opencode_go", baseUrl: "https://opencode.ai/inference/go/openai/v1" });
  expect(result.ok).toBe(true);
  const efforts = new Map(result.models.map((model) => [model.modelId, model.supportedReasoningEfforts]));
  expect(efforts).toEqual(new Map([
    ["budget-only", []], ["degraded", undefined], ["selectable", ["max"]], ["toggle-only", ["none"]], ["unsupported", []]
  ]));
});

it("distinguishes OpenRouter effort support, documented omissions, and bare compatibility rows", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [
    { id: "example/bare" },
    { id: "example/non-reasoning", architecture: { output_modalities: ["text"] }, supported_parameters: ["temperature"] },
    { id: "example/budget-only", reasoning: { supports_max_tokens: true } },
    { id: "example/all-levels", reasoning: { supported_efforts: null } },
    { id: "example/mandatory", reasoning: { supported_efforts: ["none", "high"], mandatory: true } }
  ] })));
  const result = await fetchUpstreamProviderModels({ adapterType: "openrouter", baseUrl: "https://openrouter.ai/api/v1" });
  expect(result.ok).toBe(true);
  const efforts = new Map(result.models.map((model) => [model.modelId, model.supportedReasoningEfforts]));
  expect(efforts).toEqual(new Map([
    ["example/all-levels", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
    ["example/bare", undefined], ["example/budget-only", []], ["example/mandatory", ["high"]], ["example/non-reasoning", []]
  ]));
});

it.each(["example/messages-only", "claude-sonnet-4-6"])("uses Command Code bearer-authenticated Anthropic messages for %s", async (modelId) => {
  const adapterType = "command_code";
  const baseUrl = "https://api.commandcode.ai/provider/v1";
  const reasoningEffort = modelId === "claude-sonnet-4-6" ? "high" as const : undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: modelId, supported_endpoints: ["/messages"] }] });
    expect(url).toBe(`${baseUrl}/messages`);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("x-api-key")).toBeNull();
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("temperature");
    if (reasoningEffort) {
      expect(body.output_config).toEqual({ effort: "high" });
      expect(body.thinking.type).toBe("adaptive");
    }
    if (!body.stream) {
      return Response.json({ content: [{ type: "thinking", thinking: "ignored" }, { type: "text", text: "OK" }] });
    }
    const frames = [
      { type: "message_start", message: { id: "m", model: modelId, usage: { input_tokens: 1 }, content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: hostedOutput } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" }
    ];
    return new Response(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" }
    });
  }));

  const { models: [discoveredModel] } = await fetchUpstreamProviderModels({ adapterType, baseUrl });
  expect(discoveredModel?.chatProtocol).toBe("anthropic_messages");
  await expect(probeUpstreamModelInstance({ adapterType, baseUrl, modelId, apiKeys: ["test-key"], capabilityKind: "chat", discoveredModel, reasoningEffort }))
    .resolves.toMatchObject({ ok: true, lastResponseSnippet: "OK" });
  const client = new UniversalLlmProviderClient({ adapterType, baseUrl, model: modelId, apiKey: "test-key", discoveredModel, temperature: 0.75, reasoningEffort });
  await expect(client.generateDialogue(input)).resolves.toMatchObject({ provider_used: adapterType, model_used: modelId });
});

it("rejects misleading hosted catalog and probe responses", async () => {
  const baseUrl = "https://open.bigmodel.cn/api/paas/v4";
  const adapterType = "zhipu";
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: { message: "service unavailable" } }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { reasoning_content: "no final answer" } }] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchUpstreamProviderModels({ adapterType, baseUrl })).resolves.toMatchObject({ ok: false, models: [] });
  await expect(probeUpstreamModelInstance({ adapterType, baseUrl, modelId: "glm-5.3", capabilityKind: "chat", apiKeys: ["test-key"] }))
    .resolves.toMatchObject({ ok: false, status: "error", httpStatus: 200 });
});

const zhipuStandardBase = "https://open.bigmodel.cn/api/paas/v4";

it.each([404, 405])("reads the GLM official catalog without credentials after standard upstream %i", async (status) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (url === `${zhipuStandardBase}/models`) {
      expect(headers.get("authorization")).toBe("Bearer test-key");
      expect(headers.get("x-custom-secret")).toBe("custom-value");
      return new Response(null, { status });
    }
    expect(url).toBe("https://docs.bigmodel.cn/openapi/openapi.json");
    expect(Array.from(headers)).toEqual([["accept", "application/json"]]);
    return Response.json({
      components: {
        schemas: {
          ChatCompletionTextRequest: { properties: { model: { enum: ["glm-5.3", "glm-5.3-flash"] } } },
          ChatCompletionVisionRequest: { properties: { model: { enum: ["glm-5.3-flash", "glm-4.6v"] } } },
          ChatCompletionAudioRequest: { properties: { model: { enum: ["glm-4-voice"] } } }
        }
      }
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await fetchUpstreamProviderModels({
    adapterType: "zhipu", baseUrl: `${zhipuStandardBase}/`, apiKeys: ["test-key"], customHeaders: { "X-Custom-Secret": "custom-value" }
  });
  expect(result).toMatchObject({
    ok: true,
    catalogSource: "official_docs",
    models: [
      { modelId: "glm-4.6v", inferredCapability: "chat", capabilities: { vision: true } },
      { modelId: "glm-5.3", inferredCapability: "chat", capabilities: { vision: false } },
      { modelId: "glm-5.3-flash", inferredCapability: "chat", capabilities: { vision: true } }
    ]
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  [zhipuStandardBase, 401],
  [zhipuStandardBase, 403],
  [zhipuStandardBase, 429],
  [zhipuStandardBase, 503],
  ["https://proxy.example/paas/v4", 404]
])("keeps the original catalog failure from %s status %i", async (baseUrl, status) => {
  const fetchMock = vi.fn(async () => new Response("upstream failure", { status }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await fetchUpstreamProviderModels({ adapterType: "zhipu", baseUrl, apiKeys: ["test-key"] });
  expect(result).toMatchObject({ ok: false, httpStatus: status, models: [], detail: expect.stringContaining("upstream failure") });
  expect(result.catalogSource).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps the original GLM error when the fallback document is malformed", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ components: { schemas: {} } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchUpstreamProviderModels({ adapterType: "zhipu", baseUrl: zhipuStandardBase })).resolves.toMatchObject({
    ok: false, models: [], httpStatus: 404, detail: expect.stringContaining("智谱官方文档目录读取失败")
  });
});

it("labels the catalog for the built-in model without making a network request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchUpstreamProviderModels({ adapterType: "builtin_local", baseUrl: "local://guard" })).resolves.toMatchObject({
    ok: true, catalogSource: "built_in", models: [{ modelId: "safety-l0-guard-v1" }]
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
