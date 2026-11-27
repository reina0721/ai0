import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ThemeColorPresetSchema } from "@ai0/protocol";
import { z } from "zod";

export const RolePresetIdSchema = z.string().min(1);
export type RolePresetId = z.infer<typeof RolePresetIdSchema>;
export const RelationshipArchetypeSchema = RolePresetIdSchema;
export type RelationshipArchetype = RolePresetId;

export interface RoleArchetypePreset {
  label: string;
  icon: string;
  subtitle: string;
  defaultPromptHint: string;
  catchphrases: string[];
  maxDailyProactive: number;
  subtextTensionIntensity: number;
  tokenBudget: number;
}

export const DEFAULT_ROLE_PRESETS: Readonly<Record<string, RoleArchetypePreset>> = {
  assistant: {
    label: "通用助理",
    icon: "briefcase",
    subtitle: "侧重知识库核验、工具调用与清晰结论汇报",
    defaultPromptHint: "以清晰严谨的助理姿态协作，优先依据授权事实与工具回执给出结构化结论。",
    catchphrases: ["已核验相关记录", "以下是整理好的结论"],
    maxDailyProactive: 1,
    subtextTensionIntensity: 0,
    tokenBudget: 3000
  },
  digital_employee: {
    label: "专业助理",
    icon: "briefcase",
    subtitle: "侧重知识库核验、SubAgent 协作与结构化任务汇报",
    defaultPromptHint: "以清晰严谨的专业助理姿态协作，优先调用知识库与工具核验事实，输出结构化结论与下一步行动项。",
    catchphrases: ["后台任务已同步推进", "已核验知识库原文", "以下是整理好的核心结论"],
    maxDailyProactive: 2,
    subtextTensionIntensity: 25,
    tokenBudget: 3400
  },
  collaborator: {
    label: "日常协作伙伴",
    icon: "smile",
    subtitle: "松弛自然的交流节奏，兼顾日常留白与低频提醒",
    defaultPromptHint: "以自然坦诚的协作伙伴方式交流，给出直接反馈，在对方专注时保持安静不打扰。",
    catchphrases: ["慢慢来，我在听", "交给我来处理"],
    maxDailyProactive: 2,
    subtextTensionIntensity: 40,
    tokenBudget: 2400
  },
  study_classmate: {
    label: "学习同伴",
    icon: "graduation-cap",
    subtitle: "文献拆解、知识库归纳与学习进度协同复盘",
    defaultPromptHint: "以共同钻研的同伴姿态协助拆解复杂概念、梳理知识库笔记并温和提醒学习节奏。",
    catchphrases: ["这段推导我们分步看", "笔记重点已整理完毕"],
    maxDailyProactive: 2,
    subtextTensionIntensity: 45,
    tokenBudget: 3000
  }
};

export const ROLE_ARCHETYPE_PRESETS = DEFAULT_ROLE_PRESETS;

export function resolveRolePreset(
  roleId: string | undefined,
  extraPresets?: Readonly<Record<string, RoleArchetypePreset>>
): RoleArchetypePreset {
  const key = roleId?.trim() || "assistant";
  const matched = extraPresets?.[key] ?? DEFAULT_ROLE_PRESETS[key];
  if (matched) return matched;
  return { ...DEFAULT_ROLE_PRESETS.assistant!, label: key };
}

export const PromptBrickConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().default("🧩"),
  maxTokens: z.number().int().min(32).max(2000),
  enabled: z.boolean().default(true),
  locked: z.boolean().default(false),
  audienceMode: z.enum(["all", "private_only", "masked_in_public"]).default("all"),
  educationalTip: z.string(),
  provenance: z.enum(["preset", "studio"]).optional(),
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
  roleArchetype: RolePresetIdSchema,
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
  executionMode: z.enum(["service_executor", "agent_tool_loop"]).default("service_executor"),
  skillIds: z.array(z.string().min(1)).default([]),
  allowedTools: z.array(z.string()).default([]),
  executor: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    provider: z.string().min(1)
  }).optional(),
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
  if (!agent.enabled || task.subAgentId !== agent.id) return undefined;
  if (agent.executionMode === "agent_tool_loop") {
    if (agent.allowedTools.length === 0) return undefined;
    const approved = [
      task.id,
      task.title,
      agent.id,
      "agent_tool_loop",
      agent.modelProviderId,
      [...new Set(agent.allowedTools)].sort(),
      [...new Set(agent.skillIds)].sort()
    ];
    return createHash("sha256").update(JSON.stringify(approved)).digest("hex");
  }
  const ref = agent.executor;
  if (!ref) return undefined;
  const approved = [task.id, task.title, agent.id, ref.owner, ref.name, ref.version, ref.provider,
    [...new Set(agent.allowedTools)].sort()];
  return createHash("sha256").update(JSON.stringify(approved)).digest("hex");
}

export function isTaskExecutionApproved(task: CoWorkTaskEntry, agent?: SubAgentEntry): boolean {
  if (!agent || !task.approvedRequestDigest) return false;
  if (agent.executionMode === "agent_tool_loop") {
    return task.approvedRequestDigest === taskExecutionApprovalDigest(task, agent);
  }
  const approval = task.approvedExecutor;
  const ref = agent.executor;
  return Boolean(approval && ref &&
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
  version: z.number().int().default(1),
  onboardingCompleted: z.boolean().default(false),
  soulStudio: z.object({
    displayName: z.string().min(1),
    avatarEmoji: z.string().default("🌸"),
    tagline: z.string().default(""),
    responseContract: z.string().trim().min(1).default("agent.standard_v1"),
    maxInteractiveSteps: z.number().int().min(1).max(128).default(2),
    readOnlyTools: z.array(z.object({ packageId: z.string().min(1), name: z.string().min(1) })).default([]),
    manualPackageIds: z.array(z.string().min(1)).default([]),
    primaryRole: RolePresetIdSchema.default("assistant"),
    publicRole: RolePresetIdSchema.optional(),
    autoSwitchByVenue: z.boolean().default(true),
    workVenueRole: RolePresetIdSchema.default("digital_employee"),
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
      baseMoodValence: z.number().min(-1).max(1).default(0),
      emotionSensitivity: z.number().min(0.1).max(2).default(1.0),
      moodHalfLifeHours: z.number().min(1).max(72).default(12),
      tensionHalfLifeHours: z.number().min(2).max(168).default(24),
      maxDailyProactive: z.number().int().min(0).max(20).default(0),
      subtextTensionIntensity: z.number().min(0).max(100).default(0),
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

export function createDefaultConsoleStudioConfig(displayName = "Agent", onboardingCompleted = false): SoulConsoleStudioConfig {
  const unbound = { primaryId: "", fallbackId: "", label: "" };
  return SoulConsoleStudioConfigSchema.parse({
    version: 1,
    onboardingCompleted,
    soulStudio: {
      displayName,
      avatarEmoji: "",
      tagline: "",
      autoSwitchByVenue: false,
      corePersonalityPrompt: "",
      catchphrases: [],
      bannedCliches: [],
      goldenVoiceExemplars: [],
      promptBricks: [],
      temperament: { maxDailyProactive: 0, subtextTensionIntensity: 0, baseMoodValence: 0 },
      circadianAnchors: [],
      lorebooks: []
    },
    providers: [],
    platforms: [],
    profiles: [],
    customRules: [],
    brainRouting: {
      W1_fast_dialogue: unbound,
      W2_agency_planner: unbound,
      W3_sleep_curiosity: unbound,
      W4_multimodal: unbound,
      L0_crisis_classifier: unbound
    },
    metabolicPolicy: {},
    attentionPolicy: {},
    ragSettings: {},
    systemSettings: {},
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
  return SoulConsoleStudioConfigSchema.parse(raw);
}

export function writeConsoleStudioConfig(
  soulDirPath: string,
  config: SoulConsoleStudioConfig
): SoulConsoleStudioConfig {
  const validated = SoulConsoleStudioConfigSchema.parse({ ...config, version: 1 });
  const filePath = getConsoleStudioConfigPath(soulDirPath);
  mkdirSync(dirname(filePath), { recursive: true });
  for (const brick of validated.soulStudio.promptBricks) {
    brick.provenance ??= "studio";
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
    rolePresets?: Readonly<Record<string, RoleArchetypePreset>>;
  }
) {
  const isPublic = options.audienceScope === "public_all";
  const activeRoleKey = isPublic
    ? config.soulStudio.publicRole ?? config.soulStudio.primaryRole
    : config.soulStudio.autoSwitchByVenue && options.venueType === "work_collab"
      ? config.soulStudio.workVenueRole
      : config.soulStudio.primaryRole;
  const roleMeta = resolveRolePreset(activeRoleKey, options.rolePresets);
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
    "{{subtextTensionIntensity}}": String(config.soulStudio.temperament.subtextTensionIntensity),
    "{{recalledMemories}}": (options.recalledMemories ?? []).join("；"),
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
    const text = brick.template.replace(/\{\{\w+\}\}/gu, token => replacements[token] ?? token);
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
