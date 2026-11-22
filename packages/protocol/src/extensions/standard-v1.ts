import { z } from "zod";

export const EXT_PERCEPTION_V1_KEY = "ext.perception.v1";
export const EXT_AFFECT_V1_KEY = "ext.affect.v1";
export const EXT_RHYTHM_V1_KEY = "ext.rhythm.v1";
export const EXT_EMBODIED_V1_KEY = "ext.embodied.v1";
export const EXT_MEDIA_SIDEBAND_V1_KEY = "ext.media.sideband.v1";

/** Sensory coverage and predictive-coding hypotheses supplied by a shell. */
export const ExtPerceptionV1Schema = z.object({
  source_key: z.string(),
  coverage: z.enum([
    "live_foveal",
    "ambient_peripheral",
    "stale",
    "disconnected"
  ]),
  frame_span_ms: z.number(),
  freshness_ttl_ms: z.number(),
  competing_hypotheses: z
    .array(
      z.object({
        summary_text: z.string(),
        confidence: z.number().min(0).max(1)
      })
    )
    .optional()
});

export type ExtPerceptionV1 = z.infer<typeof ExtPerceptionV1Schema>;

/** Discrete affect label plus continuous valence/arousal/dominance dimensions. */
export const ExtAffectV1Schema = z.object({
  label: z.string(),
  vad: z.object({
    valence: z.number().min(-1).max(1),
    arousal: z.number().min(0).max(1),
    dominance: z.number().min(0).max(1)
  })
});

export type ExtAffectV1 = z.infer<typeof ExtAffectV1Schema>;

/** Turn-taking timing and optional voice prosody instructions. */
export const ExtRhythmV1Schema = z.object({
  pre_delay_ms: z.number(),
  typing_indicator_ms: z.number(),
  pause_after_ms: z.number(),
  prosody: z
    .object({
      speed_rate: z.number().min(0.5).max(2),
      pitch_shift: z.number().min(-1).max(1),
      vocal_effort: z.enum(["whisper", "soft", "normal", "energetic"])
    })
    .optional()
});

export type ExtRhythmV1 = z.infer<typeof ExtRhythmV1Schema>;

export const EmbodiedSyncAnchorSchema = z.union([
  z.literal("pre_speech"),
  z.literal("on_utterance_start"),
  z.literal("on_utterance_end"),
  z
    .string()
    .regex(/^on_substring:.+$/)
    .refine(
      (anchor): anchor is `on_substring:${string}` =>
        anchor.startsWith("on_substring:")
    )
]);
export type EmbodiedSyncAnchor = z.infer<typeof EmbodiedSyncAnchorSchema>;

/** A single animation cue relative to the utterance's audio timeline. */
export const EmbodiedKeyframeSchema = z.object({
  sync_anchor: EmbodiedSyncAnchorSchema,
  gaze: z
    .object({
      target: z.enum([
        "user_eyes",
        "user_cursor",
        "active_window",
        "away_shy",
        "down_sleepy"
      ]),
      behavior: z.enum(["locked", "glancing", "lazy_follow"])
    })
    .optional(),
  facial: z
    .object({
      expression: z.string(),
      intensity: z.number().min(0).max(1),
      blush_level: z.number().min(0).max(1).optional()
    })
    .optional(),
  gesture: z
    .object({
      category: z.enum(["head_motion", "hand_gesture", "posture_shift"]),
      intent: z.string(),
      fallback_intent: z.string()
    })
    .optional(),
  linger_ms: z.number().optional()
});

export type EmbodiedKeyframe = z.infer<typeof EmbodiedKeyframeSchema>;

/** Embodied expression instructions, including up to three timed keyframes. */
export const ExtEmbodiedV1Schema = EmbodiedKeyframeSchema.extend({
  keyframes: z.array(EmbodiedKeyframeSchema).max(3).optional()
});

export type ExtEmbodiedV1 = z.infer<typeof ExtEmbodiedV1Schema>;

export const VisemeFrameSchema = z.object({
  offset_ms: z.number(),
  viseme: z.enum([
    "sil",
    "aa",
    "E",
    "I",
    "O",
    "U",
    "PP",
    "FF",
    "TH",
    "DD",
    "kk",
    "CH",
    "SS",
    "nn",
    "RR"
  ]),
  weight: z.number()
});
export type VisemeFrame = z.infer<typeof VisemeFrameSchema>;

/** Gateway-generated audio, character timing, and optional lip-sync data. */
export const ExtMediaSidebandV1Schema = z.object({
  audio_stream_id: z.string(),
  audio_format: z.enum(["pcm_s16le_24k", "opus_webm", "mp3"]),
  total_duration_ms: z.number(),
  char_offset_timestamps_ms: z.array(z.number()),
  viseme_frames: z.array(VisemeFrameSchema).optional()
});

export type ExtMediaSidebandV1 = z.infer<typeof ExtMediaSidebandV1Schema>;

export const StandardExtensionSchemas = {
  [EXT_PERCEPTION_V1_KEY]: ExtPerceptionV1Schema,
  [EXT_AFFECT_V1_KEY]: ExtAffectV1Schema,
  [EXT_RHYTHM_V1_KEY]: ExtRhythmV1Schema,
  [EXT_EMBODIED_V1_KEY]: ExtEmbodiedV1Schema,
  [EXT_MEDIA_SIDEBAND_V1_KEY]: ExtMediaSidebandV1Schema
} as const;

export type StandardExtensionKey = keyof typeof StandardExtensionSchemas;

export type RecognizedExtensions = Partial<{
  [Key in StandardExtensionKey]: z.infer<(typeof StandardExtensionSchemas)[Key]>;
}>;

export interface ParseKnownExtensionsResult {
  recognized: RecognizedExtensions;
  degraded_extensions: string[];
}

/**
 * Parses standard extension payloads that the receiver supports. Unknown,
 * unsupported, and malformed entries are reported for graceful degradation.
 */
export function parseKnownExtensions(
  extensions: Record<string, unknown>,
  supportedExtensions?: ReadonlyArray<string>
): ParseKnownExtensionsResult {
  const recognized: RecognizedExtensions = {};
  const degraded_extensions: string[] = [];
  const supported = supportedExtensions === undefined ? undefined : new Set(supportedExtensions);

  for (const [key, value] of Object.entries(extensions)) {
    const schema = StandardExtensionSchemas[key as StandardExtensionKey];

    if (schema === undefined || (supported !== undefined && !supported.has(key))) {
      degraded_extensions.push(key);
      continue;
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      degraded_extensions.push(key);
      continue;
    }

    (recognized as Record<string, unknown>)[key] = parsed.data;
  }

  return { recognized, degraded_extensions };
}
