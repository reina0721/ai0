import { z } from "zod";

import { AudienceScopeSchema } from "../core-v0/audience.js";

export const SensoryCoverageSchema = z.enum(["live_foveal", "ambient_peripheral", "on_demand", "blind", "stale", "disconnected"]);
export const BodyAnchorDescriptorSchema = z.object({ id: z.string().min(1), kind: z.string().optional(), label: z.string().optional() }).passthrough();
export const SensorAffordanceDescriptorSchema = z.object({
  modality: z.string().min(1), source_key: z.string().min(1), coverage: SensoryCoverageSchema.optional(),
  freshness_ttl_ms: z.number().finite().nonnegative().optional()
}).passthrough();
export const ObservationPrimitiveSchema = z.enum([
  "utterance_interactional", "contact_interaction", "metric_transition", "presence_context",
  "attention_focus", "endogenous_chronoception", "custom_semantic"
]);
export const ObservationTargetSchema = z.object({ anchor: z.string().min(1), kind: z.string().optional() }).passthrough();
export const UniversalObservationFrameSchema = z.object({
  channel: z.object({ modality: z.string().min(1), channelId: z.string().min(1), sensorCoverage: SensoryCoverageSchema,
    sourceKey: z.string().optional(), primitive: ObservationPrimitiveSchema.optional() }).passthrough(),
  attribution: z.object({ subjectAnchor: z.string(), principalId: z.string() }).passthrough(),
  contextFrame: z.object({ socialFrame: z.string(), audienceScope: AudienceScopeSchema }).passthrough(),
  provenance: z.object({
    epistemicTier: z.enum(["direct_sensor", "verified_telemetry", "untrusted_utterance", "system_chronoception"]),
    trustedGrant: z.boolean()
  }).passthrough(),
  interpretation: z.object({ rawPayload: z.unknown(), primaryCue: z.string(),
    competingHypotheses: z.array(z.string()).optional() }).passthrough(),
  chronology: z.object({ observedAtMs: z.number().finite(), freshnessTtlMs: z.number().finite().nonnegative(),
    turnId: z.string(), revision: z.number().int().nonnegative() }).passthrough(),
  target: ObservationTargetSchema.optional(), domain_payload: z.unknown().optional()
});
export type SensoryCoverage = z.infer<typeof SensoryCoverageSchema>;
export type BodyAnchorDescriptor = z.infer<typeof BodyAnchorDescriptorSchema>;
export type SensorAffordanceDescriptor = z.infer<typeof SensorAffordanceDescriptorSchema>;
export type ObservationPrimitive = z.infer<typeof ObservationPrimitiveSchema>;
export type ObservationTarget = z.infer<typeof ObservationTargetSchema>;
export type UniversalObservationFrame = z.infer<typeof UniversalObservationFrameSchema>;
