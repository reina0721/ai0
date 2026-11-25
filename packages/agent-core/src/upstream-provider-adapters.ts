
import {
  HOSTED_CHAT_PROVIDER_TEMPLATES,
  ReasoningEffortSchema,
  isAdaptiveClaudeModel,
  isOpenRouterBaseUrl,
  type DiscoveredRemoteModel,
  type ModelCapabilities,
  type ProviderAdapterType,
  type ProviderCapabilityKind,
  type ReasoningEffort
} from "@ai0/protocol";

const INTEGRATED_PROVIDER_BASE_URLS = new Map(
  HOSTED_CHAT_PROVIDER_TEMPLATES.map((template) => [template.adapterType, template.defaultBaseUrl])
);

export type IntegratedProvider = Extract<ProviderAdapterType, "opencode_go" | "command_code" | "openrouter" | "moonshot" | "zhipu">;

export function isIntegratedProvider(adapterType: ProviderAdapterType | undefined): adapterType is IntegratedProvider {
  return adapterType !== undefined && INTEGRATED_PROVIDER_BASE_URLS.has(adapterType);
}

export function integratedProviderBaseUrl(adapterType: IntegratedProvider): string | undefined {
  return INTEGRATED_PROVIDER_BASE_URLS.get(adapterType);
}

function openCodeGoRoot(baseUrl: string): string | undefined {
  const withoutModels = baseUrl.replace(/\/models$/u, "");
  return /\/inference\/go(?:\/(?:openai\/)?v1)?$/u.test(withoutModels)
    ? withoutModels.replace(/\/(?:openai\/)?v1$/u, "")
    : undefined;
}

export function resolveInferenceBaseUrl(adapterType: ProviderAdapterType | undefined, baseUrl: string): string {
  const openCode = adapterType === "opencode_go" ? openCodeGoRoot(baseUrl) : undefined;
  return openCode ? `${openCode}/openai/v1` : baseUrl;
}

export function resolveModelCatalogUrl(adapterType: ProviderAdapterType, baseUrl: string): string {
  const openCode = adapterType === "opencode_go" ? openCodeGoRoot(baseUrl) : undefined;
  if (openCode) return `${openCode}/v1/models`;
  return baseUrl.endsWith("/models") ? baseUrl : `${baseUrl}/models`;
}

const isKimiK3 = (modelId: string): boolean => /(?:^|\/)kimi-k3(?:[.-]|$)/iu.test(modelId);
const isFixedTemperatureKimi = (modelId: string): boolean =>
  /(?:^|\/)kimi-k(?:3|2\.[567])(?:[.-]|$)/iu.test(modelId);
const isGlm53 = (modelId: string): boolean => /^glm-5\.3(?:-|$)/iu.test(modelId);
const KIMI_K3_PUBLISHED_MODELS = new Set(["kimi-k3", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"]);

export function resolveChatProtocol(
  adapterType: ProviderAdapterType | undefined,
  modelId: string,
  discoveredModel?: DiscoveredRemoteModel
): "chat_completions" | "anthropic_messages" {
  if (adapterType === "anthropic") return "anthropic_messages";
  if (adapterType !== "command_code") return "chat_completions";
  return discoveredModel?.chatProtocol ?? (/^(?:anthropic\/)?claude[-/]/iu.test(modelId)
    ? "anthropic_messages"
    : "chat_completions");
}

export function withOpenCodeHeaders(
  adapterType: ProviderAdapterType | undefined,
  headers?: Readonly<Record<string, string>>,
  sessionId?: string
): Record<string, string> | undefined {
  if (adapterType !== "opencode_go") return headers;
  const result = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => {
    const lower = name.toLowerCase();
    return lower !== "user-agent" && (!sessionId || lower !== "x-opencode-session");
  }));
  return {
    ...result,
    "user-agent": "ai0-runtime/0.1.0",
    ...(sessionId ? { "x-opencode-session": sessionId } : {})
  };
}

export const makeOpenCodeSession = (): string => `ses_${crypto.randomUUID()}`;

export function adaptChatCompletionsRequest(
  adapterType: ProviderAdapterType | undefined,
  modelId: string,
  discoveredModel: DiscoveredRemoteModel | undefined,
  body: Record<string, unknown>,
  reasoningEffort?: ReasoningEffort,
  baseUrl?: string
): Record<string, unknown> {
  const { max_tokens, temperature, ...rest } = body;
  const openRouter = adapterType === "openrouter" || isOpenRouterBaseUrl(baseUrl);
  const openAiModel = /(?:^|\/)(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/iu.test(modelId);
  const useCompletionTokens = adapterType === "moonshot" ||
    (!!reasoningEffort && openAiModel && !openRouter && adapterType !== "ollama");
  const defaultEffort = (adapterType === "moonshot" && isKimiK3(modelId)) || (adapterType === "zhipu" && isGlm53(modelId))
    ? "low" : undefined;
  const effort = reasoningEffort ?? defaultEffort;
  const supportsTemperature = adapterType === "moonshot" || adapterType === "zhipu"
    ? discoveredModel?.supportsTemperature !== false && !isFixedTemperatureKimi(modelId)
    : !isIntegratedProvider(adapterType) || discoveredModel?.supportsTemperature === true;
  const sendTemperature = supportsTemperature &&
    !(effort && effort !== "none" && (openAiModel || adapterType === "deepseek"));
  return {
    ...rest,
    ...(useCompletionTokens ? { max_completion_tokens: max_tokens } : { max_tokens }),
    ...(sendTemperature && typeof temperature === "number" && Number.isFinite(temperature)
      ? { temperature: adapterType === "zhipu" ? Math.round(Math.max(0, Math.min(temperature, 1)) * 100) / 100 : temperature }
      : {}),
    ...(effort && !(adapterType === "deepseek" && effort === "none")
      ? (openRouter ? { reasoning: { effort } } : { reasoning_effort: effort }) : {}),
    ...(reasoningEffort && adapterType === "deepseek"
      ? { thinking: { type: reasoningEffort === "none" ? "disabled" : "enabled" } } : {})
  };
}

export function anthropicReasoningOptions(modelId: string, effort?: ReasoningEffort): {
  effort?: Exclude<ReasoningEffort, "none" | "minimal">;
  thinking?: { type: "disabled" | "adaptive" };
} | undefined {
  if (effort === "none") return { thinking: { type: "disabled" as const } };
  if (!effort || effort === "minimal") return undefined;
  return {
    effort,
    ...(isAdaptiveClaudeModel(modelId.split("/").at(-1) ?? modelId) ? { thinking: { type: "adaptive" as const } } : {})
  };
}

interface CatalogModelMetadata {
  inferredCapability?: ProviderCapabilityKind;
  capabilities?: Partial<ModelCapabilities>;
  chatProtocol?: DiscoveredRemoteModel["chatProtocol"];
  supportsTemperature?: boolean;
  contextWindow?: number;
  contextWindowIsInputLimit?: boolean;
  maxOutputTokens?: number;
  supportedReasoningEfforts?: ReasoningEffort[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function fetchOfficialZhipuModelCatalog(timeoutMs: number): Promise<Map<string, boolean>> {
  const response = await fetch("https://docs.bigmodel.cn/openapi/openapi.json", {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const document = asRecord(await response.json());
  const schemas = asRecord(asRecord(document?.components)?.schemas);
  const models = new Map<string, boolean>();
  for (const [schemaName, vision] of [["ChatCompletionTextRequest", false], ["ChatCompletionVisionRequest", true]] as const) {
    const properties = asRecord(asRecord(schemas?.[schemaName])?.properties);
    const modelEnum = asRecord(properties?.model)?.enum;
    if (!Array.isArray(modelEnum) || modelEnum.length === 0 || modelEnum.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("上游文档未包含有效的对话模型列表");
    }
    for (const modelId of modelEnum as string[]) models.set(modelId.trim(), vision);
  }
  return models;
}

function boolField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function tokenLimit(value: unknown, minimum = 1): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 4000000
    ? value : undefined;
}

function effortList(value: unknown): ReasoningEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.flatMap((item) => {
    const result = ReasoningEffortSchema.safeParse(item);
    return result.success ? [result.data] : [];
  }))];
}

export function parseCatalogModelMetadata(
  adapterType: ProviderAdapterType,
  modelId: string,
  entry: Record<string, unknown>,
  baseUrl?: string
): CatalogModelMetadata | undefined {
  const limits = asRecord(entry.limit);
  const contextWindow = tokenLimit(limits?.context, 512) ?? tokenLimit(entry.context_length, 512) ?? tokenLimit(entry.context_window, 512);
  const maxOutputTokens = tokenLimit(limits?.output) ?? tokenLimit(entry.max_output_tokens) ??
    tokenLimit(asRecord(entry.top_provider)?.max_completion_tokens);

  if (adapterType === "opencode_go") {
    if (typeof entry.type === "string" && entry.type !== "chat") return undefined;
    const inputs = asRecord(entry.modalities)?.input;
    const capabilities = asRecord(entry.capabilities);
    const reasoning = asRecord(capabilities?.reasoning);
    const efforts = effortList(reasoning?.effort);
    let supportedReasoningEfforts = efforts;
    if (reasoning?.supported === false) {
      supportedReasoningEfforts = [];
    } else if (reasoning?.toggle === true && !efforts?.includes("none")) {
      supportedReasoningEfforts = ["none", ...(efforts ?? [])];
    } else if (reasoning?.supported === true && reasoning.effort === undefined) {
      supportedReasoningEfforts = [];
    }
    return {
      inferredCapability: "chat",
      chatProtocol: "chat_completions",
      capabilities: {
        vision: Array.isArray(inputs) ? inputs.some((input) => typeof input === "string" && /^image(?:\/|$)/u.test(input)) : undefined,
        tools: boolField(asRecord(capabilities?.tools)?.supported),
        reasoning: boolField(reasoning?.supported)
      },
      supportsTemperature: boolField(capabilities?.temperature),
      contextWindow,
      maxOutputTokens,
      supportedReasoningEfforts
    };
  }

  if (adapterType === "command_code") {
    const endpoints = entry.supported_endpoints;
    const supportsTemperature = Array.isArray(entry.supported_parameters) ? entry.supported_parameters.includes("temperature") : undefined;
    let chatProtocol = resolveChatProtocol(adapterType, modelId);
    if (Array.isArray(endpoints)) {
      if (endpoints.includes("/chat/completions")) chatProtocol = "chat_completions";
      else if (endpoints.includes("/messages")) chatProtocol = "anthropic_messages";
      else return undefined;
    }
    return { inferredCapability: "chat", chatProtocol, supportsTemperature, contextWindow, maxOutputTokens };
  }

  if (adapterType === "openrouter") {
    const endpoints = entry.endpoints;
    if (Array.isArray(endpoints) && !endpoints.includes("/api/v1/chat/completions") && !endpoints.includes("/chat/completions")) return undefined;
    const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : undefined;
    const architecture = asRecord(entry.architecture);
    const inputs = architecture?.input_modalities;
    const outputs = architecture?.output_modalities;
    if (Array.isArray(outputs) && !outputs.includes("text")) return undefined;
    const reasoning = asRecord(entry.reasoning);
    const supportsEffortOptions = reasoning?.supported_efforts;
    const hasOfficialDetails = isOpenRouterBaseUrl(baseUrl) && (architecture !== undefined || parameters !== undefined);
    // The documented catalog omits unsupported controls. A bare compatibility row may not carry model metadata.
    const efforts = supportsEffortOptions === null ? [...ReasoningEffortSchema.options]
      : supportsEffortOptions === undefined && (reasoning || (entry.reasoning === undefined && hasOfficialDetails)) ? []
      : effortList(supportsEffortOptions);
    return {
      inferredCapability: "chat",
      chatProtocol: "chat_completions",
      capabilities: {
        vision: Array.isArray(inputs) ? inputs.includes("image") : undefined,
        tools: parameters ? parameters.includes("tools") : undefined,
        reasoning: reasoning ? true : parameters?.some((item) => item === "reasoning" || item === "reasoning_effort" || item === "include_reasoning")
      },
      supportsTemperature: parameters?.includes("temperature"),
      contextWindow,
      maxOutputTokens,
      supportedReasoningEfforts: reasoning?.mandatory === true ? efforts?.filter((effort) => effort !== "none") : efforts
    };
  }

  if (adapterType === "moonshot") {
    // Kimi's models list publishes context_length. Chat Completions documents this separate output limit for these IDs.
    const documentedOutputLimit = baseUrl === integratedProviderBaseUrl("moonshot") && KIMI_K3_PUBLISHED_MODELS.has(modelId)
      ? 1_048_576 : undefined;
    return {
      inferredCapability: "chat",
      chatProtocol: "chat_completions",
      capabilities: { vision: boolField(entry.supports_image_in), reasoning: boolField(entry.supports_reasoning) },
      supportsTemperature: isFixedTemperatureKimi(modelId) ? false : undefined,
      contextWindow,
      maxOutputTokens: maxOutputTokens ?? documentedOutputLimit
    };
  }

  if (adapterType === "zhipu") {
    const nonChat = /^(?:embedding|rerank|decision|image|video|audio|stt|tts|ocr|moderation)(?:$|[_-])/iu;
    if (typeof entry.type === "string" && nonChat.test(entry.type)) return undefined;
    if (/(?:embed|rerank|moderation|^glm-(?:tts|asr|image|ocr)|^cog(?:video|view))/iu.test(modelId)) return undefined;
    const hasDocumentedLimits = isGlm53(modelId) || modelId === "glm-5.2";
    return {
      inferredCapability: "chat",
      chatProtocol: "chat_completions",
      capabilities: isGlm53(modelId) ? { vision: /flash/iu.test(modelId), reasoning: true } : undefined,
      contextWindow: contextWindow ?? (hasDocumentedLimits ? 1000000 : undefined),
      maxOutputTokens: maxOutputTokens ?? (hasDocumentedLimits ? 131072 : undefined)
    };
  }

  if (adapterType === "gemini") {
    const methods = entry.supportedGenerationMethods;
    let inferredCapability: ProviderCapabilityKind | undefined;
    if (Array.isArray(methods)) {
      // Image, speech and Live auxiliaries may also advertise generateContent, but use other app entry points.
      const nonText = /(?:^|[-/])(?:imagen\d*|image|veo\d*|lyria\d*|audio|tts|live)(?:[-./]|$)/iu.test(modelId);
      if (methods.includes("generateContent") && !nonText) inferredCapability = "chat";
      else if (methods.includes("embedContent")) inferredCapability = "embedding";
      else return undefined;
    }
    const inputTokenLimit = tokenLimit(entry.inputTokenLimit, 512);
    return {
      inferredCapability,
      contextWindow: inputTokenLimit ?? contextWindow,
      contextWindowIsInputLimit: inputTokenLimit !== undefined ? true : undefined,
      maxOutputTokens: tokenLimit(entry.outputTokenLimit) ?? maxOutputTokens
    };
  }

  if (adapterType === "anthropic") {
    const capabilities = asRecord(entry.capabilities);
    const effort = asRecord(capabilities?.effort);
    const thinking = asRecord(capabilities?.thinking);
    const efforts = effort && ReasoningEffortSchema.options.filter((name) => asRecord(effort[name])?.supported === true);
    if (efforts && asRecord(asRecord(thinking?.types)?.disabled)?.supported === true && !efforts.includes("none")) {
      efforts.unshift("none");
    }
    return {
      contextWindow: tokenLimit(entry.max_input_tokens, 512) ?? contextWindow,
      maxOutputTokens: tokenLimit(entry.max_tokens) ?? maxOutputTokens,
      supportedReasoningEfforts: efforts,
      capabilities: { reasoning: boolField(thinking?.supported) }
    };
  }

  if (adapterType === "deepseek") {
    const efforts = effortList(asRecord(entry.effort)?.supported_levels);
    return { contextWindow, maxOutputTokens, supportedReasoningEfforts: efforts && ["none", ...efforts.filter((effort) => effort !== "none")] };
  }

  return { contextWindow, maxOutputTokens };
}
