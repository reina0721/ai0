import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  BlackboardPolicySchema,
  ExtensionsStateJsonSchema,
  IdentityYamlSchema,
  LorebookYamlSchema,
  MilestonesAndRitualsYamlSchema,
  OrchestrationRulesSchema,
  SoulModuleOverridesSchema,
  SkillMarkdownFrontmatterSchema
} from "@ai0/protocol";
import { z } from "zod";

import { CoordinatorStorageMutator } from "../../kernel/sqlite/database-driver.js";
import {
  RedactionLedgerEntrySchema,
  RedactionLedgerSchema,
  type RedactionLedgerEntry
} from "../../kernel/lineage-dag/hard-forget-engine.js";

const UTF8 = "utf8";

export const SoulArchiveManifestSchema = z.object({
  schema_version: z.string().min(1),
  soul_id: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  active_model_profile: z.string().min(1),
  origin_card_id: z.string().min(1).optional(),
  module_overrides: SoulModuleOverridesSchema.optional()
});
export type SoulArchiveManifest = z.infer<typeof SoulArchiveManifestSchema>;

/**
 * Voice exemplar fields are intentionally extensible until the protocol owns
 * a canonical row schema. Each JSONL line must still be a JSON object.
 */
export const VoiceExemplarSchema = z.record(z.unknown());
export type VoiceExemplar = z.infer<typeof VoiceExemplarSchema>;

export const NarrativeMarkdownSchema = z.string();

export { RedactionLedgerEntrySchema, RedactionLedgerSchema, type RedactionLedgerEntry };

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
  displayName?: string;
  /** A fully validated archive configuration. */
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
  readonly stateDescriptorsPath: string;
  readonly characterCardPath: string;
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
    this.stateDescriptorsPath = join(this.rootPath, "state_descriptors.yaml");
    this.characterCardPath = join(this.rootPath, "character_card.ccv3.json");
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
    layout.skillsPath,
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

function writeManagedFile(
  filePath: string,
  source: string,
  overwrite: boolean
): void {
  if (!overwrite && existsSync(filePath)) return;
  writeFileSync(filePath, source, UTF8);
}

export function createDefaultSoulArchiveConfig(createdAt: string, displayName: string): SoulArchiveConfig {
  const soulId = "soul." + randomUUID();
  return SoulArchiveConfigSchema.parse({
    manifest: {
      schema_version: "1.0.0",
      soul_id: soulId,
      created_at: createdAt,
      active_model_profile: "default"
    },
    identity: {
      soul_id: soulId,
      display_name: displayName,
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
    voiceExemplars: [],
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
    milestonesAndRituals: { rules: [] },
    defaultWorldLorebook: { book_id: "lore.default_world", title: "World lore", entries: [] },
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
        never_broadcast_to_all_channels: true,
        preferred_target_selection: [
          "last_active_private_channel_within_2h",
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
    createDefaultSoulArchiveConfig(
      options.createdAt ?? new Date().toISOString(),
      options.displayName ?? basename(layout.rootPath, ".soul")
    );

  if (!options.config && (existsSync(layout.manifestPath) || existsSync(layout.identityPath))) {
    const existing = existsSync(layout.manifestPath)
      ? readStructuredFile(layout.manifestPath, SoulArchiveManifestSchema)
      : readStructuredFile(layout.identityPath, IdentityYamlSchema);
    config.manifest.soul_id = config.identity.soul_id = existing.soul_id;
  }
  writeSoulArchiveConfig(layout.rootPath, config, {
    overwrite: options.overwrite ?? false
  });
  readSoulArchiveConfig(layout.rootPath);
  return layout;
}
