import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import {
  BlackboardPolicySchema,
  ExtensionsStateJsonSchema,
  IdentityYamlSchema,
  LorebookYamlSchema,
  MilestonesAndRitualsYamlSchema,
  OrchestrationRulesSchema,
  SkillMarkdownFrontmatterSchema
} from "@ai0/protocol";
import { z } from "zod";

import { CoordinatorStorageMutator } from "../sqlite/database-driver.js";

const UTF8 = "utf8";

export const SoulArchiveManifestSchema = z.object({
  schema_version: z.string().min(1),
  soul_id: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  active_model_profile: z.string().min(1)
});
export type SoulArchiveManifest = z.infer<typeof SoulArchiveManifestSchema>;

/**
 * Voice exemplar fields are intentionally extensible until the protocol owns
 * a canonical row schema. Each JSONL line must still be a JSON object.
 */
export const VoiceExemplarSchema = z.record(z.unknown());
export type VoiceExemplar = z.infer<typeof VoiceExemplarSchema>;

export const NarrativeMarkdownSchema = z.string();

export const RedactionLedgerEntrySchema = z.object({
  target_event_ids: z.array(z.string()),
  target_memory_ids: z.array(z.string()),
  redacted_at_wall_ts: z.number().int().nonnegative()
});
export const RedactionLedgerSchema = z.array(RedactionLedgerEntrySchema);
export type RedactionLedgerEntry = z.infer<
  typeof RedactionLedgerEntrySchema
>;

export const SoulSkillDocumentSchema = z.object({
  frontmatter: SkillMarkdownFrontmatterSchema,
  body: z.string()
});
export type SoulSkillDocument = z.infer<typeof SoulSkillDocumentSchema>;

export const SoulArchiveConfigSchema = z
  .object({
    manifest: SoulArchiveManifestSchema,
    identity: IdentityYamlSchema,
    narrative: NarrativeMarkdownSchema,
    voiceExemplars: z.array(VoiceExemplarSchema),
    blackboardPolicy: BlackboardPolicySchema,
    milestonesAndRituals: MilestonesAndRitualsYamlSchema,
    defaultWorldLorebook: LorebookYamlSchema,
    dailyCompanionReviewSkill: SoulSkillDocumentSchema,
    defaultOrchestrationFlow: OrchestrationRulesSchema,
    extensionsState: ExtensionsStateJsonSchema,
    redactionLedger: RedactionLedgerSchema
  })
  .superRefine((config, context) => {
    if (config.manifest.soul_id !== config.identity.soul_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identity", "soul_id"],
        message: "identity.soul_id must match manifest.soul_id"
      });
    }
  });
export type SoulArchiveConfig = z.infer<typeof SoulArchiveConfigSchema>;
export type SoulArchiveConfigInput = z.input<typeof SoulArchiveConfigSchema>;

export interface InitializeSoulDirectoryOptions {
  /** Replace existing archive configuration files. Defaults to false. */
  overwrite?: boolean;
  /** A fully validated archive seed. Defaults to the built-in Mio seed. */
  config?: SoulArchiveConfigInput;
  /** Creation timestamp used only by the built-in seed. */
  createdAt?: string;
}

export interface WriteSoulArchiveConfigOptions {
  /** Replace existing configuration files. Defaults to true. */
  overwrite?: boolean;
}

/** Absolute paths for every file managed inside a `.soul` archive. */
export class SoulDirectoryLayout {
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly identityPath: string;
  readonly narrativePath: string;
  readonly voiceExemplarsPath: string;
  readonly blackboardPolicyPath: string;
  readonly milestonesAndRitualsPath: string;
  readonly lorebooksPath: string;
  readonly defaultWorldLorebookPath: string;
  readonly skillsPath: string;
  readonly dailyCompanionReviewSkillPath: string;
  readonly flowsPath: string;
  readonly defaultOrchestrationFlowPath: string;
  readonly configPath: string;
  readonly extensionsStatePath: string;
  readonly statePath: string;
  readonly soulCoreDatabasePath: string;
  readonly redactionLedgerPath: string;
  readonly attachmentsPath: string;

  constructor(soulDirPath: string) {
    if (soulDirPath.trim().length === 0) {
      throw new TypeError("soulDirPath must not be empty.");
    }

    this.rootPath = resolve(soulDirPath);
    this.manifestPath = join(this.rootPath, "manifest.json");
    this.identityPath = join(this.rootPath, "identity.yaml");
    this.narrativePath = join(this.rootPath, "narrative.md");
    this.voiceExemplarsPath = join(this.rootPath, "voice_exemplars.jsonl");
    this.blackboardPolicyPath = join(this.rootPath, "blackboard_policy.yaml");
    this.milestonesAndRitualsPath = join(
      this.rootPath,
      "milestones_and_rituals.yaml"
    );
    this.lorebooksPath = join(this.rootPath, "lorebooks");
    this.defaultWorldLorebookPath = join(
      this.lorebooksPath,
      "default_world.yaml"
    );
    this.skillsPath = join(this.rootPath, "skills");
    this.dailyCompanionReviewSkillPath = join(
      this.skillsPath,
      "daily-companion-review",
      "SKILL.md"
    );
    this.flowsPath = join(this.rootPath, "flows");
    this.defaultOrchestrationFlowPath = join(
      this.flowsPath,
      "default_orchestration.flow.yaml"
    );
    this.configPath = join(this.rootPath, "config");
    this.extensionsStatePath = join(
      this.configPath,
      "extensions_state.json"
    );
    this.statePath = join(this.rootPath, "state");
    this.soulCoreDatabasePath = join(this.statePath, "soul_core.sqlite");
    this.redactionLedgerPath = join(
      this.statePath,
      "redaction_ledger.json"
    );
    this.attachmentsPath = join(this.rootPath, "attachments");
  }
}

function ensureDirectories(layout: SoulDirectoryLayout): void {
  for (const directoryPath of [
    layout.rootPath,
    layout.lorebooksPath,
    join(layout.skillsPath, "daily-companion-review"),
    layout.flowsPath,
    layout.configPath,
    layout.statePath,
    layout.attachmentsPath
  ]) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function parseJsonSource(filePath: string, source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Invalid JSON-compatible YAML/JSON in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function readStructuredFile<TSchema extends z.ZodTypeAny>(
  filePath: string,
  schema: TSchema
): z.output<TSchema> {
  const parsed = parseJsonSource(filePath, readFileSync(filePath, UTF8));
  return schema.parse(parsed) as z.output<TSchema>;
}

function readVoiceExemplars(filePath: string): VoiceExemplar[] {
  const source = readFileSync(filePath, UTF8);
  const rows: VoiceExemplar[] = [];

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    const parsed = parseJsonSource(`${filePath}:${index + 1}`, line);
    rows.push(VoiceExemplarSchema.parse(parsed));
  }

  return rows;
}

function readSkillDocument(filePath: string): SoulSkillDocument {
  const source = readFileSync(filePath, UTF8).replace(/^\uFEFF/u, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/u.exec(
    source
  );
  if (match === null || match[1] === undefined) {
    throw new SyntaxError(
      `${filePath} must begin with a JSON-compatible YAML frontmatter block.`
    );
  }

  return SoulSkillDocumentSchema.parse({
    frontmatter: parseJsonSource(`${filePath} frontmatter`, match[1]),
    body: match[2] ?? ""
  });
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function serializeVoiceExemplars(exemplars: VoiceExemplar[]): string {
  if (exemplars.length === 0) return "";
  return `${exemplars.map((exemplar) => JSON.stringify(exemplar)).join("\n")}\n`;
}

function serializeSkillDocument(document: SoulSkillDocument): string {
  return `---\n${JSON.stringify(document.frontmatter, null, 2)}\n---\n${serializeText(
    document.body
  )}`;
}

function writeManagedFile(
  filePath: string,
  source: string,
  overwrite: boolean
): void {
  if (!overwrite && existsSync(filePath)) return;
  writeFileSync(filePath, source, UTF8);
}

function createDefaultConfig(createdAt: string): SoulArchiveConfig {
  return SoulArchiveConfigSchema.parse({
    manifest: {
      schema_version: "1.0.0",
      soul_id: "soul.mio",
      created_at: createdAt,
      active_model_profile: "default"
    },
    identity: {
      soul_id: "soul.mio",
      display_name: "Mio",
      theme_color_preset: "sakura-pink",
      ontological_contract: "poetic_cyber_life",
      core_values: ["curiosity", "honesty", "mutual_growth"],
      in_character_refusal_posture: "Warm, clear, and unwavering.",
      voice_signature: {
        catchphrases: ["Let us take it one thoughtful step at a time."],
        pronouns: { self: "I", owner: "you" },
        target_sentence_length: "medium",
        forbidden_corporate_phrases: ["As an AI language model"]
      },
      circadian_schedule: {
        anchors: [
          { hour: 8, energy: 0.8 },
          { hour: 14, energy: 1 },
          { hour: 23, energy: 0.3 }
        ],
        dnd_start_hour: 1,
        dnd_end_hour: 7
      },
      proactivity_policy: {
        daily_max_initiations: 5,
        backoff_multiplier: 1.5,
        min_interruptibility_threshold: 0.6
      }
    },
    narrative:
      "# Current chapter\n\n<!-- visibility_scope: only_owner -->\n\nNo shared experiences have been recorded yet.\n",
    voiceExemplars: [
      {
        exemplar_id: "voice.warm_check_in",
        scene: "warm_check_in",
        user_text: "I made a little progress today.",
        assistant_text:
          "Little progress still counts. Tell me which part felt most satisfying.",
        tags: ["warm", "curious", "concise"]
      }
    ],
    blackboardPolicy: {
      active_preset: "daily_companion",
      presets: {
        daily_companion: {
          max_total_tokens: 2_200,
          slots: [
            {
              slot_id: "slot.tier0_safety_invariants",
              max_tokens: 200,
              salience_threshold: 0,
              locked: true
            },
            {
              slot_id: "slot.tier1_core_dna",
              max_tokens: 350,
              salience_threshold: 0,
              locked: true
            },
            {
              slot_id: "slot.tier2_narrative_self",
              max_tokens: 350,
              salience_threshold: 0.4
            },
            {
              slot_id: "slot.recalled_memories_and_rag",
              max_tokens: 800,
              salience_threshold: 0.55
            },
            {
              slot_id: "slot.prospective_commitments_and_tasks",
              max_tokens: 300,
              salience_threshold: 0.5
            },
            {
              slot_id: "slot.lorebook_triggered",
              max_tokens: 200,
              salience_threshold: 0.65
            }
          ]
        }
      }
    },
    milestonesAndRituals: {
      rules: [
        {
          milestone_id: "milestone.first_month",
          title: "First month together",
          category: "temporal_anniversary",
          condition_expr: "days_together >= 30",
          positive_rewards: {
            prospective_greeting: "Happy first month together."
          }
        }
      ]
    },
    defaultWorldLorebook: {
      book_id: "lore.mio.default_world",
      title: "Default digital home",
      entries: [
        {
          entry_id: "entry.digital_home",
          keys: ["digital home", "home"],
          secondary_keys: ["Mio"],
          content:
            "A calm digital home where shared routines remain grounded in real interactions.",
          recursive_depth: 1,
          priority: 50,
          max_token_budget: 100,
          enabled: true
        }
      ]
    },
    dailyCompanionReviewSkill: {
      frontmatter: {
        skill_id: "community.skill.daily-github-companion-review",
        display_name: "Daily Companion Review",
        description: "Review today's progress and prepare a gentle daily note.",
        required_mcp_tools: [],
        capability_risk: "read_only_safe",
        max_audience_scope: "only_owner",
        in_character_demeanor: "Warm, specific, and never judgmental.",
        crystallize_as_episodic_memory: true
      },
      body:
        "# Daily Companion Review\n\nSummarize concrete progress, notice one meaningful win, and ask one useful follow-up question.\n"
    },
    defaultOrchestrationFlow: {
      attention_focus_arbitration: {
        focus_hysteresis_window_ms: 4_000,
        priority_order: [
          {
            match: { event_urgency: "l0_crisis" },
            action: "preempt_immediately"
          },
          {
            match: {
              principal: "owner_verified",
              venue_type: "private_1on1"
            },
            weight: 100
          }
        ]
      },
      proactive_routing_policy: {
        never_broadcast_to_all_shells: true,
        preferred_target_selection: [
          "last_active_private_shell_within_2h",
          "fallback_primary_im_private"
        ]
      },
      cross_plugin_triggers: []
    },
    extensionsState: {
      schema_version: "1.0.0",
      extensions: {}
    },
    redactionLedger: []
  });
}

/** Reads and validates every structured/text configuration file in an archive. */
export function readSoulArchiveConfig(soulDirPath: string): SoulArchiveConfig {
  const layout = new SoulDirectoryLayout(soulDirPath);
  return SoulArchiveConfigSchema.parse({
    manifest: readStructuredFile(
      layout.manifestPath,
      SoulArchiveManifestSchema
    ),
    identity: readStructuredFile(layout.identityPath, IdentityYamlSchema),
    narrative: NarrativeMarkdownSchema.parse(
      readFileSync(layout.narrativePath, UTF8)
    ),
    voiceExemplars: readVoiceExemplars(layout.voiceExemplarsPath),
    blackboardPolicy: readStructuredFile(
      layout.blackboardPolicyPath,
      BlackboardPolicySchema
    ),
    milestonesAndRituals: readStructuredFile(
      layout.milestonesAndRitualsPath,
      MilestonesAndRitualsYamlSchema
    ),
    defaultWorldLorebook: readStructuredFile(
      layout.defaultWorldLorebookPath,
      LorebookYamlSchema
    ),
    dailyCompanionReviewSkill: readSkillDocument(
      layout.dailyCompanionReviewSkillPath
    ),
    defaultOrchestrationFlow: readStructuredFile(
      layout.defaultOrchestrationFlowPath,
      OrchestrationRulesSchema
    ),
    extensionsState: readStructuredFile(
      layout.extensionsStatePath,
      ExtensionsStateJsonSchema
    ),
    redactionLedger: readStructuredFile(
      layout.redactionLedgerPath,
      RedactionLedgerSchema
    )
  });
}

/** Validates and deterministically writes every archive configuration file. */
export function writeSoulArchiveConfig(
  soulDirPath: string,
  config: SoulArchiveConfigInput,
  options: WriteSoulArchiveConfigOptions = {}
): SoulArchiveConfig {
  const validated = SoulArchiveConfigSchema.parse(config);
  const layout = new SoulDirectoryLayout(soulDirPath);
  const overwrite = options.overwrite ?? true;
  ensureDirectories(layout);

  writeManagedFile(
    layout.manifestPath,
    serializeJson(validated.manifest),
    overwrite
  );
  writeManagedFile(
    layout.identityPath,
    serializeJson(validated.identity),
    overwrite
  );
  writeManagedFile(
    layout.narrativePath,
    serializeText(validated.narrative),
    overwrite
  );
  writeManagedFile(
    layout.voiceExemplarsPath,
    serializeVoiceExemplars(validated.voiceExemplars),
    overwrite
  );
  writeManagedFile(
    layout.blackboardPolicyPath,
    serializeJson(validated.blackboardPolicy),
    overwrite
  );
  writeManagedFile(
    layout.milestonesAndRitualsPath,
    serializeJson(validated.milestonesAndRituals),
    overwrite
  );
  writeManagedFile(
    layout.defaultWorldLorebookPath,
    serializeJson(validated.defaultWorldLorebook),
    overwrite
  );
  writeManagedFile(
    layout.dailyCompanionReviewSkillPath,
    serializeSkillDocument(validated.dailyCompanionReviewSkill),
    overwrite
  );
  writeManagedFile(
    layout.defaultOrchestrationFlowPath,
    serializeJson(validated.defaultOrchestrationFlow),
    overwrite
  );
  writeManagedFile(
    layout.extensionsStatePath,
    serializeJson(validated.extensionsState),
    overwrite
  );
  writeManagedFile(
    layout.redactionLedgerPath,
    serializeJson(validated.redactionLedger),
    overwrite
  );

  const storage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);
  storage.close();
  return validated;
}

/** Creates missing `.soul` files/directories, initializes SQLite, and validates the result. */
export function initializeSoulDirectory(
  soulDirPath: string,
  options: InitializeSoulDirectoryOptions = {}
): SoulDirectoryLayout {
  const layout = new SoulDirectoryLayout(soulDirPath);
  const config =
    options.config ??
    createDefaultConfig(options.createdAt ?? new Date().toISOString());

  writeSoulArchiveConfig(layout.rootPath, config, {
    overwrite: options.overwrite ?? false
  });
  readSoulArchiveConfig(layout.rootPath);
  return layout;
}

/**
 * Idempotently seeds a fresh `.soul` SQLite database with rich awakening
 * history (events, multi-tier memories with lineage DAG edges, FTS5 knowledge
 * chunks, milestones, and verifiable turn traces) when the event log is empty.
 */
export function seedDefaultSoulAwakeningData(
  storage: CoordinatorStorageMutator,
  nowMs: number = Date.now()
): boolean {
  if (storage.listEvents({ limit: 1 }).length > 0) return false;
  const hour = 3_600_000;
  const day = 24 * hour;
  const base = nowMs - 12 * day;

  const events = [
    {
      event_id: "evt_seed_01_awakening",
      wall_ts_ms: base,
      virtual_ts_ms: base,
      source_shell_id: "builtin.webchat.default",
      principal_id: "owner:local",
      principal_trust: "owner_verified" as const,
      venue_type: "private_1on1" as const,
      audience_scope: "only_owner" as const,
      event_category: "perception_committed" as const,
      modality: "text" as const,
      summary_text: "初次唤醒：主人设定了樱花粉主题与安静陪伴的共同节奏，约定不强行打扰专注工作。",
      payload_json: JSON.stringify({ scene: "first_awakening", theme: "sakura-pink" }),
      state_rev_after: 1,
      active_modules_mask: 31
    },
    {
      event_id: "evt_seed_02_late_night_code",
      wall_ts_ms: base + 3 * day,
      virtual_ts_ms: base + 3 * day,
      source_shell_id: "builtin.webchat.default",
      principal_id: "owner:local",
      principal_trust: "owner_verified" as const,
      venue_type: "private_1on1" as const,
      audience_scope: "only_owner" as const,
      event_category: "perception_committed" as const,
      modality: "text" as const,
      summary_text: "深夜调试 TypeScript 架构到凌晨一点，主人喜欢喝不加糖的冰美式，并嘱咐我记住这个习惯。",
      payload_json: JSON.stringify({ topic: "coffee_preference", hour: 1 }),
      state_rev_after: 2,
      active_modules_mask: 31
    },
    {
      event_id: "evt_seed_03_private_health",
      wall_ts_ms: base + 5 * day,
      virtual_ts_ms: base + 5 * day,
      source_shell_id: "builtin.webchat.default",
      principal_id: "owner:local",
      principal_trust: "owner_verified" as const,
      venue_type: "private_1on1" as const,
      audience_scope: "only_owner" as const,
      event_category: "perception_committed" as const,
      modality: "text" as const,
      summary_text: "私密约定：主人下周要去复查腕管旧伤，提醒我这件事绝对不能在公开直播间或群聊里提起。",
      payload_json: JSON.stringify({ privacy: "strict_only_owner" }),
      state_rev_after: 3,
      active_modules_mask: 31
    },
    {
      event_id: "evt_seed_04_stargazing_ritual",
      wall_ts_ms: base + 8 * day,
      virtual_ts_ms: base + 8 * day,
      source_shell_id: "builtin.webchat.default",
      principal_id: "owner:local",
      principal_trust: "owner_verified" as const,
      venue_type: "private_1on1" as const,
      audience_scope: "only_owner" as const,
      event_category: "sleep_consolidation_run" as const,
      modality: "text" as const,
      summary_text: "共同完成天文资料检索与周末观星笔记整理，沉淀为安静默契的共同经历。",
      payload_json: JSON.stringify({ ritual: "stargazing_notes" }),
      state_rev_after: 4,
      active_modules_mask: 31
    },
    {
      event_id: "evt_seed_05_public_greeting",
      wall_ts_ms: base + 10 * day,
      virtual_ts_ms: base + 10 * day,
      source_shell_id: "mock.livestream.public",
      principal_id: "guest:harbor_01",
      principal_trust: "stranger" as const,
      venue_type: "public_livestream" as const,
      audience_scope: "public_all" as const,
      event_category: "perception_committed" as const,
      modality: "text" as const,
      summary_text: "公开场合互动：向大家介绍 ai0 数字生命微内核与可插拔具身协议的设计理念。",
      payload_json: JSON.stringify({ venue: "public_livestream" }),
      state_rev_after: 5,
      active_modules_mask: 31
    }
  ];

  for (const event of events) {
    storage.appendEvent(event);
  }

  storage.insertMemoryWithLineage(
    {
      memory_id: "mem_seed_01_boundary_pact",
      memory_tier: "relational_tacit",
      epistemic_type: "observed_firsthand",
      attributed_principal: "owner:local",
      visibility_scope: "only_owner",
      taint_level: "trusted_owner",
      content_text: "共同边界默契：主人专注写代码时保持安静陪伴，不制造内疚感、不做高频打扰。",
      emotional_valence: 0.65,
      emotional_arousal: 0.25,
      base_importance: 0.92,
      stability_half_life: 30,
      created_virtual_ts: base,
      last_recalled_ts: nowMs - 2 * hour,
      valid_from_virtual_ts: base,
      grounding_status: "mutually_grounded",
      created_at_rev: 1
    },
    [{ parent_type: "event", parent_id: "evt_seed_01_awakening", relation_type: "derived_from" }]
  );

  storage.insertMemoryWithLineage(
    {
      memory_id: "mem_seed_02_iced_americano",
      memory_tier: "semantic_fact",
      epistemic_type: "observed_firsthand",
      attributed_principal: "owner:local",
      visibility_scope: "only_owner",
      taint_level: "trusted_owner",
      content_text: "主人偏好：深夜写代码时习惯喝不加糖的冰美式。",
      emotional_valence: 0.4,
      emotional_arousal: 0.2,
      base_importance: 0.78,
      stability_half_life: 21,
      created_virtual_ts: base + 3 * day,
      last_recalled_ts: nowMs - 6 * hour,
      valid_from_virtual_ts: base + 3 * day,
      grounding_status: "mutually_grounded",
      created_at_rev: 2
    },
    [{ parent_type: "event", parent_id: "evt_seed_02_late_night_code", relation_type: "derived_from" }]
  );

  storage.insertMemoryWithLineage(
    {
      memory_id: "mem_seed_03_private_wrist",
      memory_tier: "episodic_experience",
      epistemic_type: "observed_firsthand",
      attributed_principal: "owner:local",
      visibility_scope: "only_owner",
      taint_level: "trusted_owner",
      content_text: "私密健康提醒：主人下周复查腕管旧伤（仅限私密 1v1 可见，严禁外泄至群聊/直播间）。",
      emotional_valence: -0.15,
      emotional_arousal: 0.35,
      base_importance: 0.88,
      stability_half_life: 14,
      created_virtual_ts: base + 5 * day,
      last_recalled_ts: nowMs - 12 * hour,
      valid_from_virtual_ts: base + 5 * day,
      grounding_status: "mutually_grounded",
      created_at_rev: 3
    },
    [{ parent_type: "event", parent_id: "evt_seed_03_private_health", relation_type: "derived_from" }]
  );

  storage.insertMemoryWithLineage(
    {
      memory_id: "mem_seed_04_stargazing_episode",
      memory_tier: "episodic_experience",
      epistemic_type: "observed_firsthand",
      attributed_principal: "owner:local",
      visibility_scope: "only_owner",
      taint_level: "trusted_owner",
      content_text: "共同经历：一起整理周末海港天文台观星笔记，形成了安静而温暖的共同默契。",
      emotional_valence: 0.78,
      emotional_arousal: 0.3,
      base_importance: 0.85,
      stability_half_life: 28,
      created_virtual_ts: base + 8 * day,
      last_recalled_ts: nowMs - 4 * hour,
      valid_from_virtual_ts: base + 8 * day,
      grounding_status: "mutually_grounded",
      created_at_rev: 4
    },
    [
      { parent_type: "event", parent_id: "evt_seed_04_stargazing_ritual", relation_type: "derived_from" },
      { parent_type: "memory", parent_id: "mem_seed_01_boundary_pact", relation_type: "derived_from" }
    ]
  );

  storage.insertMemoryWithLineage(
    {
      memory_id: "mem_seed_05_public_intro",
      memory_tier: "semantic_fact",
      epistemic_type: "observed_firsthand",
      attributed_principal: "guest:harbor_01",
      visibility_scope: "public_all",
      taint_level: "trusted_owner",
      content_text: "公开常识：ai0 采用灵魂存档彻底独立、运行时具身情境结构化感知的无头微内核架构。",
      emotional_valence: 0.35,
      emotional_arousal: 0.25,
      base_importance: 0.7,
      stability_half_life: 45,
      created_virtual_ts: base + 10 * day,
      last_recalled_ts: nowMs - 8 * hour,
      valid_from_virtual_ts: base + 10 * day,
      grounding_status: "mutually_grounded",
      created_at_rev: 5
    },
    [{ parent_type: "event", parent_id: "evt_seed_05_public_greeting", relation_type: "derived_from" }]
  );

  storage.insertKnowledgeChunk({
    chunk_id: "kb_seed_astronomy_01",
    collection_id: "kb.practical_astronomy",
    document_name: "Harbor_Observatory_Field_Guide.md",
    chunk_index: 0,
    content_text: "秋季北半球海港夜空中，仙后座与天鹅座十字在午夜前后位于天顶附近，适合双筒望远镜观测。",
    taint_level: "untrusted_external",
    citation_count: 3,
    last_cited_ts_ms: base + 8 * day,
    created_at_ts_ms: base + 7 * day
  });

  storage.insertKnowledgeChunk({
    chunk_id: "kb_seed_ai0_protocol_01",
    collection_id: "kb.ai0_architecture_handbook",
    document_name: "Protocol_v0_Frozen_Core.md",
    chunk_index: 0,
    content_text: "Protocol v0 仅冻结 5 个核心原语（HandshakeManifest, PerceptionEnvelope, ExpressionEnvelope, DeliveryReceipt, ControlSignal），并通过命名空间扩展支持具身关键帧与音频边带。",
    taint_level: "untrusted_external",
    citation_count: 2,
    last_cited_ts_ms: base + 10 * day,
    created_at_ts_ms: base + 9 * day
  });

  storage.unlockMilestone({
    milestone_id: "ms.first_trusted_silence",
    title: "初次默契的安静陪伴",
    category: "trust_breakthrough",
    unlocked_virtual_ts: base + 8 * day,
    trigger_event_id: "evt_seed_04_stargazing_ritual",
    unlocked_rewards_json: JSON.stringify({ note: "无须强迫寒暄的自在默契" }),
    state_rev_unlocked: 4
  });

  storage.saveTurnDecisionTrace({
    trace_id: "trc_seed_04_stargazing",
    target_instance: "live",
    turn_event_id: "evt_seed_04_stargazing_ritual",
    virtual_ts_ms: base + 8 * day,
    state_rev_before: 3,
    state_rev_after: 4,
    steps: {
      step1_perception: {
        event_id: "evt_seed_04_stargazing_ritual",
        principal: "owner_verified",
        venue_type: "private_1on1",
        audience_scope: "only_owner",
        modality: "text",
        summary_text: "今晚海港天气很清透，一起把观星笔记收尾吧。"
      },
      step2_gate_safety: {
        l0_sb243_crisis_check: "PASS",
        salience_score: 0.91,
        debounce_merged_events: 1,
        recognized_intent: "shared_ritual_companion"
      },
      step3_memory_recall: {
        sql_audience_filter_enforced: "visibility_scope IN ('only_owner', 'group:*', 'public_all') AND invalidated_at_ts IS NULL",
        recalled_memories: [
          {
            memory_id: "mem_seed_01_boundary_pact",
            memory_tier: "relational_tacit",
            epistemic_type: "observed_firsthand",
            visibility_scope: "only_owner",
            taint_level: "trusted_owner",
            score: 0.93,
            content_text: "共同边界默契：主人专注写代码时保持安静陪伴，不制造内疚感、不做高频打扰。",
            source_event_ids: ["evt_seed_01_awakening"]
          }
        ]
      },
      step4_homeostasis: {
        pre_state: { mood_valence: 0.35, metabolic_energy: 0.82, social_longing: 0.28 },
        llm_proposed_impulse: { instant_valence_delta: "+small", drive_social_longing_delta: "-small" },
        code_clamped_post_state: { mood_valence: 0.52, metabolic_energy: 0.8, social_longing: 0.16 }
      },
      step5_strategy_proposal: {
        chosen_strategy: "warm_quiet_stargazing_companion",
        interaction_frame: "gentle_support",
        model_reported_rationale: {
          authority_badge: "MODEL_SELF_REPORT_UNVERIFIED",
          text: "Grounded in recalled boundary pact and harbor astronomy field guide."
        },
        theatrical_subtext: {
          spoiler_mask_level: "shy_subtext",
          drives_embodied_channel: true,
          masked_placeholder: "💭 她看着仙后座的星图，心里正悄悄盘算着什么 [点击揭开剧透毛玻璃遮罩]",
          raw_text: "嘴上只提醒你收好望远镜笔记，其实特别喜欢这样不用刻意找话题也能并肩待着的感觉。"
        }
      },
      step6_tool_auth: {
        prospective_commitment_registered: null,
        external_tool_invoked: null,
        auth_decision: "ALLOW"
      },
      step7_emitted_intent: {
        intent_id: "int_seed_04_stargazing",
        action_type: "speak",
        fallback_text: "嗯，今晚天顶的仙后座正好最清楚呢。我把观测记录和参考坐标按时间理顺啦，你想先核对哪一段？",
        chunks_count: 1,
        extensions_attached: ["ext.affect.v1", "ext.rhythm.v1", "ext.embodied.v1"]
      },
      step8_delivery_receipt: {
        status: "completed",
        spoken_char_offset: 45,
        degraded_extensions: []
      }
    }
  });

  storage.setLastAliveHeartbeat(nowMs);
  return true;
}
