import { z } from "zod";
import { ChannelKnowledgeReferencesSchema } from "./control-plane/knowledge.js";

/** Channel A projection of a turn. Optional values are omitted when unavailable. */
export const channelRunStages = ["accepted", "gate", "recall", "blackboard", "generating", "committed", "delivering"] as const;
export const ChannelRunStageSchema = z.enum(channelRunStages);
export type ChannelRunStage = z.infer<typeof ChannelRunStageSchema>;

export const ChannelStageEventSchema = z.object({
  stage: ChannelRunStageSchema,
  elapsedMs: z.number().optional()
});
export type ChannelStageEvent = z.infer<typeof ChannelStageEventSchema>;

export const ChannelTokenUsageSchema = z.object({
  contextWindow: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  reasoningTokens: z.number().optional()
});
export type ChannelTokenUsage = z.infer<typeof ChannelTokenUsageSchema>;

const ChannelRunErrorSchema = z.enum([
  "MODEL_CONTEXT_LIMIT", "PROVIDER_NOT_READY", "SOUL_NOT_AWAKENED", "UPSTREAM_INFERENCE_FAILED"
]);
export const ChannelRunProcessSchema = z.object({
  stages: z.array(ChannelStageEventSchema),
  error: ChannelRunErrorSchema.optional(),
  elapsedMs: z.number().optional(),
  reasoning: z.string().optional(),
  provider: z.object({ name: z.string(), model: z.string() }).optional(),
  usage: ChannelTokenUsageSchema.optional(),
  /** Resolved under the current viewer's permissions at read time. */
  memories: z.array(z.object({ id: z.string(), text: z.string() })).optional()
});
export type ChannelRunProcess = z.infer<typeof ChannelRunProcessSchema>;

/** Shared by run snapshots, history entries and data-turn notifications. */
export const ChannelRunPresentationSchema = ChannelKnowledgeReferencesSchema.extend({
  process: ChannelRunProcessSchema.optional(),
  error: ChannelRunErrorSchema.optional()
});
export type ChannelRunPresentation = z.infer<typeof ChannelRunPresentationSchema>;

export const ChannelReasoningEventSchema = z.object({
  type: z.literal("data-turn-reasoning"),
  /** null withdraws a discarded provider attempt. */
  data: z.object({ delta: z.string().nullable() })
});
export type ChannelReasoningEvent = z.infer<typeof ChannelReasoningEventSchema>;
