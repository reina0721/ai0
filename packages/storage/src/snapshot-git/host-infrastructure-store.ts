import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  HOSTED_CHAT_PROVIDER_TEMPLATES,
  HostInfrastructureConfigSchema,
  McpServerConfigSchema,
  ModelInstanceSchema,
  ProviderSourceSchema,
  type DiscoveredRemoteModel,
  type HostInfrastructureConfig,
  type McpServerConfig,
  type ModelCapabilities,
  type ModelInstance,
  type PlatformAdapterKind,
  type PlatformChannelInstance,
  type ProviderApiKeyEntry,
  type ProviderCapabilityKind,
  type ProviderHealth,
  type ProviderInstance,
  type ProviderSource,
  type ProviderVendorTemplate,
  type SoulProfileAndCapabilitiesConfig
} from "@ai0/protocol";

export type { ProviderVendorTemplate } from "@ai0/protocol";

export const PROVIDER_VENDOR_TEMPLATES: readonly ProviderVendorTemplate[] = Object.freeze([
  {
    id: "tpl_deepseek",
    label: "DeepSeek 官方",
    vendor: "DeepSeek",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    requiresApiKey: true,
    description: "DeepSeek 官方 API，支持高性价比对话与 R1 深度推理"
  },
  {
    id: "tpl_openai",
    label: "OpenAI / 兼容中转",
    vendor: "OpenAI Compatible",
    capabilityKind: "chat",
    supportedCapabilities: ["chat", "embedding", "tts", "stt"],
    adapterType: "openai_compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4.1", "gpt-4.1-mini"],
    requiresApiKey: true,
    description: "OpenAI 官方或任意 OneAPI / NewAPI / OpenRouter 兼容聚合站"
  },
  {
    id: "tpl_anthropic",
    label: "Anthropic Claude",
    vendor: "Anthropic",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModels: ["claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"],
    requiresApiKey: true,
    description: "Anthropic 原生接口，支持长上下文推理、视觉与工具调用"
  },
  {
    id: "tpl_gemini",
    label: "Google Gemini",
    vendor: "Google",
    capabilityKind: "chat",
    supportedCapabilities: ["chat", "embedding"],
    adapterType: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
    requiresApiKey: true,
    description: "Google Gemini OpenAI 兼容端点，支持多模态视觉与百万上下文"
  },
  {
    id: "tpl_siliconflow",
    label: "SiliconFlow 硅基流动",
    vendor: "SiliconFlow",
    capabilityKind: "chat",
    supportedCapabilities: ["chat", "embedding", "rerank"],
    adapterType: "openai_compatible",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModels: ["Qwen/Qwen2.5-72B-Instruct", "BAAI/bge-m3", "BAAI/bge-reranker-v2-m3"],
    requiresApiKey: true,
    description: "一站式接入对话、Embedding 嵌入与 Rerank 重排模型（单 Key 复用）"
  },
  ...HOSTED_CHAT_PROVIDER_TEMPLATES,
  {
    id: "tpl_ollama_chat",
    label: "Ollama 本地引擎",
    vendor: "Ollama",
    capabilityKind: "chat",
    supportedCapabilities: ["chat", "embedding"],
    adapterType: "ollama",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModels: ["qwen2.5:7b-instruct", "bge-m3"],
    requiresApiKey: false,
    description: "本机 Ollama 服务，自动通过 /api/tags 拉取已下载模型"
  },
  {
    id: "tpl_embed_ollama",
    label: "Embedding 向量嵌入服务",
    vendor: "Ollama / SiliconFlow",
    capabilityKind: "embedding",
    supportedCapabilities: ["embedding"],
    adapterType: "ollama",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModels: ["bge-m3"],
    requiresApiKey: false,
    description: "专用于知识库与长期记忆向量检索的嵌入服务"
  },
  {
    id: "tpl_rerank_sf",
    label: "Reranker 精排服务",
    vendor: "SiliconFlow",
    capabilityKind: "rerank",
    supportedCapabilities: ["rerank"],
    adapterType: "custom_http",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModels: ["BAAI/bge-reranker-v2-m3"],
    requiresApiKey: true,
    description: "用于 RAG 混合检索候选二次精排"
  },
  {
    id: "tpl_tts_fish",
    label: "TTS 语音合成 (FishAudio / GPT-SoVITS)",
    vendor: "FishAudio / GPT-SoVITS",
    capabilityKind: "tts",
    supportedCapabilities: ["tts"],
    adapterType: "custom_http",
    defaultBaseUrl: "http://127.0.0.1:9880",
    defaultModels: ["ai0-tts-warm-v2"],
    requiresApiKey: false,
    description: "低延迟情感语音合成与口型时间戳端点"
  },
  {
    id: "tpl_stt_sensevoice",
    label: "STT 语音识别 (SenseVoice / FunASR)",
    vendor: "FunASR / SenseVoice",
    capabilityKind: "stt",
    supportedCapabilities: ["stt"],
    adapterType: "custom_http",
    defaultBaseUrl: "http://127.0.0.1:8009",
    defaultModels: ["SenseVoiceSmall"],
    requiresApiKey: false,
    description: "本地流式语音转写与情感特征识别服务"
  },
  {
    id: "tpl_local_guard",
    label: "本地安全守卫 / LoRA",
    vendor: "Local Guard",
    capabilityKind: "guard_lora",
    supportedCapabilities: ["guard_lora"],
    adapterType: "builtin_local",
    defaultBaseUrl: "local://safety-l0-guard",
    defaultModels: ["safety-l0-guard-v1"],
    requiresApiKey: false,
    description: "内建 L0 危机拦截与安全分类模型"
  }
]);

export interface PlatformAdapterTemplate {
  readonly adapterKind: PlatformAdapterKind;
  readonly label: string;
  readonly defaultEndpoint: string;
  readonly defaultAudienceCeiling: "only_owner" | "group:default" | "public_all";
  readonly description: string;
}

export const PLATFORM_ADAPTER_TEMPLATES: readonly PlatformAdapterTemplate[] = Object.freeze([
  {
    adapterKind: "protocol_v0_ws",
    label: "外部 Protocol v0 躯壳客户端",
    defaultEndpoint: "ws://127.0.0.1:4173/protocol/v0/shell",
    defaultAudienceCeiling: "only_owner",
    description: "通过标准 Protocol v0 接入任意自研桌面端、游戏 Mod 或移动客户端"
  },
  {
    adapterKind: "qq_onebot",
    label: "QQ (OneBot v11 / NapCat)",
    defaultEndpoint: "ws://127.0.0.1:3001",
    defaultAudienceCeiling: "group:default",
    description: "通过 OneBot v11 反向/正向 WebSocket 桥接 QQ 私聊与群聊"
  },
  {
    adapterKind: "telegram",
    label: "Telegram Bot",
    defaultEndpoint: "https://api.telegram.org",
    defaultAudienceCeiling: "only_owner",
    description: "通过 Bot API 接入 Telegram 私聊与群组会话"
  },
  {
    adapterKind: "discord",
    label: "Discord Bot",
    defaultEndpoint: "wss://gateway.discord.gg",
    defaultAudienceCeiling: "public_all",
    description: "接入 Discord 频道与私信（公开频道默认强制社交面具隔离）"
  },
  {
    adapterKind: "feishu",
    label: "飞书 / Lark 机器人",
    defaultEndpoint: "https://open.feishu.cn/open-apis",
    defaultAudienceCeiling: "group:default",
    description: "面向团队协作场景接入飞书群聊与单聊"
  },
  {
    adapterKind: "desktop_shell",
    label: "桌面伴侣 / Live2D 躯壳",
    defaultEndpoint: "ws://127.0.0.1:4173/protocol/v0/shell",
    defaultAudienceCeiling: "only_owner",
    description: "支持桌面窗口感知、视线先行与三锚点微表情渲染的本地具身载体"
  },
  {
    adapterKind: "webhook",
    label: "通用 HTTP Webhook",
    defaultEndpoint: "http://127.0.0.1:8080/webhook",
    defaultAudienceCeiling: "public_all",
    description: "标准 HTTP 回调接入任意第三方消息网关"
  }
]);

export function resolveHostInfrastructureDir(soulDirPath: string): string {
  return join(dirname(resolve(soulDirPath)), "host");
}

export function getHostInfrastructureFilePath(hostDirPath: string): string {
  return join(resolve(hostDirPath), "infrastructure.json");
}

export function getHostVaultFilePath(hostDirPath: string): string {
  return join(resolve(hostDirPath), "vault", "provider_keys.json");
}

function sanitizeIdFragment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48) || "item";
}

export function makeDefaultModelInstanceId(sourceId: string, modelId: string): string {
  return `mdl_${sanitizeIdFragment(sourceId)}_${sanitizeIdFragment(modelId)}`;
}

export function sameProviderCatalogConnection(left: ProviderSource, right: ProviderSource): boolean {
  const normalizeUrl = (url: string) => url.trim().replace(/\/+$/u, "");
  const headers = Object.entries(left.customHeaders);
  return left.adapterType === right.adapterType && left.vendor === right.vendor &&
    normalizeUrl(left.baseUrl) === normalizeUrl(right.baseUrl) &&
    normalizeUrl(left.proxyUrl) === normalizeUrl(right.proxyUrl) &&
    left.supportedCapabilities[0] === right.supportedCapabilities[0] &&
    headers.length === Object.keys(right.customHeaders).length &&
    headers.every(([name, value]) => Object.hasOwn(right.customHeaders, name) && right.customHeaders[name] === value);
}

export function getModelCatalogEntry(
  source: ProviderSource,
  modelId: string | undefined,
  instance?: ModelInstance
): DiscoveredRemoteModel | undefined {
  const latest = source.discoveredModels.find((entry) => entry.modelId === modelId);
  if (!instance || instance.sourceId !== source.id || instance.modelId !== modelId) return latest;
  return {
    modelId: instance.modelId,
    inferredCapability: instance.capabilityKind,
    capabilities: instance.capabilities,
    chatProtocol: instance.chatProtocol,
    supportsTemperature: instance.supportsTemperature,
    contextWindow: instance.catalogContextWindow,
    maxOutputTokens: instance.catalogMaxOutputTokens,
    supportedReasoningEfforts: instance.supportedReasoningEfforts,
    ...latest,
    contextWindowIsInputLimit: latest?.contextWindow !== undefined
      ? latest.contextWindowIsInputLimit : instance.catalogContextWindowIsInputLimit
  };
}

export function inferModelCapabilityKind(
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
  if (lower.includes("guard") || lower.includes("moderation")) {
    return "guard_lora";
  }
  return fallback;
}

export function inferModelCapabilities(
  modelId: string,
  capabilityKind: ProviderCapabilityKind
): ModelCapabilities {
  const lower = modelId.toLowerCase();
  if (capabilityKind !== "chat") {
    return { vision: false, tools: false, reasoning: false, streaming: capabilityKind === "tts" };
  }
  const vision =
    lower.includes("gpt-4") ||
    lower.includes("gpt-4o") ||
    lower.includes("claude-3") ||
    lower.includes("claude-4") ||
    lower.includes("gemini") ||
    lower.includes("vl") ||
    lower.includes("vision");
  const reasoning =
    lower.includes("reasoner") ||
    lower.includes("-r1") ||
    lower.includes("/r1") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("o4") ||
    lower.includes("thinking") ||
    lower.includes("claude-3-7") ||
    lower.includes("claude-3.7") ||
    lower.includes("gemini-2.5");
  const tools = !lower.includes("embed") && !lower.includes("rerank");
  return { vision, tools, reasoning, streaming: true };
}

/**
 * Projects Tier-1 ProviderSources + Tier-2 ModelInstances back to v1 ProviderInstance[]
 * so every legacy consumer, profile selector fallback, and test stays 100% compatible.
 */
export function deriveLegacyProvidersProjection(
  sources: readonly ProviderSource[],
  models: readonly ModelInstance[]
): ProviderInstance[] {
  const projected: ProviderInstance[] = [];
  for (const source of sources) {
    const sourceModels = models.filter((m) => m.sourceId === source.id);
    const firstKeyPreview =
      source.apiKeys.find((k) => k.enabled)?.maskedPreview ??
      source.apiKeys[0]?.maskedPreview ??
      "";
    if (sourceModels.length === 0) {
      projected.push({
        id: source.id,
        label: source.label,
        vendor: source.vendor,
        capabilityKind: source.supportedCapabilities[0] ?? "chat",
        adapterType: source.adapterType,
        baseUrl: source.baseUrl,
        apiKeyMasked: firstKeyPreview,
        models: ["default"],
        defaultTemperature: 0.75,
        defaultMaxTokens: 4096,
        enabled: source.enabled,
        health: { status: "untested", latencyMs: 0 }
      });
      continue;
    }

    const byKind = new Map<ProviderCapabilityKind, ModelInstance[]>();
    for (const model of sourceModels) {
      const list = byKind.get(model.capabilityKind) ?? [];
      list.push(model);
      byKind.set(model.capabilityKind, list);
    }

    const primaryKind = source.supportedCapabilities[0] ?? sourceModels[0]!.capabilityKind;
    for (const [kind, kindModels] of byKind.entries()) {
      const rep = kindModels.find((m) => m.enabled) ?? kindModels[0]!;
      const enabledModels = kindModels.filter((m) => m.enabled);
      const id = kind === primaryKind ? source.id : `${source.id}__${kind}`;
      projected.push({
        id,
        label: source.label,
        vendor: source.vendor,
        capabilityKind: kind,
        adapterType: source.adapterType,
        baseUrl: source.baseUrl,
        apiKeyMasked: firstKeyPreview,
        models: (enabledModels.length > 0 ? enabledModels : kindModels).map((m) => m.modelId),
        defaultTemperature: rep.defaultTemperature,
        defaultMaxTokens: rep.defaultMaxTokens,
        enabled: source.enabled && enabledModels.length > 0,
        health: rep.health
      });
    }
  }
  return projected;
}

export function createDefaultHostInfrastructureConfig(): HostInfrastructureConfig {
  const providerSources: ProviderSource[] = [
    ProviderSourceSchema.parse({
      id: "prov_deepseek_v3",
      label: "DeepSeek",
      vendor: "DeepSeek",
      adapterType: "deepseek",
      supportedCapabilities: ["chat"],
      baseUrl: "https://api.deepseek.com",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_claude_sonnet",
      label: "Anthropic Claude",
      vendor: "Anthropic",
      adapterType: "anthropic",
      supportedCapabilities: ["chat"],
      baseUrl: "https://api.anthropic.com/v1",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_ollama_local",
      label: "Ollama (本地)",
      vendor: "Ollama",
      adapterType: "ollama",
      supportedCapabilities: ["chat", "embedding"],
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_bge_embed",
      label: "Ollama BGE Embedding",
      vendor: "Ollama / SiliconFlow",
      adapterType: "ollama",
      supportedCapabilities: ["embedding"],
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_bge_rerank",
      label: "SiliconFlow Reranker",
      vendor: "SiliconFlow",
      adapterType: "custom_http",
      supportedCapabilities: ["rerank"],
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_fish_tts",
      label: "FishAudio / GPT-SoVITS",
      vendor: "FishAudio / GPT-SoVITS",
      adapterType: "custom_http",
      supportedCapabilities: ["tts"],
      baseUrl: "http://127.0.0.1:9880",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_sensevoice_stt",
      label: "SenseVoice",
      vendor: "FunASR / SenseVoice",
      adapterType: "custom_http",
      supportedCapabilities: ["stt"],
      baseUrl: "http://127.0.0.1:8009",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    }),
    ProviderSourceSchema.parse({
      id: "prov_local_guard_lora",
      label: "本地安全守卫",
      vendor: "Local Guard",
      adapterType: "builtin_local",
      supportedCapabilities: ["guard_lora"],
      baseUrl: "local://safety-l0-guard",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      enabled: true
    })
  ];

  const modelInstances: ModelInstance[] = [
    ModelInstanceSchema.parse({
      id: "mdl_deepseek_flash",
      sourceId: "prov_deepseek_v3",
      displayName: "DeepSeek Flash",
      modelId: "deepseek-flash",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: false, tools: true, reasoning: false, streaming: true },
      contextWindow: 128000,
      defaultTemperature: 0.78,
      defaultMaxTokens: 4096
    }),
    ModelInstanceSchema.parse({
      id: "mdl_deepseek_chat",
      sourceId: "prov_deepseek_v3",
      displayName: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: false, tools: true, reasoning: false, streaming: true },
      contextWindow: 128000,
      defaultTemperature: 0.75,
      defaultMaxTokens: 4096
    }),
    ModelInstanceSchema.parse({
      id: "mdl_deepseek_reasoner",
      sourceId: "prov_deepseek_v3",
      displayName: "DeepSeek Reasoner (R1)",
      modelId: "deepseek-reasoner",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: false, tools: true, reasoning: true, streaming: true },
      contextWindow: 128000,
      defaultTemperature: 0.6,
      defaultMaxTokens: 8192
    }),
    ModelInstanceSchema.parse({
      id: "mdl_claude_37_sonnet",
      sourceId: "prov_claude_sonnet",
      displayName: "Claude 3.7 Sonnet",
      modelId: "claude-3-7-sonnet-latest",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: true, tools: true, reasoning: true, streaming: true },
      contextWindow: 200000,
      defaultTemperature: 0.45,
      defaultMaxTokens: 8192
    }),
    ModelInstanceSchema.parse({
      id: "mdl_ollama_qwen25",
      sourceId: "prov_ollama_local",
      displayName: "Qwen 2.5 7B Instruct",
      modelId: "qwen2.5:7b-instruct",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: false, tools: true, reasoning: false, streaming: true },
      contextWindow: 32768,
      defaultTemperature: 0.65,
      defaultMaxTokens: 2048
    }),
    ModelInstanceSchema.parse({
      id: "mdl_bge_m3_embed",
      sourceId: "prov_bge_embed",
      displayName: "BGE-M3 Embedding",
      modelId: "bge-m3",
      capabilityKind: "embedding",
      enabled: true,
      capabilities: { vision: false, tools: false, reasoning: false, streaming: false },
      defaultTemperature: 0,
      defaultMaxTokens: 512
    }),
    ModelInstanceSchema.parse({
      id: "mdl_bge_reranker_v2",
      sourceId: "prov_bge_rerank",
      displayName: "BGE Reranker v2 M3",
      modelId: "BAAI/bge-reranker-v2-m3",
      capabilityKind: "rerank",
      enabled: true,
      capabilities: { vision: false, tools: false, reasoning: false, streaming: false },
      defaultTemperature: 0,
      defaultMaxTokens: 512
    }),
    ModelInstanceSchema.parse({
      id: "mdl_fish_tts_warm",
      sourceId: "prov_fish_tts",
      displayName: "Warm Voice v2",
      modelId: "ai0-tts-warm-v2",
      capabilityKind: "tts",
      enabled: true,
      capabilities: { vision: false, tools: false, reasoning: false, streaming: true },
      defaultTemperature: 0.7,
      defaultMaxTokens: 1024
    }),
    ModelInstanceSchema.parse({
      id: "mdl_sensevoice_small",
      sourceId: "prov_sensevoice_stt",
      displayName: "SenseVoice Small",
      modelId: "SenseVoiceSmall",
      capabilityKind: "stt",
      enabled: true,
      capabilities: { vision: false, tools: false, reasoning: false, streaming: false },
      defaultTemperature: 0,
      defaultMaxTokens: 1024
    }),
    ModelInstanceSchema.parse({
      id: "mdl_local_guard_v1",
      sourceId: "prov_local_guard_lora",
      displayName: "L0 Safety Guard v1",
      modelId: "safety-l0-guard-v1",
      capabilityKind: "guard_lora",
      enabled: true,
      capabilities: { vision: false, tools: false, reasoning: false, streaming: false },
      defaultTemperature: 0,
      defaultMaxTokens: 256,
      health: { status: "ready", latencyMs: 0, detail: "本地内建守卫就绪" }
    })
  ];

  return HostInfrastructureConfigSchema.parse({
    schemaVersion: 2,
    providerSources,
    modelInstances,
    providers: deriveLegacyProvidersProjection(providerSources, modelInstances),
    platforms: [
      {
        id: "builtin.webchat",
        label: "WebChat (内置官方通道)",
        adapterKind: "builtin_webchat",
        endpoint: "/protocol/v0/shell",
        authMode: "local_builtin",
        defaultAudienceCeiling: "only_owner",
        enabled: true,
        builtinPluginId: "builtin.webchat",
        notes: "随仓官方网页交互通道，通过标准 Protocol v0 接入网关"
      },
      {
        id: "builtin.terminal",
        label: "Terminal CLI (内置终端通道)",
        adapterKind: "builtin_terminal",
        endpoint: "/protocol/v0/shell",
        authMode: "local_builtin",
        defaultAudienceCeiling: "only_owner",
        enabled: true,
        builtinPluginId: "builtin.terminal",
        notes: "命令行终端交互躯壳"
      }
    ],
    mcpServers: [
      McpServerConfigSchema.parse({
        id: "mcp_filesystem_local",
        name: "Local Workspace FS (示例)",
        description: "标准 stdio MCP 文件工具示例；启用前请确认目录作用域。",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        enabled: false,
        status: "untested",
        discoveredTools: [
          { name: "read_file", description: "读取授权工作区文本文件", risk: "read_only_safe" },
          { name: "list_directory", description: "列出授权目录文件清单", risk: "read_only_safe" }
        ]
      })
    ],
    systemSettings: {
      auth2faEnabled: false,
      proxyUrl: "",
      codeSandboxEnabled: true,
      sb243BreakMinutes: 180,
      crisisHotlineRegion: "CN-4001619995 / US-988",
      appearance: "light",
      soulTheme: "sakura-pink"
    }
  });
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", encoding: "utf8" });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function maskSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("••")) return trimmed;
  return trimmed.length > 8 ? `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}` : "••••••";
}

export function isPlaceholderSecret(value: string): boolean {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.includes("••") ||
    ["local-no-key", "builtin-local", "local-tts-token", "local-stt"].includes(trimmed)
  );
}

/** Parses `$ENV_VAR` or `${ENV_VAR}` syntax without touching plaintext API keys. */
export function parseEnvVarReference(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/u.exec(trimmed);
  return match ? (match[1] ?? match[2]) : undefined;
}

type VaultStoreFile = Record<string, string | Record<string, string>>;

function readRawVaultFile(hostDirPath: string): VaultStoreFile {
  const vaultPath = getHostVaultFilePath(hostDirPath);
  if (!existsSync(vaultPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(vaultPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as VaultStoreFile)
      : {};
  } catch {
    return {};
  }
}

function writeRawVaultFile(hostDirPath: string, store: VaultStoreFile): void {
  atomicWriteJson(getHostVaultFilePath(hostDirPath), store);
}

export function saveHostVaultKey(
  hostDirPath: string,
  sourceId: string,
  rawKey: string,
  keyEntryId = "default"
): string | undefined {
  const trimmed = rawKey.trim();
  if (isPlaceholderSecret(trimmed)) return undefined;
  const store = readRawVaultFile(hostDirPath);
  const existing = store[sourceId];
  const bucket: Record<string, string> =
    typeof existing === "string"
      ? { default: existing }
      : existing && typeof existing === "object"
        ? { ...existing }
        : {};
  bucket[keyEntryId] = trimmed;
  store[sourceId] = bucket;
  writeRawVaultFile(hostDirPath, store);
  return maskSecretValue(trimmed);
}

export function readHostVaultKey(
  hostDirPath: string,
  sourceId: string,
  keyEntryId?: string
): string | undefined {
  const store = readRawVaultFile(hostDirPath);
  const entry = store[sourceId];
  if (!entry) return undefined;
  if (typeof entry === "string") {
    return entry.trim() || undefined;
  }
  if (keyEntryId) {
    return entry[keyEntryId]?.trim() || undefined;
  }
  const first = Object.values(entry).find((v) => typeof v === "string" && v.trim().length > 0);
  return first?.trim() || undefined;
}

export function deleteHostVaultKey(
  hostDirPath: string,
  sourceId: string,
  keyEntryId?: string
): void {
  const store = readRawVaultFile(hostDirPath);
  const entry = store[sourceId];
  if (!entry) return;
  if (!keyEntryId || typeof entry === "string") {
    delete store[sourceId];
  } else {
    const next = { ...entry };
    delete next[keyEntryId];
    if (Object.keys(next).length === 0) {
      delete store[sourceId];
    } else {
      store[sourceId] = next;
    }
  }
  writeRawVaultFile(hostDirPath, store);
}

/**
 * Resolves all enabled effective API keys for a ProviderSource at runtime:
 * - `vault_secret`: loaded from host/vault/provider_keys.json
 * - `env_var`: resolved dynamically from process.env (never persisted to disk)
 */
export function resolveEffectiveSourceApiKeys(
  hostDirPath: string,
  source: ProviderSource,
  env: Readonly<Record<string, string | undefined>> = process.env
): string[] {
  const resolved: string[] = [];
  for (const keyEntry of source.apiKeys) {
    if (!keyEntry.enabled) continue;
    if (keyEntry.kind === "env_var" && keyEntry.envVarName) {
      const value = env[keyEntry.envVarName]?.trim();
      if (value) resolved.push(value);
      continue;
    }
    const secret = readHostVaultKey(hostDirPath, source.id, keyEntry.id);
    if (secret) resolved.push(secret);
  }
  // Backward compat: if a vault key exists under source.id even without an apiKeys entry
  if (resolved.length === 0) {
    const legacy = readHostVaultKey(hostDirPath, source.id);
    if (legacy) resolved.push(legacy);
  }
  return resolved;
}

function hydrateSourceApiKeyStatuses(
  sources: readonly ProviderSource[],
  env: Readonly<Record<string, string | undefined>> = process.env
): ProviderSource[] {
  return sources.map((source) => ({
    ...source,
    apiKeys: source.apiKeys.map((entry) =>
      entry.kind === "env_var" && entry.envVarName
        ? { ...entry, envPresent: Boolean(env[entry.envVarName]?.trim()) }
        : entry
    )
  }));
}

/**
 * Losslessly upgrades a v1 HostInfrastructureConfig (flat `providers[]`) to v2
 * (`providerSources[]` + `modelInstances[]` + derived `providers[]`).
 */
export function migrateHostInfrastructureToV2(
  raw: unknown,
  hostDirPath?: string
): { config: HostInfrastructureConfig; migrated: boolean } {
  const parsed = HostInfrastructureConfigSchema.parse(raw);
  if (parsed.schemaVersion === 2 && parsed.providerSources.length > 0) {
    const hydratedSources = hydrateSourceApiKeyStatuses(parsed.providerSources);
    return {
      config: HostInfrastructureConfigSchema.parse({
        ...parsed,
        schemaVersion: 2,
        providerSources: hydratedSources,
        providers: deriveLegacyProvidersProjection(hydratedSources, parsed.modelInstances)
      }),
      migrated: false
    };
  }

  // Migrate from v1 flat providers[]
  const sources: ProviderSource[] = [];
  const models: ModelInstance[] = [];
  for (const prov of parsed.providers) {
    const hasKey = Boolean(prov.apiKeyMasked && !isPlaceholderSecret(prov.apiKeyMasked)) ||
      Boolean(hostDirPath && readHostVaultKey(hostDirPath, prov.id));
    const apiKeys: ProviderApiKeyEntry[] = [];
    if (hasKey) {
      const envName = parseEnvVarReference(prov.apiKeyMasked);
      if (envName) {
        apiKeys.push({
          id: "default",
          label: "环境变量密钥",
          kind: "env_var",
          envVarName: envName,
          maskedPreview: `$${envName}`,
          enabled: true
        });
      } else {
        const preview = prov.apiKeyMasked || (hostDirPath ? maskSecretValue(readHostVaultKey(hostDirPath, prov.id) ?? "") : "••••••");
        apiKeys.push({
          id: "default",
          label: "主密钥",
          kind: "vault_secret",
          maskedPreview: preview,
          enabled: true
        });
      }
    }

    sources.push(
      ProviderSourceSchema.parse({
        id: prov.id,
        label: prov.label,
        vendor: prov.vendor,
        adapterType: prov.adapterType,
        supportedCapabilities: [prov.capabilityKind],
        baseUrl: prov.baseUrl,
        apiKeys,
        keyRotationStrategy: "round_robin",
        enabled: prov.enabled
      })
    );

    for (const modelId of prov.models) {
      models.push(
        ModelInstanceSchema.parse({
          id: makeDefaultModelInstanceId(prov.id, modelId),
          sourceId: prov.id,
          displayName: modelId,
          modelId,
          capabilityKind: prov.capabilityKind,
          enabled: prov.enabled,
          capabilities: inferModelCapabilities(modelId, prov.capabilityKind),
          defaultTemperature: prov.defaultTemperature,
          defaultMaxTokens: prov.defaultMaxTokens,
          health: prov.health
        })
      );
    }
  }

  const hydratedSources = hydrateSourceApiKeyStatuses(sources);
  const upgraded = HostInfrastructureConfigSchema.parse({
    ...parsed,
    schemaVersion: 2,
    providerSources: hydratedSources,
    modelInstances: models,
    providers: deriveLegacyProvidersProjection(hydratedSources, models)
  });
  return { config: upgraded, migrated: true };
}

export function readHostInfrastructureConfig(hostDirPath: string): HostInfrastructureConfig {
  const filePath = getHostInfrastructureFilePath(hostDirPath);
  if (!existsSync(filePath)) {
    const seeded = createDefaultHostInfrastructureConfig();
    writeHostInfrastructureConfig(hostDirPath, seeded);
    return seeded;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const { config, migrated } = migrateHostInfrastructureToV2(raw, hostDirPath);
  if (migrated) {
    writeHostInfrastructureConfig(hostDirPath, config);
  }
  return config;
}

export function writeHostInfrastructureConfig(
  hostDirPath: string,
  config: HostInfrastructureConfig
): HostInfrastructureConfig {
  const normalized =
    config.providerSources.length === 0 && config.providers.length > 0
      ? migrateHostInfrastructureToV2(config, hostDirPath).config
      : config;
  const hydratedSources = hydrateSourceApiKeyStatuses(normalized.providerSources);
  const validated = HostInfrastructureConfigSchema.parse({
    ...normalized,
    schemaVersion: 2,
    providerSources: hydratedSources,
    providers: deriveLegacyProvidersProjection(hydratedSources, normalized.modelInstances)
  });
  // Strip live envPresent before writing to disk so file stays deterministic
  const toDisk = {
    ...validated,
    providerSources: validated.providerSources.map((src) => ({
      ...src,
      apiKeys: src.apiKeys.map(({ envPresent: _omit, ...rest }) => rest)
    }))
  };
  atomicWriteJson(getHostInfrastructureFilePath(hostDirPath), toDisk);
  return validated;
}

export interface ProviderReferenceUsage {
  readonly scope: "profile_primary" | "profile_brain_override" | "capability_knowledge" | "capability_multimodal";
  readonly targetId: string;
  readonly targetLabel: string;
}

function bindingMatchesProviderOrModel(
  binding: { providerId: string; modelId: string; modelInstanceId?: string } | undefined,
  sourceId: string,
  modelId?: string,
  modelInstanceId?: string
): boolean {
  if (!binding) return false;
  if (modelInstanceId && binding.modelInstanceId) {
    return binding.modelInstanceId === modelInstanceId;
  }
  const sourceMatches =
    binding.providerId === sourceId || binding.providerId.startsWith(`${sourceId}__`);
  if (!sourceMatches) return false;
  if (modelId !== undefined) {
    return binding.modelId === modelId;
  }
  return true;
}

/**
 * Inspects which Profiles or General Capabilities reference a given ProviderSource ID
 * (or optionally a specific ModelInstance under that source).
 */
export function findProviderReferences(
  providerId: string,
  soulConfig: SoulProfileAndCapabilitiesConfig,
  modelId?: string,
  modelInstanceId?: string
): ProviderReferenceUsage[] {
  const usages: ProviderReferenceUsage[] = [];
  for (const profile of soulConfig.profiles) {
    if (bindingMatchesProviderOrModel(profile.primaryChat, providerId, modelId, modelInstanceId)) {
      usages.push({
        scope: "profile_primary",
        targetId: profile.id,
        targetLabel: `配置「${profile.name}」主力对话`
      });
    }
    const overrideLabels: ReadonlyArray<[keyof typeof profile.brainRegionOverrides, string]> = [
      ["fallbackChat", "备用降级"],
      ["W2_agency_planner", "W2 规划"],
      ["W3_sleep_curiosity", "W3 睡眠"],
      ["W4_multimodal", "W4 多模态"],
      ["L0_crisis_classifier", "L0 守卫"]
    ];
    for (const [slot, slotLabel] of overrideLabels) {
      if (bindingMatchesProviderOrModel(profile.brainRegionOverrides[slot], providerId, modelId, modelInstanceId)) {
        usages.push({
          scope: "profile_brain_override",
          targetId: profile.id,
          targetLabel: `配置「${profile.name}」${slotLabel}`
        });
      }
    }
  }
  if (bindingMatchesProviderOrModel(soulConfig.capabilities.knowledge.embeddingBinding, providerId, modelId, modelInstanceId)) {
    usages.push({
      scope: "capability_knowledge",
      targetId: "knowledge.embedding",
      targetLabel: "知识库 Embedding"
    });
  }
  if (bindingMatchesProviderOrModel(soulConfig.capabilities.knowledge.rerankBinding, providerId, modelId, modelInstanceId)) {
    usages.push({
      scope: "capability_knowledge",
      targetId: "knowledge.rerank",
      targetLabel: "知识库 Rerank"
    });
  }
  if (bindingMatchesProviderOrModel(soulConfig.capabilities.multimodal.ttsBinding, providerId, modelId, modelInstanceId)) {
    usages.push({
      scope: "capability_multimodal",
      targetId: "multimodal.tts",
      targetLabel: "语音合成 TTS"
    });
  }
  if (bindingMatchesProviderOrModel(soulConfig.capabilities.multimodal.sttBinding, providerId, modelId, modelInstanceId)) {
    usages.push({
      scope: "capability_multimodal",
      targetId: "multimodal.stt",
      targetLabel: "语音识别 STT"
    });
  }
  return usages;
}

// ---------------------------------------------------------------------------
// Tier-1 ProviderSource CRUD & Multi-Key Pool Management
// ---------------------------------------------------------------------------

export function upsertProviderSource(
  hostDirPath: string,
  source: ProviderSource
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const validated = ProviderSourceSchema.parse(source);
  const exists = current.providerSources.some((item) => item.id === validated.id);
  const nextSources = exists
    ? current.providerSources.map((item) => (item.id === validated.id ? validated : item))
    : [...current.providerSources, validated];
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    providerSources: nextSources
  });
}

export function deleteProviderSource(
  hostDirPath: string,
  sourceId: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  deleteHostVaultKey(hostDirPath, sourceId);
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    providerSources: current.providerSources.filter((item) => item.id !== sourceId),
    modelInstances: current.modelInstances.filter((item) => item.sourceId !== sourceId)
  });
}

export function addSourceApiKey(
  hostDirPath: string,
  sourceId: string,
  rawInput: string,
  label = ""
): { config: HostInfrastructureConfig; keyEntry: ProviderApiKeyEntry } {
  const current = readHostInfrastructureConfig(hostDirPath);
  const source = current.providerSources.find((s) => s.id === sourceId);
  if (!source) {
    throw new Error(`Provider source not found: ${sourceId}`);
  }
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("API Key 或环境变量名不能为空");
  }

  const keyId = `key_${randomUUID().slice(0, 8)}`;
  const envVarName = parseEnvVarReference(trimmed);
  let keyEntry: ProviderApiKeyEntry;

  if (envVarName) {
    keyEntry = {
      id: keyId,
      label: label.trim() || `环境变量 ${envVarName}`,
      kind: "env_var",
      envVarName,
      maskedPreview: `$${envVarName}`,
      enabled: true
    };
  } else {
    if (isPlaceholderSecret(trimmed)) {
      throw new Error("请输入真实有效的 API Key（非脱敏占位符）");
    }
    const masked = saveHostVaultKey(hostDirPath, sourceId, trimmed, keyId);
    if (!masked) {
      throw new Error("无法保存该密钥到宿主机 Vault");
    }
    keyEntry = {
      id: keyId,
      label: label.trim() || `Key #${source.apiKeys.length + 1}`,
      kind: "vault_secret",
      maskedPreview: masked,
      enabled: true
    };
  }

  const nextSource: ProviderSource = {
    ...source,
    apiKeys: [...source.apiKeys, keyEntry]
  };
  const config = upsertProviderSource(hostDirPath, nextSource);
  return { config, keyEntry };
}

export function updateSourceApiKey(
  hostDirPath: string,
  sourceId: string,
  keyId: string,
  patch: { enabled?: boolean; label?: string }
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const source = current.providerSources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Provider source not found: ${sourceId}`);
  const nextKeys = source.apiKeys.map((entry) =>
    entry.id === keyId
      ? {
          ...entry,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {})
        }
      : entry
  );
  return upsertProviderSource(hostDirPath, { ...source, apiKeys: nextKeys });
}

export function removeSourceApiKey(
  hostDirPath: string,
  sourceId: string,
  keyId: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const source = current.providerSources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Provider source not found: ${sourceId}`);
  const target = source.apiKeys.find((entry) => entry.id === keyId);
  if (target?.kind === "vault_secret") {
    deleteHostVaultKey(hostDirPath, sourceId, keyId);
  }
  return upsertProviderSource(hostDirPath, {
    ...source,
    apiKeys: source.apiKeys.filter((entry) => entry.id !== keyId)
  });
}

// ---------------------------------------------------------------------------
// Tier-2 ModelInstance CRUD
// ---------------------------------------------------------------------------

export function upsertModelInstance(
  hostDirPath: string,
  model: ModelInstance
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const source = current.providerSources.find((s) => s.id === model.sourceId);
  if (!source) {
    throw new Error(`Provider source not found for model: ${model.sourceId}`);
  }
  const validated = ModelInstanceSchema.parse(model);
  const exists = current.modelInstances.some((item) => item.id === validated.id);
  const nextModels = exists
    ? current.modelInstances.map((item) => (item.id === validated.id ? validated : item))
    : [...current.modelInstances, validated];

  // Auto-expand source.supportedCapabilities if user adds a new capability kind model under it
  const nextSources = source.supportedCapabilities.includes(validated.capabilityKind)
    ? current.providerSources
    : current.providerSources.map((s) =>
        s.id === source.id
          ? { ...s, supportedCapabilities: [...s.supportedCapabilities, validated.capabilityKind] }
          : s
      );

  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    providerSources: nextSources,
    modelInstances: nextModels
  });
}

export function deleteModelInstance(
  hostDirPath: string,
  instanceId: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    modelInstances: current.modelInstances.filter((item) => item.id !== instanceId)
  });
}

export function updateModelInstanceHealth(
  hostDirPath: string,
  instanceId: string,
  health: ProviderHealth
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    modelInstances: current.modelInstances.map((item) =>
      item.id === instanceId ? { ...item, health } : item
    )
  });
}

// ---------------------------------------------------------------------------
// Backward-Compatible v1 ProviderInstance CRUD (operates cleanly on v2 SSOT)
// ---------------------------------------------------------------------------

export function upsertProviderInstance(
  hostDirPath: string,
  provider: ProviderInstance,
  rawApiKey?: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const existingSource = current.providerSources.find((s) => s.id === provider.id);

  let nextApiKeys: ProviderApiKeyEntry[] = existingSource?.apiKeys ?? [];
  if (rawApiKey && rawApiKey.trim()) {
    const envVar = parseEnvVarReference(rawApiKey);
    if (envVar) {
      const hasEnv = nextApiKeys.some((k) => k.kind === "env_var" && k.envVarName === envVar);
      if (!hasEnv) {
        nextApiKeys = [
          ...nextApiKeys,
          {
            id: `key_${randomUUID().slice(0, 8)}`,
            label: `环境变量 ${envVar}`,
            kind: "env_var",
            envVarName: envVar,
            maskedPreview: `$${envVar}`,
            enabled: true
          }
        ];
      }
    } else if (!isPlaceholderSecret(rawApiKey)) {
      const keyId = nextApiKeys.find((k) => k.kind === "vault_secret")?.id ?? "default";
      const masked = saveHostVaultKey(hostDirPath, provider.id, rawApiKey, keyId);
      if (masked) {
        const entry: ProviderApiKeyEntry = {
          id: keyId,
          label: "主密钥",
          kind: "vault_secret",
          maskedPreview: masked,
          enabled: true
        };
        const existsKey = nextApiKeys.some((k) => k.id === keyId);
        nextApiKeys = existsKey
          ? nextApiKeys.map((k) => (k.id === keyId ? entry : k))
          : [...nextApiKeys, entry];
      }
    }
  }

  const nextSource = ProviderSourceSchema.parse({
    id: provider.id,
    label: provider.label,
    vendor: provider.vendor,
    adapterType: provider.adapterType,
    supportedCapabilities: existingSource
      ? Array.from(new Set([...existingSource.supportedCapabilities, provider.capabilityKind]))
      : [provider.capabilityKind],
    baseUrl: provider.baseUrl,
    apiKeys: nextApiKeys,
    keyRotationStrategy: existingSource?.keyRotationStrategy ?? "round_robin",
    proxyUrl: existingSource?.proxyUrl ?? "",
    timeoutMs: existingSource?.timeoutMs ?? 60000,
    customHeaders: existingSource?.customHeaders ?? {},
    enabled: provider.enabled
  });
  if (existingSource && sameProviderCatalogConnection(existingSource, nextSource)) {
    nextSource.discoveredModels = existingSource.discoveredModels;
    nextSource.lastFetchedAt = existingSource.lastFetchedAt;
    nextSource.catalogSource = existingSource.catalogSource;
  }

  const otherModels = current.modelInstances.filter(
    (m) => !(m.sourceId === provider.id && m.capabilityKind === provider.capabilityKind)
  );
  const updatedModels: ModelInstance[] = provider.models.map((modelId) => {
    const existing = current.modelInstances.find(
      (m) => m.sourceId === provider.id && m.modelId === modelId
    );
    return ModelInstanceSchema.parse({
      id: existing?.id ?? makeDefaultModelInstanceId(provider.id, modelId),
      sourceId: provider.id,
      displayName: existing?.displayName ?? modelId,
      modelId,
      capabilityKind: provider.capabilityKind,
      enabled: provider.enabled,
      capabilities: existing?.capabilities ?? inferModelCapabilities(modelId, provider.capabilityKind),
      chatProtocol: existing?.chatProtocol,
      supportsTemperature: existing?.supportsTemperature,
      contextWindow: existing?.contextWindow,
      contextWindowOverride: existing?.contextWindowOverride,
      useCatalogContextWindow: existing?.useCatalogContextWindow,
      catalogContextWindow: existing?.catalogContextWindow,
      catalogContextWindowIsInputLimit: existing?.catalogContextWindowIsInputLimit,
      catalogMaxOutputTokens: existing?.catalogMaxOutputTokens,
      useCatalogMaxOutputTokens: existing?.useCatalogMaxOutputTokens,
      supportedReasoningEfforts: existing?.supportedReasoningEfforts,
      reasoningEffort: existing?.reasoningEffort,
      defaultTemperature: provider.defaultTemperature,
      defaultMaxTokens: provider.defaultMaxTokens,
      customParams: existing?.customParams ?? {},
      health: provider.health
    });
  });

  const existsSource = current.providerSources.some((s) => s.id === nextSource.id);
  const nextSources = existsSource
    ? current.providerSources.map((s) => (s.id === nextSource.id ? nextSource : s))
    : [...current.providerSources, nextSource];

  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    providerSources: nextSources,
    modelInstances: [...otherModels, ...updatedModels]
  });
}

export function deleteProviderInstance(
  hostDirPath: string,
  providerId: string
): HostInfrastructureConfig {
  return deleteProviderSource(hostDirPath, providerId);
}

// ---------------------------------------------------------------------------
// MCP Server Config CRUD & AstrBot / Claude Desktop JSON Import
// ---------------------------------------------------------------------------

export function upsertMcpServerConfig(
  hostDirPath: string,
  server: McpServerConfig
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const validated = McpServerConfigSchema.parse(server);
  const exists = current.mcpServers.some((item) => item.id === validated.id);
  const nextServers = exists
    ? current.mcpServers.map((item) => (item.id === validated.id ? validated : item))
    : [...current.mcpServers, validated];
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    mcpServers: nextServers
  });
}

export function deleteMcpServerConfig(
  hostDirPath: string,
  serverId: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    mcpServers: current.mcpServers.filter((item) => item.id !== serverId)
  });
}

/**
 * Parses standard AstrBot / Claude Desktop `mcpServers` JSON format:
 * `{ "mcpServers": { "github": { "command": "npx", "args": [...], "env": {...} }, "remote": { "url": "https://...", "transport": "sse" } } }`
 */
export function importMcpServersFromJson(
  hostDirPath: string,
  rawPayload: unknown
): { config: HostInfrastructureConfig; imported: McpServerConfig[] } {
  const obj =
    typeof rawPayload === "string" ? (JSON.parse(rawPayload) as unknown) : rawPayload;
  if (!obj || typeof obj !== "object") {
    throw new Error("MCP JSON 必须是有效对象");
  }
  const root = obj as Record<string, unknown>;
  const mapSource =
    root.mcpServers && typeof root.mcpServers === "object" && !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : !Array.isArray(root)
        ? root
        : {};

  const imported: McpServerConfig[] = [];
  for (const [name, value] of Object.entries(mapSource)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const spec = value as Record<string, unknown>;
    const url = typeof spec.url === "string" ? spec.url.trim() : "";
    const command = typeof spec.command === "string" ? spec.command.trim() : "";
    const rawTransport = typeof spec.transport === "string" ? spec.transport.toLowerCase() : typeof spec.type === "string" ? spec.type.toLowerCase() : "";
    const transport: McpServerConfig["transport"] =
      rawTransport === "sse"
        ? "sse"
        : rawTransport === "streamable_http" || rawTransport === "http" || rawTransport === "streamable-http"
          ? "streamable_http"
          : url && !command
            ? "streamable_http"
            : "stdio";

    const args = Array.isArray(spec.args) ? spec.args.map((a) => String(a)) : [];
    const env: Record<string, string> = {};
    if (spec.env && typeof spec.env === "object" && !Array.isArray(spec.env)) {
      for (const [k, v] of Object.entries(spec.env as Record<string, unknown>)) {
        env[k] = String(v);
      }
    }
    const headers: Record<string, string> = {};
    if (spec.headers && typeof spec.headers === "object" && !Array.isArray(spec.headers)) {
      for (const [k, v] of Object.entries(spec.headers as Record<string, unknown>)) {
        headers[k] = String(v);
      }
    }

    const server = McpServerConfigSchema.parse({
      id: `mcp_${sanitizeIdFragment(name)}`,
      name,
      description: typeof spec.description === "string" ? spec.description : "",
      transport,
      command,
      args,
      env,
      url,
      headers,
      timeoutMs: typeof spec.timeoutMs === "number" ? spec.timeoutMs : 15000,
      enabled: spec.disabled === true ? false : spec.enabled !== false,
      status: "untested",
      discoveredTools: []
    });
    imported.push(server);
  }

  if (imported.length === 0) {
    throw new Error("未在 JSON 中找到有效的 MCP 服务器条目（期望 mcpServers 对象）");
  }

  const current = readHostInfrastructureConfig(hostDirPath);
  const merged = [...current.mcpServers];
  for (const item of imported) {
    const idx = merged.findIndex((existing) => existing.id === item.id);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx]!, ...item };
    } else {
      merged.push(item);
    }
  }
  const config = writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    mcpServers: merged
  });
  return { config, imported };
}

// ---------------------------------------------------------------------------
// Platform Channels CRUD
// ---------------------------------------------------------------------------

export function upsertPlatformChannelInstance(
  hostDirPath: string,
  platform: PlatformChannelInstance
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  const exists = current.platforms.some((item) => item.id === platform.id);
  const nextPlatforms = exists
    ? current.platforms.map((item) => (item.id === platform.id ? platform : item))
    : [...current.platforms, platform];
  return writeHostInfrastructureConfig(hostDirPath, { ...current, platforms: nextPlatforms });
}

export function deletePlatformChannelInstance(
  hostDirPath: string,
  platformId: string
): HostInfrastructureConfig {
  const current = readHostInfrastructureConfig(hostDirPath);
  return writeHostInfrastructureConfig(hostDirPath, {
    ...current,
    platforms: current.platforms.filter((item) => item.id !== platformId)
  });
}
