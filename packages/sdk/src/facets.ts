import { cognitionResponseContractPoint } from "@ai0/protocol";
import { defineFacetPoint } from "@ai0/extension-core";
import { perceptionExtractorContract, cognitionProposalPolicyContract } from "@ai0/protocol";
export const perceptionExtractorFacet = defineFacetPoint(perceptionExtractorContract);
export const cognitionProposalPolicyFacet = defineFacetPoint(cognitionProposalPolicyContract);
import {
  ConsolePageSchema,
  perceptionSourceContract,
  ContinuousStateDescriptorSchema,
  EmbodiedPresentationStyleSchema, type EmbodiedPresentationStyle, InteractionChannelSchema,
  type CommunicativeIntentEnvelope,
  type ContinuousStateDescriptor,
  type ConsoleUiSlotContribution,
  type ExpressionEnvelope,
  type DeliveryReceipt,
  type InteractionChannel,
  type PluginConfigField,
  type RuntimeConsolePage,
  type UniversalObservationFrame
} from "@ai0/protocol";

export interface SdkDebounceInputEvent {
  frame?: UniversalObservationFrame;
  lifecycle: "activity" | "interim" | "commit" | "retract";
  text?: string;
  virtual_ts_ms?: number;
}

export type SdkPerceptionFilterResult =
  | { kind: "pass"; event: SdkDebounceInputEvent }
  | { kind: "hold" | "suppress" }
  | { kind: "observe"; event: SdkDebounceInputEvent };

export interface SdkPerceptionFilter {
  priority?: number;
  onEvent(event: SdkDebounceInputEvent, channelId: string, nowMs: number): SdkPerceptionFilterResult;
  flushDue?(nowMs: number): readonly SdkDebounceInputEvent[];
}

export interface SdkExpressionRealizer {
  channel: InteractionChannel;
  presentationStyle?: EmbodiedPresentationStyle;
  deliver?(envelope: ExpressionEnvelope, signal?: AbortSignal): void | DeliveryReceipt | Promise<void | DeliveryReceipt>;
}

export interface SdkExpressionMediaTranscoder {
  cursor?: import("@ai0/protocol").MediaCursorResolver;
  getSupportedVocabulary?(): {
    voice_emotion_tags?: string[];
    visual_semantic_cues?: string[];
    expression_tags?: string[];
    gesture_intents?: string[];
    haptic_cues?: string[];
  };
  onUpstreamMediaFrame?(frame: unknown): unknown | Promise<unknown>;
  onDownstreamExpression?(intent: ExpressionEnvelope): unknown | Promise<unknown>;
}

export interface SdkExpressionIntentDecorator {
  priority?: number;
  presentationStyle?: EmbodiedPresentationStyle;
  decorate(intent: CommunicativeIntentEnvelope, channel: InteractionChannel): CommunicativeIntentEnvelope;
}

export interface SdkCognitionContextContributor {
  priority?: number;
  contributeToBlackboard(
    snapshot: Readonly<Record<string, unknown>>,
    maxTokens: number, request?: { text: string }
  ): { slot_id: string; text: string } | null | Promise<{ slot_id: string; text: string } | null>;
}

export interface SdkCognitionSleepOrgan {
  onTurnCompleted?(turnTrace: unknown): unknown[] | Promise<unknown[]>;
  onSleepCycleWakeup(
    snapshot: Readonly<Record<string, unknown>>,
    events: readonly unknown[]
  ): unknown[] | Promise<unknown[]>;
}

export interface SdkAttentionArbitrator {
  arbitrate(params: {
    candidates: Array<{ channel_id: string; salience: number; preferred?: boolean; l0_crisis?: boolean }>;
    current_channel_id: string | null;
    last_switch_ts_ms: number;
    now_ts_ms: number;
    events?: Array<{ channel_id: string; event_type: string; payload?: unknown }>;
    rules?: Array<{
      when: { channel_id?: string; event_type: string };
      if?: { selected_channel_id?: string; min_salience?: number };
      then: { action: string; target_channel_id?: string };
    }>;
    hysteresis_ms?: number;
  }): {
    selected_channel_id: string | null;
    switched: boolean;
    actions: Array<{ action: string; target_channel_id?: string }>;
  };
}

export const channelBridgeFacet = defineFacetPoint<{ channel_id: string; protocol_path?: string }>({
  owner: "channel",
  name: "bridge",
  version: 1,
  parse(raw) {
    const value = raw as { channel_id?: unknown; protocol_path?: unknown } | null;
    if (!value || typeof value.channel_id !== "string" || !value.channel_id) {
      throw new TypeError("Invalid channel.bridge facet");
    }
    return {
      channel_id: value.channel_id,
      ...(typeof value.protocol_path === "string" ? { protocol_path: value.protocol_path } : {})
    };
  }
});

export const perceptionIngressFacet = defineFacetPoint<InteractionChannel>({
  owner: "perception",
  name: "ingress",
  version: 1,
  parse: (raw) => InteractionChannelSchema.parse(raw)
});
export const perceptionSourceFacet = defineFacetPoint(perceptionSourceContract);

export const perceptionFilterFacet = defineFacetPoint<SdkPerceptionFilter>({
  owner: "perception",
  name: "filter",
  version: 1,
  parse(raw) {
    const value = raw as SdkPerceptionFilter | null;
    if (
      typeof value?.onEvent !== "function" ||
      (value.priority !== undefined && !Number.isFinite(value.priority)) ||
      (value.flushDue !== undefined && typeof value.flushDue !== "function")
    ) {
      throw new TypeError("Invalid perception.filter facet");
    }
    return value;
  }
});

export const cognitionStateDynamicsFacet = defineFacetPoint<{
  descriptors: readonly ContinuousStateDescriptor[];
}>({
  owner: "cognition",
  name: "state_dynamics",
  version: 1,
  parse(raw) {
    const value = raw as { descriptors?: unknown[] } | null;
    if (!Array.isArray(value?.descriptors)) throw new TypeError("Invalid cognition.state_dynamics facet");
    return { descriptors: value.descriptors.map((item) => ContinuousStateDescriptorSchema.parse(item)) };
  }
});

export const cognitionAttentionArbitratorFacet = defineFacetPoint<SdkAttentionArbitrator>({
  owner: "cognition",
  name: "attention_arbitrator",
  version: 1,
  parse(raw) {
    const value = raw as SdkAttentionArbitrator | null;
    if (typeof value?.arbitrate !== "function") throw new TypeError("Invalid cognition.attention_arbitrator facet");
    return value;
  }
});

export const cognitionContextContributorFacet = defineFacetPoint<SdkCognitionContextContributor>({
  owner: "cognition",
  name: "context_contributor",
  version: 1,
  parse(raw) {
    const value = raw as SdkCognitionContextContributor | null;
    if (
      typeof value?.contributeToBlackboard !== "function" ||
      (value.priority !== undefined && !Number.isFinite(value.priority))
    ) {
      throw new TypeError("Invalid cognition.context_contributor facet");
    }
    return value;
  }
});

export const cognitionSleepOrganFacet = defineFacetPoint<SdkCognitionSleepOrgan>({
  owner: "cognition",
  name: "sleep_organ",
  version: 1,
  parse(raw) {
    const value = raw as SdkCognitionSleepOrgan | null;
    if (typeof value?.onSleepCycleWakeup !== "function") {
      throw new TypeError("Invalid cognition.sleep_organ facet");
    }
    return value;
  }
});

export const expressionRealizerFacet = defineFacetPoint<SdkExpressionRealizer>({
  owner: "expression",
  name: "realizer",
  version: 1,
  parse(raw) {
    const value = raw as SdkExpressionRealizer | null;
    if (!value || (value.deliver !== undefined && typeof value.deliver !== "function")) {
      throw new TypeError("Invalid expression.realizer facet");
    }
    return { channel: InteractionChannelSchema.parse(value.channel),
      presentationStyle: EmbodiedPresentationStyleSchema.optional().parse(value.presentationStyle), deliver: value.deliver };
  }
});

export const expressionMediaTranscoderFacet = defineFacetPoint<SdkExpressionMediaTranscoder>({
  owner: "expression",
  name: "media_transcoder",
  version: 1,
  parse(raw) {
    const value = raw as SdkExpressionMediaTranscoder | null;
    if (
      !value ||
      (value.onUpstreamMediaFrame !== undefined && typeof value.onUpstreamMediaFrame !== "function") ||
      (value.onDownstreamExpression !== undefined && typeof value.onDownstreamExpression !== "function") ||
      (value.cursor !== undefined && (!value.cursor?.extension || typeof value.cursor.resolve !== "function")) ||
      (!value.onUpstreamMediaFrame && !value.onDownstreamExpression && !value.cursor)
    ) {
      throw new TypeError("Invalid expression.media_transcoder facet");
    }
    return value;
  }
});

export const expressionIntentDecoratorFacet = defineFacetPoint<SdkExpressionIntentDecorator>({
  owner: "expression",
  name: "intent_decorator",
  version: 1,
  parse(raw) {
    const value = raw as SdkExpressionIntentDecorator | null;
    if (typeof value?.decorate !== "function" || (value.priority !== undefined && !Number.isFinite(value.priority))) {
      throw new TypeError("Invalid expression.intent_decorator facet");
    }
    EmbodiedPresentationStyleSchema.optional().parse(value.presentationStyle);
    return value;
  }
});

export const consoleSurfaceFacet = defineFacetPoint<{ pages: readonly (RuntimeConsolePage | ReturnType<typeof ConsolePageSchema.parse>)[] }>({
  owner: "console",
  name: "surface",
  version: 1,
  parse(raw) {
    const value = raw as { pages?: (RuntimeConsolePage | ReturnType<typeof ConsolePageSchema.parse>)[] } | null;
    if (!Array.isArray(value?.pages)) throw new TypeError("Invalid console.surface facet");
    return { pages: [...value.pages] };
  }
});

export const consoleUiSlotFacet = defineFacetPoint<{ slots: readonly ConsoleUiSlotContribution[] }>({
  owner: "console",
  name: "ui_slot",
  version: 1,
  parse(raw) {
    const value = raw as { slots?: ConsoleUiSlotContribution[] } | null;
    if (!Array.isArray(value?.slots)) throw new TypeError("Invalid console.ui_slot facet");
    return { slots: [...value.slots] };
  }
});

export const consoleConfigSchemaFacet = defineFacetPoint<{ fields: readonly PluginConfigField[] }>({
  owner: "console",
  name: "config_schema",
  version: 1,
  parse(raw) {
    const value = raw as { fields?: PluginConfigField[] } | null;
    if (!Array.isArray(value?.fields)) throw new TypeError("Invalid console.config_schema facet");
    return { fields: [...value.fields] };
  }
});

export const cognitionResponseContractFacet = defineFacetPoint(cognitionResponseContractPoint);
