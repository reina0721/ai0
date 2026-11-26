import { sortFacetsByPriority, type ExtensionCoreHost } from "@ai0/extension-core";
import { expressionIntentDecoratorFacet, expressionRealizerFacet } from "./facets.js";
import { CommunicativeIntentEnvelopeSchema, InteractionChannelSchema, EXT_EMBODIED_V1_KEY, type CommunicativeIntentEnvelope, type EmbodiedKeyframe, type ExpressionEnvelope,
  type ExpressionVocabulary, type InteractionChannel, type NegotiatedIntentDispatch } from "@ai0/protocol";

export class RealizerVocabularyNegotiator {
  private readonly channels = new Map<string, InteractionChannel>();
  private readonly media = new Map<string, ExpressionVocabulary>();

  constructor(private readonly extensionHost?: ExtensionCoreHost) {}

  mount(channel: InteractionChannel) { this.channels.set(channel.channel_id, InteractionChannelSchema.parse(channel)); }
  hasChannel(channelId: string): boolean { return this.channels.has(channelId) || this.extensionHost?.listFacets(expressionRealizerFacet)
    .some(entry => entry.implementation.channel.channel_id === channelId) === true; }
  unmount(channelId: string) { this.channels.delete(channelId); this.media.delete(channelId); }
  mountMediaVocabulary(channelId: string, vocabulary: ExpressionVocabulary) {
    this.media.set(channelId, structuredClone(vocabulary));
  }

  negotiate(request: CommunicativeIntentEnvelope, preferredChannelId?: string): NegotiatedIntentDispatch {
    const constraints = request.deliveryConstraints;
    const host = this.extensionHost;
    const candidates = new Map(this.channels);
    if (host) for (const entry of host.listFacets(expressionRealizerFacet)) {
      const channel = entry.implementation.channel;
      if (!candidates.has(channel.channel_id) && host.allowsAudienceScope(entry.packageId, constraints.audienceScope)) {
        candidates.set(channel.channel_id, channel);
      }
    }
    for (const channel of candidates.values()) {
      if (preferredChannelId !== undefined && preferredChannelId !== channel.channel_id) continue;
      if (channel.current_audience.scope !== constraints.audienceScope ||
          (constraints.maxLatencyMs !== undefined && channel.latency_budget_ms > constraints.maxLatencyMs)) continue;
      let intent = request;
      if (host) for (const entry of sortFacetsByPriority(host.listFacets(expressionIntentDecoratorFacet))) {
        if (!host.allowsAudienceScope(entry.packageId, constraints.audienceScope)) continue;
        intent = host.invokeFacet(entry, facet => CommunicativeIntentEnvelopeSchema.parse({
          ...facet.decorate(structuredClone(intent), structuredClone(channel)),
          intent: request.intent, intentId: request.intentId, correlationEventId: request.correlationEventId,
          deliveryConstraints: constraints
        })) ?? intent;
      }
      const caps = channel.capabilities;
      const affordance = caps.embodiment_surface?.supported_tokens?.find(value =>
        value.semanticAction === (intent.actuationHint?.semanticAction ?? intent.expressiveStance?.semanticCue ?? intent.intent)
        && (!constraints.requireNonVerbalQuiet || (value.kind === "nonverbal" && value.quiet))
        && (constraints.maxLatencyMs === undefined || (value.latencyMs ?? channel.latency_budget_ms) <= constraints.maxLatencyMs));
      if (constraints.requireNonVerbalQuiet && !affordance && intent.intent !== "explicit_silence") continue;
      const actuatorId = affordance?.token ?? intent.actuationHint?.semanticAction;
      if (intent.intent === "actuate" && !caps.actuators.some(actuator => actuator.actuator_id === actuatorId)) continue;
      const vocabulary = caps.expression_vocabulary;
      const media = this.media.get(channel.channel_id);
      const stance = intent.expressiveStance;
      const tag = stance?.semanticCue;
      const expression = tag && [vocabulary?.expression_tags, vocabulary?.facial_expressions, media?.expression_tags]
        .some(tags => tags?.includes(tag)) ? { tag, intensity: stance?.intensity ?? 1 } : undefined;
      const gesture = stance?.gestureIntent;
      const haptic = stance?.hapticCue;
      const supportsEmbodied = Boolean(caps.embodiment_surface);
      const tokenKeyframe: EmbodiedKeyframe | undefined = supportsEmbodied && affordance?.kind === "nonverbal"
        ? { sync_anchor: "pre_speech", expression: { tag: affordance.token, intensity: stance?.intensity ?? 1 } }
        : undefined;
      const envelope: ExpressionEnvelope = {
        intent_id: intent.intentId, correlation_event_id: intent.correlationEventId, chunk_seq: 0, is_final: true,
        action_type: intent.intent === "communicate" ? (constraints.requireNonVerbalQuiet ? "explicit_silence" : "speak")
          : intent.intent === "actuate" ? "invoke_actuator" : intent.intent,
        fallback_text: intent.intent === "communicate" && !constraints.requireNonVerbalQuiet ? intent.utterance ?? "" : "",
        attention_target: intent.attentionTarget, observation_request: intent.observationRequest,
        delivery_constraints: constraints, expressive_stance: supportsEmbodied ? stance : undefined,
        ...(intent.intent === "actuate" && actuatorId ? { actuator_invocation: {
          actuator_id: actuatorId, arguments: intent.actuationHint?.arguments ?? {}
        } } : {}),
        extensions: supportsEmbodied ? { [EXT_EMBODIED_V1_KEY]: {
          sync_anchor: "pre_speech",
          ...(intent.attentionTarget ? { attention: { target: intent.attentionTarget, behavior: "locked" } } : {}),
          ...(tokenKeyframe ? { expression: tokenKeyframe.expression, keyframes: [tokenKeyframe] }
            : expression ? { expression } : {}),
          ...(gesture && (vocabulary?.gesture_intents?.includes(gesture) || media?.gesture_intents?.includes(gesture))
            ? { gesture: { category: "semantic", intent: gesture } } : {}),
          ...(haptic && (vocabulary?.haptic_cues?.includes(haptic) || media?.haptic_cues?.includes(haptic))
            ? { haptic: { cue_tag: haptic } } : {})
        } } : {}
      };
      return { status: "dispatched", channelId: channel.channel_id, envelope };
    }
    return { status: "held_pending_compliant_channel", envelope: null };
  }
}
