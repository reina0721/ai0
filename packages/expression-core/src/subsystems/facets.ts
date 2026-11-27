import { defineFacetPoint } from "@ai0/extension-core";
import { EmbodiedPresentationStyleSchema, type EmbodiedPresentationStyle, InteractionChannelSchema, type CommunicativeIntentEnvelope, type ExpressionEnvelope,
  type InteractionChannel } from "@ai0/protocol";
import type { MediaCursorResolver } from "@ai0/protocol";

export interface ExpressionRealizer {
  priority?: number;
  channel: InteractionChannel;
  presentationStyle?: EmbodiedPresentationStyle;
  deliver?(envelope: ExpressionEnvelope, signal?: AbortSignal): void | import("@ai0/protocol").DeliveryReceipt | Promise<void | import("@ai0/protocol").DeliveryReceipt>;
}
export interface ExpressionMediaTranscoder {
  priority?: number;
  cursor?: MediaCursorResolver;
  onUpstreamMediaFrame?(frame: unknown): void | Promise<void>;
  onDownstreamExpression?(intent: ExpressionEnvelope): void | Promise<void>;
  transcodeExpression?(
    intent: CommunicativeIntentEnvelope,
    channel: InteractionChannel
  ): Readonly<Record<string, unknown>> | undefined;
}
export interface ExpressionIntentDecorator {
  priority?: number;
  presentationStyle?: EmbodiedPresentationStyle;
  decorate(intent: CommunicativeIntentEnvelope, channel: InteractionChannel): CommunicativeIntentEnvelope;
}

export const expressionRealizerFacet = defineFacetPoint<ExpressionRealizer>({
  owner: "expression", name: "realizer", version: 1,
  parse(raw) {
    const value = raw as ExpressionRealizer | null;
    if (
      !value ||
      (value.deliver !== undefined && typeof value.deliver !== "function") ||
      (value.priority !== undefined && !Number.isFinite(value.priority))
    ) {
      throw new TypeError("Invalid expression realizer");
    }
    return {
      ...(value.priority !== undefined ? { priority: value.priority } : {}),
      channel: InteractionChannelSchema.parse(value.channel),
      presentationStyle: EmbodiedPresentationStyleSchema.optional().parse(value.presentationStyle),
      deliver: value.deliver
    };
  }
});

export const expressionMediaTranscoderFacet = defineFacetPoint<ExpressionMediaTranscoder>({
  owner: "expression", name: "media_transcoder", version: 1,
  parse(raw) {
    const value = raw as ExpressionMediaTranscoder | null;
    if (
      !value ||
      (value.priority !== undefined && !Number.isFinite(value.priority)) ||
      (value.onUpstreamMediaFrame !== undefined && typeof value.onUpstreamMediaFrame !== "function") ||
      (value.onDownstreamExpression !== undefined && typeof value.onDownstreamExpression !== "function") ||
      (value.transcodeExpression !== undefined && typeof value.transcodeExpression !== "function") ||
      (value.cursor !== undefined && (!value.cursor?.extension || typeof value.cursor.resolve !== "function")) ||
      (!value.onUpstreamMediaFrame && !value.onDownstreamExpression && !value.transcodeExpression && !value.cursor)
    ) throw new TypeError("Invalid media transcoder");
    return value;
  }
});

export const expressionIntentDecoratorFacet = defineFacetPoint<ExpressionIntentDecorator>({
  owner: "expression", name: "intent_decorator", version: 1,
  parse(raw) {
    const value = raw as ExpressionIntentDecorator | null;
    if (typeof value?.decorate !== "function" || (value.priority !== undefined && !Number.isFinite(value.priority))) {
      throw new TypeError("Invalid intent decorator");
    }
    EmbodiedPresentationStyleSchema.optional().parse(value.presentationStyle);
    return value;
  }
});
