import { z } from "zod";

import { AudienceScopeSchema } from "../core-v0/audience.js";
import { ExpressionEnvelopeSchema } from "../core-v0/primitives.js";

export const CommunicativeIntentEnvelopeSchema = z.object({
  intent: z.enum(["communicate", "explicit_silence", "actuate", "request_observation"]),
  intentId: z.string(), correlationEventId: z.string(),
  utterance: z.string().optional(), attentionTarget: z.string().optional(),
  expressiveStance: z.object({ semanticCue: z.string().optional(), intensity: z.number().min(0).max(1).optional(),
    gestureIntent: z.string().optional(), hapticCue: z.string().optional() }).passthrough().optional(),
  actuationHint: z.object({ semanticAction: z.string(), arguments: z.record(z.unknown()).optional() }).optional(),
  observationRequest: z.record(z.unknown()).optional(),
  deliveryConstraints: z.object({ audienceScope: AudienceScopeSchema, requireNonVerbalQuiet: z.boolean().optional(),
    maxLatencyMs: z.number().finite().nonnegative().optional() })
});
export const ExpressionDispatchProvenanceSchema = z.object({
  realizerPackageId: z.string().optional(),
  realizerGeneration: z.number().int().nonnegative().optional(),
  decoratorTraces: z
    .array(
      z.object({
        packageId: z.string(),
        generation: z.number().int().nonnegative()
      })
    )
    .default([])
});
export type ExpressionDispatchProvenance = z.infer<typeof ExpressionDispatchProvenanceSchema>;

export const NegotiatedIntentDispatchSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("dispatched"),
    channelId: z.string(),
    envelope: ExpressionEnvelopeSchema,
    provenance: ExpressionDispatchProvenanceSchema.optional()
  }),
  z.object({ status: z.literal("held_pending_compliant_channel"), envelope: z.null() })
]);
export type CommunicativeIntentEnvelope = z.infer<typeof CommunicativeIntentEnvelopeSchema>;
export type NegotiatedIntentDispatch = z.infer<typeof NegotiatedIntentDispatchSchema>;
