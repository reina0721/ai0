import { describe, expect, it } from "vitest";

import {
  AgentConfigProfileSchema,
  AgentSkillRecordSchema,
  HOSTED_CHAT_PROVIDER_TEMPLATES,
  HostInfrastructureConfigSchema,
  McpServerConfigSchema,
  ModelInstanceSchema,
  ProviderInstanceSchema,
  ProviderSourceSchema,
  SoulProfileAndCapabilitiesConfigSchema,
  exportProtocolSchemaCatalog
} from "./index.js";
import { PluginConfigFieldSchema } from "../plugin-manifests/index.js";

describe("orthogonal control-plane config schemas", () => {
  it("round-trips hosted provider catalogs alongside entries saved without protocol metadata", () => {
    for (const template of HOSTED_CHAT_PROVIDER_TEMPLATES) {
      const discoveredModels = [
        { modelId: "legacy-model", inferredCapability: "chat" },
        { modelId: "claude-model", inferredCapability: "chat", chatProtocol: "anthropic_messages", supportsTemperature: false }
      ];
      const source = ProviderSourceSchema.parse({
        id: template.id,
        label: template.label,
        vendor: template.vendor,
        adapterType: template.adapterType,
        supportedCapabilities: template.supportedCapabilities,
        baseUrl: template.defaultBaseUrl,
        discoveredModels
      });

      expect(source.adapterType).toBe(template.adapterType);
      expect(source.discoveredModels).toEqual(discoveredModels);
      expect(ProviderSourceSchema.parse(JSON.parse(JSON.stringify(source)))).toEqual(source);
    }
  });

  it("validates two-tier provider sources, model instances, MCP servers, skills, and plugin config fields", () => {
    const source = ProviderSourceSchema.parse({
      id: "src_deepseek",
      label: "DeepSeek 官方",
      vendor: "DeepSeek",
      adapterType: "deepseek",
      supportedCapabilities: ["chat"],
      baseUrl: "https://api.deepseek.com",
      apiKeys: [
        { id: "key_1", label: "主密钥", kind: "vault_secret", maskedPreview: "sk-12••••••90ab", enabled: true },
        { id: "key_2", label: "环境变量", kind: "env_var", envVarName: "DEEPSEEK_API_KEY", maskedPreview: "$DEEPSEEK_API_KEY", enabled: true }
      ],
      keyRotationStrategy: "round_robin"
    });
    expect(source.apiKeys).toHaveLength(2);
    expect(source.timeoutMs).toBe(60000);

    const model = ModelInstanceSchema.parse({
      id: "mdl_deepseek_r1",
      sourceId: "src_deepseek",
      displayName: "DeepSeek Reasoner",
      modelId: "deepseek-reasoner",
      capabilityKind: "chat",
      capabilities: { vision: false, tools: true, reasoning: true, streaming: true }
    });
    expect(model.capabilities.reasoning).toBe(true);
    expect(model.enabled).toBe(true);

    const mcp = McpServerConfigSchema.parse({
      id: "mcp_fs",
      name: "本地文件工具",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    });
    expect(mcp.transport).toBe("stdio");
    expect(mcp.status).toBe("untested");

    const skill = AgentSkillRecordSchema.parse({
      id: "skill_review",
      slug: "daily-review",
      displayName: "每日复盘",
      source: "soul_user",
      filePath: "/tmp/SKILL.md",
      bodyMarkdown: "# Daily Review"
    });
    expect(skill.readonly).toBe(false);

    const field = PluginConfigFieldSchema.parse({
      key: "poetic_style",
      label: "诗意风格",
      type: "select",
      default: "gentle",
      options: [{ value: "gentle", label: "温柔" }]
    });
    expect(field.type).toBe("select");
  });

  it("validates pure provider instances decoupled from business slots", () => {
    const provider = ProviderInstanceSchema.parse({
      id: "prov_openai_main",
      label: "OpenAI 官方",
      vendor: "OpenAI",
      capabilityKind: "chat",
      adapterType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1", "gpt-4.1-mini"]
    });
    expect(provider.models).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(provider.enabled).toBe(true);
    expect(provider.health.status).toBe("untested");
  });

  it("validates host infrastructure and soul profile/capability separation", () => {
    const infra = HostInfrastructureConfigSchema.parse({
      providers: [
        {
          id: "prov_deepseek",
          label: "DeepSeek",
          vendor: "DeepSeek",
          capabilityKind: "chat",
          adapterType: "deepseek",
          baseUrl: "https://api.deepseek.com",
          models: ["deepseek-flash"]
        }
      ],
      platforms: [
        {
          id: "builtin.webchat",
          label: "WebChat",
          adapterKind: "builtin_webchat",
          authMode: "local_builtin",
          builtinPluginId: "builtin.webchat"
        }
      ]
    });
    expect(infra.providers).toHaveLength(1);
    expect(infra.platforms).toHaveLength(1);

    const savedWithoutLayoutPreferences = HostInfrastructureConfigSchema.parse({
      systemSettings: { appearance: "dark", soulTheme: "astral-blue" }
    });
    expect(savedWithoutLayoutPreferences.systemSettings).toMatchObject({
      appearance: "dark",
      soulTheme: "astral-blue",
      navRailMode: "expanded",
      inspectorView: "trace"
    });

    const profile = AgentConfigProfileSchema.parse({
      id: "profile_default",
      name: "默认私密配置",
      primaryChat: { providerId: "prov_deepseek", modelId: "deepseek-flash" }
    });
    expect(profile.conversationGate.debounceMs).toBe(1200);
    expect(profile.conversationGate.neverBroadcastAll).toBe(true);

    const soulCfg = SoulProfileAndCapabilitiesConfigSchema.parse({
      defaultProfileId: "profile_default",
      profiles: [profile],
      routingRules: [
        {
          id: "rule_default",
          label: "公开频道",
          umoPattern: "*:public_livestream:*",
          audienceScope: "public_all",
          profileId: "profile_default"
        }
      ],
      capabilities: {
        knowledge: {
          embeddingBinding: { providerId: "prov_embed", modelId: "bge-m3" }
        },
        multimodal: {
          ttsBinding: { providerId: "prov_tts", modelId: "warm-v2" }
        }
      }
    });
    expect(soulCfg.capabilities.knowledge.embeddingBinding?.modelId).toBe("bge-m3");
    expect(soulCfg.capabilities.multimodal.ttsBinding?.providerId).toBe("prov_tts");
    expect(exportProtocolSchemaCatalog().control_plane.HostInfrastructureConfigSchema.name).toBe(
      "HostInfrastructureConfigSchema"
    );
  });
});
