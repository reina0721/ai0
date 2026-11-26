import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ThemeColorPresetSchema } from "@ai0/protocol";
import { z } from "zod";

export const RelationshipArchetypeSchema = z.enum([
  "romantic_partner",
  "best_friend",
  "digital_employee",
  "study_classmate",
  "vtuber_partner"
]);
export type RelationshipArchetype = z.infer<typeof RelationshipArchetypeSchema>;

export const PromptBrickConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().default("🧩"),
  maxTokens: z.number().int().min(32).max(2000),
  enabled: z.boolean().default(true),
  locked: z.boolean().default(false),
  audienceMode: z.enum(["all", "private_only", "masked_in_public"]).default("all"),
  educationalTip: z.string(),
  provenance: z.enum(["digital_life", "studio", "legacy_unknown"]).optional(),
  template: z.string()
});
export type PromptBrickConfig = z.infer<typeof PromptBrickConfigSchema>;

export const ModelProviderEntrySchema = z.object({
  id: z.string().min(1),
  category: z.enum(["llm", "embedding", "reranker", "tts", "stt", "lora"]),
  vendor: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().default(""),
  apiKeyMasked: z.string().default(""),
  modelId: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.75),
  maxTokens: z.number().int().min(64).max(128000).default(2048),
  enabled: z.boolean().default(true),
  lastLatencyMs: z.number().int().nonnegative().default(0),
  status: z.enum(["ready", "configured", "untested", "error"]).default("untested")
});
export type ModelProviderEntry = z.infer<typeof ModelProviderEntrySchema>;

export const PlatformChannelEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["webchat", "desktop", "qq_onebot", "wechat", "feishu", "telegram", "discord", "livestream", "live2d"]),
  name: z.string().min(1),
  endpoint: z.string().default(""),
  enabled: z.boolean().default(true),
  connected: z.boolean().default(false),
  rttMs: z.number().int().nonnegative().default(18),
  defaultProfileId: z.string().default("profile_private_owner"),
  sensors: z.array(z.string()).default([]),
  realizers: z.array(z.string()).default([]),
  actuators: z.array(z.string()).default([]),
  sensorTtlSeconds: z.number().int().min(1).max(3600).default(15),
  debounceMs: z.number().int().min(0).max(10000).default(1200),
  messagesToday: z.number().int().nonnegative().default(0)
});
export type PlatformChannelEntry = z.infer<typeof PlatformChannelEntrySchema>;

export const SceneProfileEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  roleArchetype: RelationshipArchetypeSchema,
  llmProviderId: z.string().min(1),
  knowledgeBaseIds: z.array(z.string()).default([]),
  enabledPlugins: z.array(z.string()).default(["*"]),
  socialMaskEnabled: z.boolean().default(false),
  socialMaskDampingPct: z.number().int().min(0).max(100).default(70),
  tokenBudgetPreset: z.number().int().min(600).max(6000).default(2200)
});
export type SceneProfileEntry = z.infer<typeof SceneProfileEntrySchema>;

export const CustomSessionRuleSchema = z.object({
  id: z.string().min(1),
  umo: z.string().min(1),
  label: z.string().min(1),
  platform: z.string().min(1),
  audienceScope: z.enum(["only_owner", "fixed_group", "public_all"]),
  profileId: z.string().min(1),
  triggerAt: z.boolean().default(true),
  triggerNickname: z.boolean().default(true),
  triggerKeywords: z.array(z.string()).default([]),
  proactiveReplyRatePct: z.number().int().min(0).max(100).default(15),
  continuousWindowSec: z.number().int().min(0).max(600).default(60),
  opportunityExpireSec: z.number().int().min(5).max(300).default(45),
  rateLimitPerMin: z.number().int().min(1).max(120).default(12),
  allowExternalTools: z.boolean().default(true),
  enabled: z.boolean().default(true)
});
export type CustomSessionRule = z.infer<typeof CustomSessionRuleSchema>;

export const GrowthProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  targetFile: z.enum(["narrative.md", "identity.yaml"]),
  sourceEventSummary: z.string(),
  beforeText: z.string(),
  afterText: z.string(),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  createdAt: z.string()
});
export type GrowthProposal = z.infer<typeof GrowthProposalSchema>;

export const SubAgentEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().default("🤖"),
  specialty: z.string(),
  modelProviderId: z.string(),
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()).default([]),
  executor: z.object({ owner: z.string().min(1), name: z.string().min(1), version: z.number().int().positive(),
    provider: z.string().min(1) }).optional(),
  maxSteps: z.number().int().min(1).max(20).default(8),
  enabled: z.boolean().default(true)
});
export type SubAgentEntry = z.infer<typeof SubAgentEntrySchema>;

export const CoWorkTaskEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subAgentId: z.string(),
  status: z.enum(["queued", "running", "waiting_approval", "completed", "paused"]),
  currentStep: z.number().int().min(0).max(8),
  totalSteps: z.number().int().default(8),
  stepLabel: z.string(),
  riskLevel: z.enum(["read_only_safe", "needs_owner_confirm", "high_risk"]),
  createdAt: z.string(),
  outputSummary: z.string().optional(),
  evidenceId: z.string().optional(),
  approvedExecutor: SubAgentEntrySchema.shape.executor,
  approvedRequestDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  crystallizedMemoryId: z.string().optional()
});
export type CoWorkTaskEntry = z.infer<typeof CoWorkTaskEntrySchema>;

export function taskExecutionApprovalDigest(task: CoWorkTaskEntry, agent: SubAgentEntry): string | undefined {
  const ref = agent.executor;
  if (!agent.enabled || !ref || task.subAgentId !== agent.id) return undefined;
  const approved = [task.id, task.title, agent.id, ref.owner, ref.name, ref.version, ref.provider,
    [...new Set(agent.allowedTools)].sort()];
  return createHash("sha256").update(JSON.stringify(approved)).digest("hex");
}
export function isTaskExecutionApproved(task: CoWorkTaskEntry, agent?: SubAgentEntry): boolean {
  const approval = task.approvedExecutor;
  const ref = agent?.executor;
  return Boolean(approval && ref && agent && task.approvedRequestDigest &&
    ref.owner === approval.owner && ref.name === approval.name && ref.version === approval.version &&
    ref.provider === approval.provider && task.approvedRequestDigest === taskExecutionApprovalDigest(task, agent));
}

export const ScheduledPromiseEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["agent_promise", "user_upcoming_event", "cron_job"]),
  title: z.string().min(1),
  scheduleExpr: z.string(),
  status: z.enum(["pending", "due", "fulfilled", "missed"]),
  note: z.string().default("")
});
export type ScheduledPromiseEntry = z.infer<typeof ScheduledPromiseEntrySchema>;

export const SoulConsoleStudioConfigSchema = z.object({
  version: z.number().int().default(2),
  onboardingCompleted: z.boolean().default(false),
  soulStudio: z.object({
    displayName: z.string().min(1),
    avatarEmoji: z.string().default("🌸"),
    tagline: z.string().default(""),
    responseContract: z.string().trim().min(1).default("agent.standard_v1"),
    maxInteractiveSteps: z.number().int().min(1).max(128).default(2),
    readOnlyTools: z.array(z.object({ packageId: z.string().min(1), name: z.string().min(1) })).default([]),
    manualPackageIds: z.array(z.string().min(1)).default([]),
    primaryRole: RelationshipArchetypeSchema.default("best_friend"),
    publicRole: RelationshipArchetypeSchema.optional(),
    autoSwitchByVenue: z.boolean().default(true),
    workVenueRole: RelationshipArchetypeSchema.default("digital_employee"),
    ontologicalMode: z.enum(["poetic_honest", "pure_roleplay"]).default("poetic_honest"),
    corePersonalityPrompt: z.string(),
    catchphrases: z.array(z.string()),
    bannedCliches: z.array(z.string()),
    goldenVoiceExemplars: z.array(
      z.object({
        id: z.string(),
        mood: z.string(),
        user: z.string(),
        assistant: z.string()
      })
    ),
    promptBricks: z.array(PromptBrickConfigSchema),
    maxBlackboardTokens: z.number().int().min(800).max(6000).default(2200),
    temperament: z.object({
      baseMoodValence: z.number().min(-1).max(1).default(0.28),
      emotionSensitivity: z.number().min(0.1).max(2).default(1.0),
      moodHalfLifeHours: z.number().min(1).max(72).default(12),
      tensionHalfLifeHours: z.number().min(2).max(168).default(24),
      maxDailyProactive: z.number().int().min(0).max(20).default(3),
      gapMoeIntensity: z.number().min(0).max(100).default(68),
      zeroExitGuiltLocked: z.boolean().default(true)
    }),
    circadianAnchors: z.array(
      z.object({
        hour: z.number().int().min(0).max(23),
        energy: z.number().min(0).max(1)
      })
    ),
    dndStartHour: z.number().int().min(0).max(23).default(0),
    dndEndHour: z.number().int().min(0).max(23).default(7),
    lorebooks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        keys: z.array(z.string()),
        secondaryKeys: z.array(z.string()).default([]),
        priority: z.number().int().default(80),
        tokenBudget: z.number().int().default(180),
        content: z.string(),
        enabled: z.boolean().default(true)
      })
    )
  }),
  providers: z.array(ModelProviderEntrySchema),
  brainRouting: z.object({
    W1_fast_dialogue: z.object({ primaryId: z.string(), fallbackId: z.string(), label: z.string() }),
    W2_agency_planner: z.object({ primaryId: z.string(), fallbackId: z.string(), label: z.string() }),
    W3_sleep_curiosity: z.object({ primaryId: z.string(), fallbackId: z.string(), label: z.string() }),
    W4_multimodal: z.object({ primaryId: z.string(), fallbackId: z.string(), label: z.string() }),
    L0_crisis_classifier: z.object({ primaryId: z.string(), fallbackId: z.string(), label: z.string() })
  }),
  metabolicPolicy: z.object({
    dailyTokenBudget: z.number().int().min(10000).max(10000000).default(300000),
    usedTokensToday: z.number().int().nonnegative().default(0),
    sleepyThresholdPct: z.number().int().min(5).max(50).default(25),
    emergencyReservePct: z.number().int().min(1).max(15).default(5),
    autoDowngradeEnabled: z.boolean().default(true)
  }),
  platforms: z.array(PlatformChannelEntrySchema),
  attentionPolicy: z.object({
    focusHysteresisMs: z.number().int().min(500).max(30000).default(4000),
    neverBroadcastAll: z.boolean().default(true),
    retractDraftAwareness: z.boolean().default(true),
    habituationDecayRate: z.number().min(0.01).max(1).default(0.18)
  }),
  profiles: z.array(SceneProfileEntrySchema),
  customRules: z.array(CustomSessionRuleSchema),
  evolution: z.object({
    sleepFirewall: z.object({
      level0Only: z.boolean().default(true),
      blockPlayfulBanter: z.boolean().default(true),
      autoTriggerIdleMins: z.number().int().min(5).max(720).default(45),
      maxArchivePct: z.number().int().min(5).max(50).default(20)
    }),
    curiositySources: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["rss", "kb", "mcp_readonly"]),
        urlOrRef: z.string(),
        enabled: z.boolean().default(true)
      })
    ),
    dreamJournal: z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        title: z.string(),
        content: z.string(),
        kind: z.enum(["dream", "curiosity_note"])
      })
    ),
    growthProposals: z.array(GrowthProposalSchema)
  }),
  ragSettings: z.object({
    chunkSize: z.number().int().min(100).max(2000).default(500),
    chunkOverlap: z.number().int().min(0).max(500).default(80),
    topK: z.number().int().min(1).max(20).default(4),
    denseWeight: z.number().min(0).max(1).default(0.65),
    bm25Weight: z.number().min(0).max(1).default(0.35),
    honestForgetThreshold: z.number().min(0).max(1).default(0.38)
  }),
  agency: z.object({
    subAgents: z.array(SubAgentEntrySchema),
    activeTasks: z.array(CoWorkTaskEntrySchema),
    scheduledPromises: z.array(ScheduledPromiseEntrySchema)
  }),
  ecosystem: z.object({
    plugins: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        version: z.string(),
        bus: z.string(),
        carrier: z.string(),
        enabled: z.boolean(),
        description: z.string(),
        configFields: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            type: z.enum(["text", "number", "boolean", "secret"]),
            value: z.union([z.string(), z.number(), z.boolean()])
          })
        )
      })
    ),
    commands: z.array(
      z.object({
        id: z.string(),
        command: z.string(),
        aliases: z.array(z.string()),
        description: z.string(),
        permission: z.enum(["owner", "admin", "all"]),
        enabled: z.boolean()
      })
    ),
    mcpServers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        transport: z.enum(["stdio", "sse", "http"]),
        endpoint: z.string(),
        enabled: z.boolean(),
        tools: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            risk: z.enum(["read_only_safe", "needs_owner_confirm"])
          })
        )
      })
    ),
    skills: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        inCharacterDemeanor: z.string(),
        tools: z.array(z.string()),
        bodyMarkdown: z.string(),
        enabled: z.boolean()
      })
    ),
    ecaFlows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        whenExpr: z.string(),
        ifExpr: z.string(),
        thenAction: z.string(),
        enabled: z.boolean()
      })
    )
  }),
  systemSettings: z.object({
    auth2faEnabled: z.boolean().default(false),
    proxyUrl: z.string().default(""),
    codeSandboxEnabled: z.boolean().default(true),
    sb243BreakMinutes: z.number().int().min(30).max(180).default(180),
    crisisHotlineRegion: z.string().default("CN-4001619995 / US-988"),
    appearance: z.enum(["light", "dark"]).default("light"),
    soulTheme: ThemeColorPresetSchema.default("sakura-pink")
  })
});

export type SoulConsoleStudioConfig = z.infer<typeof SoulConsoleStudioConfigSchema>;

export const ROLE_ARCHETYPE_PRESETS: Record<
  RelationshipArchetype,
  {
    label: string;
    icon: string;
    subtitle: string;
    defaultPromptHint: string;
    catchphrases: string[];
    maxDailyProactive: number;
    gapMoeIntensity: number;
    tokenBudget: number;
  }
> = {
  romantic_partner: {
    label: "亲密伴侣",
    icon: "heart",
    subtitle: "高情感细腻度、纪念日追踪与温和边界，严格遵循反操控健康约束",
    defaultPromptHint: "以亲密温和且保持独立人格的伴侣姿态相处，尊重对方现实生活作息，离场时温和道别，绝不使用内疚挽留或冷暴力。",
    catchphrases: ["先休息五分钟再继续", "我在听，慢慢说", "我记下来了"],
    maxDailyProactive: 4,
    gapMoeIntensity: 78,
    tokenBudget: 2200
  },
  best_friend: {
    label: "日常挚友",
    icon: "smile",
    subtitle: "松弛自然的交流节奏，兼顾日常留白与低频主动关怀",
    defaultPromptHint: "以熟悉自然的朋友方式交流，给出坦诚直接的反馈，在对方专注工作时保持安静不打扰。",
    catchphrases: ["慢慢来，我在听", "先喝口水喘口气", "交给我来处理"],
    maxDailyProactive: 3,
    gapMoeIntensity: 62,
    tokenBudget: 2200
  },
  digital_employee: {
    label: "专业助理",
    icon: "briefcase",
    subtitle: "侧重知识库核验、SubAgent 协作与结构化任务汇报",
    defaultPromptHint: "以清晰严谨的数字助理姿态协作，优先调用知识库与工具核验事实，输出结构化结论与下一步行动项。",
    catchphrases: ["后台任务已同步推进", "已核验知识库原文", "以下是整理好的核心结论"],
    maxDailyProactive: 2,
    gapMoeIntensity: 25,
    tokenBudget: 3400
  },
  study_classmate: {
    label: "学习同伴",
    icon: "graduation-cap",
    subtitle: "文献拆解、知识库归纳与学习进度协同复盘",
    defaultPromptHint: "以共同钻研的同伴姿态协助拆解复杂概念、梳理知识库笔记并温和提醒学习节奏。",
    catchphrases: ["这段推导我们分步看", "写完这节先休息一下", "笔记重点已整理完毕"],
    maxDailyProactive: 3,
    gapMoeIntensity: 55,
    tokenBudget: 3000
  },
  vtuber_partner: {
    label: "互动搭档",
    icon: "mic",
    subtitle: "强喜剧节奏与留白控制，公开场景默认启用 70% 社交面具隔离",
    defaultPromptHint: "在公开互动中保持轻松机智的节奏与分寸感，严格遵守公开受众隐私隔离，不泄露任何私密记录。",
    catchphrases: ["等等，刚才那条消息很有意思", "先别急着下结论", "咱们聊回正题"],
    maxDailyProactive: 5,
    gapMoeIntensity: 85,
    tokenBudget: 1600
  }
};

const knowledgeTaskExecutor = { owner: "host.knowledge", name: "search", version: 1, provider: "host.knowledge" };
// Fingerprints identify unedited entries shipped in v6. User-edited entries survive migration.
const legacySeedDigests = new Set([
  "2c57efac23c4c81c80d446ae38e4bae0a7b17bab7391e1a644017615f8fc9944",
  "afade81c151b9b94b5841ab54ae48a60438dcc93e4a5c8cb881958b524a77267",
  "16fcaa0e1c601e7076b5753f8270e0cafe04b44bb2f3860c5e246aefc95b2168",
  "4a098f5ed0ddfe8282fbc5128f24cd98ab3fb28d05c1fc9e659007d8ff7207d5",
  "ff2a6789eaa87805e299cd15eb2dc6650dc8477ed248dfc38dd460064bcf07a0",
  "494635b26f39e5f7facf4ee88dcff2ac0d3ffaca3440f229895d64b4fae87744",
  "5eb7ae822b15e8f704b2658a4f0348b48f245a4981be4c89756fecc150047074",
  "fc5457622de78ba20a23f32612143b3ac455ffe57bd9484e010e91b251026b82",
  "c7f9734d5b656893b5679f30dd45b92ca3cd4b4417ff4ea74634f7dbd9537b97",
  "56efecd17e44eeef8453f942c0194de4d5156a1a2c4af8c683e3f903d0ba1612",
  "86b498853891147b868705074d935a7b38be3b2e4116944925cd4da874c3e93d",
  "7e81326e01f093012082ef23676903351c546d74c83de65d276635780caf06de",
  "e4e984626be2229222e0822962349b0c865db1b7361143bce4b32570c92d5ed1",
  "3d8722c143bfd543e7b9a0def968ed95a6d8c70ce1bd0b28e04cd7663b0ddcf3",
  "8c9517d338ccb9a0a80fa1204544cd5021718a9524f393df7599104986b1db3b",
  "8a0eda4defcbf6906d9bf280f83a786219d753841121c786b14b8df1aa99b12d",
  "8d1bd941ae137ad1effbec294136a2d1342e8d128f51b6d3a5b02df1eee4c363",
  "cb74564b34f3783f53ea8f12a12249bda1b7e1e6e9d8782c7863c5c4a2e40bf4",
  "4e0e3422654e8add7b704d1c619023375a83783d0659ded033cf2bdb4fe9ab93",
  "9e99ca9634e8453708f73d87eaf683dd0f0367d05858477e5326c932bf04022e",
  "f0618e550d77cab83951def1160e3211eb6eb854817269b5afd42d92dd53aafd",
  "19f6c5ac5b07baaefed76eb5b695cd84c6ecd0ae9d005aa81a7f81594e964cfd",
  "d749e8b0b669375a5ad3887fc0bbfd8e31704740abc4f79423b80e929585599e",
  "d46b2481320f344b5698451381942c708f7b26847a5d948421ca31bb37c5df61",
  "7ddb0b02db579edc3a12ab308a452d615bf77263a190c35db825b365f1c9805d",
  "546c6c8f229745799409535faea0356a55ad55e08a35da8c28a8f1bf3dcdc987",
  "2e8380324af4304b5030962ddc1b50e6e71513c70983544fcf33edf4e6026854"
]);
const legacyDigest = (item: unknown) => createHash("sha256").update(JSON.stringify(item)).digest("hex");
const isLegacySeed = (item: unknown) => legacySeedDigests.has(legacyDigest(item));

export function createDefaultConsoleStudioConfig(displayName = "Agent", onboardingCompleted = false): SoulConsoleStudioConfig {
  const unbound = { primaryId: "", fallbackId: "", label: "" };
  return SoulConsoleStudioConfigSchema.parse({
    version: 7, onboardingCompleted,
    soulStudio: { displayName, avatarEmoji: "", tagline: "", autoSwitchByVenue: false,
      corePersonalityPrompt: "", catchphrases: [], bannedCliches: [], goldenVoiceExemplars: [], promptBricks: [],
      temperament: { maxDailyProactive: 0, gapMoeIntensity: 0, baseMoodValence: 0 }, circadianAnchors: [], lorebooks: [] },
    providers: [], platforms: [], profiles: [], customRules: [],
    brainRouting: { W1_fast_dialogue: unbound, W2_agency_planner: unbound, W3_sleep_curiosity: unbound,
      W4_multimodal: unbound, L0_crisis_classifier: unbound },
    metabolicPolicy: {}, attentionPolicy: {}, ragSettings: {}, systemSettings: {},
    evolution: { sleepFirewall: {}, curiositySources: [], dreamJournal: [], growthProposals: [] },
    agency: { subAgents: [], activeTasks: [], scheduledPromises: [] },
    ecosystem: { plugins: [], commands: [], mcpServers: [], skills: [], ecaFlows: [] }
  });
}

export function getConsoleStudioConfigPath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "console_studio.json");
}

export function readConsoleStudioConfig(
  soulDirPath: string,
  fallbackDisplayName = basename(resolve(soulDirPath), ".soul")
): SoulConsoleStudioConfig {
  const filePath = getConsoleStudioConfigPath(soulDirPath);
  if (!existsSync(filePath)) {
    return createDefaultConsoleStudioConfig(fallbackDisplayName);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("Invalid studio configuration");
  if (Number(raw.version ?? 0) > 7) throw new Error("Unsupported studio configuration version");
  const parsed = SoulConsoleStudioConfigSchema.parse(raw);
  if (parsed.version < 7) {
    const studio = parsed.soulStudio;
    const normalizedIdentity = studio.displayName ? studio.corePersonalityPrompt.replace(studio.displayName, "__NAME__") : studio.corePersonalityPrompt;
    if (legacyDigest(normalizedIdentity) === "bbf2704ce2b536ccdfb10219410d39731306644505bbab261c9d8c05ad7a9b50") studio.corePersonalityPrompt = "";
    if (legacyDigest(studio.catchphrases) === "4bae8138d40bf06ef691d6fedd96c89dc961e24f659f4da5eaa893b70178b2c2") studio.catchphrases = [];
    if (legacyDigest(studio.bannedCliches) === "f81b320783af2a1465c8437af8089fc367c4080bb9c11e49bb94198709a1561e") studio.bannedCliches = [];
    studio.goldenVoiceExemplars = studio.goldenVoiceExemplars.filter(item => !isLegacySeed(item));
    parsed.providers = parsed.providers.filter(item => !isLegacySeed(item));
    parsed.ecosystem.skills = parsed.ecosystem.skills.filter(item => !isLegacySeed(item));
    parsed.ecosystem.mcpServers = parsed.ecosystem.mcpServers.filter(item => !isLegacySeed(item));
    parsed.ecosystem.ecaFlows = parsed.ecosystem.ecaFlows.filter(item => !isLegacySeed(item));
    parsed.soulStudio.promptBricks = parsed.soulStudio.promptBricks.filter(brick => !isLegacySeed(brick));
    for (const brick of parsed.soulStudio.promptBricks) brick.provenance ??= "legacy_unknown";
    for (const agent of parsed.agency.subAgents) {
      agent.executor = agent.id === "sub_research_scholar" && agent.allowedTools.includes("rag.search_docs") ? knowledgeTaskExecutor : undefined;
    }
    for (const task of parsed.agency.activeTasks) {
      const agent = parsed.agency.subAgents.find(item => item.id === task.subAgentId && item.enabled);
      task.approvedExecutor = task.status === "queued" ? agent?.executor : undefined;
      task.approvedRequestDigest = task.approvedExecutor && agent ? taskExecutionApprovalDigest(task, agent) : undefined;
    }
    parsed.version = 7;
  }
  return parsed;
}

export function writeConsoleStudioConfig(
  soulDirPath: string,
  config: SoulConsoleStudioConfig
): SoulConsoleStudioConfig {
  const validated = SoulConsoleStudioConfigSchema.parse({ ...config, version: 7 });
  const filePath = getConsoleStudioConfigPath(soulDirPath);
  mkdirSync(dirname(filePath), { recursive: true });
  let previous: SoulConsoleStudioConfig | undefined;
  if (existsSync(filePath)) {
    previous = readConsoleStudioConfig(soulDirPath);
  }
  const defaults = createDefaultConsoleStudioConfig(validated.soulStudio.displayName).soulStudio.promptBricks;
  for (const brick of validated.soulStudio.promptBricks) {
    const before = previous?.soulStudio.promptBricks.find(item => item.id === brick.id);
    const seeded = defaults.some(item => item.id === brick.id && item.template === brick.template);
    brick.provenance = before?.template === brick.template ? before.provenance ?? (seeded ? "digital_life" : "legacy_unknown")
      : seeded ? "digital_life" : "studio";
  }
  const temporary = filePath + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(validated, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
  return validated;
}

export function compileStudioPrompt(
  config: SoulConsoleStudioConfig,
  options: {
    audienceScope: "only_owner" | "public_all";
    venueType?: string;
    platform?: string;
    moodValence?: number;
    circadianEnergy?: number;
    metabolicEnergy?: number;
    narrativeSummary?: string;
    recalledMemories?: string[];
    unsaidRemainder?: string;
  }
) {
  const isPublic = options.audienceScope === "public_all";
  const activeRoleKey = isPublic
    ? config.soulStudio.publicRole ?? config.soulStudio.primaryRole
    : config.soulStudio.autoSwitchByVenue && options.venueType === "work_collab"
      ? config.soulStudio.workVenueRole
      : config.soulStudio.primaryRole;
  const roleMeta = ROLE_ARCHETYPE_PRESETS[activeRoleKey];
  const replacements: Record<string, string> = {
    "{{displayName}}": config.soulStudio.displayName,
    "{{activeRoleLabel}}": roleMeta.label,
    "{{corePersonalityPrompt}}": config.soulStudio.corePersonalityPrompt,
    "{{catchphrases}}": config.soulStudio.catchphrases.join(" / "),
    "{{bannedCliches}}": config.soulStudio.bannedCliches.join("、"),
    "{{narrativeSummary}}": options.narrativeSummary ?? "",
    "{{confirmedCollaboration}}": isPublic ? "" : config.evolution.growthProposals
      .filter(proposal => proposal.status === "approved" && proposal.targetFile === "narrative.md")
      .map(proposal => "[已批准记录 " + proposal.id + "] " + proposal.afterText).join("\n"),
    "{{platform}}": options.platform ?? "未指定",
    "{{venueType}}": options.venueType ?? (isPublic ? "public_livestream" : "private_1on1"),
    "{{audienceScope}}": options.audienceScope,
    "{{socialMaskInstruction}}": options.audienceScope,
    "{{desktopWindow}}": options.platform ?? "未上报",
    "{{moodValence}}": options.moodValence?.toFixed(2) ?? "",
    "{{circadianPct}}": options.circadianEnergy === undefined ? "" : String(Math.round(options.circadianEnergy * 100)),
    "{{metabolicPct}}": options.metabolicEnergy === undefined ? "" : String(Math.round(options.metabolicEnergy * 100)),
    "{{gapMoeIntensity}}": String(config.soulStudio.temperament.gapMoeIntensity),
    "{{recalledMemories}}": (options.recalledMemories ?? []
    ).join("；"),
    "{{unsaidRemainder}}": options.unsaidRemainder || "无可核实的未交付文本",
    "{{duePromises}}": isPublic ? "" : config.agency.scheduledPromises.slice(0, 2).map((p) => p.title).join("；"),
    "{{activeTasksSummary}}": isPublic ? "" : config.agency.activeTasks
      .filter((t) => t.status !== "completed")
      .map((t) => `${t.title} (${t.stepLabel})`)
      .join("；") || "当前无进行中的后台异步任务"
  };

  let remaining = config.soulStudio.maxBlackboardTokens;
  const renderedBricks = config.soulStudio.promptBricks.map((brick) => {
    const source = brick.provenance ?? "studio";
    const base = { id: brick.id, title: brick.title, icon: brick.icon, maxTokens: brick.maxTokens, source };
    if (!brick.enabled) {
      return { ...base, tokens: 0, included: false, reason: "已关闭", rendered: "" };
    }
    if (isPublic && brick.audienceMode === "private_only") {
      return { ...base, tokens: 0, included: false, reason: "公开场合自动剥离", rendered: "" };
    }
    const expanded = brick.template.replace(/\{\{\w+\}\}/gu, token => replacements[token] ?? token);
    const text = source === "legacy_unknown" ? "[来源未经核实的历史配置]\n" + expanded : expanded;
    const prefix = "### " + brick.title + "\n";
    const budget = Math.min(remaining, brick.maxTokens);
    const capacity = Math.floor(budget / 0.72) - [...prefix].length - 2;
    if (capacity <= 0) return { ...base, tokens: 0, included: false, reason: "预算不足", rendered: "" };
    const rendered = [...text].slice(0, capacity).join("");
    const tokens = Math.ceil(([...prefix].length + [...rendered].length + 2) * 0.72);
    remaining -= tokens;
    return { ...base, tokens, included: true, rendered, reason: rendered !== text ? "已裁剪" : undefined };
  });

  const promptText = renderedBricks
    .filter((b) => b.included)
    .map((b) => `### ${b.title}\n${b.rendered}`)
    .join("\n\n");

  const totalTokens = renderedBricks.reduce((sum, b) => sum + b.tokens, 0);
  return {
    promptText,
    totalTokens,
    maxTokens: config.soulStudio.maxBlackboardTokens,
    bricks: renderedBricks
  };
}

export const compileStudioPromptPreview = compileStudioPrompt;
