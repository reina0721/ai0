import type { DiscoveredRemoteModel, ProviderAdapterType, ReasoningEffort } from "./orthogonal-config.js";

const standardEfforts = ["low", "medium", "high"] as const;
const broadEfforts = [...standardEfforts, "xhigh", "max"] as const;
const threeEfforts = ["low", "high", "max"] as const;

type ReasoningModelMetadata = Pick<DiscoveredRemoteModel, "chatProtocol" | "supportedReasoningEfforts">;

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  return /^https:\/\/(?:(?:eu|us)\.)?openrouter\.ai\/api\/v1\/?$/iu.test(baseUrl?.trim() ?? "");
}

export function isAdaptiveClaudeModel(modelId: string): boolean {
  return /^claude-(?:(?:opus|sonnet)-4-[6-9]|(?:opus|sonnet|haiku|fable|mythos)-5)(?:-|$)/iu.test(modelId);
}

function claudeEfforts(modelId: string): readonly ReasoningEffort[] {
  if (/^claude-opus-4-5(?:-|$)/u.test(modelId)) return standardEfforts;
  if (/^claude-(?:opus|sonnet)-4-6(?:-|$)/u.test(modelId)) return [...standardEfforts, "max"];
  if (isAdaptiveClaudeModel(modelId)) return broadEfforts;
  return [];
}

function openAiEfforts(modelId: string): readonly ReasoningEffort[] {
  if (/^gpt-6(?:\.[12])?-(?:luna|terra)(?:-|$)/u.test(modelId)) return ["none", ...broadEfforts];
  if (/^gpt-6(?:\.[12])?-(?:astra|sol)(?:-|$)/u.test(modelId)) return broadEfforts;
  if (/^gpt-5(?:\.[1-6]|-(?:mini|nano|codex)|$)(?:-|$)/u.test(modelId) && !/-(?:pro|chat)(?:-|$)/u.test(modelId)) {
    if (/^gpt-5\.6(?:-|$)/u.test(modelId)) return ["none", ...broadEfforts];
    if (/^gpt-5\.[23]-codex(?:-|$)/u.test(modelId)) return [...standardEfforts, "xhigh"];
    if (/^gpt-5\.[245](?:-|$)/u.test(modelId)) return ["none", ...standardEfforts, "xhigh"];
    if (/^gpt-5\.1(?:-|$)/u.test(modelId)) return ["none", ...standardEfforts];
    return ["minimal", ...standardEfforts];
  }
  return /^(?:o1|o3|o4-mini)(?:-|$)/u.test(modelId) && !/-(?:pro|preview)(?:-|$)/u.test(modelId)
    ? standardEfforts : [];
}

function deepSeekEfforts(modelId: string): readonly ReasoningEffort[] {
  if (/^deepseek-v4-pro(?:-|$)/u.test(modelId)) return ["none", "high", "max"];
  if (/^deepseek-(?:flash|v4(?:\.1)?-flash|chat|reasoner)(?:-|$)/u.test(modelId)) return ["none", ...threeEfforts];
  return [];
}

function zhipuEfforts(modelId: string): readonly ReasoningEffort[] {
  if (/^glm-5\.[34](?:-|$)/u.test(modelId)) return threeEfforts;
  if (/^glm-5\.2(?:-|$)/u.test(modelId)) return ["none", "high", "max"];
  return [];
}

function geminiEfforts(modelId: string): readonly ReasoningEffort[] {
  if (/^gemini-4-(?:neon|hydrogen)(?:-|$)/u.test(modelId)) return [...standardEfforts, "xhigh"];
  if (/^gemini-3(?:\.\d+)?-pro(?:-|$)/u.test(modelId)) return ["low", "high"];
  if (/^gemini-2\.5-flash(?:-|$)/u.test(modelId)) return ["none", ...standardEfforts];
  return /^gemini-(?:2\.5-pro|3(?:\.\d+)?-flash|4-)(?:\b|$)/u.test(modelId) ? standardEfforts : [];
}

export function getSupportedReasoningEfforts(
  adapterType: ProviderAdapterType | undefined,
  modelId: string,
  metadata?: ReasoningModelMetadata,
  baseUrl?: string
): readonly ReasoningEffort[] {
  const id = modelId.toLowerCase().split("/").at(-1) ?? "";
  const usesMessages = adapterType === "anthropic" || (adapterType === "command_code" &&
    (metadata?.chatProtocol === "anthropic_messages" || (!metadata?.chatProtocol && id.startsWith("claude-"))));
  if (metadata?.supportedReasoningEfforts) {
    return usesMessages
      ? metadata.supportedReasoningEfforts.filter((effort) => effort !== "minimal")
      : metadata.supportedReasoningEfforts;
  }
  if (usesMessages) return claudeEfforts(id);
  if (adapterType === "openrouter" || adapterType === "opencode_go" || isOpenRouterBaseUrl(baseUrl)) return [];
  if (adapterType === "moonshot") return /^kimi-k3(?:[.-]|$)/u.test(id) ? threeEfforts : [];
  if (adapterType === "zhipu") return zhipuEfforts(id);
  if (adapterType === "deepseek" || /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/iu.test(baseUrl?.trim() ?? "")) {
    return deepSeekEfforts(id);
  }
  if (adapterType === "gemini") return geminiEfforts(id);
  if (adapterType === "ollama") return /^gpt-oss(?:[:.-]|$)/u.test(id) ? standardEfforts : [];
  if (adapterType === "command_code") {
    if (/^kimi-k3(?:[.-]|$)/u.test(id)) return threeEfforts;
    if (id.startsWith("glm-")) return zhipuEfforts(id);
    if (id.startsWith("gemini-")) return geminiEfforts(id);
    if (id.startsWith("deepseek-")) return deepSeekEfforts(id);
  }
  return adapterType === "openai_compatible" || adapterType === "command_code" || adapterType === undefined
    ? openAiEfforts(id) : [];
}
