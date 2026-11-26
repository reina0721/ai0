import { z } from "zod";

import { AudienceScopeSchema } from "../core-v0/primitives.js";
import {
  CapabilityRiskSchema,
  ExtensionCarrierKindSchema,
  ExtensionFacetIdSchema,
  ExtensionPermissionsSchema,
  PluginConfigFieldSchema,
  ThemeColorPresetSchema
} from "../plugin-manifests/index.js";

/**
 * Orthogonal Configuration & Control-Plane Schemas (SSOT)
 *
 * Separates the system cleanly into four independent planes:
 * 1. Plane IV  (Integrations): Pure external resource pools (Two-Tier ProviderSources -> ModelInstances, Platforms, MCP Servers).
 * 2. Plane III (Capabilities): Cross-cutting subsystems (Knowledge/RAG, Multimodal Voice, Memory, Skills, Extensions) referencing Models by ID.
 * 3. Plane II  (Configuration): Profiles & UMO Routing Rules assembling Models + Capabilities + Persona + Gating.
 * 4. Plane I   (Soul & Runtime): Canonical `.soul` files & live kernel execution.
 */

// ---------------------------------------------------------------------------
// 1. Plane IV — Upstream Service Provider Pool (Two-Tier: Source -> Models)
// ---------------------------------------------------------------------------

export const ProviderCapabilityKindSchema = z.enum([
  "chat",
  "embedding",
  "rerank",
  "tts",
  "stt",
  "guard_lora"
]);
export type ProviderCapabilityKind = z.infer<typeof ProviderCapabilityKindSchema>;

export const ProviderAdapterTypeSchema = z.enum([
  "openai_compatible",
  "anthropic",
  "gemini",
  "deepseek",
  "opencode_go",
  "command_code",
  "openrouter",
  "moonshot",
  "zhipu",
  "ollama",
  "custom_http",
  "builtin_local"
]);
export type ProviderAdapterType = z.infer<typeof ProviderAdapterTypeSchema>;

export const ProviderHealthSchema = z.object({
  status: z.enum(["ready", "configured", "untested", "error"]).default("untested"),
  latencyMs: z.number().int().nonnegative().default(0),
  httpStatus: z.number().int().optional(),
  lastCheckedAt: z.string().optional(),
  detail: z.string().optional(),
  lastResponseSnippet: z.string().optional()
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const KeyRotationStrategySchema = z.enum(["round_robin", "failover"]);
export type KeyRotationStrategy = z.infer<typeof KeyRotationStrategySchema>;

export const ProviderApiKeyEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().default(""),
  kind: z.enum(["vault_secret", "env_var"]).default("vault_secret"),
  /** Environment variable name without leading '$' when kind === "env_var". */
  envVarName: z.string().optional(),
  maskedPreview: z.string().default(""),
  /** Computed live on read when kind === "env_var" (never exposes secret value). */
  envPresent: z.boolean().optional(),
  enabled: z.boolean().default(true)
});
export type ProviderApiKeyEntry = z.infer<typeof ProviderApiKeyEntrySchema>;

export const ModelCapabilitiesSchema = z.object({
  vision: z.boolean().default(false),
  tools: z.boolean().default(true),
  reasoning: z.boolean().default(false),
  streaming: z.boolean().default(true)
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ProviderCatalogSourceSchema = z.enum(["upstream", "official_docs", "built_in"]);
export type ProviderCatalogSource = z.infer<typeof ProviderCatalogSourceSchema>;

const ModelChatProtocolSchema = z.enum(["chat_completions", "anthropic_messages"]);
export const ReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

const ContextWindowSchema = z.number().int().min(512).max(4000000);
const CatalogMaxOutputTokensSchema = z.number().int().positive().max(4000000);

export const DiscoveredRemoteModelSchema = z.object({
  modelId: z.string().min(1),
  inferredCapability: ProviderCapabilityKindSchema.default("chat"),
  ownedBy: z.string().optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  chatProtocol: ModelChatProtocolSchema.optional(),
  supportsTemperature: z.boolean().optional(),
  contextWindow: ContextWindowSchema.optional(),
  contextWindowIsInputLimit: z.boolean().optional(),
  maxOutputTokens: CatalogMaxOutputTokensSchema.optional(),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).optional()
});
export type DiscoveredRemoteModel = z.infer<typeof DiscoveredRemoteModelSchema>;

/** Tier 1: Upstream Vendor Source / Endpoint / Multi-Key Credential Pool */
export const ProviderSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  vendor: z.string().min(1),
  adapterType: ProviderAdapterTypeSchema,
  supportedCapabilities: z.array(ProviderCapabilityKindSchema).min(1).default(["chat"]),
  baseUrl: z.string().default(""),
  apiKeys: z.array(ProviderApiKeyEntrySchema).default([]),
  keyRotationStrategy: KeyRotationStrategySchema.default("round_robin"),
  proxyUrl: z.string().default(""),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  customHeaders: z.record(z.string()).default({}),
  discoveredModels: z.array(DiscoveredRemoteModelSchema).default([]),
  catalogSource: ProviderCatalogSourceSchema.optional(),
  lastFetchedAt: z.string().optional(),
  enabled: z.boolean().default(true)
});
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

/** Tier 2: Individual Selectable Model Instance under a ProviderSource (1:N) */
export const ModelInstanceSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  displayName: z.string().min(1),
  modelId: z.string().min(1),
  capabilityKind: ProviderCapabilityKindSchema,
  enabled: z.boolean().default(true),
  capabilities: ModelCapabilitiesSchema.default({}),
  chatProtocol: ModelChatProtocolSchema.optional(),
  supportsTemperature: z.boolean().optional(),
  contextWindow: ContextWindowSchema.optional(),
  contextWindowOverride: ContextWindowSchema.optional(),
  useCatalogContextWindow: z.boolean().optional(),
  catalogContextWindow: ContextWindowSchema.optional(),
  catalogContextWindowIsInputLimit: z.boolean().optional(),
  catalogMaxOutputTokens: CatalogMaxOutputTokensSchema.optional(),
  useCatalogMaxOutputTokens: z.boolean().optional(),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  defaultTemperature: z.number().min(0).max(2).default(0.75),
  defaultMaxTokens: z.number().int().min(64).max(128000).default(4096),
  customParams: z.record(z.unknown()).default({}),
  health: ProviderHealthSchema.default({ status: "untested", latencyMs: 0 })
});
export type ModelInstance = z.infer<typeof ModelInstanceSchema>;

/** Backward-compatible projected v1 provider entry (derived automatically from Source + Models). */
export const ProviderInstanceSchema = z.object({
  id: z.string().min(1),
  /** Pure connection label (e.g. "DeepSeek 官方", "本地 Ollama"), never hardcoded to a business role. */
  label: z.string().min(1),
  vendor: z.string().min(1),
  capabilityKind: ProviderCapabilityKindSchema,
  adapterType: ProviderAdapterTypeSchema,
  baseUrl: z.string().default(""),
  apiKeyMasked: z.string().default(""),
  /** Available model IDs exposed by this provider instance. */
  models: z.array(z.string().min(1)).min(1),
  defaultTemperature: z.number().min(0).max(2).default(0.75),
  defaultMaxTokens: z.number().int().min(64).max(128000).default(4096),
  enabled: z.boolean().default(true),
  health: ProviderHealthSchema.default({ status: "untested", latencyMs: 0 })
});
export type ProviderInstance = z.infer<typeof ProviderInstanceSchema>;

// ---------------------------------------------------------------------------
// 1b. MCP Servers, Disk-Backed Agent Skills & Extension Market Contracts
// ---------------------------------------------------------------------------

export const McpTransportSchema = z.enum(["stdio", "sse", "streamable_http"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpToolDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  inputSchemaSummary: z.string().optional(),
  risk: z.enum(["read_only_safe", "needs_owner_confirm", "high_risk"]).default("read_only_safe")
});
export type McpToolDescriptor = z.infer<typeof McpToolDescriptorSchema>;

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  transport: McpTransportSchema.default("stdio"),
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  url: z.string().default(""),
  headers: z.record(z.string()).default({}),
  timeoutMs: z.number().int().min(1000).max(120000).default(15000),
  enabled: z.boolean().default(true),
  status: z.enum(["untested", "connected", "error"]).default("untested"),
  lastLatencyMs: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
  lastProbedAt: z.string().optional(),
  discoveredTools: z.array(McpToolDescriptorSchema).default([])
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const AgentSkillRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().default(""),
  source: z.enum(["soul_user", "plugin_bundled"]),
  filePath: z.string().min(1),
  readonly: z.boolean().default(false),
  enabled: z.boolean().default(true),
  requiredMcpTools: z.array(z.string()).default([]),
  requiredVaultSecrets: z.array(z.string()).default([]),
  capabilityRisk: CapabilityRiskSchema.default("read_only_safe"),
  maxAudienceScope: AudienceScopeSchema.default("only_owner"),
  inCharacterDemeanor: z.string().default(""),
  crystallizeAsEpisodicMemory: z.boolean().default(false),
  bodyMarkdown: z.string().default(""),
  updatedAt: z.string().optional()
});
export type AgentSkillRecord = z.infer<typeof AgentSkillRecordSchema>;

export const ExtensionMarketEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  author: z.string().min(1),
  description: z.string().default(""),
  facets: z.array(ExtensionFacetIdSchema).min(1),
  carrierKind: ExtensionCarrierKindSchema,
  tags: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  permissions: ExtensionPermissionsSchema,
  configFields: z.array(PluginConfigFieldSchema).default([]),
  installed: z.boolean().optional(),
  builtin: z.boolean().optional()
});
export type ExtensionMarketEntry = z.infer<typeof ExtensionMarketEntrySchema>;

// ---------------------------------------------------------------------------
// 2. Plane IV — Downstream Platform & Channel Pool (纯粹的消息平台与通道接入池)
// ---------------------------------------------------------------------------

export const PlatformAdapterKindSchema = z.enum([
  "builtin_webchat",
  "builtin_terminal",
  "protocol_v0_ws",
  "qq_onebot",
  "wechat",
  "feishu",
  "telegram",
  "discord",
  "desktop_channel",
  "live2d",
  "webhook"
]);
export type PlatformAdapterKind = z.infer<typeof PlatformAdapterKindSchema>;

export const PlatformChannelInstanceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  adapterKind: PlatformAdapterKindSchema,
  endpoint: z.string().default(""),
  authMode: z.enum(["scoped_token", "webhook_secret", "local_builtin"]).default("scoped_token"),
  defaultAudienceCeiling: AudienceScopeSchema.default("only_owner"),
  enabled: z.boolean().default(true),
  builtinPluginId: z.string().optional(),
  notes: z.string().default("")
});
export type PlatformChannelInstance = z.infer<typeof PlatformChannelInstanceSchema>;

// ---------------------------------------------------------------------------
// 3. Host Infrastructure Config (宿主机全局基础设施配置 — 跨 .soul 实例共享)
// ---------------------------------------------------------------------------

export const DaemonSystemSettingsSchema = z.object({
  auth2faEnabled: z.boolean().default(false),
  proxyUrl: z.string().default(""),
  codeSandboxEnabled: z.boolean().default(true),
  sb243BreakMinutes: z.number().int().min(30).max(180).default(180),
  crisisHotlineRegion: z.string().default("CN-4001619995 / US-988"),
  appearance: z.enum(["light", "dark"]).default("light"),
  soulTheme: ThemeColorPresetSchema.default("sakura-pink"),
  navRailMode: z.enum(["mini", "expanded", "dual"]).default("expanded"),
  inspectorView: z.enum(["trace", "sandbox-diff"]).default("trace")
});
export type DaemonSystemSettings = z.infer<typeof DaemonSystemSettingsSchema>;

export const HostInfrastructureConfigSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(2),
  providerSources: z.array(ProviderSourceSchema).default([]),
  modelInstances: z.array(ModelInstanceSchema).default([]),
  /** Backward-compatible derived flat projection for v1 consumers. */
  providers: z.array(ProviderInstanceSchema).default([]),
  platforms: z.array(PlatformChannelInstanceSchema).default([]),
  mcpServers: z.array(McpServerConfigSchema).default([]),
  systemSettings: DaemonSystemSettingsSchema.default({})
});
export type HostInfrastructureConfig = z.infer<typeof HostInfrastructureConfigSchema>;

// ---------------------------------------------------------------------------
// 4. Plane II — Profiles & UMO Routing Rules (核心配置与会话路由层)
// ---------------------------------------------------------------------------

export const ModelSlotBindingSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  /** Optional explicit Tier-2 ModelInstance ID for exact resolution. */
  modelInstanceId: z.string().min(1).optional()
});
export type ModelSlotBinding = z.infer<typeof ModelSlotBindingSchema>;

export const RoleArchetypeSchema = z.enum([
  "romantic_partner",
  "best_friend",
  "digital_employee",
  "study_classmate",
  "vtuber_partner"
]);
export type RoleArchetype = z.infer<typeof RoleArchetypeSchema>;

export const BrainRegionOverridesSchema = z.object({
  fallbackChat: ModelSlotBindingSchema.optional(),
  W2_agency_planner: ModelSlotBindingSchema.optional(),
  W3_sleep_curiosity: ModelSlotBindingSchema.optional(),
  W4_multimodal: ModelSlotBindingSchema.optional(),
  L0_crisis_classifier: ModelSlotBindingSchema.optional()
});
export type BrainRegionOverrides = z.infer<typeof BrainRegionOverridesSchema>;

export const MetabolicBudgetPolicySchema = z.object({
  dailyTokenBudget: z.number().int().min(10000).max(10000000).default(300000),
  usedTokensToday: z.number().int().nonnegative().default(0),
  sleepyThresholdPct: z.number().int().min(5).max(50).default(25),
  emergencyReservePct: z.number().int().min(1).max(15).default(5),
  autoDowngradeEnabled: z.boolean().default(true)
});
export type MetabolicBudgetPolicy = z.infer<typeof MetabolicBudgetPolicySchema>;

export const ConversationGatePolicySchema = z.object({
  debounceMs: z.number().int().min(0).max(10000).default(1200),
  focusHysteresisMs: z.number().int().min(0).max(30000).default(4000),
  habituationDecayRate: z.number().min(0.01).max(1).default(0.18),
  retractDraftAwareness: z.boolean().default(true),
  neverBroadcastAll: z.boolean().default(true),
  triggerAt: z.boolean().default(true),
  triggerNickname: z.boolean().default(true),
  triggerKeywords: z.array(z.string()).default([]),
  proactiveReplyRatePct: z.number().int().min(0).max(100).default(15),
  rateLimitPerMin: z.number().int().min(1).max(120).default(12)
});
export type ConversationGatePolicy = z.infer<typeof ConversationGatePolicySchema>;

export const AgentConfigProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  roleArchetype: RoleArchetypeSchema.default("best_friend"),
  /** Primary LLM binding (AstrBot-simple upfront model selection). */
  primaryChat: ModelSlotBindingSchema,
  /** Optional progressive-disclosure overrides for heterogeneous W1-W4/L0 brain regions. */
  brainRegionOverrides: BrainRegionOverridesSchema.default({}),
  metabolicPolicy: MetabolicBudgetPolicySchema.default({}),
  /** Conversation rhythm, debounce & focus arbitration (moved out of Platform Adapters). */
  conversationGate: ConversationGatePolicySchema.default({}),
  /** Social mask & context budget. */
  socialMaskEnabled: z.boolean().default(false),
  socialMaskDampingPct: z.number().int().min(0).max(100).default(70),
  maxContextTokens: z.number().int().min(600).max(8000).default(2200),
  /** Mounted general capabilities. */
  knowledgeCollectionIds: z.array(z.string()).default([]),
  voiceReplyEnabled: z.boolean().default(false),
  allowedExtensionIds: z.array(z.string()).default(["*"]),
  allowExternalTools: z.boolean().default(true)
});
export type AgentConfigProfile = z.infer<typeof AgentConfigProfileSchema>;

export const UmoRoutingRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int().min(0).max(1000).default(100),
  label: z.string().min(1),
  /** Unified Message Object pattern: [platform_or_channel]:[venue_type]:[session_or_principal] (* wildcards supported). */
  umoPattern: z.string().min(1),
  audienceScope: AudienceScopeSchema.default("only_owner"),
  profileId: z.string().min(1),
  enabled: z.boolean().default(true)
});
export type UmoRoutingRule = z.infer<typeof UmoRoutingRuleSchema>;

// ---------------------------------------------------------------------------
// 5. Plane III — General Capability Configs (独立横向通用能力配置)
// ---------------------------------------------------------------------------

export const KnowledgeCapabilityConfigSchema = z.object({
  embeddingBinding: ModelSlotBindingSchema.optional(),
  rerankBinding: ModelSlotBindingSchema.optional(),
  chunkSize: z.number().int().min(100).max(2000).default(500),
  chunkOverlap: z.number().int().min(0).max(500).default(80),
  topK: z.number().int().min(1).max(20).default(4),
  denseWeight: z.number().min(0).max(1).default(0.65),
  bm25Weight: z.number().min(0).max(1).default(0.35),
  honestForgetThreshold: z.number().min(0).max(1).default(0.38)
});
export type KnowledgeCapabilityConfig = z.infer<typeof KnowledgeCapabilityConfigSchema>;

export const MultimodalCapabilityConfigSchema = z.object({
  ttsBinding: ModelSlotBindingSchema.optional(),
  sttBinding: ModelSlotBindingSchema.optional(),
  voiceStyleTag: z.string().default("warm_natural"),
  keyframeChoreographyEnabled: z.boolean().default(true),
  autoSynthesizeOnVoiceVenue: z.boolean().default(true)
});
export type MultimodalCapabilityConfig = z.infer<typeof MultimodalCapabilityConfigSchema>;

export const SoulProfileAndCapabilitiesConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  defaultProfileId: z.string().min(1),
  profiles: z.array(AgentConfigProfileSchema).min(1),
  routingRules: z.array(UmoRoutingRuleSchema).default([]),
  capabilities: z.object({
    knowledge: KnowledgeCapabilityConfigSchema.default({}),
    multimodal: MultimodalCapabilityConfigSchema.default({})
  }).default({})
});
export type SoulProfileAndCapabilitiesConfig = z.infer<
  typeof SoulProfileAndCapabilitiesConfigSchema
>;

export const ResolvedSessionRouteSchema = z.object({
  umo: z.string(),
  matchedRuleId: z.string().nullable(),
  matchedRuleLabel: z.string(),
  profileId: z.string(),
  profileName: z.string(),
  effectiveAudienceScope: AudienceScopeSchema,
  audienceDowngradedByCeiling: z.boolean(),
  primaryChat: ModelSlotBindingSchema,
  fallbackChat: ModelSlotBindingSchema,
  socialMaskActive: z.boolean(),
  socialMaskDampingPct: z.number().int().min(0).max(100),
  maxContextTokens: z.number().int(),
  debounceMs: z.number().int()
});
export type ResolvedSessionRoute = z.infer<typeof ResolvedSessionRouteSchema>;
