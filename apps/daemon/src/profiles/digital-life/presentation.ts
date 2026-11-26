import type { PresentationRenderer } from "@ai0/expression-core";
import { EXT_EMBODIED_V1_KEY, type EmbodiedKeyframe } from "@ai0/protocol";

export const renderEmbodiedPresentation: PresentationRenderer = ({ intent, channel, style, media, nonverbalToken }) => {
  const caps = channel.capabilities;
  const vocabulary = caps.expression_vocabulary;
  const stance = intent.expressiveStance;
  const tag = stance?.semanticCue;
  const expression = tag && [vocabulary?.expression_tags, vocabulary?.facial_expressions, media?.expression_tags]
    .some(tags => tags?.includes(tag)) ? { tag, intensity: stance?.intensity ?? 1 } : undefined;
  const gesture = stance?.gestureIntent;
  const haptic = stance?.hapticCue;
  const supportsEmbodied = Boolean(caps.embodiment_surface);
  const tokenKeyframe: EmbodiedKeyframe | undefined = style && supportsEmbodied && nonverbalToken
    ? { sync_anchor: style.syncAnchor, expression: { tag: nonverbalToken, intensity: stance?.intensity ?? 1 } }
    : undefined;
  const hasCue = Boolean(intent.attentionTarget || tokenKeyframe || expression || gesture || haptic);
  return supportsEmbodied && style && hasCue ? { [EXT_EMBODIED_V1_KEY]: {
    sync_anchor: style.syncAnchor,
    ...(intent.attentionTarget && style.attentionBehavior
      ? { attention: { target: intent.attentionTarget, behavior: style.attentionBehavior } } : {}),
    ...(tokenKeyframe ? { expression: tokenKeyframe.expression, keyframes: [tokenKeyframe] }
      : expression ? { expression } : {}),
    ...(gesture && (vocabulary?.gesture_intents?.includes(gesture) || media?.gesture_intents?.includes(gesture))
      ? { gesture: { category: "semantic", intent: gesture } } : {}),
    ...(haptic && (vocabulary?.haptic_cues?.includes(haptic) || media?.haptic_cues?.includes(haptic))
      ? { haptic: { cue_tag: haptic } } : {})
  } } : {};
};
