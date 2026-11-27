import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, jsonSchema, streamText, tool, type ModelMessage, type LanguageModelUsage } from "ai";
import type { AgentModelAdapter, AgentModelEvent, PreparedAgentRequest } from "@ai0/protocol";
import { tracePreparedRequest, traceStructuredRequest, type ModelTraceLease, type StructuredRequestTrace } from "./model-request-trace.js";
export * from "./model-request-trace.js";

import { getSupportedReasoningEfforts, isOpenRouterBaseUrl } from "@ai0/protocol";

import type {
  ChannelTokenUsage,
  DiscoveredRemoteModel,
  KeyRotationStrategy,
  ModelCapabilities,
  ProviderAdapterType,
  ProviderCapabilityKind,
  ProviderCatalogSource,
  ReasoningEffort,
} from "@ai0/protocol";

import {
  adaptChatCompletionsRequest,
  anthropicReasoningOptions,
  fetchOfficialZhipuModelCatalog,
  integratedProviderBaseUrl,
  isIntegratedProvider,
  makeOpenCodeSession,
  parseCatalogModelMetadata,
  resolveChatProtocol,
  resolveInferenceBaseUrl,
  resolveModelCatalogUrl,
  withOpenCodeHeaders,
  type IntegratedProvider
} from "./upstream-provider-adapters.js";

export interface LlmProviderConfig {
  traceLease?: ModelTraceLease;
  provider?:
    | "openai-compatible"
    | "anthropic"
    | "ollama";
  adapterType?: ProviderAdapterType;
  sourceId?: string;
  sessionId?: string;
  discoveredModel?: DiscoveredRemoteModel;
  baseUrl?: string;
  apiKey?: string;
  /** Multi-key pool for AstrBot-style round-robin / failover rotation. */
  apiKeys?: readonly string[];
  keyRotationStrategy?: KeyRotationStrategy;
  customHeaders?: Readonly<Record<string, string>>;
  model?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  contextWindow?: number;
  contextWindowOverride?: number;
  useCatalogContextWindow?: boolean;
  useCatalogMaxOutputTokens?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

type RemoteProvider = NonNullable<LlmProviderConfig["provider"]> | "deepseek" | IntegratedProvider;
const DEFAULT_TIMEOUT_MS = 15_000;
const defaultBaseUrl = (provider: RemoteProvider): string => {
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "ollama") return "http://127.0.0.1:11434/v1";
  return "https://api.openai.com/v1";
};

function isOfficialDeepSeek(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return url.origin === "https://api.deepseek.com" && !url.username && !url.password
      && (url.pathname === "/" || url.pathname === "/v1");
  } catch {
    return false;
  }
}

const MINIMUM_OUTPUT_TOKENS = 64;

export class ModelContextLimitError extends Error {
  readonly code = "MODEL_CONTEXT_LIMIT";

  constructor() {
    super("本轮消息超出模型对话窗口，请缩短输入或增大对话窗口。");
    this.name = "ModelContextLimitError";
  }
}

export function getEffectiveModelContextWindow(config?: LlmProviderConfig): number | undefined {
  const catalog = config?.discoveredModel;
  if (config?.useCatalogContextWindow) return catalog?.contextWindow;
  if (config?.contextWindowOverride === undefined) return undefined;
  const totalLimit = catalog?.contextWindowIsInputLimit ? undefined : catalog?.contextWindow;
  return Math.min(config.contextWindowOverride, totalLimit ?? Number.POSITIVE_INFINITY);
}

function getWindowLimits(config: LlmProviderConfig) {
  const catalog = config.discoveredModel;
  const chosenWindow = getEffectiveModelContextWindow(config);
  if (catalog?.contextWindowIsInputLimit) {
    return { inputLimit: catalog.contextWindow, totalLimit: config.useCatalogContextWindow ? undefined : chosenWindow };
  }
  return { inputLimit: undefined, totalLimit: chosenWindow ?? catalog?.contextWindow };
}

function getOutputTokenLimit(config: LlmProviderConfig, hasExplicitEffort = false): number {
  const catalogLimit = config.discoveredModel?.maxOutputTokens;
  if (config.useCatalogMaxOutputTokens && catalogLimit !== undefined) return catalogLimit;
  const explicitLimit = config.useCatalogMaxOutputTokens === false || getEffectiveModelContextWindow(config) !== undefined || hasExplicitEffort;
  return Math.min(config.maxTokens ?? 900, catalogLimit ?? Number.POSITIVE_INFINITY, explicitLimit ? Number.POSITIVE_INFINITY : 4096);
}

export function planContextWindow(config: LlmProviderConfig | undefined, mandatoryTokens: number, profileBudget: number, reservedTokens = 0) {
  if (!config) return undefined;
  const { inputLimit, totalLimit } = getWindowLimits(config);
  if (inputLimit === undefined && totalLimit === undefined) return undefined;
  const outputLimit = getOutputTokenLimit(config, config.reasoningEffort !== undefined);
  const total = totalLimit ?? Number.POSITIVE_INFINITY;
  const available = total - mandatoryTokens;
  const minimumOutput = Math.min(MINIMUM_OUTPUT_TOKENS, outputLimit);
  // Some catalogs advertise an output ceiling as large as the total window. Keep room for
  // ordinary history when both limits come from the catalog, then cap output to the actual request.
  const historyReserve = config.useCatalogContextWindow && config.useCatalogMaxOutputTokens && totalLimit !== undefined
    ? Math.min(profileBudget + reservedTokens, Math.floor(available / 2)) : 0;
  const maxOutputTokens = Math.min(outputLimit, available, Math.max(minimumOutput, available - historyReserve));
  const maxInputTokens = Math.min(inputLimit ?? Number.POSITIVE_INFINITY, total - maxOutputTokens);
  if (mandatoryTokens > maxInputTokens || maxOutputTokens < minimumOutput) {
    throw new ModelContextLimitError();
  }
  const useModelWindow = getEffectiveModelContextWindow(config) !== undefined;
  if (!useModelWindow && maxInputTokens - mandatoryTokens >= profileBudget + reservedTokens) return undefined;
  return { maxInputTokens, useModelWindow };
}

const compact = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return [...normalized].slice(0, maxLength).join("");
};

export const extractStructuredJson = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/giu, "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export interface FetchProviderModelsInput {
  adapterType: ProviderAdapterType;
  baseUrl: string;
  apiKeys?: readonly string[];
  customHeaders?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  fallbackCapability?: ProviderCapabilityKind;
}

export interface FetchProviderModelsResult {
  ok: boolean;
  models: DiscoveredRemoteModel[];
  catalogSource?: ProviderCatalogSource;
  latencyMs: number;
  httpStatus?: number;
  detail: string;
}

export interface ProbeModelInstanceInput {
  adapterType: ProviderAdapterType;
  baseUrl: string;
  modelId: string;
  capabilityKind: ProviderCapabilityKind;
  discoveredModel?: DiscoveredRemoteModel;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  apiKeys?: readonly string[];
  customHeaders?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export interface ProbeModelInstanceResult {
  ok: boolean;
  status: "ready" | "configured" | "error";
  latencyMs: number;
  httpStatus?: number;
  detail: string;
  lastResponseSnippet?: string;
}

function inferDiscoveredCapability(
  modelId: string,
  fallback: ProviderCapabilityKind = "chat"
): ProviderCapabilityKind {
  const lower = modelId.toLowerCase();
  if (lower.includes("rerank")) return "rerank";
  if (lower.includes("embed") || lower.includes("bge-m3") || lower.includes("bge-large") || lower.includes("nomic-embed")) {
    return "embedding";
  }
  if (lower.includes("tts") || lower.includes("sovits") || lower.includes("cosyvoice") || lower.includes("speech")) {
    return "tts";
  }
  if (lower.includes("whisper") || lower.includes("sensevoice") || lower.includes("asr") || lower.includes("stt")) {
    return "stt";
  }
  if (lower.includes("guard") || lower.includes("moderation")) return "guard_lora";
  return fallback;
}

function inferDiscoveredCapabilities(
  modelId: string,
  capabilityKind: ProviderCapabilityKind
): ModelCapabilities {
  const lower = modelId.toLowerCase();
  if (capabilityKind !== "chat") {
    return { vision: false, tools: false, reasoning: false, streaming: capabilityKind === "tts" };
  }
  return {
    vision: /(gpt-4|claude-3|claude-4|gemini|vl|vision)/iu.test(lower),
    tools: !/(embed|rerank)/iu.test(lower),
    reasoning: /(reasoner|-r1|\/r1|o1|o3|o4|thinking|claude-3-7|claude-3\.7|gemini-2\.5)/iu.test(lower),
    streaming: true
  };
}

function buildAuthHeaders(
  adapterType: ProviderAdapterType,
  apiKey?: string,
  customHeaders?: Readonly<Record<string, string>>,
  usesMessages = adapterType === "anthropic"
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(customHeaders ?? {})
  };
  if (apiKey) {
    if (adapterType === "anthropic") {
      headers["x-api-key"] = apiKey;
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
  }
  if (usesMessages) {
    headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
  }
  return headers;
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 502 || status === 503;
}

function resolveRequestedEffort(
  adapterType: ProviderAdapterType,
  baseUrl: string,
  modelId: string,
  discoveredModel: DiscoveredRemoteModel | undefined,
  requestedEffort: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  return requestedEffort && getSupportedReasoningEfforts(adapterType, modelId, discoveredModel, baseUrl).includes(requestedEffort)
    ? requestedEffort : undefined;
}

const GEMINI_OFFICIAL_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_NATIVE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

async function readGeminiModelPages(
  firstPage: Record<string, unknown> | null,
  headers: HeadersInit,
  signal: AbortSignal
): Promise<unknown[]> {
  const models: unknown[] = [];
  const visitedPages = new Set<string>();
  let page = firstPage;
  for (;;) {
    if (page?.error || !Array.isArray(page?.models)) throw new Error("Gemini 上游响应未包含有效的模型目录");
    models.push(...page.models);
    const nextPageToken = page.nextPageToken;
    if (typeof nextPageToken !== "string" || !nextPageToken) return models;
    if (visitedPages.has(nextPageToken)) throw new Error("Gemini 模型目录重复返回分页标记");
    visitedPages.add(nextPageToken);
    const url = new URL(GEMINI_NATIVE_MODELS_URL);
    url.searchParams.set("pageToken", nextPageToken);
    const response = await fetch(url.href, { method: "GET", headers, signal, redirect: "error" });
    if (!response.ok) throw new Error(`Gemini 模型目录分页失败 (HTTP ${response.status})`);
    page = await response.json() as Record<string, unknown> | null;
  }
}

/**
 * Fetches live available models from an upstream provider source:
 * - OpenAI / DeepSeek / Custom HTTP: GET ${baseUrl}/models
 * - Gemini official: GET /v1beta/models (fallback to the OpenAI-compatible directory)
 * - OpenCode Go: catalog uses /inference/go/v1/models
 * - Ollama: GET ${origin}/api/tags (fallback to GET ${baseUrl}/models)
 */
export async function fetchUpstreamProviderModels(
  input: FetchProviderModelsInput
): Promise<FetchProviderModelsResult> {
  const started = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));

  if (input.adapterType === "builtin_local") {
    return {
      ok: true,
      models: [
        {
          modelId: "safety-l0-guard-v1",
          inferredCapability: "guard_lora",
          ownedBy: "ai0-builtin",
          capabilities: { vision: false, tools: false, reasoning: false, streaming: false }
        }
      ],
      catalogSource: "built_in",
      latencyMs: 0,
      detail: "本地内建守卫模型已就绪"
    };
  }

  const base = input.baseUrl.trim().replace(/\/+$/u, "");
  if (!base || !/^https?:\/\//iu.test(base)) {
    return {
      ok: false,
      models: [],
      latencyMs: elapsed(),
      detail: "请先配置有效的 HTTP(S) API Base URL 后再拉取模型目录"
    };
  }

  const keys = (input.apiKeys ?? []).filter((k) => k.trim().length > 0);
  const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];
  const timeoutMs = Math.max(2000, Math.min(input.timeoutMs ?? 15000, 60000));

  // Ollama natively exposes /api/tags at server origin
  const catalogUrl = resolveModelCatalogUrl(input.adapterType, base);
  const candidateUrls: string[] = [];
  const metadataAdapter = input.adapterType === "openai_compatible" && isOpenRouterBaseUrl(base) ? "openrouter"
    : input.adapterType === "openai_compatible" && isOfficialDeepSeek(base) ? "deepseek" : input.adapterType;
  if (input.adapterType === "gemini" && base === GEMINI_OFFICIAL_OPENAI_BASE) candidateUrls.push(GEMINI_NATIVE_MODELS_URL);
  if (input.adapterType === "ollama") {
    try {
      const origin = new URL(base).origin;
      candidateUrls.push(`${origin}/api/tags`);
    } catch {
      // Fallback below
    }
  }
  candidateUrls.push(catalogUrl);
  const headers = withOpenCodeHeaders(input.adapterType, input.customHeaders);

  let lastStatus: number | undefined;
  let lastError = "无法连接到上游模型目录接口";

  for (const key of attempts) {
    let shouldTryNextKey = false;
    for (const url of candidateUrls) {
      try {
        const isNativeGemini = url === GEMINI_NATIVE_MODELS_URL && base === GEMINI_OFFICIAL_OPENAI_BASE && input.adapterType === "gemini";
        const authHeaders = buildAuthHeaders(input.adapterType, isNativeGemini ? undefined : key, headers);
        const requestHeaders = isNativeGemini ? new Headers(authHeaders) : authHeaders;
        if (requestHeaders instanceof Headers && key) requestHeaders.set("x-goog-api-key", key);
        const signal = AbortSignal.timeout(timeoutMs);
        const res = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
          signal,
          ...(isNativeGemini ? { redirect: "error" } : {})
        });
        lastStatus = res.status;
        if (!res.ok) {
          const text = compact(await res.text().catch(() => ""), 160);
          lastError = `HTTP ${res.status}${text ? `: ${text}` : ""}`;
          if (res.status === 404 || res.status === 405) {
            lastError += "。此端点未提供模型目录，请检查服务来源的 API Base URL。";
            if (input.adapterType === "zhipu" && base === integratedProviderBaseUrl("zhipu")) {
              try {
                const catalog = await fetchOfficialZhipuModelCatalog(timeoutMs);
                const models: DiscoveredRemoteModel[] = Array.from(catalog, ([modelId, vision]) => {
                  const metadata = parseCatalogModelMetadata("zhipu", modelId, {});
                  return {
                    modelId,
                    ownedBy: "智谱 AI",
                    inferredCapability: "chat",
                    chatProtocol: "chat_completions",
                    ...(metadata?.contextWindow !== undefined ? { contextWindow: metadata.contextWindow } : {}),
                    ...(metadata?.maxOutputTokens !== undefined ? { maxOutputTokens: metadata.maxOutputTokens } : {}),
                    capabilities: { ...inferDiscoveredCapabilities(modelId, "chat"), ...metadata?.capabilities, vision }
                  };
                });
                models.sort((a, b) => a.modelId.localeCompare(b.modelId));
                return {
                  ok: true,
                  models,
                  catalogSource: "official_docs",
                  latencyMs: elapsed(),
                  detail: `从智谱官方文档读取 ${models.length} 个模型。请通过连接测试确认当前密钥可用的模型。`
                };
              } catch (err) {
                lastError += ` 智谱官方文档目录读取失败：${err instanceof Error ? err.message : String(err)}`;
              }
            }
          }
          if (isRetryableStatus(res.status)) {
            shouldTryNextKey = true;
            if (!isNativeGemini) break;
          }
          continue;
        }
        const firstPage = (await res.json()) as Record<string, unknown> | null;
        const json: Record<string, unknown> | null = isNativeGemini
          ? { models: await readGeminiModelPages(firstPage, requestHeaders, signal) } : firstPage;
        if (json?.error || (!Array.isArray(json?.data) && !Array.isArray(json?.models))) {
          lastError = "上游响应未包含有效的模型目录";
          continue;
        }
        const discovered: DiscoveredRemoteModel[] = [];
        const seen = new Set<string>();

        const pushModel = (modelId: string, ownedBy?: string, entry: Record<string, unknown> = {}) => {
          const id = modelId.trim();
          if (!id || seen.has(id)) return;
          const metadata = parseCatalogModelMetadata(metadataAdapter, id, entry, base);
          if (!metadata) return;
          seen.add(id);
          const inferredCapability = metadata.inferredCapability ?? inferDiscoveredCapability(id, input.fallbackCapability ?? "chat");
          const defaults = inferDiscoveredCapabilities(id, inferredCapability);
          discovered.push({
            modelId: id,
            inferredCapability,
            ...(ownedBy ? { ownedBy } : {}),
            ...(metadata.chatProtocol ? { chatProtocol: metadata.chatProtocol } : {}),
            ...(metadata.supportsTemperature !== undefined ? { supportsTemperature: metadata.supportsTemperature } : {}),
            ...(metadata.contextWindow !== undefined ? { contextWindow: metadata.contextWindow } : {}),
            ...(metadata.contextWindowIsInputLimit !== undefined ? { contextWindowIsInputLimit: metadata.contextWindowIsInputLimit } : {}),
            ...(metadata.maxOutputTokens !== undefined ? { maxOutputTokens: metadata.maxOutputTokens } : {}),
            ...(metadata.supportedReasoningEfforts ? { supportedReasoningEfforts: metadata.supportedReasoningEfforts } : {}),
            capabilities: {
              vision: metadata.capabilities?.vision ?? defaults.vision,
              tools: metadata.capabilities?.tools ?? defaults.tools,
              reasoning: metadata.capabilities?.reasoning ?? defaults.reasoning,
              streaming: metadata.capabilities?.streaming ?? defaults.streaming
            }
          });
        };

        if (isNativeGemini && Array.isArray(json.models)) {
          for (const entry of json.models) {
            if (!entry || typeof entry !== "object") continue;
            const rec = entry as Record<string, unknown>;
            if (typeof rec.name !== "string" || !rec.name.startsWith("models/") || !Array.isArray(rec.supportedGenerationMethods)) continue;
            pushModel(rec.name.slice("models/".length), "Google", rec);
          }
          if (!discovered.length) {
            lastError = "Gemini 原生目录中没有可用的对话或嵌入模型";
            continue;
          }
        } else if (Array.isArray(json.data)) {
          for (const entry of json.data) {
            if (entry && typeof entry === "object") {
              const rec = entry as Record<string, unknown>;
              if (typeof rec.id === "string") {
                pushModel(rec.id, typeof rec.owned_by === "string" ? rec.owned_by : undefined, rec);
              }
            }
          }
        } else if (Array.isArray(json.models)) {
          for (const entry of json.models) {
            if (typeof entry === "string") {
              pushModel(entry);
            } else if (entry && typeof entry === "object") {
              const rec = entry as Record<string, unknown>;
              const name = typeof rec.name === "string" ? rec.name : typeof rec.id === "string" ? rec.id : "";
              if (name) pushModel(name, typeof rec.owned_by === "string" ? rec.owned_by : "ollama", rec);
            }
          }
        }

        discovered.sort((a, b) => a.modelId.localeCompare(b.modelId));
        return {
          ok: true,
          models: discovered,
          catalogSource: "upstream",
          latencyMs: elapsed(),
          httpStatus: res.status,
          detail: `成功拉取 ${discovered.length} 个可用模型 (${elapsed()}ms)`
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (!shouldTryNextKey) break;
  }

  return {
    ok: false,
    models: [],
    latencyMs: elapsed(),
    ...(lastStatus !== undefined ? { httpStatus: lastStatus } : {}),
    detail: `拉取模型目录失败：${lastError}`
  };
}

/**
 * Executes a real lightweight probe against a specific ModelInstance
 * (chat completion / embeddings / rerank / HTTP health check) with multi-key failover.
 */
export async function probeUpstreamModelInstance(
  input: ProbeModelInstanceInput
): Promise<ProbeModelInstanceResult> {
  const started = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));

  if (input.adapterType === "builtin_local" || input.capabilityKind === "guard_lora") {
    return {
      ok: true,
      status: "ready",
      latencyMs: 0,
      detail: "本地安全守卫已内建就绪"
    };
  }

  const base = input.baseUrl.trim().replace(/\/+$/u, "");
  if (!base || !/^https?:\/\//iu.test(base)) {
    return {
      ok: false,
      status: "error",
      latencyMs: elapsed(),
      detail: "缺少有效的 HTTP(S) Base URL"
    };
  }

  const keys = (input.apiKeys ?? []).filter((k) => k.trim().length > 0);
  if (
    keys.length === 0 &&
    input.adapterType !== "ollama" &&
    input.adapterType !== "custom_http"
  ) {
    return {
      ok: false,
      status: "configured",
      latencyMs: elapsed(),
      detail: "尚未配置有效 API Key（或 $ENV 环境变量未注入），无法发起上游实测"
    };
  }

  const attempts: Array<string | undefined> = keys.length > 0 ? keys : [undefined];
  const timeoutMs = Math.max(2000, Math.min(input.timeoutMs ?? 20000, 60000));
  const integratedProvider = isIntegratedProvider(input.adapterType) ? input.adapterType : undefined;
  const inferenceBase = resolveInferenceBaseUrl(input.adapterType, base);
  const reasoningAdapter = isOfficialDeepSeek(inferenceBase) ? "deepseek" : input.adapterType;
  const reasoningEffort = resolveRequestedEffort(reasoningAdapter, inferenceBase, input.modelId, input.discoveredModel, input.reasoningEffort);
  const usesMessages = input.capabilityKind === "chat" &&
    resolveChatProtocol(input.adapterType, input.modelId, input.discoveredModel) === "anthropic_messages";
  const customHeaders = withOpenCodeHeaders(input.adapterType, input.customHeaders,
    input.adapterType === "opencode_go" && input.capabilityKind === "chat" ? makeOpenCodeSession() : undefined);
  let lastStatus: number | undefined;
  let lastDetail = "连接测试失败";

  for (const key of attempts) {
    const headers: Record<string, string> = {
      ...buildAuthHeaders(input.adapterType, key, customHeaders, usesMessages || input.adapterType === "anthropic"),
      "content-type": "application/json"
    };
    try {
      if (input.capabilityKind === "chat") {
        const url = `${inferenceBase}${usesMessages ? "/messages" : "/chat/completions"}`;
        const anthropicOptions = usesMessages ? anthropicReasoningOptions(input.modelId, reasoningEffort) : undefined;
        const maxTokens = Math.min(reasoningEffort ? input.maxTokens ?? 1024 : integratedProvider ? 1024 : 16,
          input.discoveredModel?.maxOutputTokens ?? Number.POSITIVE_INFINITY);
        const body = {
          model: input.modelId,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: integratedProvider ? "Reply with only OK." : "Reply OK" }],
          ...(!usesMessages && !integratedProvider && input.discoveredModel?.supportsTemperature !== false ? { temperature: 0 } : {}),
          ...(anthropicOptions?.thinking ? { thinking: anthropicOptions.thinking } : {}),
          ...(anthropicOptions?.effort ? { output_config: { effort: anthropicOptions.effort } } : {})
        };
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify((integratedProvider || reasoningEffort) && !usesMessages
            ? adaptChatCompletionsRequest(reasoningAdapter, input.modelId, input.discoveredModel, body, reasoningEffort, inferenceBase)
            : body),
          signal: AbortSignal.timeout(timeoutMs)
        });
        lastStatus = res.status;
        const rawText = await res.text();
        if (!res.ok) {
          lastDetail = `HTTP ${res.status}: ${compact(rawText, 160)}`;
          if (isRetryableStatus(res.status)) continue;
          return { ok: false, status: "error", latencyMs: elapsed(), httpStatus: res.status, detail: lastDetail };
        }
        let snippet = "";
        try {
          const parsed = JSON.parse(rawText) as Record<string, unknown>;
          if (!parsed.error && usesMessages && Array.isArray(parsed.content)) {
            const firstText = parsed.content.find((part: { text?: unknown } | null) => typeof part?.text === "string");
            if (typeof firstText?.text === "string") snippet = compact(firstText.text, 60);
          } else if (!parsed.error && !usesMessages && Array.isArray(parsed.choices)) {
            const choice = parsed.choices[0] as Record<string, unknown> | undefined;
            const msg = choice?.message as Record<string, unknown> | undefined;
            if (typeof msg?.content === "string") snippet = compact(msg.content, 60);
          }
        } catch {
          if (!integratedProvider && !reasoningEffort) snippet = compact(rawText, 60);
        }
        if (!snippet && (integratedProvider || reasoningEffort)) {
          lastDetail = "上游模型未返回有效的对话正文";
          continue;
        }
        snippet ||= "OK";
        const ms = elapsed();
        return {
          ok: true,
          status: "ready",
          latencyMs: ms,
          httpStatus: res.status,
          detail: `实测通过 · ${ms}ms · 回复: "${snippet}"`,
          lastResponseSnippet: snippet
        };
      }

      if (input.capabilityKind === "embedding") {
        const url = `${inferenceBase}/embeddings`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: input.modelId, input: "ai0 health check" }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        lastStatus = res.status;
        const rawText = await res.text();
        if (!res.ok) {
          lastDetail = `HTTP ${res.status}: ${compact(rawText, 160)}`;
          if (isRetryableStatus(res.status)) continue;
          return { ok: false, status: "error", latencyMs: elapsed(), httpStatus: res.status, detail: lastDetail };
        }
        let dims = 0;
        try {
          const parsed = JSON.parse(rawText) as { data?: Array<{ embedding?: unknown[] }> };
          dims = Array.isArray(parsed.data?.[0]?.embedding) ? parsed.data![0]!.embedding!.length : 0;
        } catch {
          dims = 0;
        }
        if (!dims && integratedProvider) {
          lastDetail = "上游模型未返回有效的向量";
          continue;
        }
        const ms = elapsed();
        return {
          ok: true,
          status: "ready",
          latencyMs: ms,
          httpStatus: res.status,
          detail: dims > 0 ? `Embedding 就绪 · ${dims} 维 · ${ms}ms` : `Embedding 就绪 · ${ms}ms`,
          lastResponseSnippet: dims > 0 ? `${dims} dims` : "ok"
        };
      }

      if (input.capabilityKind === "rerank") {
        const url = `${base}/rerank`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: input.modelId, query: "ping", documents: ["ping"] }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        lastStatus = res.status;
        const rawText = await res.text();
        if (!res.ok) {
          lastDetail = `HTTP ${res.status}: ${compact(rawText, 160)}`;
          if (isRetryableStatus(res.status)) continue;
          return { ok: false, status: "error", latencyMs: elapsed(), httpStatus: res.status, detail: lastDetail };
        }
        const ms = elapsed();
        return {
          ok: true,
          status: "ready",
          latencyMs: ms,
          httpStatus: res.status,
          detail: `Rerank 实测通过 · ${ms}ms`,
          lastResponseSnippet: "rerank ok"
        };
      }

      // TTS / STT / custom HTTP reachability probe
      const res = await fetch(base, {
        method: "GET",
        headers: buildAuthHeaders(input.adapterType, key, customHeaders),
        signal: AbortSignal.timeout(timeoutMs)
      });
      lastStatus = res.status;
      const ms = elapsed();
      if (res.status < 500) {
        return {
          ok: true,
          status: "ready",
          latencyMs: ms,
          httpStatus: res.status,
          detail: `端点可达 (HTTP ${res.status}) · ${ms}ms`,
          lastResponseSnippet: `HTTP ${res.status}`
        };
      }
      lastDetail = `HTTP ${res.status}`;
      if (isRetryableStatus(res.status)) continue;
      return { ok: false, status: "error", latencyMs: ms, httpStatus: res.status, detail: lastDetail };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    status: "error",
    latencyMs: elapsed(),
    ...(lastStatus !== undefined ? { httpStatus: lastStatus } : {}),
    detail: lastDetail
  };
}

function reportedCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function detail(value: unknown, field: string): number | undefined {
  return value && typeof value === "object" ? reportedCount(Reflect.get(value, field)) : undefined;
}

/** Some adapters fill missing usage with zero. Use the upstream counters to retain absence. */
function reportedUsage(usage: LanguageModelUsage, messages: boolean): ChannelTokenUsage {
  const raw = usage.raw ?? {};
  if (messages) return {
    inputTokens: reportedCount(raw.input_tokens) === undefined ? undefined : usage.inputTokens,
    outputTokens: reportedCount(raw.output_tokens),
    cachedInputTokens: reportedCount(raw.cache_read_input_tokens),
    reasoningTokens: detail(raw.output_tokens_details, "thinking_tokens")
  };
  return {
    inputTokens: reportedCount(raw.prompt_tokens),
    outputTokens: reportedCount(raw.completion_tokens),
    cachedInputTokens: reportedCount(raw.prompt_cache_hit_tokens) ?? detail(raw.prompt_tokens_details, "cached_tokens"),
    reasoningTokens: detail(raw.completion_tokens_details, "reasoning_tokens")
  };
}

function toModelMessage(message: PreparedAgentRequest["messages"][number]): ModelMessage {
  switch (message.role) {
    case "system_invariant":
    case "developer_frame":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "untrusted_observation":
      return { role: "user", content: JSON.stringify({ untrusted_observation: message.content }) };
    case "tool":
      return { role: "tool", content: [{ type: "tool-result", toolName: message.name, toolCallId: message.callId,
        output: { type: "text", value: JSON.stringify(message.result) } }] };
    case "assistant":
      return { role: "assistant", content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...message.calls.map(call => ({ type: "tool-call" as const, toolCallId: call.id, toolName: call.name, input: call.input }))
      ] };
  }
}

export class UpstreamModelClient {
  private readonly config: Readonly<LlmProviderConfig>;
  private readonly keyCursors = new Map<string, number>();

  constructor(config: LlmProviderConfig = {}) {
    this.config = Object.freeze({ ...config });
  }

  private resolveOrderedApiKeys(effectiveConfig: LlmProviderConfig): string[] {
    const rawList = [
      ...(effectiveConfig.apiKeys ?? []),
      ...(effectiveConfig.apiKey ? [effectiveConfig.apiKey] : [])
    ]
      .map((k) => k.trim())
      .filter(Boolean);
    const deduped = Array.from(new Set(rawList));
    if (deduped.length <= 1) return deduped;

    const strategy = effectiveConfig.keyRotationStrategy ?? "round_robin";
    if (strategy === "failover") return deduped;

    const bucketKey = effectiveConfig.sourceId || effectiveConfig.baseUrl || "default";
    const startIdx = (this.keyCursors.get(bucketKey) ?? 0) % deduped.length;
    this.keyCursors.set(bucketKey, (startIdx + 1) % deduped.length);
    return [...deduped.slice(startIdx), ...deduped.slice(0, startIdx)];
  }

  private prepareProvider(requestedModel: string, overrides?: LlmProviderConfig) {
    const effectiveConfig: LlmProviderConfig = {
      ...this.config,
      ...(overrides ?? {}),
    };
    const candidateKeys = this.resolveOrderedApiKeys(effectiveConfig);
    const configuredProvider = effectiveConfig.provider ??
      (effectiveConfig.adapterType === "ollama" ? "ollama" : effectiveConfig.adapterType === "anthropic" ? "anthropic" :
        "openai-compatible");
    const keylessEndpoint = configuredProvider === "ollama" ||
      (effectiveConfig.adapterType === "custom_http" && Boolean(effectiveConfig.baseUrl?.trim()));
    if (candidateKeys.length === 0 && !keylessEndpoint) throw new ProviderNotConfiguredError();
    const integratedProvider = isIntegratedProvider(effectiveConfig.adapterType) ? effectiveConfig.adapterType : undefined;
    const defaultUrl = (integratedProvider && integratedProviderBaseUrl(integratedProvider)) ?? defaultBaseUrl(configuredProvider);
    const baseOverride = integratedProvider ? effectiveConfig.baseUrl?.trim() || undefined : effectiveConfig.baseUrl;
    const baseURL = resolveInferenceBaseUrl(integratedProvider, (baseOverride ?? defaultUrl).replace(/\/+$/u, ""));
    const provider: RemoteProvider = integratedProvider ??
      (configuredProvider === "openai-compatible" && isOfficialDeepSeek(baseURL) ? "deepseek" : configuredProvider);
    const model = effectiveConfig.model ?? requestedModel;
    const modelId = provider === "deepseek" && /^(deepseek-chat|deepseek-reasoner|deepseek-v4-flash)$/u.test(model)
      ? "deepseek-flash"
      : model;
    const discoveredModel = effectiveConfig.discoveredModel;
    const usesMessages = resolveChatProtocol(
      integratedProvider ?? (configuredProvider === "anthropic" ? "anthropic" : undefined),
      modelId,
      discoveredModel
    ) === "anthropic_messages";
    const reasoningAdapter = provider === "deepseek" ? "deepseek" : effectiveConfig.adapterType ??
      (usesMessages ? "anthropic" : provider === "ollama" ? "ollama" : "openai_compatible");
    const reasoningEffort = resolveRequestedEffort(reasoningAdapter, baseURL, modelId, discoveredModel, effectiveConfig.reasoningEffort);
    const anthropicOptions = usesMessages ? anthropicReasoningOptions(modelId, reasoningEffort) : undefined;
    const deepseekOptions = provider === "deepseek"
      ? reasoningEffort === "none"
        ? { thinking: { type: "disabled" } }
        : reasoningEffort
          ? { thinking: { type: "enabled" }, reasoningEffort }
          : /^(deepseek-chat|deepseek-flash|deepseek-v4-flash)$/u.test(model) ? { thinking: { type: "disabled" } } : undefined
      : undefined;
    const headers = withOpenCodeHeaders(integratedProvider, effectiveConfig.customHeaders,
      integratedProvider === "opencode_go" ? effectiveConfig.sessionId || makeOpenCodeSession() : undefined);
    const timeoutMs =
      Number.isFinite(effectiveConfig.timeoutMs) && (effectiveConfig.timeoutMs ?? 0) > 0
        ? Math.floor(effectiveConfig.timeoutMs as number)
        : DEFAULT_TIMEOUT_MS;
    const keyAttempts: Array<string | undefined> = candidateKeys.length > 0 ? candidateKeys : [undefined];

    const makeModel = (apiKey: string | undefined, transport?: typeof fetch) => {
      const adapter = usesMessages
        ? createAnthropic({ fetch: transport, baseURL, headers, ...(integratedProvider ? { authToken: apiKey } : { apiKey }) })
        : provider === "deepseek"
          ? createDeepSeek({ fetch: transport, baseURL, apiKey, headers })
          : createOpenAICompatible({
              includeUsage: true, fetch: transport,
              name: provider,
              baseURL,
              apiKey,
              headers,
              ...(integratedProvider || reasoningEffort
                ? { transformRequestBody: (body) => adaptChatCompletionsRequest(reasoningAdapter, modelId, discoveredModel, body, reasoningEffort, baseURL) }
                : {})
            });
      return adapter(modelId);
    };
    const providerOptions: NonNullable<Parameters<typeof streamText>[0]["providerOptions"]> = {};
    if (anthropicOptions) providerOptions.anthropic = anthropicOptions;
    if (deepseekOptions) providerOptions.deepseek = deepseekOptions;
    const settings = {
      ...(typeof effectiveConfig.temperature === "number" && discoveredModel?.supportsTemperature !== false &&
        (!usesMessages || !anthropicOptions || anthropicOptions.thinking?.type !== "adaptive") &&
        (!usesMessages || !integratedProvider || discoveredModel?.supportsTemperature === true)
        ? { temperature: effectiveConfig.temperature }
        : {}),
      maxRetries: 0,
      onError: () => undefined,
      providerOptions,
    };
    return { keyAttempts, effectiveConfig, model, modelId, discoveredModel, provider, usesMessages,
      integratedProvider, reasoningEffort, timeoutMs, settings, makeModel };
  }

  asModelAdapter(model: string, traceLease?: ModelTraceLease, overrides?: LlmProviderConfig, observer?: {
    onReasoning?(delta: string | null): void;
    onFinish(provider: string, model: string, usage: ChannelTokenUsage): void;
  }): AgentModelAdapter {
    return { capabilities: { tools: true, structuredOutput: true },
      model: request => this.streamPrepared(model, request, traceLease, overrides, observer) };
  }

  private async *streamPrepared(model: string, request: PreparedAgentRequest, lease?: ModelTraceLease, overrides?: LlmProviderConfig,
    observer?: Parameters<UpstreamModelClient["asModelAdapter"]>[3]): AsyncGenerator<AgentModelEvent> {
    request.signal.throwIfAborted();
    const { keyAttempts, modelId, provider, usesMessages, integratedProvider, makeModel, timeoutMs, effectiveConfig, settings } = this.prepareProvider(model, overrides);
    const baseMessages = request.messages.map(toModelMessage);
    const schemaInstruction = request.output?.schema
      ? `Return valid JSON matching this schema when producing the final response: ${JSON.stringify(request.output.schema)}`
      : undefined;
    const messages: ModelMessage[] = schemaInstruction && (request.tools.length > 0 || usesMessages || Boolean(integratedProvider) || provider === "deepseek")
      ? [{ role: "system", content: schemaInstruction }, ...baseMessages]
      : baseMessages;
    const wireStructuredOutput = request.tools.length === 0 && request.output?.schema && !usesMessages && (!integratedProvider || integratedProvider === "moonshot")
      ? { output: Output.json() }
      : {};
    const requiredKeys = Array.isArray((request.output?.schema as { required?: unknown } | undefined)?.required)
      ? ((request.output?.schema as { required: unknown[] }).required).filter((item): item is string => typeof item === "string")
      : [];
    const tools = Object.fromEntries(request.tools.map(spec => [spec.name, tool({
      description: spec.description, inputSchema: jsonSchema(spec.inputSchema)
    })]));
    const { inputLimit, totalLimit } = getWindowLimits(effectiveConfig);
    const outputLimit = getOutputTokenLimit(effectiveConfig, effectiveConfig.reasoningEffort !== undefined);
    const tokens = estimateTokens(JSON.stringify({ messages, tools: request.tools, schema: request.output?.schema })) + 32;
    const maxOutputTokens = Math.min(outputLimit, (totalLimit ?? Infinity) - tokens);
    if (tokens > (inputLimit ?? Infinity) || maxOutputTokens < Math.min(MINIMUM_OUTPUT_TOKENS, outputLimit)) throw new ModelContextLimitError();
    const trace = lease ?? this.config.traceLease;
    const transport = trace ? tracePreparedRequest(trace, request, provider, undefined, modelId) : request.wrapFetch?.(provider);
    let failure: unknown;
    for (const key of keyAttempts) {
      let emitted = false;
      let emittedReasoning = false;
      const bufferedStructured = request.tools.length === 0 && Boolean(request.output?.schema);
      let bufferedText = "";
      let pendingFinishInfo: { provider: string; model: string; usage: ChannelTokenUsage } | undefined;
      const abortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const stream = streamText({ ...settings, model: makeModel(key, transport), messages, allowSystemInMessages: true,
          ...(request.tools.length ? { tools } : {}),
          ...wireStructuredOutput,
          maxOutputTokens, abortSignal });
        for await (const part of stream.fullStream) {
          abortSignal.throwIfAborted();
          if (part.type === "error") throw part.error;
          if (part.type === "reasoning-delta") {
            if (part.text) emittedReasoning = true;
            observer?.onReasoning?.(part.text);
          }
          if (part.type === "finish-step") {
            const info = {
              provider,
              model: part.response.modelId || modelId,
              usage: { ...reportedUsage(part.usage, usesMessages), contextWindow: getEffectiveModelContextWindow(effectiveConfig) }
            };
            if (bufferedStructured) pendingFinishInfo = info;
            else observer?.onFinish(info.provider, info.model, info.usage);
          }
          if (part.type === "abort") throw new Error("Provider stopped streaming");
          if (part.type === "tool-call") {
            emitted = true;
            yield { kind: "tool", id: part.toolCallId, name: part.toolName, input: part.input };
          }
          if (part.type === "text-delta") {
            if (bufferedStructured) {
              bufferedText += part.text;
            } else {
              emitted = true;
              yield { kind: "delta", text: part.text };
            }
          }
          if (part.type === "finish") {
            if (part.finishReason === "error" || part.finishReason === "length" || part.finishReason === "content-filter")
              throw new Error("Incomplete model response: " + part.finishReason);
            if (bufferedStructured) {
              const parsed = extractStructuredJson(bufferedText);
              if (!parsed || requiredKeys.some(reqKey => !(reqKey in parsed))) {
                throw new Error("Invalid structured model response");
              }
              if (pendingFinishInfo) observer?.onFinish(pendingFinishInfo.provider, pendingFinishInfo.model, pendingFinishInfo.usage);
              if (bufferedText) yield { kind: "delta", text: bufferedText };
            }
            yield { kind: "finish" };
            return;
          }
        }
        throw new Error("Model stream ended without a finish event");
      } catch (error) {
        request.signal.throwIfAborted();
        failure = error;
        if (emittedReasoning) observer?.onReasoning?.(null);
        if (emitted) break;
      }
    }
    throw new UpstreamInferenceError(failure);
  }

  async generateStructured<T>(
    input: StructuredModelRequest<T>,
    signal?: AbortSignal,
    onReasoning?: (delta: string | null) => void,
  ): Promise<StructuredModelResponse<T>> {
    signal?.throwIfAborted();
    const { keyAttempts, effectiveConfig, model, modelId, discoveredModel, provider, usesMessages,
      integratedProvider, reasoningEffort, timeoutMs, settings, makeModel } = this.prepareProvider(input.model, input.dynamicLlmConfig);
    const transport = traceStructuredRequest(input.dynamicLlmConfig?.traceLease ?? this.config.traceLease, provider, modelId, input);
    const messages = { system: input.system, prompt: input.observation };
    const { inputLimit, totalLimit } = getWindowLimits(effectiveConfig);
    const outputLimit = getOutputTokenLimit(effectiveConfig, reasoningEffort !== undefined);
    const inputTokens = inputLimit !== undefined || totalLimit !== undefined ? estimateTokens(messages.system) + estimateTokens(messages.prompt) + 32 : 0;
    const maxOutputTokens = Math.min(outputLimit, (totalLimit ?? Number.POSITIVE_INFINITY) - inputTokens);
    if (inputTokens > (inputLimit ?? Number.POSITIVE_INFINITY) || maxOutputTokens < Math.min(MINIMUM_OUTPUT_TOKENS, outputLimit)) {
      throw new ModelContextLimitError();
    }

    let failure: unknown;
    for (const apiKey of keyAttempts) {
      signal?.throwIfAborted();
      let emittedReasoning = false;
      const timeout = AbortSignal.timeout(timeoutMs);
      const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = streamText({
          ...settings, model: makeModel(apiKey, transport), ...messages, maxOutputTokens, abortSignal,
          ...(!usesMessages && (!integratedProvider || integratedProvider === "moonshot") ? { output: Output.json() } : {})
        });
        let content = "";
        let actualModel = modelId;
        let usage: ChannelTokenUsage = {};
        for await (const part of response.fullStream) {
          signal?.throwIfAborted();
          if (part.type === "text-delta") { content += part.text; }
          if (part.type === "reasoning-delta" && part.text && onReasoning) {
            emittedReasoning = true;
            onReasoning(part.text);
          }
          if (part.type === "error") throw part.error;
          if (part.type === "finish-step") {
            actualModel = part.response.modelId || modelId;
            usage = reportedUsage(part.usage, usesMessages);
          }
        }
        signal?.throwIfAborted();
        const parsed = extractStructuredJson(content);
        const validated = parsed ? input.validate(parsed) : undefined;
        if (validated !== undefined) return { value: validated, provider_used: provider, model_used: actualModel, usage: {
          ...usage, contextWindow: actualModel === modelId || actualModel === model
            ? getEffectiveModelContextWindow(effectiveConfig) ?? discoveredModel?.contextWindow ?? effectiveConfig.contextWindow : undefined
        } };
        failure = new Error("Invalid structured model response");
      } catch (error) {
        signal?.throwIfAborted();
        failure = error;
      }
      if (emittedReasoning) onReasoning?.(null);
    }
    throw new UpstreamInferenceError(failure);
  }
}

export interface StructuredModelRequest<T> {
  trace?: StructuredRequestTrace;
  outputSchema?: Readonly<Record<string, unknown>>;
  model: string;
  system: string;
  observation: string;
  dynamicLlmConfig?: LlmProviderConfig;
  validate(value: Record<string, unknown>): T | undefined;
}
export interface StructuredModelResponse<T> {
  value: T;
  provider_used: string;
  model_used: string;
  usage: ChannelTokenUsage;
}
export class ProviderNotConfiguredError extends Error {
  readonly code = "PROVIDER_NOT_READY";
  constructor() { super("No inference provider is configured"); this.name = "ProviderNotConfiguredError"; }
}
export class UpstreamInferenceError extends Error {
  readonly code = "UPSTREAM_INFERENCE_FAILED";
  constructor(cause?: unknown) { super("Upstream inference failed", { cause }); this.name = "UpstreamInferenceError"; }
}

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const character of text) tokens += character.codePointAt(0)! > 127 ? 1 : 0.25;
  return Math.ceil(tokens);
}
