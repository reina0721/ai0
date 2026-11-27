import { sortFacetsByPriority, type ExtensionHostView } from "@ai0/extension-core";
import { expressionIntentDecoratorFacet, expressionRealizerFacet } from "./facets.js";
import { CommunicativeIntentEnvelopeSchema, DeliveryReceiptSchema, InteractionChannelSchema, type CommunicativeIntentEnvelope, type ExpressionEnvelope,
  type ExpressionVocabulary, type InteractionChannel, type NegotiatedIntentDispatch } from "@ai0/protocol";

import type { EmbodiedPresentationStyle } from "@ai0/protocol";
export type { EmbodiedPresentationStyle } from "@ai0/protocol";


/** The caller owns the undelivered intent and may negotiate again when an endpoint changes. */
export class PendingExpressionDelivery extends Error {
  readonly code = "held_pending_compliant_channel";
  constructor(readonly intent: CommunicativeIntentEnvelope, readonly channelId: string) {
    super("Expression awaits a compliant channel");
    this.name = "PendingExpressionDelivery";
  }
}

export type PresentationRenderer = (input: {
  intent: CommunicativeIntentEnvelope; channel: InteractionChannel; style?: EmbodiedPresentationStyle;
  nonverbalToken?: string; media?: ExpressionVocabulary;
}) => ExpressionEnvelope["extensions"];

/** Capture a host-approved endpoint and its generation before offering an action for dispatch. */
export function bindActuatorDelivery(host: ExtensionHostView, packageId: string, channelId: string,
  permits: (actuatorId: string) => boolean) {
  const entries = host.listFacets(expressionRealizerFacet).filter(entry =>
    entry.packageId === packageId && entry.implementation.channel.channel_id === channelId && entry.implementation.deliver);
  if (entries.length !== 1) throw new Error("Missing or ambiguous delivery endpoint");
  const entry = entries[0]!;
  const channel = entry.implementation.channel;
  return async (envelope: ExpressionEnvelope, signal: AbortSignal) => {
    const action = envelope.actuator_invocation;
    const authorized = () => action && envelope.action_type === "invoke_actuator" &&
      envelope.delivery_constraints?.audienceScope === channel.current_audience.scope && permits(action.actuator_id) &&
      channel.capabilities.actuators.some(item => item.actuator_id === action.actuator_id) &&
      host.allowsAudienceScope(packageId, channel.current_audience.scope, expressionRealizerFacet.id);
    signal.throwIfAborted();
    if (!authorized()) throw new Error("Actuation denied");
    const lease = host.leaseFacet(entry);
    const combined = AbortSignal.any([signal, lease.signal]);
    try {
      combined.throwIfAborted();
      const raw = await entry.implementation.deliver!(structuredClone(envelope), combined);
      combined.throwIfAborted();
      if (!authorized() || raw === undefined) return undefined;
      const receipt = DeliveryReceiptSchema.parse(raw);
      if (receipt.intent_id !== envelope.intent_id || receipt.chunk_seq !== envelope.chunk_seq) throw new Error("Mismatched delivery receipt");
      return receipt;
    } finally { lease.dispose(); }
  };
}

export class RealizerVocabularyNegotiator {
  private readonly channels = new Map<string, InteractionChannel>();
  private readonly media = new Map<string, ExpressionVocabulary>();

  constructor(private readonly extensionHost?: ExtensionHostView, private readonly style?: Readonly<EmbodiedPresentationStyle>,
    private readonly renderer?: PresentationRenderer) {}

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
    const styles = new Map<string, EmbodiedPresentationStyle>();
    const realizerOrigins = new Map<string, { packageId: string; generation: number }>();
    if (host) {
      for (const entry of sortFacetsByPriority(host.listFacets(expressionRealizerFacet))) {
        const channel = entry.implementation.channel;
        if (!candidates.has(channel.channel_id) && host.allowsAudienceScope(entry.packageId, constraints.audienceScope, expressionRealizerFacet.id)) {
          candidates.set(channel.channel_id, channel);
          realizerOrigins.set(channel.channel_id, { packageId: entry.packageId, generation: entry.generation });
          if (entry.implementation.presentationStyle) styles.set(channel.channel_id, entry.implementation.presentationStyle);
        }
      }
    }
    for (const channel of candidates.values()) {
      if (preferredChannelId !== undefined && preferredChannelId !== channel.channel_id) continue;
      if (channel.current_audience.scope !== constraints.audienceScope ||
          (constraints.maxLatencyMs !== undefined && channel.latency_budget_ms > constraints.maxLatencyMs)) continue;
      let intent = request;
      let decoratorStyle: EmbodiedPresentationStyle | undefined;
      const decoratorTraces: Array<{ packageId: string; generation: number }> = [];
      if (host) for (const entry of sortFacetsByPriority(host.listFacets(expressionIntentDecoratorFacet))) {
        if (!host.allowsAudienceScope(entry.packageId, constraints.audienceScope, expressionIntentDecoratorFacet.id)) continue;
        decoratorStyle ??= entry.implementation.presentationStyle;
        const decorated = host.invokeFacet(entry, facet => CommunicativeIntentEnvelopeSchema.parse({
          ...facet.decorate(structuredClone(intent), structuredClone(channel)),
          intent: request.intent, intentId: request.intentId, correlationEventId: request.correlationEventId,
          deliveryConstraints: constraints
        }));
        if (decorated !== undefined) {
          intent = decorated;
          decoratorTraces.push({ packageId: entry.packageId, generation: entry.generation });
        }
      }
      const style = styles.get(channel.channel_id) ?? decoratorStyle ?? this.style;
      const caps = channel.capabilities;
      const affordance = caps.embodiment_surface?.supported_tokens?.find(value =>
        value.semanticAction === (intent.actuationHint?.semanticAction ?? intent.expressiveStance?.semanticCue ?? intent.intent)
        && (!constraints.requireNonVerbalQuiet || (value.kind === "nonverbal" && value.quiet))
        && (constraints.maxLatencyMs === undefined || (value.latencyMs ?? channel.latency_budget_ms) <= constraints.maxLatencyMs));
      if (constraints.requireNonVerbalQuiet && !affordance && intent.intent !== "explicit_silence") continue;
      const actuatorId = affordance?.token ?? intent.actuationHint?.semanticAction;
      if (intent.intent === "actuate" && !caps.actuators.some(actuator => actuator.actuator_id === actuatorId)) continue;
      const supportsEmbodied = Boolean(caps.embodiment_surface);
      const stance = intent.expressiveStance;
      const render = this.renderer;
      const extensions = supportsEmbodied && render ? render({ intent: structuredClone(intent), channel: structuredClone(channel),
        style, nonverbalToken: affordance?.kind === "nonverbal" ? affordance.token : undefined,
        media: structuredClone(this.media.get(channel.channel_id)) }) : {};
      if (host) {
        for (const [extKey, extPayload] of Object.entries(extensions)) {
          const match = /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\.([a-z][a-z0-9_]*)@(\d+)$/.exec(extKey);
          if (match) {
            const [, ns, name, verStr] = match;
            const ver = Number(verStr);
            if (host.getDynamicContract("expression_protocol", ns!, name!, ver)) {
              host.validateDynamicContractPayload("expression_protocol", ns!, name!, ver, extPayload);
            }
          }
        }
      }
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
        extensions
      };
      const origin = realizerOrigins.get(channel.channel_id);
      return {
        status: "dispatched",
        channelId: channel.channel_id,
        envelope,
        provenance: {
          ...(origin ? { realizerPackageId: origin.packageId, realizerGeneration: origin.generation } : {}),
          decoratorTraces
        }
      };
    }
    return { status: "held_pending_compliant_channel", envelope: null };
  }
}
