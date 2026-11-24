import type { ProviderAdapterType, ProviderCapabilityKind } from "./orthogonal-config.js";

export interface ProviderVendorTemplate {
  readonly id: string;
  readonly label: string;
  readonly vendor: string;
  readonly capabilityKind: ProviderCapabilityKind;
  readonly supportedCapabilities: readonly ProviderCapabilityKind[];
  readonly adapterType: ProviderAdapterType;
  readonly defaultBaseUrl: string;
  readonly defaultModels: readonly string[];
  readonly requiresApiKey: boolean;
  readonly description: string;
}

export const HOSTED_CHAT_PROVIDER_TEMPLATES: readonly ProviderVendorTemplate[] = Object.freeze([
  {
    id: "tpl_opencode_go",
    label: "OpenCode Go",
    vendor: "OpenCode Go",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "opencode_go",
    defaultBaseUrl: "https://opencode.ai/inference/go/openai/v1",
    defaultModels: ["glm-5.3-flash"],
    requiresApiKey: true,
    description: "OpenCode Go 订阅的编码模型"
  },
  {
    id: "tpl_command_code",
    label: "Command Code",
    vendor: "Command Code",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "command_code",
    defaultBaseUrl: "https://api.commandcode.ai/provider/v1",
    defaultModels: ["deepseek/deepseek-v4-flash"],
    requiresApiKey: true,
    description: "一个 API Key 接入 Claude、GPT 和开放模型"
  },
  {
    id: "tpl_openrouter",
    label: "OpenRouter 聚合路由",
    vendor: "OpenRouter",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: ["openai/gpt-4.1-mini"],
    requiresApiKey: true,
    description: "从统一目录选用不同厂商的对话模型"
  },
  {
    id: "tpl_moonshot",
    label: "Kimi 开放平台",
    vendor: "Moonshot AI",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "moonshot",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModels: ["kimi-k3.1-pro"],
    requiresApiKey: true,
    description: "月之暗面 Kimi 国内标准 API"
  },
  {
    id: "tpl_zhipu",
    label: "智谱 GLM",
    vendor: "智谱 AI",
    capabilityKind: "chat",
    supportedCapabilities: ["chat"],
    adapterType: "zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModels: ["glm-5.3", "glm-5.3-flash"],
    requiresApiKey: true,
    description: "智谱开放平台国内标准 API"
  }
]);
