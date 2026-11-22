import type { VerifiableTurnTrace } from "@ai0/protocol";

export interface LiveBlackboardSlotSnapshot {
  id: string;
  label: string;
  tokenCount: number;
  quotaTokens: number;
  priority: number;
  summary: string;
  locked?: boolean;
}

export interface LiveMemoryLineageNode {
  id: string;
  label: string;
  memoryTier: string;
  visibilityScope: string;
  taintLevel: string;
  contentText: string;
  parentIds: string[];
  sealed: boolean;
}

export interface LiveKnowledgePackSnapshot {
  id: string;
  name: string;
  mounted: boolean;
  documents: number;
  citations: number;
  sampleText: string;
}

export interface LiveExtensionSnapshot {
  id: string;
  carrier: string;
  buses: string[];
  enabled: boolean;
  rev: number;
  readDomains: string[];
  proposeDomains: string[];
}

export interface LiveTelemetryEntry {
  id: string;
  track: "EVENT" | "TRACE" | "AGENCY" | "SYS";
  timestamp: string;
  message: string;
  traceId?: string;
}

export interface LiveHomeostasisSample {
  hour: number;
  circadian: number;
  fastAffect: number;
  slowAffect: number;
}

export interface PromptBrickView {
  id: string;
  title: string;
  icon: string;
  maxTokens: number;
  enabled: boolean;
  locked?: boolean;
  audienceMode: "all" | "private_only" | "masked_in_public";
  educationalTip: string;
  template: string;
}

export interface PromptCompiledPreview {
  promptText: string;
  totalTokens: number;
  maxTokens: number;
  bricks: Array<{
    id: string;
    title: string;
    icon: string;
    tokens: number;
    maxTokens: number;
    included: boolean;
    reason?: string;
    rendered: string;
  }>;
}

export interface ConsoleStudioState {
  version: number;
  onboardingCompleted: boolean;
  soulStudio: {
    displayName: string;
    avatarEmoji: string;
    tagline: string;
    primaryRole: "romantic_partner" | "best_friend" | "digital_employee" | "study_classmate" | "vtuber_partner";
    autoSwitchByVenue: boolean;
    workVenueRole: "romantic_partner" | "best_friend" | "digital_employee" | "study_classmate" | "vtuber_partner";
    ontologicalMode: "poetic_honest" | "pure_roleplay";
    corePersonalityPrompt: string;
    catchphrases: string[];
    bannedCliches: string[];
    goldenVoiceExemplars: Array<{ id: string; mood: string; user: string; assistant: string }>;
    promptBricks: PromptBrickView[];
    maxBlackboardTokens: number;
    temperament: {
      baseMoodValence: number;
      emotionSensitivity: number;
      moodHalfLifeHours: number;
      tensionHalfLifeHours: number;
      maxDailyProactive: number;
      gapMoeIntensity: number;
      zeroExitGuiltLocked: boolean;
    };
    circadianAnchors: Array<{ hour: number; energy: number }>;
    dndStartHour: number;
    dndEndHour: number;
    lorebooks: Array<{
      id: string;
      title: string;
      keys: string[];
      secondaryKeys: string[];
      priority: number;
      tokenBudget: number;
      content: string;
      enabled: boolean;
    }>;
  };
  providers: Array<{
    id: string;
    category: "llm" | "embedding" | "reranker" | "tts" | "stt" | "lora";
    vendor: string;
    name: string;
    baseUrl: string;
    apiKeyMasked: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    enabled: boolean;
    lastLatencyMs: number;
    status: "ready" | "configured" | "untested" | "error";
  }>;
  brainRouting: Record<
    "W1_fast_dialogue" | "W2_agency_planner" | "W3_sleep_curiosity" | "W4_multimodal" | "L0_crisis_classifier",
    { primaryId: string; fallbackId: string; label: string }
  >;
  metabolicPolicy: {
    dailyTokenBudget: number;
    usedTokensToday: number;
    sleepyThresholdPct: number;
    emergencyReservePct: number;
    autoDowngradeEnabled: boolean;
  };
  platforms: Array<{
    id: string;
    kind: "webchat" | "desktop" | "qq_onebot" | "wechat" | "feishu" | "telegram" | "discord" | "livestream" | "live2d";
    name: string;
    endpoint: string;
    enabled: boolean;
    connected: boolean;
    rttMs: number;
    defaultProfileId: string;
    sensors: string[];
    realizers: string[];
    actuators: string[];
    sensorTtlSeconds: number;
    debounceMs: number;
    messagesToday: number;
  }>;
  attentionPolicy: {
    focusHysteresisMs: number;
    neverBroadcastAll: boolean;
    retractDraftAwareness: boolean;
    habituationDecayRate: number;
  };
  profiles: Array<{
    id: string;
    name: string;
    description: string;
    roleArchetype: "romantic_partner" | "best_friend" | "digital_employee" | "study_classmate" | "vtuber_partner";
    llmProviderId: string;
    knowledgeBaseIds: string[];
    enabledPlugins: string[];
    socialMaskEnabled: boolean;
    socialMaskDampingPct: number;
    tokenBudgetPreset: number;
  }>;
  customRules: Array<{
    id: string;
    umo: string;
    label: string;
    platform: string;
    audienceScope: "only_owner" | "fixed_group" | "public_all";
    profileId: string;
    triggerAt: boolean;
    triggerNickname: boolean;
    triggerKeywords: string[];
    proactiveReplyRatePct: number;
    continuousWindowSec: number;
    opportunityExpireSec: number;
    rateLimitPerMin: number;
    allowExternalTools: boolean;
    enabled: boolean;
  }>;
  evolution: {
    sleepFirewall: {
      level0Only: boolean;
      blockPlayfulBanter: boolean;
      autoTriggerIdleMins: number;
      maxArchivePct: number;
    };
    curiositySources: Array<{
      id: string;
      name: string;
      type: "rss" | "kb" | "mcp_readonly";
      urlOrRef: string;
      enabled: boolean;
    }>;
    dreamJournal: Array<{
      id: string;
      date: string;
      title: string;
      content: string;
      kind: "dream" | "curiosity_note";
    }>;
    growthProposals: Array<{
      id: string;
      title: string;
      targetFile: "narrative.md" | "identity.yaml";
      sourceEventSummary: string;
      beforeText: string;
      afterText: string;
      status: "pending" | "approved" | "rejected";
      createdAt: string;
    }>;
  };
  ragSettings: {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    denseWeight: number;
    bm25Weight: number;
    honestForgetThreshold: number;
  };
  agency: {
    subAgents: Array<{
      id: string;
      name: string;
      icon: string;
      specialty: string;
      modelProviderId: string;
      systemPrompt: string;
      allowedTools: string[];
      maxSteps: number;
      enabled: boolean;
    }>;
    activeTasks: Array<{
      id: string;
      title: string;
      subAgentId: string;
      status: "running" | "waiting_approval" | "completed" | "paused";
      currentStep: number;
      totalSteps: number;
      stepLabel: string;
      riskLevel: "read_only_safe" | "needs_owner_confirm" | "high_risk";
      createdAt: string;
      outputSummary?: string;
      crystallizedMemoryId?: string;
    }>;
    scheduledPromises: Array<{
      id: string;
      kind: "agent_promise" | "user_upcoming_event" | "cron_job";
      title: string;
      scheduleExpr: string;
      status: "pending" | "due" | "fulfilled" | "missed";
      note: string;
    }>;
  };
  ecosystem: {
    plugins: Array<{
      id: string;
      name: string;
      version: string;
      bus: string;
      carrier: string;
      enabled: boolean;
      description: string;
      configFields: Array<{
        key: string;
        label: string;
        type: "text" | "number" | "boolean" | "secret";
        value: string | number | boolean;
      }>;
    }>;
    commands: Array<{
      id: string;
      command: string;
      aliases: string[];
      description: string;
      permission: "owner" | "admin" | "all";
      enabled: boolean;
    }>;
    mcpServers: Array<{
      id: string;
      name: string;
      transport: "stdio" | "sse" | "http";
      endpoint: string;
      enabled: boolean;
      tools: Array<{
        name: string;
        description: string;
        risk: "read_only_safe" | "needs_owner_confirm";
      }>;
    }>;
    skills: Array<{
      id: string;
      name: string;
      description: string;
      inCharacterDemeanor: string;
      tools: string[];
      bodyMarkdown: string;
      enabled: boolean;
    }>;
    ecaFlows: Array<{
      id: string;
      name: string;
      whenExpr: string;
      ifExpr: string;
      thenAction: string;
      enabled: boolean;
    }>;
  };
  systemSettings: {
    auth2faEnabled: boolean;
    proxyUrl: string;
    codeSandboxEnabled: boolean;
    sb243BreakMinutes: number;
    crisisHotlineRegion: string;
    appearance: "light" | "dark";
    soulTheme: "sakura-pink" | "astral-blue" | "cyber-emerald";
  };
}

export interface LiveConversationSession {
  umo: string;
  label: string;
  platform: string;
  audienceScope: "only_owner" | "fixed_group" | "public_all";
  profileName: string;
  messageCount: number;
  lastSummary: string;
  lastActiveAt: string;
}

export interface ConsoleLiveSnapshot {
  soulId: string;
  personaName: string;
  soulDir: string;
  targetInstance: "live" | `sandbox:${string}`;
  stateRev: number;
  virtualTsMs: number;
  virtualOffsetHours: number;
  eventsCount: number;
  memoriesCount: number;
  tracesCount: number;
  redactionLedgerCount: number;
  metabolicEnergy: number;
  circadianEnergy: number;
  moodValence: number;
  socialLonging: number;
  frictionTension: number;
  trustBond: number;
  blackboardSlots: LiveBlackboardSlotSnapshot[];
  compiledBlackboardPrompt: string;
  totalBlackboardTokens: number;
  maxBlackboardTokens: number;
  lineageNodes: LiveMemoryLineageNode[];
  knowledgePacks: LiveKnowledgePackSnapshot[];
  milestones: Array<{
    id: string;
    title: string;
    moment: string;
    note: string;
    completed: boolean;
    conditions: string[];
  }>;
  extensions: LiveExtensionSnapshot[];
  recentTraces: VerifiableTurnTrace[];
  latestTrace?: VerifiableTurnTrace;
  telemetryEntries: LiveTelemetryEntry[];
  homeostasisSamples: LiveHomeostasisSample[];
  sb243Metrics: Array<{ year_month: string; crisis_referral_triggered_count: number }>;
  pragmaStatus: { journal_mode: string; foreign_keys: number; secure_delete: number };
  recentTranscript: Array<{ id: string; role: "user" | "assistant"; text: string; timestamp?: string }>;
  studioConfig?: ConsoleStudioState;
  promptPreviewPrivate?: PromptCompiledPreview;
  promptPreviewPublic?: PromptCompiledPreview;
  conversations?: LiveConversationSession[];
  availableSouls?: Array<{ id: string; name: string; role: string; path: string; active: boolean }>;
  narrativeText?: string;
}
