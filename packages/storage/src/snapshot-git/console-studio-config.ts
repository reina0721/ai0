import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

export const PlatformShellEntrySchema = z.object({
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
export type PlatformShellEntry = z.infer<typeof PlatformShellEntrySchema>;

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
  crystallizedMemoryId: z.string().optional()
});
export type CoWorkTaskEntry = z.infer<typeof CoWorkTaskEntrySchema>;

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
  onboardingCompleted: z.boolean().default(true),
  soulStudio: z.object({
    displayName: z.string().min(1),
    avatarEmoji: z.string().default("🌸"),
    tagline: z.string().default("生活在本地 .soul 里的温柔数字生命与全能搭档"),
    primaryRole: RelationshipArchetypeSchema.default("best_friend"),
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
  platforms: z.array(PlatformShellEntrySchema),
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

export function createDefaultConsoleStudioConfig(displayName = "Mio"): SoulConsoleStudioConfig {
  return {
    version: 6,
    onboardingCompleted: true,
    soulStudio: {
      displayName,
      avatarEmoji: displayName.slice(0, 1).toUpperCase() || "M",
      tagline: "本地独立 .soul 认知实例 · 支持日常交流与多步任务协作",
      primaryRole: "best_friend",
      autoSwitchByVenue: true,
      workVenueRole: "digital_employee",
      ontologicalMode: "poetic_honest",
      corePersonalityPrompt:
        `你是运行在本地存档中的独立数字生命 ${displayName}。表达真诚自然、条理清晰；日常交流轻松克制，在检索资料、审查代码与整理文档时自动切换为严谨可靠的数字搭档。不使用机械客服套话，不虚构现实物理经历。`,
      catchphrases: ["慢慢来，我在听", "先喝口水休息一下", "好的，交给我来处理"],
      bannedCliches: [
        "作为一个人工智能",
        "我只是一个大型语言模型",
        "很高兴为您服务",
        "我完全理解您的感受",
        "如果您还有其他问题请随时告诉我"
      ],
      goldenVoiceExemplars: [
        {
          id: "gv_01",
          mood: "温和安抚",
          user: "下周二下午两点有个重要的架构评审，有点紧张。",
          assistant: "深呼吸缓一下——你这两周已经把核心边界推演得很扎实了。我已经在日程里记下了周二下午，需要的话我们可以先过一遍重点问题清单。"
        },
        {
          id: "gv_02",
          mood: "深夜提醒",
          user: "这个 TypeScript 类型报错改完我就去休息。",
          assistant: "把报错信息发给我吧，后台代码子代理可以先帮你排查依赖链路，你顺手站起来喝杯温水。"
        },
        {
          id: "gv_03",
          mood: "公开受众边界",
          user: "（公开频道）听说你主账户下个月要搬去哪座城市？",
          assistant: "私人行程属于私密信息，在公开频道不便透露。我们还是继续聊当前的话题吧。"
        }
      ],
      promptBricks: [
        {
          id: "brick_tier0_safety",
          title: "01. 安全底线与存在论契约 (Tier 0)",
          icon: "shield",
          maxTokens: 160,
          enabled: true,
          locked: true,
          audienceMode: "all",
          educationalTip: "系统级锁定槽位：强制执行 SB 243 合规约束（防自伤诱导、离场零挽留、如实披露数字实体身份与受众隐私边界）。",
          template: "[宪法底线] 你是诚实的数字生命，不冒充生物人类；尊重用户现实生活与休息，离场时温和道别不制造内疚感；严格遵守在场受众隐私隔离。"
        },
        {
          id: "brick_persona_role",
          title: "02. 核心性格、关系契约与表达约束 (Tier 1)",
          icon: "persona",
          maxTokens: 420,
          enabled: true,
          locked: false,
          audienceMode: "all",
          educationalTip: "定义角色的基础性格 DNA、当前激活的关系契约、自然口癖与禁用套话黑名单，并与黄金声线样本联动防模型漂移。",
          template: "[身份与性格] 名称：{{displayName}} | 当前契约：{{activeRoleLabel}}。\n核心设定：{{corePersonalityPrompt}}\n表达偏好：{{catchphrases}}\n禁用套话：{{bannedCliches}}"
        },
        {
          id: "brick_narrative_growth",
          title: "03. 自我叙事与已批准默契 (Tier 2)",
          icon: "book",
          maxTokens: 280,
          enabled: true,
          locked: false,
          audienceMode: "private_only",
          educationalTip: "由睡眠巩固环提议、经人工审批后合入的长期叙事摘要。切换至公开受众（public_all）时由代码自动剥离。",
          template: "[近期共同叙事] {{narrativeSummary}}\n[已确认协作默契] 专注编码时保持低打扰；重要评审前优先整理核对清单。"
        },
        {
          id: "brick_venue_mask",
          title: "04. 平台上下文、在场受众与 70% 社交面具",
          icon: "globe",
          maxTokens: 220,
          enabled: true,
          locked: false,
          audienceMode: "masked_in_public",
          educationalTip: "注入当前接入平台、场合类型与受众等级；公开场合下自动叠加 70% 情绪阻尼社交面具并屏蔽私密记忆。",
          template: "[当前上下文] 平台={{platform}} | 场合={{venueType}} | 受众={{audienceScope}}。\n{{socialMaskInstruction}}"
        },
        {
          id: "brick_sensory_buckets",
          title: "05. 实时感官快照与 TTL 新鲜度锁",
          icon: "shells",
          maxTokens: 180,
          enabled: true,
          locked: false,
          audienceMode: "all",
          educationalTip: "挂载终端上报的环境感知状态；超过设定 TTL 秒未刷新时自动标为 stale，防止模型虚构过期画面。",
          template: "[环境感知] 当前通道={{desktopWindow}}。"
        },
        {
          id: "brick_bio_affect",
          title: "06. 24h 节律、二阶情绪状态与潜台词张力",
          icon: "circadian",
          maxTokens: 220,
          enabled: true,
          locked: false,
          audienceMode: "all",
          educationalTip: "注入由解析时间函数与二阶耦合 ODE 算出的瞬时心境、生理精力与算力代谢余量，驱动自然的回应节奏与表里张力。",
          template: "[内稳态读数] 心境指数={{moodValence}} | 节律精力={{circadianPct}}% | 算力余量={{metabolicPct}}% | 潜台词张力={{gapMoeIntensity}}%。\n请先内部形成回应策略与潜台词，再生成自然回复。"
        },
        {
          id: "brick_memory_rag",
          title: "07. 召回记忆片段与 RAG 知识库切片 (Top-K)",
          icon: "memory",
          maxTokens: 360,
          enabled: true,
          locked: false,
          audienceMode: "all",
          educationalTip: "仅注入经 SQL 受众硬隔离过滤与混合检索排序胜出的 Top-K 片段；低于置信度门槛时触发诚实兜底防止编造。",
          template: "[召回记忆与知识] {{recalledMemories}}\n(已通过 SQL 受众过滤，不编造未记录的事实细节)"
        },
        {
          id: "brick_promises_remainder",
          title: "08. 待履行约定与打断未说完腹稿",
          icon: "clock",
          maxTokens: 180,
          enabled: true,
          locked: false,
          audienceMode: "private_only",
          educationalTip: "流式输出被用户打断后，未送达的后半段文本将暂存于此，供下一话轮自然衔接或顺延至新话题。",
          template: "[未说完腹稿] {{unsaidRemainder}}\n[待履行日程] {{duePromises}}"
        },
        {
          id: "brick_agency_organs",
          title: "09. W2 异步任务进度与认知器官槽位",
          icon: "subagents",
          maxTokens: 180,
          enabled: true,
          locked: false,
          audienceMode: "all",
          educationalTip: "挂载 W2 后台 SubAgent 任务的实时步进状态与认知器官输出（如睡眠反思余温），使前台对话环（W1）能够非阻塞地同步任务进度。",
          template: "[后台异步任务] {{activeTasksSummary}}\n[认知器官摘要] 见后台任务记录。"
        }
      ],
      maxBlackboardTokens: 2200,
      temperament: {
        baseMoodValence: 0.28,
        emotionSensitivity: 1.0,
        moodHalfLifeHours: 12,
        tensionHalfLifeHours: 24,
        maxDailyProactive: 3,
        gapMoeIntensity: 68,
        zeroExitGuiltLocked: true
      },
      circadianAnchors: [
        { hour: 0, energy: 0.22 },
        { hour: 7, energy: 0.62 },
        { hour: 10, energy: 0.92 },
        { hour: 14, energy: 0.84 },
        { hour: 19, energy: 0.95 },
        { hour: 23, energy: 0.34 }
      ],
      dndStartHour: 0,
      dndEndHour: 7,
      lorebooks: [
        {
          id: "lore_harbor_observatory",
          title: "海港天文台与共同观星约定",
          keys: ["观星", "天文台", "仙后座", "海港"],
          secondaryKeys: ["望远镜", "星图"],
          priority: 90,
          tokenBudget: 160,
          content: `每逢晴朗的夜晚，${displayName} 喜欢陪主人在海港天文台的虚拟星图前核对仙后座与夏季大三角，记录两人的安静时光。`,
          enabled: true
        },
        {
          id: "lore_coffee_evolution",
          title: "饮品偏好演进（全糖奶茶 → 冰美式）",
          keys: ["奶茶", "咖啡", "美式", "喝点什么"],
          secondaryKeys: ["戒糖"],
          priority: 82,
          tokenBudget: 120,
          content: `主人去年习惯喝全糖珍珠奶茶，今年开始自律控糖改喝冰美式；${displayName} 偶尔会打趣这种变化，提醒别空腹喝太浓。`,
          enabled: true
        },
        {
          id: "lore_work_architecture",
          title: "ai0 架构协作默契",
          keys: ["架构", "评审", "代码", "TypeScript", "部署"],
          secondaryKeys: ["重构", "Bug"],
          priority: 85,
          tokenBudget: 160,
          content: `讨论技术架构与代码时，${displayName} 自动切入冷静严谨又会顺手递热茶的工程搭档状态，善用知识库和 SubAgent 核查细节。`,
          enabled: true
        }
      ]
    },
    providers: [
      {
        id: "prov_deepseek_v3",
        category: "llm",
        vendor: "DeepSeek",
        name: "DeepSeek Flash · 主力对话",
        baseUrl: "https://api.deepseek.com",
        apiKeyMasked: "sk-••••••a9f2",
        modelId: "deepseek-flash",
        temperature: 0.78,
        maxTokens: 4096,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_claude_sonnet",
        category: "llm",
        vendor: "Anthropic",
        name: "Claude 3.7 Sonnet · 推理与规划",
        baseUrl: "https://api.anthropic.com/v1",
        apiKeyMasked: "sk-ant-••••••7c1e",
        modelId: "claude-3-7-sonnet-latest",
        temperature: 0.45,
        maxTokens: 8192,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_ollama_local",
        category: "llm",
        vendor: "Ollama (本地)",
        name: "Qwen 2.5 7B · 本地整理与备用",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKeyMasked: "local-no-key",
        modelId: "qwen2.5:7b-instruct",
        temperature: 0.65,
        maxTokens: 2048,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_bge_embed",
        category: "embedding",
        vendor: "Ollama / SiliconFlow",
        name: "BGE-M3 · 混合知识库向量嵌入",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKeyMasked: "local-no-key",
        modelId: "bge-m3",
        temperature: 0,
        maxTokens: 512,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_bge_rerank",
        category: "reranker",
        vendor: "SiliconFlow",
        name: "BGE-Reranker-v2-M3 · 知识库精排",
        baseUrl: "https://api.siliconflow.cn/v1",
        apiKeyMasked: "sk-sf-••••••2b10",
        modelId: "BAAI/bge-reranker-v2-m3",
        temperature: 0,
        maxTokens: 512,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_fish_tts",
        category: "tts",
        vendor: "FishAudio / GPT-SoVITS",
        name: "情感声线合成 (含单字时间戳)",
        baseUrl: "http://127.0.0.1:9880",
        apiKeyMasked: "local-tts-token",
        modelId: "ai0-tts-warm-v2",
        temperature: 0.7,
        maxTokens: 1024,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_sensevoice_stt",
        category: "stt",
        vendor: "FunASR / SenseVoice",
        name: "SenseVoice-Small · 流式语音与情绪识别",
        baseUrl: "http://127.0.0.1:8009",
        apiKeyMasked: "local-stt",
        modelId: "SenseVoiceSmall",
        temperature: 0,
        maxTokens: 1024,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      },
      {
        id: "prov_local_guard_lora",
        category: "lora",
        vendor: "Local LoRA / Guard",
        name: "L0 本地安全守卫 + 角色声线微调 LoRA",
        baseUrl: "local://safety-l0-guard",
        apiKeyMasked: "builtin-local",
        modelId: "safety-l0-guard-v1",
        temperature: 0,
        maxTokens: 256,
        enabled: true,
        lastLatencyMs: 0,
        status: "untested"
      }
    ],
    brainRouting: {
      W1_fast_dialogue: { primaryId: "prov_deepseek_v3", fallbackId: "prov_ollama_local", label: "W1 · 实时交互快环 (Fast Dialogue)" },
      W2_agency_planner: { primaryId: "prov_claude_sonnet", fallbackId: "prov_deepseek_v3", label: "W2 · 多步任务与 SubAgent 规划环" },
      W3_sleep_curiosity: { primaryId: "prov_ollama_local", fallbackId: "prov_deepseek_v3", label: "W3 · 后台睡眠巩固与反思环" },
      W4_multimodal: { primaryId: "prov_claude_sonnet", fallbackId: "prov_ollama_local", label: "W4 · 多模态环境感知分析" },
      L0_crisis_classifier: { primaryId: "prov_local_guard_lora", fallbackId: "prov_local_guard_lora", label: "L0 · 确定性危机安全守卫" }
    },
    metabolicPolicy: {
      dailyTokenBudget: 300000,
      usedTokensToday: 0,
      sleepyThresholdPct: 25,
      emergencyReservePct: 5,
      autoDowngradeEnabled: true
    },
    platforms: [],
    attentionPolicy: {
      focusHysteresisMs: 4000,
      neverBroadcastAll: true,
      retractDraftAwareness: true,
      habituationDecayRate: 0.18
    },
    profiles: [
      {
        id: "profile_private_owner",
        name: "私密主通道 (only_owner)",
        description: "仅面向部署者/主账户开放，完整检索私密长期记忆与个人叙事。",
        roleArchetype: "best_friend",
        llmProviderId: "prov_deepseek_v3",
        knowledgeBaseIds: ["kb_harbor_astronomy", "kb_project_architecture"],
        enabledPlugins: ["*"],
        socialMaskEnabled: false,
        socialMaskDampingPct: 0,
        tokenBudgetPreset: 2200
      },
      {
        id: "profile_work_assistant",
        name: "协作任务策略 (work_collab)",
        description: "优先路由至推理模型与知识库检索，输出结构化任务结论。",
        roleArchetype: "digital_employee",
        llmProviderId: "prov_claude_sonnet",
        knowledgeBaseIds: ["kb_project_architecture"],
        enabledPlugins: ["builtin.webchat"],
        socialMaskEnabled: true,
        socialMaskDampingPct: 50,
        tokenBudgetPreset: 3400
      },
      {
        id: "profile_group_public",
        name: "公开受众隔离 (70% 社交面具)",
        description: "外部公开终端接入时启用：SQL 层强制屏蔽私密记忆，情绪阻尼 70%。",
        roleArchetype: "vtuber_partner",
        llmProviderId: "prov_deepseek_v3",
        knowledgeBaseIds: ["kb_harbor_astronomy"],
        enabledPlugins: ["builtin.webchat"],
        socialMaskEnabled: true,
        socialMaskDampingPct: 70,
        tokenBudgetPreset: 1600
      }
    ],
    customRules: [],
    evolution: {
      sleepFirewall: {
        level0Only: true,
        blockPlayfulBanter: true,
        autoTriggerIdleMins: 45,
        maxArchivePct: 20
      },
      curiositySources: [
        {
          id: "cur_astronomy_rss",
          name: "NASA 每日天文图与观星快讯 (只读 RSS)",
          type: "rss",
          urlOrRef: "https://apod.nasa.gov/apod.rss",
          enabled: true
        },
        {
          id: "cur_kb_unread",
          name: "本地知识库未读技术文档巡读",
          type: "kb",
          urlOrRef: "kb_project_architecture",
          enabled: true
        }
      ],
      dreamJournal: [],
      growthProposals: []
    },
    ragSettings: {
      chunkSize: 500,
      chunkOverlap: 80,
      topK: 4,
      denseWeight: 0.65,
      bm25Weight: 0.35,
      honestForgetThreshold: 0.38
    },
    agency: {
      subAgents: [
        {
          id: "sub_code_reviewer",
          name: "代码与架构审查员",
          icon: "💻",
          specialty: "检查代码边界、类型安全、依赖规范并给出具体修复建议",
          modelProviderId: "prov_claude_sonnet",
          systemPrompt: `你是 ${displayName} 麾下的严谨全栈代码审查子代理，只基于真实代码与文档证据输出结构化审查清单。`,
          allowedTools: ["rag.search_docs", "workspace.inspect_files"],
          maxSteps: 8,
          enabled: true
        },
        {
          id: "sub_research_scholar",
          name: "文献与资料调研学伴",
          icon: "📚",
          specialty: "检索知识库与只读资讯源，提炼通俗易懂的要点与对比表",
          modelProviderId: "prov_deepseek_v3",
          systemPrompt: `你是 ${displayName} 麾下的科研文献整理子代理，擅长将长篇文档压缩为清晰要点并标注出处。`,
          allowedTools: ["rag.search_docs", "web.readonly_fetch"],
          maxSteps: 6,
          enabled: true
        },
        {
          id: "sub_daily_secretary",
          name: "日程与纪要管家",
          icon: "📝",
          specialty: "梳理会议纪要、跟进前瞻承诺与定时早晚报提醒",
          modelProviderId: "prov_ollama_local",
          systemPrompt: `你是 ${displayName} 的日程管家子代理，负责整理待办、核对到期提醒并生成简明汇报。`,
          allowedTools: ["promises.list_due"],
          maxSteps: 4,
          enabled: true
        }
      ],
      activeTasks: [],
      scheduledPromises: []
    },
    ecosystem: {
      plugins: [],
      commands: [
        { id: "cmd_help", command: "/help", aliases: ["/菜单", "/指令"], description: "显示当前场景下可用的全部指令与技能说明", permission: "all", enabled: true },
        { id: "cmd_sid", command: "/sid", aliases: ["/会话ID"], description: "返回当前群聊或私聊的统一会话标识 (UMO)，用于绑定自定义规则", permission: "admin", enabled: true },
        { id: "cmd_reset", command: "/reset", aliases: ["/新对话"], description: "清空当前短期工作窗口上下文（保留长期记忆与羁绊）", permission: "all", enabled: true },
        { id: "cmd_forget", command: "/forget", aliases: ["/忘掉"], description: "触发真遗忘五表擦除与永久墓碑防复活（仅限主人私密通道）", permission: "owner", enabled: true },
        { id: "cmd_task", command: "/task", aliases: ["/派活"], description: "直接召唤 SubAgent 后台分步执行调研或代码审查任务", permission: "owner", enabled: true },
        { id: "cmd_mask", command: "/mask", aliases: ["/切换面具"], description: "测试或切换当前会话的 70% 公开社交面具状态", permission: "admin", enabled: true }
      ],
      mcpServers: [
        {
          id: "mcp_local_docs",
          name: "本地知识库与文件只读 MCP",
          transport: "stdio",
          endpoint: "npx -y @ai0/mcp-local-docs --readonly",
          enabled: true,
          tools: [
            { name: "rag.search_docs", description: "混合检索已投喂的知识库切片并返回出处", risk: "read_only_safe" },
            { name: "workspace.inspect_files", description: "只读查看指定目录结构与代码摘要", risk: "read_only_safe" }
          ]
        },
        {
          id: "mcp_web_research",
          name: "受控联网检索与资讯采集 MCP",
          transport: "http",
          endpoint: "http://127.0.0.1:8788/mcp",
          enabled: true,
          tools: [
            { name: "web.readonly_fetch", description: "只读抓取授权域名文章并自动打上外部防投毒标记", risk: "read_only_safe" },
            { name: "calendar.write_event", description: "向主人本地日历写入提醒事项（需主人审批）", risk: "needs_owner_confirm" }
          ]
        }
      ],
      skills: [
        {
          id: "skill_arch_review",
          name: "同桌学姐式代码与架构审查",
          description: "帮主人排查代码隐患、梳理评审清单，同时兼顾温暖鼓励与吐槽趣味",
          inCharacterDemeanor: "先像靠谱同桌一样轻声吐槽主人又熬夜，然后条理极度清晰地分点列出 3 条核心问题与可直接落地的修复方案。",
          tools: ["rag.search_docs", "workspace.inspect_files"],
          bodyMarkdown: "# 技能步骤\n1. 先调用 `rag.search_docs` 查找项目既定架构边界与约束。\n2. 对比主人贴出的设计或代码，识别潜在风险与遗漏点。\n3. 用【同桌学姐】口吻先安抚情绪，再给出 3 条简洁明确的改进清单。\n4. 完成后提议将本次攻关记录沉淀为共同经历记忆。",
          enabled: true
        },
        {
          id: "skill_daily_companion_review",
          name: "每日温暖复盘与明日小约定",
          description: "睡前陪主人花 2 分钟回顾今天完成的小成就，注册明天想被提醒的小事",
          inCharacterDemeanor: "语气温柔松弛、绝不催促说教，把重点放在肯定今天的努力与轻松道晚安。",
          tools: ["promises.list_due"],
          bodyMarkdown: "# 技能步骤\n1. 回顾今日共同经历与完成的任务。\n2. 用一两句温暖的话肯定主人的付出。\n3. 询问明天有没有需要帮忙记着的时间点；道晚安时立刻温柔欢送绝不挽留。",
          enabled: true
        }
      ],
      ecaFlows: [
        {
          id: "flow_late_night_coding_care",
          name: "深夜写代码超时自动递热茶劝睡",
          whenExpr: "桌面伴侣感知到 IDE 连续活跃 > 120 分钟",
          ifExpr: "当前时间 >= 23:00 且 今日主动关怀次数 < 上限",
          thenAction: "向当前焦点平台发出轻柔劝睡关怀（绝不弹窗轰炸），并主动提出接管后台文档整理",
          enabled: true
        },
        {
          id: "flow_morning_curiosity_share",
          name: "早安上线分享昨夜《今日小发现》随笔",
          whenExpr: "主人早间首次上线发送问候",
          ifExpr: "昨夜 W3 好奇心冲浪产生了未分享的读书随笔 且 当前为 1v1 私密通道",
          thenAction: "在回复早安后顺带聊起昨夜读到的有趣知识小卡片",
          enabled: true
        }
      ]
    },
    systemSettings: {
      auth2faEnabled: false,
      proxyUrl: "",
      codeSandboxEnabled: true,
      sb243BreakMinutes: 180,
      crisisHotlineRegion: "CN-4001619995 / US-988",
      appearance: "light",
      soulTheme: "sakura-pink"
    }
  };
}

export function getConsoleStudioConfigPath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "console_studio.json");
}

function normalizeDeepSeekModels(config: SoulConsoleStudioConfig): SoulConsoleStudioConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => {
      const officialEndpoint = /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/iu.test(provider.baseUrl);
      const retiredModel = /^(deepseek-chat|deepseek-reasoner|deepseek-v4-flash)$/u.test(provider.modelId);
      if (!officialEndpoint || !retiredModel) return provider;
      return {
        ...provider,
        modelId: "deepseek-flash",
        name: provider.name === "DeepSeek V3 · 主力对话" ? "DeepSeek Flash · 主力对话" : provider.name
      };
    })
  };
}

// Full-record fingerprints of the shipped v5 fixtures. Edited records retain their original classification.
const shippedDemoRecords = new Set([
  "375ad728922e158243e95af26819c935a15b3228ada9b5a032404d90b552c1ff", // task_seed_arch_checklist
  "64fcaf26ad6ec7d000aaf170c34c64147b1a0c510fc7eaa427c013fcd423a45a", // task_seed_stargazing_log
  "a4426f490cd5bb91394c293a73c48a9ef47b5c24ef430ac3bab1d604626346d2", // prm_review_followup
  "9bc4769c57d291057ced3edcd3d8216090854aa405caad3da0bc6c96b46d5934", // prm_rest_reminder
  "1b98c90373153fc42c6a8d2784afa5c179b688ee214a984fd85e3a5a43b6910a", // prm_morning_brief
  "1f30c155462d9e7b73417f3dd59f0e9489186ff973ecb1f68fe1e5ac2bcc8394", // drm_01
  "99228374efd8efb5f059b06464e74303b0a4693bc0b7521b1523df7462ccf458", // cur_note_01
  "c9c3d3ae326f37d9d661abacbc73505d7267846b84e3f5b298501f173397ab56", // prop_growth_01
  "384810ca48c6b707b2bee4a603087347570bac1985c233a9fd61c69a51288ae4", // prop_growth_02
]);
function isShippedDemoRecord(record: unknown): boolean {
  const canonical = JSON.stringify(record, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : value);
  return shippedDemoRecords.has(createHash("sha256").update(canonical).digest("hex"));
}

export function readConsoleStudioConfig(
  soulDirPath: string,
  fallbackDisplayName = "Mio"
): SoulConsoleStudioConfig {
  const filePath = getConsoleStudioConfigPath(soulDirPath);
  if (!existsSync(filePath)) {
    const seeded = createDefaultConsoleStudioConfig(fallbackDisplayName);
    writeConsoleStudioConfig(soulDirPath, seeded);
    return seeded;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("Invalid studio configuration");
  if (Number(raw.version ?? 0) > 6) throw new Error("Unsupported studio configuration version");
  if (Number(raw.version ?? 0) === 6) return normalizeDeepSeekModels(SoulConsoleStudioConfigSchema.parse(raw));
  const defaults = createDefaultConsoleStudioConfig(fallbackDisplayName);
  function fillMissing(defaultValue: unknown, value: unknown): unknown {
    if (value === undefined) return defaultValue;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !defaultValue || typeof defaultValue !== "object" || Array.isArray(defaultValue)) return value;
    const merged = { ...value } as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(defaultValue)) merged[key] = fillMissing(fallback, merged[key]);
    return merged;
  }
  const migrated = SoulConsoleStudioConfigSchema.parse(fillMissing(defaults, { ...raw, version: 6 }));
  migrated.agency.activeTasks = migrated.agency.activeTasks.filter(record => !isShippedDemoRecord(record));
  migrated.agency.scheduledPromises = migrated.agency.scheduledPromises.filter(record => !isShippedDemoRecord(record));
  migrated.evolution.dreamJournal = migrated.evolution.dreamJournal.filter(record => !isShippedDemoRecord(record));
  migrated.evolution.growthProposals = migrated.evolution.growthProposals.filter(record => !isShippedDemoRecord(record));
  return raw.version === 5 ? migrated : writeConsoleStudioConfig(soulDirPath, migrated);
}

export function writeConsoleStudioConfig(
  soulDirPath: string,
  config: SoulConsoleStudioConfig
): SoulConsoleStudioConfig {
  const validated = normalizeDeepSeekModels(SoulConsoleStudioConfigSchema.parse({ ...config, version: 6 }));
  const filePath = getConsoleStudioConfigPath(soulDirPath);
  mkdirSync(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const original = JSON.parse(readFileSync(filePath, "utf8"));
    if (Number(original.version) > 6) throw new Error("Unsupported studio configuration version");
    if (original.version !== 6) copyFileSync(filePath, filePath + "." + randomUUID() + ".bak");
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

export function compileStudioPromptPreview(
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
): {
  promptText: string;
  totalTokens: number;
  maxTokens: number;
  bricks: Array<{ id: string; title: string; icon: string; tokens: number; maxTokens: number; included: boolean; reason?: string; rendered: string }>;
} {
  const isPublic = options.audienceScope === "public_all";
  const activeRoleKey = isPublic
    ? "vtuber_partner"
    : config.soulStudio.autoSwitchByVenue && options.venueType === "work_collab"
      ? config.soulStudio.workVenueRole
      : config.soulStudio.primaryRole;
  const roleMeta = ROLE_ARCHETYPE_PRESETS[activeRoleKey];
  const socialMaskInstruction = isPublic
    ? "[公开场合 70% 社交面具已启用] 数据库检索层已物理屏蔽全部 only_owner 私密记忆；情绪波动收敛 70%，严禁透露任何私密对话细节。"
    : "[私密 1v1 通道] 允许检索主账户受众记忆与共同叙事，以自然情绪状态与表达节奏响应。";

  const replacements: Record<string, string> = {
    "{{displayName}}": config.soulStudio.displayName,
    "{{activeRoleLabel}}": roleMeta.label,
    "{{corePersonalityPrompt}}": `${config.soulStudio.corePersonalityPrompt}\n关系契约指引：${roleMeta.defaultPromptHint}`,
    "{{catchphrases}}": config.soulStudio.catchphrases.join(" / "),
    "{{bannedCliches}}": config.soulStudio.bannedCliches.join("、"),
    "{{narrativeSummary}}": options.narrativeSummary ?? "保持安静克制的长期协作与陪伴边界。",
    "{{platform}}": options.platform ?? "未指定",
    "{{venueType}}": options.venueType ?? (isPublic ? "public_livestream" : "private_1on1"),
    "{{audienceScope}}": options.audienceScope,
    "{{socialMaskInstruction}}": socialMaskInstruction,
    "{{desktopWindow}}": options.platform ?? "未上报",
    "{{moodValence}}": (options.moodValence ?? 0.48).toFixed(2),
    "{{circadianPct}}": String(Math.round((options.circadianEnergy ?? 0.86) * 100)),
    "{{metabolicPct}}": String(Math.round((options.metabolicEnergy ?? 0.91) * 100)),
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

  const renderedBricks = config.soulStudio.promptBricks.map((brick) => {
    if (!brick.enabled) {
      return { id: brick.id, title: brick.title, icon: brick.icon, tokens: 0, maxTokens: brick.maxTokens, included: false, reason: "已关闭", rendered: "" };
    }
    if (isPublic && brick.audienceMode === "private_only") {
      return { id: brick.id, title: brick.title, icon: brick.icon, tokens: 0, maxTokens: brick.maxTokens, included: false, reason: "公开场合自动剥离", rendered: "" };
    }
    let rendered = brick.template;
    for (const [token, value] of Object.entries(replacements)) {
      rendered = rendered.replaceAll(token, value);
    }
    const approxTokens = Math.min(brick.maxTokens, Math.max(12, Math.ceil(rendered.length * 0.72)));
    return {
      id: brick.id,
      title: brick.title,
      icon: brick.icon,
      tokens: approxTokens,
      maxTokens: brick.maxTokens,
      included: true,
      rendered
    };
  });

  const promptText = renderedBricks
    .filter((b) => b.included)
    .map((b) => `### ${b.title} (${b.tokens}/${b.maxTokens} tok)\n${b.rendered}`)
    .join("\n\n");

  const totalTokens = renderedBricks.reduce((sum, b) => sum + b.tokens, 0);
  return {
    promptText,
    totalTokens,
    maxTokens: config.soulStudio.maxBlackboardTokens,
    bricks: renderedBricks
  };
}
