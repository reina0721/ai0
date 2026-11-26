import { z } from "zod";

export const RealizerAffordanceDescriptorSchema = z.object({
  token: z.string().min(1), semanticAction: z.string().min(1), kind: z.enum(["verbal", "nonverbal"]),
  quiet: z.boolean(), latencyMs: z.number().finite().nonnegative().optional()
}).passthrough();
export const GroundingTruthStageSchema = z.enum([
  "generated_unpresented", "physically_presented", "actuation_verified", "interlocutor_grounded"
]);
export type RealizerAffordanceDescriptor = z.infer<typeof RealizerAffordanceDescriptorSchema>;
export type GroundingTruthStage = z.infer<typeof GroundingTruthStageSchema>;
/** A media adapter translates a device cursor into Unicode code points in the fallback text. */
export interface MediaCursorResolver {
  extension: string;
  resolve(payload: unknown, progress: { played_audio_ms?: number; playback_cursor?: { unit: string; position: number } }): number | undefined;
}
