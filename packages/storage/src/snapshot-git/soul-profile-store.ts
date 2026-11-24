import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  SoulProfileAndCapabilitiesConfigSchema,
  type AgentConfigProfile,
  type HostInfrastructureConfig,
  type PlatformAdapterKind,
  type ProviderAdapterType,
  type ProviderCapabilityKind,
  type SoulProfileAndCapabilitiesConfig,
  type UmoRoutingRule
} from "@ai0/protocol";

import {
  getConsoleStudioConfigPath,
  readConsoleStudioConfig,
  type SoulConsoleStudioConfig
} from "./console-studio-config.js";
import {
  createDefaultHostInfrastructureConfig,
  getHostInfrastructureFilePath,
  readHostInfrastructureConfig,
  resolveHostInfrastructureDir,
  saveHostVaultKey,
  writeHostInfrastructureConfig
} from "./host-infrastructure-store.js";

export function getSoulProfilesFilePath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "profiles.json");
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

export function createDefaultSoulProfileConfig(): SoulProfileAndCapabilitiesConfig {
  return SoulProfileAndCapabilitiesConfigSchema.parse({
    schemaVersion: 1,
    defaultProfileId: "profile_private_owner",
    profiles: [
      {
        id: "profile_private_owner",
        name: "私密主配置 (only_owner)",
        description: "面向主账户的默认交互策略，完整检索私密记忆与个人叙事，关闭公开社交面具。",
        roleArchetype: "best_friend",
        primaryChat: { providerId: "prov_deepseek_v3", modelId: "deepseek-flash" },
        brainRegionOverrides: {
          fallbackChat: { providerId: "prov_ollama_local", modelId: "qwen2.5:7b-instruct" },
          W2_agency_planner: { providerId: "prov_claude_sonnet", modelId: "claude-3-7-sonnet-latest" },
          W3_sleep_curiosity: { providerId: "prov_ollama_local", modelId: "qwen2.5:7b-instruct" },
          W4_multimodal: { providerId: "prov_claude_sonnet", modelId: "claude-3-7-sonnet-latest" },
          L0_crisis_classifier: { providerId: "prov_local_guard_lora", modelId: "safety-l0-guard-v1" }
        },
        metabolicPolicy: {
          dailyTokenBudget: 300000,
          usedTokensToday: 0,
          sleepyThresholdPct: 25,
          emergencyReservePct: 5,
          autoDowngradeEnabled: true
        },
        conversationGate: {
          debounceMs: 1200,
          focusHysteresisMs: 4000,
          habituationDecayRate: 0.18,
          retractDraftAwareness: true,
          neverBroadcastAll: true,
          triggerAt: true,
          triggerNickname: true,
          triggerKeywords: [],
          proactiveReplyRatePct: 15,
          rateLimitPerMin: 20
        },
        socialMaskEnabled: false,
        socialMaskDampingPct: 0,
        maxContextTokens: 2200,
        knowledgeCollectionIds: ["kb_harbor_astronomy", "kb_project_architecture"],
        voiceReplyEnabled: false,
        allowedExtensionIds: ["*"],
        allowExternalTools: true
      },
      {
        id: "profile_work_assistant",
        name: "协作任务配置 (work_collab)",
        description: "面向代码评审与资料协作场景，优先使用高推理能力模型并挂载架构知识库。",
        roleArchetype: "digital_employee",
        primaryChat: { providerId: "prov_claude_sonnet", modelId: "claude-3-7-sonnet-latest" },
        brainRegionOverrides: {
          fallbackChat: { providerId: "prov_deepseek_v3", modelId: "deepseek-flash" }
        },
        socialMaskEnabled: true,
        socialMaskDampingPct: 50,
        maxContextTokens: 3400,
        knowledgeCollectionIds: ["kb_project_architecture"],
        voiceReplyEnabled: false,
        allowedExtensionIds: ["*"],
        allowExternalTools: true
      },
      {
        id: "profile_group_public",
        name: "公开受众配置 (70% 社交面具)",
        description: "面向公开群聊与直播间：SQL 层硬隔离私密记忆，情绪阻尼 70%，禁用高危外部工具。",
        roleArchetype: "vtuber_partner",
        primaryChat: { providerId: "prov_deepseek_v3", modelId: "deepseek-flash" },
        brainRegionOverrides: {
          fallbackChat: { providerId: "prov_ollama_local", modelId: "qwen2.5:7b-instruct" }
        },
        socialMaskEnabled: true,
        socialMaskDampingPct: 70,
        maxContextTokens: 1600,
        knowledgeCollectionIds: ["kb_harbor_astronomy"],
        voiceReplyEnabled: false,
        allowedExtensionIds: ["builtin.webchat"],
        allowExternalTools: false
      }
    ],
    routingRules: [
      {
        id: "rule_public_livestream",
        priority: 10,
        label: "公开直播 / 公共频道默认隔离",
        umoPattern: "*:public_livestream:*",
        audienceScope: "public_all",
        profileId: "profile_group_public",
        enabled: true
      },
      {
        id: "rule_work_collab",
        priority: 20,
        label: "协作群组路由",
        umoPattern: "*:group_chat:*",
        audienceScope: "group:default",
        profileId: "profile_work_assistant",
        enabled: true
      }
    ],
    capabilities: {
      knowledge: {
        embeddingBinding: { providerId: "prov_bge_embed", modelId: "bge-m3" },
        rerankBinding: { providerId: "prov_bge_rerank", modelId: "BAAI/bge-reranker-v2-m3" },
        chunkSize: 500,
        chunkOverlap: 80,
        topK: 4,
        denseWeight: 0.65,
        bm25Weight: 0.35,
        honestForgetThreshold: 0.38
      },
      multimodal: {
        ttsBinding: { providerId: "prov_fish_tts", modelId: "ai0-tts-warm-v2" },
        sttBinding: { providerId: "prov_sensevoice_stt", modelId: "SenseVoiceSmall" },
        voiceStyleTag: "warm_natural",
        keyframeChoreographyEnabled: true,
        autoSynthesizeOnVoiceVenue: true
      }
    }
  });
}

function stripRoleSuffixFromLegacyProviderName(name: string, vendor: string): string {
  const cleaned = name
    .replace(/\s*[·•-]\s*(主力对话|推理与规划|本地整理与备用|混合知识库向量嵌入|知识库精排|流式语音与情绪识别).*$/u, "")
    .replace(/\(含单字时间戳\)/u, "")
    .trim();
  if (!cleaned || cleaned === "情感声线合成" || cleaned.includes("L0 本地安全守卫")) {
    return vendor || cleaned || "Provider";
  }
  return cleaned;
}

function mapLegacyCategory(category: SoulConsoleStudioConfig["providers"][number]["category"]): ProviderCapabilityKind {
  switch (category) {
    case "llm": return "chat";
    case "embedding": return "embedding";
    case "reranker": return "rerank";
    case "tts": return "tts";
    case "stt": return "stt";
    case "lora": return "guard_lora";
  }
}

function inferAdapterType(vendor: string, category: ProviderCapabilityKind): ProviderAdapterType {
  const lower = vendor.toLowerCase();
  if (category === "guard_lora") return "builtin_local";
  if (lower.includes("anthropic") || lower.includes("claude")) return "anthropic";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  if (lower.includes("ollama")) return "ollama";
  if (category === "chat" || category === "embedding") return "openai_compatible";
  return "custom_http";
}

function mapLegacyPlatformKind(kind: SoulConsoleStudioConfig["platforms"][number]["kind"]): PlatformAdapterKind {
  switch (kind) {
    case "webchat": return "builtin_webchat";
    case "desktop": return "desktop_shell";
    case "qq_onebot": return "qq_onebot";
    case "wechat": return "wechat";
    case "feishu": return "feishu";
    case "telegram": return "telegram";
    case "discord": return "discord";
    case "live2d": return "live2d";
    case "livestream": return "protocol_v0_ws";
  }
}

/**
 * Losslessly splits a legacy `config/console_studio.json` into:
 * 1) Host-level `infrastructure.json` + `vault/provider_keys.json` (Providers, Platforms, System Settings)
 * 2) Per-soul `config/profiles.json` (Profiles, UMO Routing Rules, Capability Bindings)
 * Runs idempotently when orthogonal config files are missing.
 */
export function ensureOrthogonalStoresMigrated(
  soulDirPath: string,
  hostDirPath: string = resolveHostInfrastructureDir(soulDirPath)
): {
  infrastructure: HostInfrastructureConfig;
  soulProfiles: SoulProfileAndCapabilitiesConfig;
} {
  const infraPath = getHostInfrastructureFilePath(hostDirPath);
  const profilesPath = getSoulProfilesFilePath(soulDirPath);
  const legacyPath = getConsoleStudioConfigPath(soulDirPath);

  const needInfra = !existsSync(infraPath);
  const needProfiles = !existsSync(profilesPath);

  if (!needInfra && !needProfiles) {
    return {
      infrastructure: readHostInfrastructureConfig(hostDirPath),
      soulProfiles: readSoulProfileConfig(soulDirPath)
    };
  }

  let legacy: SoulConsoleStudioConfig | undefined;
  if (existsSync(legacyPath)) {
    try {
      legacy = readConsoleStudioConfig(soulDirPath);
    } catch {
      legacy = undefined;
    }
  }

  if (needInfra) {
    const defaultInfra = createDefaultHostInfrastructureConfig();
    if (legacy) {
      const migratedProviders = legacy.providers.map((prov) => {
        const capabilityKind = mapLegacyCategory(prov.category);
        return {
          id: prov.id,
          label: stripRoleSuffixFromLegacyProviderName(prov.name, prov.vendor),
          vendor: prov.vendor,
          capabilityKind,
          adapterType: inferAdapterType(prov.vendor, capabilityKind),
          baseUrl: prov.baseUrl,
          apiKeyMasked: prov.apiKeyMasked,
          models: [prov.modelId],
          defaultTemperature: prov.temperature,
          defaultMaxTokens: prov.maxTokens,
          enabled: prov.enabled,
          health: {
            status: prov.status,
            latencyMs: prov.lastLatencyMs
          }
        };
      });

      const migratedPlatforms = [
        ...defaultInfra.platforms,
        ...legacy.platforms
          .filter((p) => !defaultInfra.platforms.some((d) => d.id === p.id))
          .map((p) => ({
            id: p.id,
            label: p.name,
            adapterKind: mapLegacyPlatformKind(p.kind),
            endpoint: p.endpoint,
            authMode: "scoped_token" as const,
            defaultAudienceCeiling: "only_owner" as const,
            enabled: p.enabled,
            notes: ""
          }))
      ];

      const migratedMcpServers = legacy.ecosystem.mcpServers.map((srv) => ({
        id: srv.id,
        name: srv.name,
        description: "",
        transport: (srv.transport === "http" ? "streamable_http" : srv.transport) as "stdio" | "sse" | "streamable_http",
        command: srv.transport === "stdio" ? srv.endpoint.split(/\s+/u)[0] ?? "" : "",
        args: srv.transport === "stdio" ? srv.endpoint.split(/\s+/u).slice(1) : [],
        env: {},
        url: srv.transport === "stdio" ? "" : srv.endpoint,
        headers: {},
        timeoutMs: 15000,
        enabled: srv.enabled,
        status: "untested" as const,
        lastLatencyMs: 0,
        discoveredTools: srv.tools.map((t) => ({
          name: t.name,
          description: t.description,
          risk: t.risk
        }))
      }));

      writeHostInfrastructureConfig(hostDirPath, {
        schemaVersion: 1,
        providerSources: [],
        modelInstances: [],
        providers: migratedProviders.length ? migratedProviders : defaultInfra.providers,
        platforms: migratedPlatforms,
        mcpServers: migratedMcpServers.length ? migratedMcpServers : defaultInfra.mcpServers,
        systemSettings: { ...defaultInfra.systemSettings, ...legacy.systemSettings }
      });

      // Copy legacy per-soul vault keys into host-level vault if present
      const legacyVaultPath = join(resolve(soulDirPath), "vault", "provider_keys.json");
      if (existsSync(legacyVaultPath)) {
        try {
          const oldKeys = JSON.parse(readFileSync(legacyVaultPath, "utf8")) as Record<string, string>;
          for (const [providerId, rawKey] of Object.entries(oldKeys)) {
            if (typeof rawKey === "string") saveHostVaultKey(hostDirPath, providerId, rawKey);
          }
        } catch {
          // Ignore unreadable legacy vault
        }
      }
    } else {
      writeHostInfrastructureConfig(hostDirPath, defaultInfra);
    }
  }

  const infrastructure = readHostInfrastructureConfig(hostDirPath);

  if (needProfiles) {
    const defaultProfiles = createDefaultSoulProfileConfig();
    if (legacy) {
      const findModel = (providerId: string): { providerId: string; modelId: string } => {
        const provider = infrastructure.providers.find((p) => p.id === providerId);
        if (provider) return { providerId: provider.id, modelId: provider.models[0]! };
        const fallback = infrastructure.providers.find((p) => p.capabilityKind === "chat");
        return {
          providerId: fallback?.id ?? "prov_deepseek_v3",
          modelId: fallback?.models[0] ?? "deepseek-flash"
        };
      };

      const findByKind = (kind: ProviderCapabilityKind) => {
        const provider = infrastructure.providers.find((p) => p.capabilityKind === kind);
        return provider ? { providerId: provider.id, modelId: provider.models[0]! } : undefined;
      };

      const legacyDebounce = legacy.platforms.find((p) => p.enabled)?.debounceMs ?? 1200;
      const migratedProfiles: AgentConfigProfile[] = legacy.profiles.map((profile, idx) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        roleArchetype: profile.roleArchetype,
        primaryChat: findModel(
          idx === 0 ? legacy.brainRouting.W1_fast_dialogue.primaryId : profile.llmProviderId
        ),
        brainRegionOverrides: {
          fallbackChat: findModel(legacy.brainRouting.W1_fast_dialogue.fallbackId),
          W2_agency_planner: findModel(legacy.brainRouting.W2_agency_planner.primaryId),
          W3_sleep_curiosity: findModel(legacy.brainRouting.W3_sleep_curiosity.primaryId),
          W4_multimodal: findModel(legacy.brainRouting.W4_multimodal.primaryId),
          L0_crisis_classifier: findModel(legacy.brainRouting.L0_crisis_classifier.primaryId)
        },
        metabolicPolicy: legacy.metabolicPolicy,
        conversationGate: {
          debounceMs: legacyDebounce,
          focusHysteresisMs: legacy.attentionPolicy.focusHysteresisMs,
          habituationDecayRate: legacy.attentionPolicy.habituationDecayRate,
          retractDraftAwareness: legacy.attentionPolicy.retractDraftAwareness,
          neverBroadcastAll: legacy.attentionPolicy.neverBroadcastAll,
          triggerAt: true,
          triggerNickname: true,
          triggerKeywords: [],
          proactiveReplyRatePct: 15,
          rateLimitPerMin: 12
        },
        socialMaskEnabled: profile.socialMaskEnabled,
        socialMaskDampingPct: profile.socialMaskDampingPct,
        maxContextTokens: profile.tokenBudgetPreset,
        knowledgeCollectionIds: profile.knowledgeBaseIds,
        voiceReplyEnabled: false,
        allowedExtensionIds: profile.enabledPlugins,
        allowExternalTools: !profile.socialMaskEnabled
      }));

      const migratedRules: UmoRoutingRule[] = legacy.customRules.map((rule, index) => ({
        id: rule.id,
        priority: (index + 1) * 10,
        label: rule.label,
        umoPattern: rule.umo,
        audienceScope: rule.audienceScope === "fixed_group" ? "group:default" : rule.audienceScope,
        profileId: rule.profileId,
        enabled: rule.enabled
      }));

      writeSoulProfileConfig(soulDirPath, {
        schemaVersion: 1,
        defaultProfileId: migratedProfiles[0]?.id ?? defaultProfiles.defaultProfileId,
        profiles: migratedProfiles.length ? migratedProfiles : defaultProfiles.profiles,
        routingRules: migratedRules.length ? migratedRules : defaultProfiles.routingRules,
        capabilities: {
          knowledge: {
            embeddingBinding: findByKind("embedding"),
            rerankBinding: findByKind("rerank"),
            ...legacy.ragSettings
          },
          multimodal: {
            ttsBinding: findByKind("tts"),
            sttBinding: findByKind("stt"),
            voiceStyleTag: "warm_natural",
            keyframeChoreographyEnabled: true,
            autoSynthesizeOnVoiceVenue: true
          }
        }
      });
    } else {
      writeSoulProfileConfig(soulDirPath, defaultProfiles);
    }
  }

  return {
    infrastructure,
    soulProfiles: readSoulProfileConfig(soulDirPath)
  };
}

export function readSoulProfileConfig(soulDirPath: string): SoulProfileAndCapabilitiesConfig {
  const filePath = getSoulProfilesFilePath(soulDirPath);
  if (!existsSync(filePath)) {
    const seeded = createDefaultSoulProfileConfig();
    writeSoulProfileConfig(soulDirPath, seeded);
    return seeded;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return SoulProfileAndCapabilitiesConfigSchema.parse(raw);
}

export function writeSoulProfileConfig(
  soulDirPath: string,
  config: SoulProfileAndCapabilitiesConfig
): SoulProfileAndCapabilitiesConfig {
  const validated = SoulProfileAndCapabilitiesConfigSchema.parse({ ...config, schemaVersion: 1 });
  atomicWriteJson(getSoulProfilesFilePath(soulDirPath), validated);
  return validated;
}
