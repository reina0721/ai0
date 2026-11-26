import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

import {
  ExtMediaSidebandV1Schema,
  type ExpressionEnvelope,
  type ExtMediaSidebandV1,
  type VisemeFrame
} from "@ai0/protocol";
import { defineExtensionPackage, expressionMediaTranscoderFacet } from "@ai0/sdk";

const offsetsFor = (text: string): number[] => {
  const chars = Array.from(text);
  let elapsed = 0;
  return chars.map((char) => {
    const at = elapsed;
    elapsed += /[，。！？,.!?；;：:\n]/u.test(char)
      ? 180
      : /\s/u.test(char)
        ? 45
        : 92;
    return at;
  });
};

const visemeFor = (char: string): VisemeFrame["viseme"] => {
  if (/\s/u.test(char)) return "sil";
  if (/[aāáǎà]/iu.test(char)) return "aa";
  if (/[eēéěè]/iu.test(char)) return "E";
  if (/[iīíǐì]/iu.test(char)) return "I";
  if (/[oōóǒò]/iu.test(char)) return "O";
  if (/[uūúǔùü]/iu.test(char)) return "U";
  if (/[bmp]/iu.test(char)) return "PP";
  if (/[fv]/iu.test(char)) return "FF";
  return "nn";
};

export function buildSideband(intent: ExpressionEnvelope): ExtMediaSidebandV1 {
  const text = intent.fallback_text ?? "";
  const chars = Array.from(text);
  const timestamps = offsetsFor(text);
  const lastTimestamp = timestamps[timestamps.length - 1] ?? 0;
  return ExtMediaSidebandV1Schema.parse({
    audio_stream_id: `stream_${intent.intent_id}_${intent.chunk_seq}`,
    audio_format: "pcm_s16le_24k",
    total_duration_ms: chars.length === 0 ? 0 : lastTimestamp + 120,
    char_offset_timestamps_ms: timestamps,
    viseme_frames: chars.map((char, index) => ({
      offset_ms: timestamps[index] ?? 0,
      viseme: visemeFor(char),
      weight: /\s/u.test(char) ? 0 : 0.85
    }))
  });
}

export const emotionTtsSideband = defineExtensionPackage({
  manifest,
  activate(scope) {
    scope.contributeFacet(expressionMediaTranscoderFacet, {
      getSupportedVocabulary: () => ({
        voice_emotion_tags: ["warm_neutral", "bright", "soft", "curious"],
        visual_semantic_cues: ["gentle_blink", "small_smile", "concerned_gaze"]
      }),
      onUpstreamMediaFrame: frame => frame,
      onDownstreamExpression: (intent: ExpressionEnvelope) => ({ intent, sideband: buildSideband(intent) })
    });
  }
});

export default emotionTtsSideband;
