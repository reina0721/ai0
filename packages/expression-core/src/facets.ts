import { defineFacetPoint } from "@ai0/extension-core";
import { InteractionChannelSchema, type CommunicativeIntentEnvelope, type ExpressionEnvelope,
  type InteractionChannel } from "@ai0/protocol";

export interface ExpressionRealizer {
  channel: InteractionChannel;
  deliver?(envelope: ExpressionEnvelope): void | Promise<void>;
}
export interface ExpressionMediaTranscoder {
  onUpstreamMediaFrame?(frame: unknown): void | Promise<void>;
  onDownstreamExpression?(intent: ExpressionEnvelope): void | Promise<void>;
}
export interface ExpressionIntentDecorator {
  priority?: number;
  decorate(intent: CommunicativeIntentEnvelope, channel: InteractionChannel): CommunicativeIntentEnvelope;
}

export const expressionRealizerFacet = defineFacetPoint<ExpressionRealizer>({
  owner: "expression", name: "realizer", version: 1,
  parse(raw) {
    const value = raw as ExpressionRealizer | null;
    if (!value || (value.deliver !== undefined && typeof value.deliver !== "function")) {
      throw new TypeError("Invalid expression realizer");
    }
    return { channel: InteractionChannelSchema.parse(value.channel), deliver: value.deliver };
  }
});

export const expressionMediaTranscoderFacet = defineFacetPoint<ExpressionMediaTranscoder>({
  owner: "expression", name: "media_transcoder", version: 1,
  parse(raw) {
    const value = raw as ExpressionMediaTranscoder | null;
    if (!value || (value.onUpstreamMediaFrame !== undefined && typeof value.onUpstreamMediaFrame !== "function") ||
        (value.onDownstreamExpression !== undefined && typeof value.onDownstreamExpression !== "function") ||
        (!value.onUpstreamMediaFrame && !value.onDownstreamExpression)) throw new TypeError("Invalid media transcoder");
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
    return value;
  }
});
