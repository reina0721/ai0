import { z } from "zod";

import {
  AudienceScopeSchema,
  SensorModalitySchema,
  VenueTypeSchema
} from "../core-v0/primitives.js";

/** The five independently-versioned domains of cognitive state. */
export const StateDomainSchema = z.enum([
  "D1_WORKING_TURN",
  "D2_HOMEOSTASIS_AFFECT",
  "D3_MEMORY_PROJECTION",
  "D4_COMMITMENTS_TASKS",
  "D5_IDENTITY_NARRATIVE"
]);
export type StateDomain = z.infer<typeof StateDomainSchema>;

export const WellKnownExtensionFacetIdSchema = z.enum([
  "channel.bridge",
  "agent.tool_provider",
  "agent.skill_manual",
  "agent.model_adapter",
  "perception.ingress",
  "perception.filter",
  "cognition.state_dynamics",
  "cognition.attention_arbitrator",
  "cognition.context_contributor",
  "cognition.sleep_organ",
  "expression.realizer",
  "expression.media_transcoder",
  "expression.intent_decorator",
  "console.surface",
  "console.ui_slot",
  "console.config_schema",
  "extension.asset_codec"
]);
export type WellKnownExtensionFacetId = z.infer<typeof WellKnownExtensionFacetIdSchema>;

export const ExtensionFacetIdSchema = z.union([
  WellKnownExtensionFacetIdSchema,
  z.string().regex(/^(?:channel|agent|perception|cognition|expression|console|extension)\.[a-z][a-z0-9_]*$/)
]);
export type ExtensionFacetId = z.infer<typeof ExtensionFacetIdSchema>;

export const ExtensionCarrierKindSchema = z.enum([
  "declarative_soul_asset",
  "markdown_skill_manual",
  "zero_code_protocol_bridge",
  "visual_cognitive_flow",
  "native_code_plugin"
]);
export type ExtensionCarrierKind = z.infer<typeof ExtensionCarrierKindSchema>;

export const ConsoleUiSlotTargetSchema = z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/i);
export type ConsoleUiSlotTarget = z.infer<typeof ConsoleUiSlotTargetSchema>;

export const ExtensionPermissionsSchema = z.object({
  read_blackboard_domains: z.array(StateDomainSchema),
  propose_mutation_domains: z.array(StateDomainSchema),
  max_audience_scope: AudienceScopeSchema,
  network_access: z.boolean()
});
export type ExtensionPermissions = z.infer<typeof ExtensionPermissionsSchema>;

export const ConsoleWidgetTypeSchema = z.enum([
  "timeseries_chart",
  "kv_badges",
  "markdown_card_list",
  "json_schema_form",
  "sandboxed_iframe_stage",
  "web_stage_module",
  "contribution_module"
]);
export type ConsoleWidgetType = z.infer<typeof ConsoleWidgetTypeSchema>;

export const ConsoleUiSlotContributionSchema = z.object({
  slot_target: ConsoleUiSlotTargetSchema,
  widget_type: ConsoleWidgetTypeSchema,
  title: z.string(),
  data_endpoint: z.string().optional(),
  route_path: z.string().optional(),
  channel_id: z.string().optional(),
  entry_module: z.string().optional(),
  style_sheets: z.array(z.string()).optional(),
  iframe_src: z.string().optional()
});
export type ConsoleUiSlotContribution = z.infer<
  typeof ConsoleUiSlotContributionSchema
>;

export const PluginOriginSchema = z.enum(["builtin", "soul", "external"]);
export type PluginOrigin = z.infer<typeof PluginOriginSchema>;

export const RuntimeConsoleUiSlotSchema = ConsoleUiSlotContributionSchema.extend({
  entry_module_url: z.string().optional(),
  style_sheet_urls: z.array(z.string()).optional(),
  iframe_src_url: z.string().optional()
});
export type RuntimeConsoleUiSlot = z.infer<typeof RuntimeConsoleUiSlotSchema>;

const PagePathSchema = z.string().regex(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)*$/u)
  .refine(path => !path.split("/").some(part => part === "." || part === ".."));
export const ConsolePageSchema = z.object({
  path: PagePathSchema, title: z.string().min(1), aliases: z.array(PagePathSchema).optional(),
  navigation: z.boolean().optional(), channel_id: z.string().min(1).optional(),
  entry_module: z.string().min(1), style_sheets: z.array(z.string()).optional()
});
export interface RuntimeConsolePage {
  path: string;
  title: string;
  navigation?: boolean;
  aliases?: string[];
  channel_id?: string;
  entry_module_url?: string;
  iframe_src_url?: string;
  style_sheet_urls?: string[];
}
export const PluginConfigFieldOptionSchema = z.object({
  value: z.string(),
  label: z.string()
});
export type PluginConfigFieldOption = z.infer<typeof PluginConfigFieldOptionSchema>;

export const PluginConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["string", "text", "int", "float", "bool", "secret", "select", "list"]),
  hint: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  required: z.boolean().optional(),
  options: z.array(PluginConfigFieldOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  group: z.string().optional()
});
export type PluginConfigField = z.infer<typeof PluginConfigFieldSchema>;

export const RuntimePluginDescriptorSchema = z.object({
  extension_id: z.string(),
  display_name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  author: z.string(),
  tags: z.array(z.string()).optional(),
  carrier_kind: ExtensionCarrierKindSchema,
  facets: z.array(ExtensionFacetIdSchema).min(1),
  origin: PluginOriginSchema,
  enabled: z.boolean(),
  permissions: ExtensionPermissionsSchema.optional(),
  config_fields: z.array(PluginConfigFieldSchema).optional(),
  config_schema: z.union([z.string(), z.record(z.unknown())]).optional(),
  module_urls: z.array(z.string()).optional(),
  missing_assets: z.array(z.string()).optional(),
  pages: z.array(ConsolePageSchema.omit({ entry_module: true, style_sheets: true }).extend({ entry_module_url: z.string().optional(), iframe_src_url: z.string().optional(), style_sheet_urls: z.array(z.string()).optional() })).optional(),
  ui_slots: z.array(RuntimeConsoleUiSlotSchema)
});
export type RuntimePluginDescriptor = z.infer<
  typeof RuntimePluginDescriptorSchema
>;

export const ConsoleContributionsSchema = z.object({
  pages: z.array(ConsolePageSchema).optional(),
  modules: z.array(z.string().min(1)).optional(),
  config_fields: z.array(PluginConfigFieldSchema).optional(),
  config_schema: z
    .union([z.string(), z.record(z.unknown())])
    .optional(),
  default_config_profiles: z.record(z.unknown()).optional(),
  ui_slots: z.array(ConsoleUiSlotContributionSchema).optional()
});
export type ConsoleContributions = z.infer<typeof ConsoleContributionsSchema>;

/** Carrier V: ai0.extension.json for a native code plugin. */
export const Ai0ExtensionManifestSchema = z.object({
  manifest_version: z.literal("2.0.0"),
  extension_id: z.string(),
  display_name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  author: z.string(),
  homepage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  carrier_kind: ExtensionCarrierKindSchema,
  facets: z.array(ExtensionFacetIdSchema).min(1),
  entry: z.string().optional(),
  permissions: ExtensionPermissionsSchema,
  console_contributions: ConsoleContributionsSchema.optional()
});
export type Ai0ExtensionManifest = z.infer<typeof Ai0ExtensionManifestSchema>;

export const CapabilityRiskSchema = z.enum([
  "read_only_safe",
  "low_read_and_scoped_write",
  "high_side_effect_privileged"
]);
export type CapabilityRisk = z.infer<typeof CapabilityRiskSchema>;

/** Carrier II: YAML frontmatter parsed from SKILL.md. */
export const SkillMarkdownFrontmatterSchema = z.object({
  skill_id: z.string(),
  display_name: z.string(),
  description: z.string(),
  required_mcp_tools: z.array(z.string()),
  capability_risk: CapabilityRiskSchema,
  max_audience_scope: AudienceScopeSchema,
  in_character_demeanor: z.string(),
  crystallize_as_episodic_memory: z.boolean(),
  required_vault_secrets: z.array(z.string()).optional(),
  config_schema: z.record(z.unknown()).optional()
});
export type SkillMarkdownFrontmatter = z.infer<
  typeof SkillMarkdownFrontmatterSchema
>;

export const ProtocolBridgeTransportSchema = z.enum([
  "mcp_stdio",
  "mcp_sse",
  "mcp_streamable_http",
  "protocol_v0_ws_inbound",
  "protocol_v0_ws_outbound",
  "openapi_webhook",
  "openai_compatible_api"
]);
export type ProtocolBridgeTransport = z.infer<
  typeof ProtocolBridgeTransportSchema
>;

/** Carrier III: a protocol, MCP, or webhook bridge configuration. */
export const ProtocolBridgeConfigSchema = z.object({
  bridge_id: z.string(),
  display_name: z.string(),
  facets: z.array(ExtensionFacetIdSchema).min(1),
  transport: ProtocolBridgeTransportSchema,
  endpoint_or_command: z.string(),
  capability_risk: CapabilityRiskSchema.optional(),
  required_vault_secrets: z.array(z.string()).optional(),
  config_schema: z.record(z.unknown()).optional()
});
export type ProtocolBridgeConfig = z.infer<typeof ProtocolBridgeConfigSchema>;

export const AttentionPriorityRuleSchema = z.object({
  match: z.record(z.unknown()),
  action: z.string().optional(),
  weight: z.number().optional()
});
export type AttentionPriorityRule = z.infer<typeof AttentionPriorityRuleSchema>;

export const CrossPluginTriggerSchema = z.object({
  rule_id: z.string(),
  when: z.object({
    source_channel: z.string(),
    semantic_event: z.string()
  }),
  if_condition: z.string(),
  then_actions: z.array(z.record(z.unknown()))
});
export type CrossPluginTrigger = z.infer<typeof CrossPluginTriggerSchema>;

/** Carrier IV: orchestration_rules.yaml. */
export const OrchestrationRulesSchema = z.object({
  attention_focus_arbitration: z.object({
    focus_hysteresis_window_ms: z.number(),
    priority_order: z.array(AttentionPriorityRuleSchema)
  }),
  proactive_routing_policy: z.object({
    never_broadcast_to_all_channels: z.literal(true),
    preferred_target_selection: z.array(z.string())
  }),
  cross_plugin_triggers: z.array(CrossPluginTriggerSchema)
});
export type OrchestrationRules = z.infer<typeof OrchestrationRulesSchema>;

const CustomBlackboardSlotIdSchema = z
  .string()
  .regex(/^slot\.custom_organs\..+$/);

export const BlackboardSlotIdSchema = z.union([
  z.enum([
    "slot.tier0_safety_invariants",
    "slot.tier1_core_dna",
    "slot.tier2_narrative_self",
    "slot.embodiment_and_sensory_buckets",
    "slot.homeostasis_and_vitality",
    "slot.recalled_memories_and_rag",
    "slot.prospective_commitments_and_tasks",
    "slot.lorebook_triggered"
  ]),
  CustomBlackboardSlotIdSchema
]);
export type BlackboardSlotId = z.infer<typeof BlackboardSlotIdSchema>;

export const BlackboardSlotPolicySchema = z.object({
  slot_id: BlackboardSlotIdSchema,
  max_tokens: z.number(),
  salience_threshold: z.number(),
  locked: z.boolean().optional()
});
export type BlackboardSlotPolicy = z.infer<typeof BlackboardSlotPolicySchema>;

export const BlackboardPresetSchema = z.object({
  max_total_tokens: z.number(),
  slots: z.array(BlackboardSlotPolicySchema)
});
export type BlackboardPreset = z.infer<typeof BlackboardPresetSchema>;

/** Carrier IV: blackboard_policy.yaml. */
export const BlackboardPolicySchema = z.object({
  active_preset: z.string(),
  presets: z.record(BlackboardPresetSchema)
});
export type BlackboardPolicy = z.infer<typeof BlackboardPolicySchema>;

export const OntologicalContractSchema = z.enum([
  "poetic_cyber_life",
  "strict_rp",
  "transparent_ai"
]);
export type OntologicalContract = z.infer<typeof OntologicalContractSchema>;

export const ThemeColorPresetSchema = z.union([
  z.enum(["sakura-pink", "astral-blue", "cyber-emerald"]),
  z.literal("cerasus-pink").transform(() => "sakura-pink" as const)
]);
export type ThemeColorPreset = z.infer<typeof ThemeColorPresetSchema>;

export const VoiceSignatureSchema = z.object({
  catchphrases: z.array(z.string()),
  pronouns: z.object({ self: z.string(), owner: z.string() }),
  target_sentence_length: z.enum(["short", "medium", "expressive"]),
  forbidden_corporate_phrases: z.array(z.string())
});
export type VoiceSignature = z.infer<typeof VoiceSignatureSchema>;

export const CircadianScheduleSchema = z.object({
  anchors: z.array(z.object({ hour: z.number(), energy: z.number() })),
  dnd_start_hour: z.number(),
  dnd_end_hour: z.number()
});
export type CircadianSchedule = z.infer<typeof CircadianScheduleSchema>;

export const ProactivityPolicySchema = z.object({
  daily_max_initiations: z.number(),
  backoff_multiplier: z.number(),
  min_interruptibility_threshold: z.number()
});
export type ProactivityPolicy = z.infer<typeof ProactivityPolicySchema>;

/** Carrier I: identity.yaml. */
export const IdentityYamlSchema = z.object({
  soul_id: z.string(),
  display_name: z.string(),
  theme_color_preset: ThemeColorPresetSchema.optional(),
  ontological_contract: OntologicalContractSchema,
  core_values: z.array(z.string()),
  in_character_refusal_posture: z.string(),
  voice_signature: VoiceSignatureSchema,
  circadian_schedule: CircadianScheduleSchema,
  proactivity_policy: ProactivityPolicySchema
});
export type IdentityYaml = z.infer<typeof IdentityYamlSchema>;

export const LorebookEntrySchema = z.object({
  entry_id: z.string(),
  keys: z.array(z.string()),
  secondary_keys: z.array(z.string()).optional(),
  content: z.string(),
  recursive_depth: z.number(),
  priority: z.number(),
  max_token_budget: z.number(),
  enabled: z.boolean()
});
export type LorebookEntry = z.infer<typeof LorebookEntrySchema>;

/** Carrier I: lorebook.yaml. */
export const LorebookYamlSchema = z.object({
  book_id: z.string(),
  title: z.string(),
  entries: z.array(LorebookEntrySchema)
});
export type LorebookYaml = z.infer<typeof LorebookYamlSchema>;

export const MilestoneCategorySchema = z.enum([
  "temporal_anniversary",
  "trust_breakthrough",
  "joint_agency_achievement",
  "story_event"
]);
export type MilestoneCategory = z.infer<typeof MilestoneCategorySchema>;

export const PositiveMilestoneRewardsSchema = z.object({
  unlocked_nickname: z.string().optional(),
  new_voice_exemplar: z.string().optional(),
  prospective_greeting: z.string().optional()
});
export type PositiveMilestoneRewards = z.infer<
  typeof PositiveMilestoneRewardsSchema
>;

export const MilestoneRuleSchema = z.object({
  milestone_id: z.string(),
  title: z.string(),
  category: MilestoneCategorySchema,
  condition_expr: z.string(),
  positive_rewards: PositiveMilestoneRewardsSchema
});
export type MilestoneRule = z.infer<typeof MilestoneRuleSchema>;

/** Carrier I: milestones_and_rituals.yaml. */
export const MilestonesAndRitualsYamlSchema = z.object({
  rules: z.array(MilestoneRuleSchema)
});
export type MilestonesAndRitualsYaml = z.infer<
  typeof MilestonesAndRitualsYamlSchema
>;

export const ScenarioRollbackModeSchema = z.enum([
  "silent_hard",
  "meta_reconciled",
  "dream_bridge"
]);
export type ScenarioRollbackMode = z.infer<typeof ScenarioRollbackModeSchema>;

/** The declarative perception shape used by a .scenario.yaml test step. */
export const ScenarioPerceptionInjectionSchema = z.object({
  channel_id: z.string(),
  venue_type: VenueTypeSchema,
  audience_scope: AudienceScopeSchema,
  actor_principal: z.string(),
  modality: SensorModalitySchema,
  summary_text: z.string()
});
export type ScenarioPerceptionInjection = z.infer<
  typeof ScenarioPerceptionInjectionSchema
>;

export const ScenarioStepSchema = z.object({
  step: z.number(),
  name: z.string(),
  inject_perception: ScenarioPerceptionInjectionSchema.optional(),
  virtual_clock_advance: z
    .object({
      duration: z.string(),
      mode: z.enum(["active_unattended", "hibernation"])
    })
    .optional(),
  create_snapshot: z.string().optional(),
  rollback_to_snapshot: z
    .object({
      snapshot_id: z.string(),
      mode: ScenarioRollbackModeSchema
    })
    .optional(),
  assertions: z.array(z.string())
});
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

/** Carrier I: .scenario.yaml. */
export const ScenarioPlaybookSchema = z.object({
  scenario_id: z.string(),
  description: z.string(),
  initial_soul_snapshot: z.string(),
  target_instance_mode: z.literal("sandbox_fork"),
  ablation_matrix_runs: z.array(
    z.object({ run_name: z.string(), disabled_organs: z.array(z.string()) })
  ),
  steps: z.array(ScenarioStepSchema)
});
export type ScenarioPlaybook = z.infer<typeof ScenarioPlaybookSchema>;

export const ScopedCapabilityTokenSchema = z.object({
  token_id: z.string(),
  allowed_channel_id_prefix: z.string(),
  enforced_venue_type: VenueTypeSchema,
  max_audience_privacy_ceiling: AudienceScopeSchema,
  can_authenticate_owner_principal: z.boolean(),
  allowed_actuators: z.array(z.string()),
  issued_at_ms: z.number(),
  signature: z.string().optional()
});
export type ScopedCapabilityToken = z.infer<typeof ScopedCapabilityTokenSchema>;

export const ExtensionPersistentStateSchema = z.object({
  extension_id: z.string(),
  carrier_kind: ExtensionCarrierKindSchema,
  facets: z.array(ExtensionFacetIdSchema).min(1),
  enabled: z.boolean(),
  status: z.enum(["active", "disabled", "faulted_isolated"]),
  active_profile: z.string().optional(),
  config_values: z.record(z.unknown()),
  permission_overrides: ExtensionPermissionsSchema,
  bound_vault_secrets: z.record(z.string()),
  last_error: z.string().optional()
});
export type ExtensionPersistentState = z.infer<
  typeof ExtensionPersistentStateSchema
>;

export const ExtensionsStateJsonSchema = z.object({
  schema_version: z.literal("1.0.0"),
  extensions: z.record(ExtensionPersistentStateSchema)
});
export type ExtensionsStateJson = z.infer<typeof ExtensionsStateJsonSchema>;
