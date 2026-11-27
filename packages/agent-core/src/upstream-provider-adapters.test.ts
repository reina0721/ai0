import { expect, it } from "vitest";

import { parseCatalogModelMetadata } from "./index.js";

it("reads published Gemini input and output ceilings, leaving bare compatibility rows unknown", () => {
  expect(parseCatalogModelMetadata("gemini", "gemini-3.8-flash", {
    name: "models/gemini-3.8-flash", inputTokenLimit: 1_048_576, outputTokenLimit: 65_536
  })).toMatchObject({ contextWindow: 1_048_576, maxOutputTokens: 65_536 });
  expect(parseCatalogModelMetadata("gemini", "gemini-3.8-flash", {})).toMatchObject({
    contextWindow: undefined, maxOutputTokens: undefined
  });
});

it("uses the documented Moonshot K3 output ceiling only with the official endpoint and exact model ID", () => {
  const modelId = "kimi-k3.1-pro";
  const baseUrl = "https://api.moonshot.cn/v1";
  const entry = { context_length: 1_048_576 };
  expect(parseCatalogModelMetadata("moonshot", modelId, entry, baseUrl))
    .toMatchObject({ contextWindow: 1_048_576, maxOutputTokens: 1_048_576 });
  expect(parseCatalogModelMetadata("moonshot", modelId, { ...entry, max_output_tokens: 8_192 }, baseUrl))
    .toMatchObject({ maxOutputTokens: 8_192 });
  expect(parseCatalogModelMetadata("moonshot", modelId, entry, "https://proxy.example/v1")?.maxOutputTokens).toBeUndefined();
  expect(parseCatalogModelMetadata("moonshot", "kimi-k2.7-code", { context_length: 262_144 }, baseUrl)?.maxOutputTokens).toBeUndefined();
});

it("applies documented GLM-5.2 limits and prefers numeric catalog values", () => {
  expect(parseCatalogModelMetadata("zhipu", "glm-5.2", {})).toMatchObject({
    contextWindow: 1_000_000, maxOutputTokens: 131_072
  });
  expect(parseCatalogModelMetadata("zhipu", "glm-5.2", { context_length: 131_072, max_output_tokens: 8_192 }))
    .toMatchObject({ contextWindow: 131_072, maxOutputTokens: 8_192 });
});

it("keeps unpublished Command Code output and Ollama tag limits unknown", () => {
  expect(parseCatalogModelMetadata("command_code", "claude-sonnet-5-5", {
    context_length: 1_000_000, supported_endpoints: ["/messages"]
  })).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: undefined });
  expect(parseCatalogModelMetadata("ollama", "gemma4", {
    name: "gemma4", size: 9_608_350_245, details: { parameter_size: "8.0B" }
  })).toMatchObject({ contextWindow: undefined, maxOutputTokens: undefined });
});
