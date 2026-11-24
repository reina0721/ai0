import { expect, it } from "vitest";

import { getSupportedReasoningEfforts } from "./model-reasoning.js";

it("uses gateway effort metadata instead of assuming native model support", () => {
  expect(getSupportedReasoningEfforts("opencode_go", "kimi-k3", { supportedReasoningEfforts: ["max"] })).toEqual(["max"]);
  expect(getSupportedReasoningEfforts("moonshot", "kimi-k3")).toEqual(["low", "high", "max"]);
  expect(getSupportedReasoningEfforts("moonshot", "kimi-k2.7-code")).toEqual([]);
  expect(getSupportedReasoningEfforts("moonshot", "kimi-k3", { supportedReasoningEfforts: [] })).toEqual([]);
  expect(getSupportedReasoningEfforts("openai_compatible", "gpt-5.5", undefined, "https://openrouter.ai/api/v1")).toEqual([]);
});

it("only offers levels allowed by known models without catalog metadata", () => {
  expect(getSupportedReasoningEfforts("command_code", "claude-sonnet-4-6")).toEqual(["low", "medium", "high", "max"]);
  expect(getSupportedReasoningEfforts("command_code", "gpt-5.3-codex")).toEqual(["low", "medium", "high", "xhigh"]);
  expect(getSupportedReasoningEfforts("anthropic", "claude-sonnet-4-5")).toEqual([]);
  expect(getSupportedReasoningEfforts("deepseek", "deepseek-v4-pro")).toEqual(["none", "high", "max"]);
  expect(getSupportedReasoningEfforts("zhipu", "glm-5.3-flash")).toEqual(["low", "high", "max"]);
});
