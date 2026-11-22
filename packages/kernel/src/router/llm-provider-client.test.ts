import { afterEach, expect, it, vi } from "vitest";

import { UniversalLlmProviderClient, type LlmDialogueSynthesisInput } from "./llm-provider-client.js";

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

function providerStream(model: string, parts: { content?: string; reasoning_content?: string }[]): Response {
  const frame = (delta: object, finishReason: string | null) => ({
    id: "completion-test", model, created: 1, object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  });
  const frames = [...parts.map((part) => frame(part, null)), frame({}, "stop")];
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
