import { z } from "zod";

import {
  AudienceScopeSchema,
  PerceptionEnvelopeSchema,
  SensorModalitySchema,
  VenueTypeSchema
} from "../core-v0/primitives.js";
import * as CoreV0 from "../core-v0/primitives.js";
import * as StandardExtensions from "../extensions/standard-v1.js";
import {
  StateDomainSchema
} from "../plugin-manifests/index.js";
import * as PluginManifests from "../plugin-manifests/index.js";
import * as OrthogonalConfig from "./orthogonal-config.js";

export * from "./orthogonal-config.js";
export * from "./provider-templates.js";
export * from "./model-reasoning.js";

/** Trust classification for a principal that contributed an input. */
export const PrincipalTrustSchema = z.enum([
  "owner_verified",
  "bound_friend",
  "stranger",
  "environment_sensor",
  "tool_output"
]);
export type PrincipalTrust = z.infer<typeof PrincipalTrustSchema>;

export const MemoryTierSchema = z.enum([
  "episodic_experience",
  "semantic_fact",
  "relational_tacit",
  "kb_crystallized_gist",
  "topic_taboo_seal"
]);
export type MemoryTier = z.infer<typeof MemoryTierSchema>;

export const EpistemicTypeSchema = z.enum([
  "observed_firsthand",
  "reported_hearsay",
  "inferred_hypothesis",
  "imagined_narrative"
]);
export type EpistemicType = z.infer<typeof EpistemicTypeSchema>;

export const TaintLevelSchema = z.enum([
  "trusted_owner",
  "semi_trusted_friend",
  "untrusted_external"
]);
export type TaintLevel = z.infer<typeof TaintLevelSchema>;

export const GroundingStatusSchema = z.enum([
  "not_applicable",
  "proposed_presented",
  "mutually_grounded",
  "disputed_retired"
]);
export type GroundingStatus = z.infer<typeof GroundingStatusSchema>;

export const LineageRelationTypeSchema = z.enum([
  "derived_from",
  "supersedes",
  "contradicts",
  "crystallized_from"
]);
export type LineageRelationType = z.infer<typeof LineageRelationTypeSchema>;

export const InteractionFrameSchema = z.enum([
  "serious_factual",
  "playful_banter",
  "tsundere_irony",
  "roleplay_fiction",
  "gentle_support"
]);
export type InteractionFrame = z.infer<typeof InteractionFrameSchema>;

const SandboxTargetInstanceSchema = z
  .string()
  .regex(/^sandbox:.+$/)
  .refine(
    (value): value is `sandbox:${string}` => value.startsWith("sandbox:"),
    "Sandbox target instances must start with sandbox:"
  );

export const TargetInstanceSchema = z.union([
  z.literal("live"),
  SandboxTargetInstanceSchema
]);
export type TargetInstance = z.infer<typeof TargetInstanceSchema>;

const RecalledMemorySchema = z.object({
  memory_id: z.string(),
  memory_tier: MemoryTierSchema,
  epistemic_type: EpistemicTypeSchema,
  visibility_scope: AudienceScopeSchema,
  taint_level: TaintLevelSchema,
  score: z.number(),
  content_text: z.string(),
  source_event_ids: z.array(z.string())
});

const VerifiableTurnStepsSchema = z.object({
  step1_perception: z.object({
    event_id: z.string(),
    principal: PrincipalTrustSchema,
    venue_type: VenueTypeSchema,
    audience_scope: AudienceScopeSchema,
    modality: SensorModalitySchema,
    summary_text: z.string()
  }),
  step2_gate_safety: z.object({
    l0_sb243_crisis_check: z.enum(["PASS", "INTERCEPTED_CRISIS"]),
    salience_score: z.number(),
    debounce_merged_events: z.number(),
    recognized_intent: z.string()
  }),
  step3_memory_recall: z.object({
    sql_audience_filter_enforced: z.string(),
    recalled_memories: z.array(RecalledMemorySchema)
  }),
  step4_homeostasis: z.object({
    pre_state: z.record(z.number()),
    llm_proposed_impulse: z.record(z.string()),
    code_clamped_post_state: z.record(z.number())
  }),
  step5_strategy_proposal: z.object({
    chosen_strategy: z.string(),
    interaction_frame: InteractionFrameSchema.optional(),
    model_reported_rationale: z.object({
      authority_badge: z.literal("MODEL_SELF_REPORT_UNVERIFIED"),
      text: z.string()
    }),
    theatrical_subtext: z.object({
      spoiler_mask_level: z.string(),
      drives_embodied_channel: z.boolean(),
      masked_placeholder: z.string(),
      raw_text: z.string()
    }).optional()
  }),
  step6_tool_auth: z.object({
    prospective_commitment_registered: z
      .object({
        commitment_id: z.string(),
        kind: z.string(),
        trigger_virtual_ts: z.string(),
        description: z.string()
      })
      .nullable()
      .optional(),
    external_tool_invoked: z
      .object({
        tool_id: z.string(),
        arguments: z.record(z.unknown())
      })
      .nullable()
      .optional(),
    auth_decision: z.enum([
      "ALLOW",
      "ALLOW_REDACTED",
      "REQUIRE_OWNER_CONFIRM",
      "DENY"
    ])
  }),
  step7_emitted_intent: z.object({
    intent_id: z.string(),
    action_type: z.enum(["speak", "explicit_silence", "invoke_actuator"]),
    fallback_text: z.string(),
    chunks_count: z.number(),
    extensions_attached: z.array(z.string())
  }),
  step8_delivery_receipt: z
    .object({
      status: z.enum([
        "rendered",
        "playing",
        "completed",
        "interrupted",
        "degraded",
        "failed"
      ]),
      spoken_char_offset: z.number(),
      degraded_extensions: z.array(z.string())
    })
    .nullable()
});

/** The deterministic, eight-stage audit record exposed to privileged consoles. */
export const VerifiableTurnTraceSchema = z.object({
  trace_id: z.string(),
  target_instance: TargetInstanceSchema,
  turn_event_id: z.string(),
  virtual_ts_ms: z.number(),
  state_rev_before: z.number(),
  state_rev_after: z.number(),
  steps: VerifiableTurnStepsSchema
});
export type VerifiableTurnTrace = z.infer<typeof VerifiableTurnTraceSchema>;

export const StateMutationProposalSchema = z.object({
  proposal_id: z.string(),
  worker_id: z.enum(["W1", "W2", "W3", "W4", "organ"]),
  base_rev: z.number(),
  target_domain: StateDomainSchema,
  source_event_ids: z.array(z.string()),
  interaction_frame: InteractionFrameSchema.optional(),
  payload: z.record(z.unknown())
});
export type StateMutationProposal = z.infer<typeof StateMutationProposalSchema>;

export const TelemetryFrameSchema = z.object({
  track: z.enum([
    "track1_protocol_frames",
    "track2_mvcc_homeostasis",
    "track3_firewall_pragmatics",
    "track4_sql_audience_guard"
  ]),
  frame_id: z.string(),
  target_instance: TargetInstanceSchema,
  virtual_ts_ms: z.number(),
  state_rev: z.number(),
  summary: z.string(),
  data: z.record(z.unknown())
});
export type TelemetryFrame = z.infer<typeof TelemetryFrameSchema>;

export const AdminTargetQuerySchema = z.object({
  target_instance: TargetInstanceSchema.default("live")
});
export type AdminTargetQuery = z.infer<typeof AdminTargetQuerySchema>;

export const AdminMutationEnvelopeSchema = z.object({
  target_instance: TargetInstanceSchema,
  expected_rev: z.number()
});
export type AdminMutationEnvelope = z.infer<typeof AdminMutationEnvelopeSchema>;

export const SandboxForkRequestSchema = z.object({
  source_snapshot_id: z.string(),
  fork_label: z.string().optional()
});
export type SandboxForkRequest = z.infer<typeof SandboxForkRequestSchema>;

export const ClockAdvanceRequestSchema = z.object({
  target_instance: TargetInstanceSchema,
  duration_ms: z.number(),
  mode: z.enum(["active_unattended", "hibernation"])
});
export type ClockAdvanceRequest = z.infer<typeof ClockAdvanceRequestSchema>;

export const SandboxInjectRequestSchema = z.object({
  target_instance: TargetInstanceSchema,
  perception: PerceptionEnvelopeSchema.optional(),
  ablation_overrides: z.record(z.boolean()).optional()
});
export type SandboxInjectRequest = z.infer<typeof SandboxInjectRequestSchema>;

export const HardForgetRequestSchema = z.object({
  target_instance: TargetInstanceSchema,
  mode: z.enum(["hard_forget", "topic_seal"]),
  target_event_ids: z.array(z.string()).optional(),
  target_memory_ids: z.array(z.string()).optional(),
  topic_description: z.string().optional(),
  dry_run_preview: z.boolean().optional()
});
export type HardForgetRequest = z.infer<typeof HardForgetRequestSchema>;

export interface ProtocolSchemaDescriptor {
  readonly name: string;
  readonly schema: z.ZodTypeAny;
}

export interface ProtocolSchemaCatalog {
  readonly protocol_version: "0.1.0";
  readonly primitives: Readonly<Record<string, ProtocolSchemaDescriptor>>;
  readonly extensions: Readonly<Record<string, ProtocolSchemaDescriptor>>;
  readonly plugin_manifests: Readonly<
    Record<string, ProtocolSchemaDescriptor>
  >;
  readonly control_plane: Readonly<Record<string, ProtocolSchemaDescriptor>>;
}

function descriptor(name: string, schema: z.ZodTypeAny): ProtocolSchemaDescriptor {
  return { name, schema };
}

/**
 * Returns the runtime Zod schemas which define the public protocol surface.
 * Keeping the descriptors in code lets the admin plane introspect the current
 * contract without generated or hand-maintained JSON Schema artifacts.
 */
export function exportProtocolSchemaCatalog() {
  return {
    protocol_version: "0.1.0",
    primitives: {
      ProtocolVersionSchema: descriptor("ProtocolVersionSchema", CoreV0.ProtocolVersionSchema),
      VenueTypeSchema: descriptor("VenueTypeSchema", CoreV0.VenueTypeSchema),
      AudienceScopeSchema: descriptor("AudienceScopeSchema", CoreV0.AudienceScopeSchema),
      WellKnownChannelKindSchema: descriptor("WellKnownChannelKindSchema", CoreV0.WellKnownChannelKindSchema),
      ChannelKindSchema: descriptor("ChannelKindSchema", CoreV0.ChannelKindSchema),
      WellKnownSensorModalitySchema: descriptor("WellKnownSensorModalitySchema", CoreV0.WellKnownSensorModalitySchema),
      SensorModalitySchema: descriptor("SensorModalitySchema", CoreV0.SensorModalitySchema),
      ExpressionVocabularySchema: descriptor("ExpressionVocabularySchema", CoreV0.ExpressionVocabularySchema),
      ActuatorDeclarationSchema: descriptor("ActuatorDeclarationSchema", CoreV0.ActuatorDeclarationSchema),
      EmbodimentSurfaceDescriptorSchema: descriptor("EmbodimentSurfaceDescriptorSchema", CoreV0.EmbodimentSurfaceDescriptorSchema),
      InteractionChannelSchema: descriptor("InteractionChannelSchema", CoreV0.InteractionChannelSchema),
      HandshakeManifestSchema: descriptor("HandshakeManifestSchema", CoreV0.HandshakeManifestSchema),
      HandshakeAckSchema: descriptor("HandshakeAckSchema", CoreV0.HandshakeAckSchema),
      PerceptionEnvelopeSchema: descriptor("PerceptionEnvelopeSchema", CoreV0.PerceptionEnvelopeSchema),
      ExpressionEnvelopeSchema: descriptor("ExpressionEnvelopeSchema", CoreV0.ExpressionEnvelopeSchema),
      DeliveryReceiptSchema: descriptor("DeliveryReceiptSchema", CoreV0.DeliveryReceiptSchema),
      ControlSignalSchema: descriptor("ControlSignalSchema", CoreV0.ControlSignalSchema),
      ProtocolRpcMethodSchema: descriptor("ProtocolRpcMethodSchema", CoreV0.ProtocolRpcMethodSchema),
      JsonRpcIdSchema: descriptor("JsonRpcIdSchema", CoreV0.JsonRpcIdSchema),
      JsonRpcValueSchema: descriptor("JsonRpcValueSchema", CoreV0.JsonRpcValueSchema),
      ProtocolRpcRequestSchema: descriptor("ProtocolRpcRequestSchema", CoreV0.ProtocolRpcRequestSchema),
      ProtocolRpcNotificationSchema: descriptor("ProtocolRpcNotificationSchema", CoreV0.ProtocolRpcNotificationSchema),
      ProtocolRpcSuccessResponseSchema: descriptor("ProtocolRpcSuccessResponseSchema", CoreV0.ProtocolRpcSuccessResponseSchema),
      ProtocolRpcErrorResponseSchema: descriptor("ProtocolRpcErrorResponseSchema", CoreV0.ProtocolRpcErrorResponseSchema),
      ProtocolRpcMessageSchema: descriptor("ProtocolRpcMessageSchema", CoreV0.ProtocolRpcMessageSchema)
    },
    extensions: {
      ExtPerceptionV1Schema: descriptor("ExtPerceptionV1Schema", StandardExtensions.ExtPerceptionV1Schema),
      ExtAffectV1Schema: descriptor("ExtAffectV1Schema", StandardExtensions.ExtAffectV1Schema),
      ExtRhythmV1Schema: descriptor("ExtRhythmV1Schema", StandardExtensions.ExtRhythmV1Schema),
      EmbodiedSyncAnchorSchema: descriptor("EmbodiedSyncAnchorSchema", StandardExtensions.EmbodiedSyncAnchorSchema),
      EmbodiedKeyframeSchema: descriptor("EmbodiedKeyframeSchema", StandardExtensions.EmbodiedKeyframeSchema),
      ExtEmbodiedV1Schema: descriptor("ExtEmbodiedV1Schema", StandardExtensions.ExtEmbodiedV1Schema),
      VisemeFrameSchema: descriptor("VisemeFrameSchema", StandardExtensions.VisemeFrameSchema),
      ExtMediaSidebandV1Schema: descriptor("ExtMediaSidebandV1Schema", StandardExtensions.ExtMediaSidebandV1Schema)
    },
    plugin_manifests: {
      StateDomainSchema: descriptor("StateDomainSchema", PluginManifests.StateDomainSchema),
      WellKnownExtensionFacetIdSchema: descriptor("WellKnownExtensionFacetIdSchema", PluginManifests.WellKnownExtensionFacetIdSchema),
      ExtensionFacetIdSchema: descriptor("ExtensionFacetIdSchema", PluginManifests.ExtensionFacetIdSchema),
      ExtensionCarrierKindSchema: descriptor("ExtensionCarrierKindSchema", PluginManifests.ExtensionCarrierKindSchema),
      ConsoleUiSlotTargetSchema: descriptor("ConsoleUiSlotTargetSchema", PluginManifests.ConsoleUiSlotTargetSchema),
      ExtensionPermissionsSchema: descriptor("ExtensionPermissionsSchema", PluginManifests.ExtensionPermissionsSchema),
      ConsoleWidgetTypeSchema: descriptor("ConsoleWidgetTypeSchema", PluginManifests.ConsoleWidgetTypeSchema),
      ConsoleUiSlotContributionSchema: descriptor("ConsoleUiSlotContributionSchema", PluginManifests.ConsoleUiSlotContributionSchema),
      PluginOriginSchema: descriptor("PluginOriginSchema", PluginManifests.PluginOriginSchema),
      PluginConfigFieldSchema: descriptor("PluginConfigFieldSchema", PluginManifests.PluginConfigFieldSchema),
      RuntimeConsoleUiSlotSchema: descriptor("RuntimeConsoleUiSlotSchema", PluginManifests.RuntimeConsoleUiSlotSchema),
      RuntimePluginDescriptorSchema: descriptor("RuntimePluginDescriptorSchema", PluginManifests.RuntimePluginDescriptorSchema),
      ConsoleContributionsSchema: descriptor("ConsoleContributionsSchema", PluginManifests.ConsoleContributionsSchema),
      Ai0ExtensionManifestSchema: descriptor("Ai0ExtensionManifestSchema", PluginManifests.Ai0ExtensionManifestSchema),
      CapabilityRiskSchema: descriptor("CapabilityRiskSchema", PluginManifests.CapabilityRiskSchema),
      SkillMarkdownFrontmatterSchema: descriptor("SkillMarkdownFrontmatterSchema", PluginManifests.SkillMarkdownFrontmatterSchema),
      ProtocolBridgeTransportSchema: descriptor("ProtocolBridgeTransportSchema", PluginManifests.ProtocolBridgeTransportSchema),
      ProtocolBridgeConfigSchema: descriptor("ProtocolBridgeConfigSchema", PluginManifests.ProtocolBridgeConfigSchema),
      AttentionPriorityRuleSchema: descriptor("AttentionPriorityRuleSchema", PluginManifests.AttentionPriorityRuleSchema),
      CrossPluginTriggerSchema: descriptor("CrossPluginTriggerSchema", PluginManifests.CrossPluginTriggerSchema),
      OrchestrationRulesSchema: descriptor("OrchestrationRulesSchema", PluginManifests.OrchestrationRulesSchema),
      BlackboardSlotIdSchema: descriptor("BlackboardSlotIdSchema", PluginManifests.BlackboardSlotIdSchema),
      BlackboardSlotPolicySchema: descriptor("BlackboardSlotPolicySchema", PluginManifests.BlackboardSlotPolicySchema),
      BlackboardPresetSchema: descriptor("BlackboardPresetSchema", PluginManifests.BlackboardPresetSchema),
      BlackboardPolicySchema: descriptor("BlackboardPolicySchema", PluginManifests.BlackboardPolicySchema),
      OntologicalContractSchema: descriptor("OntologicalContractSchema", PluginManifests.OntologicalContractSchema),
      ThemeColorPresetSchema: descriptor("ThemeColorPresetSchema", PluginManifests.ThemeColorPresetSchema),
      VoiceSignatureSchema: descriptor("VoiceSignatureSchema", PluginManifests.VoiceSignatureSchema),
      CircadianScheduleSchema: descriptor("CircadianScheduleSchema", PluginManifests.CircadianScheduleSchema),
      ProactivityPolicySchema: descriptor("ProactivityPolicySchema", PluginManifests.ProactivityPolicySchema),
      IdentityYamlSchema: descriptor("IdentityYamlSchema", PluginManifests.IdentityYamlSchema),
      LorebookEntrySchema: descriptor("LorebookEntrySchema", PluginManifests.LorebookEntrySchema),
      LorebookYamlSchema: descriptor("LorebookYamlSchema", PluginManifests.LorebookYamlSchema),
      MilestoneCategorySchema: descriptor("MilestoneCategorySchema", PluginManifests.MilestoneCategorySchema),
      PositiveMilestoneRewardsSchema: descriptor("PositiveMilestoneRewardsSchema", PluginManifests.PositiveMilestoneRewardsSchema),
      MilestoneRuleSchema: descriptor("MilestoneRuleSchema", PluginManifests.MilestoneRuleSchema),
      MilestonesAndRitualsYamlSchema: descriptor("MilestonesAndRitualsYamlSchema", PluginManifests.MilestonesAndRitualsYamlSchema),
      ScenarioRollbackModeSchema: descriptor("ScenarioRollbackModeSchema", PluginManifests.ScenarioRollbackModeSchema),
      ScenarioPerceptionInjectionSchema: descriptor("ScenarioPerceptionInjectionSchema", PluginManifests.ScenarioPerceptionInjectionSchema),
      ScenarioStepSchema: descriptor("ScenarioStepSchema", PluginManifests.ScenarioStepSchema),
      ScenarioPlaybookSchema: descriptor("ScenarioPlaybookSchema", PluginManifests.ScenarioPlaybookSchema),
      ScopedCapabilityTokenSchema: descriptor("ScopedCapabilityTokenSchema", PluginManifests.ScopedCapabilityTokenSchema),
      ExtensionPersistentStateSchema: descriptor("ExtensionPersistentStateSchema", PluginManifests.ExtensionPersistentStateSchema),
      ExtensionsStateJsonSchema: descriptor("ExtensionsStateJsonSchema", PluginManifests.ExtensionsStateJsonSchema)
    },
    control_plane: {
      PrincipalTrustSchema: descriptor("PrincipalTrustSchema", PrincipalTrustSchema),
      MemoryTierSchema: descriptor("MemoryTierSchema", MemoryTierSchema),
      EpistemicTypeSchema: descriptor("EpistemicTypeSchema", EpistemicTypeSchema),
      TaintLevelSchema: descriptor("TaintLevelSchema", TaintLevelSchema),
      GroundingStatusSchema: descriptor("GroundingStatusSchema", GroundingStatusSchema),
      LineageRelationTypeSchema: descriptor("LineageRelationTypeSchema", LineageRelationTypeSchema),
      InteractionFrameSchema: descriptor("InteractionFrameSchema", InteractionFrameSchema),
      TargetInstanceSchema: descriptor("TargetInstanceSchema", TargetInstanceSchema),
      VerifiableTurnTraceSchema: descriptor("VerifiableTurnTraceSchema", VerifiableTurnTraceSchema),
      StateMutationProposalSchema: descriptor("StateMutationProposalSchema", StateMutationProposalSchema),
      TelemetryFrameSchema: descriptor("TelemetryFrameSchema", TelemetryFrameSchema),
      AdminTargetQuerySchema: descriptor("AdminTargetQuerySchema", AdminTargetQuerySchema),
      AdminMutationEnvelopeSchema: descriptor("AdminMutationEnvelopeSchema", AdminMutationEnvelopeSchema),
      SandboxForkRequestSchema: descriptor("SandboxForkRequestSchema", SandboxForkRequestSchema),
      ClockAdvanceRequestSchema: descriptor("ClockAdvanceRequestSchema", ClockAdvanceRequestSchema),
      SandboxInjectRequestSchema: descriptor("SandboxInjectRequestSchema", SandboxInjectRequestSchema),
      HardForgetRequestSchema: descriptor("HardForgetRequestSchema", HardForgetRequestSchema),
      ProviderSourceSchema: descriptor("ProviderSourceSchema", OrthogonalConfig.ProviderSourceSchema),
      ModelInstanceSchema: descriptor("ModelInstanceSchema", OrthogonalConfig.ModelInstanceSchema),
      McpServerConfigSchema: descriptor("McpServerConfigSchema", OrthogonalConfig.McpServerConfigSchema),
      AgentSkillRecordSchema: descriptor("AgentSkillRecordSchema", OrthogonalConfig.AgentSkillRecordSchema),
      ExtensionMarketEntrySchema: descriptor("ExtensionMarketEntrySchema", OrthogonalConfig.ExtensionMarketEntrySchema),
      ProviderInstanceSchema: descriptor("ProviderInstanceSchema", OrthogonalConfig.ProviderInstanceSchema),
      PlatformChannelInstanceSchema: descriptor("PlatformChannelInstanceSchema", OrthogonalConfig.PlatformChannelInstanceSchema),
      HostInfrastructureConfigSchema: descriptor("HostInfrastructureConfigSchema", OrthogonalConfig.HostInfrastructureConfigSchema),
      AgentConfigProfileSchema: descriptor("AgentConfigProfileSchema", OrthogonalConfig.AgentConfigProfileSchema),
      UmoRoutingRuleSchema: descriptor("UmoRoutingRuleSchema", OrthogonalConfig.UmoRoutingRuleSchema),
      KnowledgeCapabilityConfigSchema: descriptor("KnowledgeCapabilityConfigSchema", OrthogonalConfig.KnowledgeCapabilityConfigSchema),
      MultimodalCapabilityConfigSchema: descriptor("MultimodalCapabilityConfigSchema", OrthogonalConfig.MultimodalCapabilityConfigSchema),
      SoulProfileAndCapabilitiesConfigSchema: descriptor("SoulProfileAndCapabilitiesConfigSchema", OrthogonalConfig.SoulProfileAndCapabilitiesConfigSchema),
      ResolvedSessionRouteSchema: descriptor("ResolvedSessionRouteSchema", OrthogonalConfig.ResolvedSessionRouteSchema)
    }
  } as const satisfies ProtocolSchemaCatalog;
}
