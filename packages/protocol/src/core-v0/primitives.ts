import { z } from "zod";

export const ProtocolVersionSchema = z.literal("0.1.0");
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const VenueTypeSchema = z.enum([
  "private_1on1",
  "group_chat",
  "public_livestream",
  "local_ambient"
]);
export type VenueType = z.infer<typeof VenueTypeSchema>;

const GroupAudienceScopeSchema = z
  .string()
  .regex(/^(only_owner|public_all|group:[a-zA-Z0-9_.:-]+)$/)
  .refine(
    (scope): scope is `group:${string}` => scope.startsWith("group:"),
    "Group audience scopes must start with group:"
  );

export const AudienceScopeSchema = z.union([
  z.literal("only_owner"),
  z.literal("public_all"),
  GroupAudienceScopeSchema
]);
export type AudienceScope = z.infer<typeof AudienceScopeSchema>;

export const WellKnownShellKindSchema = z.enum([
  "webchat",
  "desktop_avatar",
  "im_bridge",
  "game_embodied",
  "hardware_iot",
  "cli"
]);
export type WellKnownShellKind = z.infer<typeof WellKnownShellKindSchema>;

const CustomShellKindSchema = z
  .string()
  .regex(/^custom\..+$/)
  .refine(
    (shellKind): shellKind is `custom.${string}` => shellKind.startsWith("custom.")
  );

export const ShellKindSchema = z.union([
  WellKnownShellKindSchema,
  CustomShellKindSchema
]);
export type ShellKind = z.infer<typeof ShellKindSchema>;

export const WellKnownSensorModalitySchema = z.enum([
  "text",
  "audio_transcript",
  "vad_activity",
  "typing_activity",
  "tactile",
  "window_focus",
  "game_state",
  "visual_semantic"
]);
export type WellKnownSensorModality = z.infer<
  typeof WellKnownSensorModalitySchema
>;

const CustomSensorModalitySchema = z
  .string()
  .regex(/^custom\..+$/)
  .refine(
    (modality): modality is `custom.${string}` => modality.startsWith("custom.")
  );

export const SensorModalitySchema = z.union([
  WellKnownSensorModalitySchema,
  CustomSensorModalitySchema
]);
export type SensorModality = z.infer<typeof SensorModalitySchema>;

export const ExpressionVocabularySchema = z.object({
  facial_expressions: z.array(z.string()).optional(),
  gesture_intents: z.array(z.string()).optional(),
  voice_emotion_tags: z.array(z.string()).optional()
});
export type ExpressionVocabulary = z.infer<
  typeof ExpressionVocabularySchema
>;

export const ActuatorDeclarationSchema = z.object({
  actuator_id: z.string(),
  description: z.string(),
  parameters_json_schema: z.record(z.unknown()),
  requires_local_user_consent: z.boolean()
});
export type ActuatorDeclaration = z.infer<
  typeof ActuatorDeclarationSchema
>;

export const HandshakeManifestSchema = z.object({
  protocol_version: ProtocolVersionSchema,
  shell_id: z.string(),
  shell_kind: ShellKindSchema,
  display_name: z.string(),
  venue_type: VenueTypeSchema,
  current_audience: z.object({
    scope: AudienceScopeSchema,
    member_count: z.number(),
    description: z.string().optional()
  }),
  latency_budget_ms: z.number(),
  capabilities: z.object({
    sensors: z.array(SensorModalitySchema),
    supported_extensions: z.array(z.string()),
    expression_vocabulary: ExpressionVocabularySchema.optional(),
    actuators: z.array(ActuatorDeclarationSchema)
  }),
  auth_token: z.string()
});
export type HandshakeManifest = z.infer<typeof HandshakeManifestSchema>;

export const HandshakeAckSchema = z.object({
  session_id: z.string(),
  accepted_version: ProtocolVersionSchema,
  enforced_venue_type: VenueTypeSchema,
  max_audience_privacy_ceiling: AudienceScopeSchema,
  entity_nature: z.literal("artificial_intelligence_digital_life"),
  server_virtual_ts_ms: z.number()
});
export type HandshakeAck = z.infer<typeof HandshakeAckSchema>;

export const PerceptionEnvelopeSchema = z.object({
  event_id: z.string(),
  timestamp: z.string(),
  actor: z.object({
    platform_uid: z.string(),
    display_name: z.string()
  }),
  lifecycle: z.enum(["activity", "interim", "commit", "retract"]),
  modality: SensorModalitySchema,
  summary_text: z.string(),
  confidence: z.number().min(0).max(1),
  sustained_ms: z.number().optional(),
  persistence_hint: z.enum(["permanent", "ephemeral_blackboard"]),
  extensions: z.record(z.unknown())
});
export type PerceptionEnvelope = z.infer<typeof PerceptionEnvelopeSchema>;

export const ExpressionEnvelopeSchema = z.object({
  intent_id: z.string(),
  correlation_event_id: z.string(),
  chunk_seq: z.number(),
  is_final: z.boolean(),
  action_type: z.enum(["speak", "explicit_silence", "invoke_actuator"]),
  fallback_text: z.string(),
  silence_reason: z
    .enum([
      "listening_wait_for_more",
      "not_addressed_in_group",
      "respecting_user_focus",
      "emotional_pause"
    ])
    .optional(),
  actuator_invocation: z
    .object({
      actuator_id: z.string(),
      arguments: z.record(z.unknown())
    })
    .optional(),
  extensions: z.record(z.unknown())
});
export type ExpressionEnvelope = z.infer<typeof ExpressionEnvelopeSchema>;

export const DeliveryReceiptSchema = z.object({
  intent_id: z.string(),
  chunk_seq: z.number(),
  status: z.enum([
    "rendered",
    "playing",
    "completed",
    "interrupted",
    "degraded",
    "failed"
  ]),
  spoken_char_offset: z.number().optional(),
  played_audio_ms: z.number().optional(),
  interrupted_by_event_id: z.string().optional(),
  degraded_extensions: z.array(z.string()).optional(),
  actuator_outcome: z
    .object({
      success: z.boolean(),
      result_summary: z.string(),
      data: z.record(z.unknown()).optional(),
      error_code: z.string().optional()
    })
    .optional()
});
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

export const ControlSignalSchema = z.object({
  signal_type: z.enum([
    "barge_in_cancel",
    "audience_changed",
    "capabilities_updated",
    "focus_shifted",
    "sb243_break_reminder",
    "crisis_intervention_card"
  ]),
  target_intent_id: z.string().optional(),
  active_focus_shell_id: z.string().optional(),
  payload: z.record(z.unknown()).optional()
});
export type ControlSignal = z.infer<typeof ControlSignalSchema>;

export const ProtocolRpcMethodSchema = z.enum([
  "ai0.handshake",
  "ai0.perception",
  "ai0.expression",
  "ai0.receipt",
  "ai0.control"
]);
export type ProtocolRpcMethod = z.infer<typeof ProtocolRpcMethodSchema>;

export const JsonRpcIdSchema = z.union([
  z.string(),
  z.number().finite(),
  z.null()
]);
export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

export type JsonRpcValue =
  | null
  | boolean
  | number
  | string
  | JsonRpcValue[]
  | { [key: string]: JsonRpcValue };

export const JsonRpcValueSchema: z.ZodType<JsonRpcValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonRpcValueSchema),
    z.record(JsonRpcValueSchema)
  ])
);

const ProtocolRpcRequestBaseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema
});

const ProtocolRpcNotificationBaseSchema = z.object({
  jsonrpc: z.literal("2.0")
});

function createProtocolRpcRequestSchema<
  Method extends ProtocolRpcMethod,
  Params extends z.ZodTypeAny
>(method: Method, params: Params) {
  return ProtocolRpcRequestBaseSchema.extend({
    method: z.literal(method),
    params
  }).strict();
}

function createProtocolRpcNotificationSchema<
  Method extends ProtocolRpcMethod,
  Params extends z.ZodTypeAny
>(method: Method, params: Params) {
  return ProtocolRpcNotificationBaseSchema.extend({
    method: z.literal(method),
    params
  }).strict();
}

export const ProtocolRpcRequestSchema = z.discriminatedUnion("method", [
  createProtocolRpcRequestSchema("ai0.handshake", HandshakeManifestSchema),
  createProtocolRpcRequestSchema("ai0.perception", PerceptionEnvelopeSchema),
  createProtocolRpcRequestSchema("ai0.expression", ExpressionEnvelopeSchema),
  createProtocolRpcRequestSchema("ai0.receipt", DeliveryReceiptSchema),
  createProtocolRpcRequestSchema("ai0.control", ControlSignalSchema)
]);
export type ProtocolRpcRequest = z.infer<typeof ProtocolRpcRequestSchema>;

export const ProtocolRpcNotificationSchema = z.discriminatedUnion("method", [
  createProtocolRpcNotificationSchema(
    "ai0.handshake",
    HandshakeManifestSchema
  ),
  createProtocolRpcNotificationSchema(
    "ai0.perception",
    PerceptionEnvelopeSchema
  ),
  createProtocolRpcNotificationSchema(
    "ai0.expression",
    ExpressionEnvelopeSchema
  ),
  createProtocolRpcNotificationSchema("ai0.receipt", DeliveryReceiptSchema),
  createProtocolRpcNotificationSchema("ai0.control", ControlSignalSchema)
]);
export type ProtocolRpcNotification = z.infer<
  typeof ProtocolRpcNotificationSchema
>;

export const ProtocolRpcSuccessResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: JsonRpcIdSchema,
    result: JsonRpcValueSchema
  })
  .strict();
export type ProtocolRpcSuccessResponse = z.infer<
  typeof ProtocolRpcSuccessResponseSchema
>;

export const ProtocolRpcErrorResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: JsonRpcIdSchema,
    error: z.object({
      code: z.number().int(),
      message: z.string(),
      data: JsonRpcValueSchema.optional()
    })
  })
  .strict();
export type ProtocolRpcErrorResponse = z.infer<
  typeof ProtocolRpcErrorResponseSchema
>;

export const ProtocolRpcMessageSchema = z.union([
  ProtocolRpcRequestSchema,
  ProtocolRpcNotificationSchema,
  ProtocolRpcSuccessResponseSchema,
  ProtocolRpcErrorResponseSchema
]);
export type ProtocolRpcMessage = z.infer<typeof ProtocolRpcMessageSchema>;

/**
 * Returns the number of character-start timestamps at or before the played time.
 * The timestamp array is expected to be monotonically increasing.
 */
export function computeSpokenCharOffsetFromAudioMs(
  charOffsetTimestampsMs: ReadonlyArray<number>,
  playedAudioMs: number
): number {
  const clampedPlayedAudioMs = Math.max(0, playedAudioMs);
  let lowerBound = 0;
  let upperBound = charOffsetTimestampsMs.length;

  while (lowerBound < upperBound) {
    const midpoint = lowerBound + Math.floor((upperBound - lowerBound) / 2);
    const timestamp = charOffsetTimestampsMs[midpoint];

    if (timestamp !== undefined && timestamp <= clampedPlayedAudioMs) {
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint;
    }
  }

  return lowerBound;
}
