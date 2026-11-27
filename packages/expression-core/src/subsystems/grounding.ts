import { AudienceScopeSchema, type AudienceScope, type DeliveryReceipt, type ExpressionEnvelope } from "@ai0/protocol";
import { sortFacetsByPriority, type ExtensionHostView, type FacetRegistration } from "@ai0/extension-core";
import {
  acknowledgeInterlocutorSegment,
  applyDeliveryReceiptToIntent,
  type GroundingIntentState,
  type GroundingSegmentState,
  type RecoveredInterruption
} from "../kernel/grounding-state-machine.js";
import { expressionMediaTranscoderFacet, type ExpressionMediaTranscoder } from "./facets.js";

export type { RecoveredInterruption } from "../kernel/grounding-state-machine.js";

interface TranscodedSegment extends GroundingSegmentState {
  cursor?: FacetRegistration<ExpressionMediaTranscoder>;
  audience?: AudienceScope;
}

export class GroundingReceiptTracker {
  private readonly intents = new Map<string, GroundingIntentState<TranscodedSegment>>();
  constructor(private readonly host?: ExtensionHostView) {}

  recordGenerated(envelope: ExpressionEnvelope) {
    const entry = this.intents.get(envelope.intent_id) ?? { segments: new Map<number, TranscodedSegment>() };
    if (!entry.segments.has(envelope.chunk_seq)) {
      const scope = AudienceScopeSchema.safeParse(envelope.delivery_constraints?.audienceScope ?? "only_owner");
      const audience = scope.success ? scope.data : undefined;
      const compatible = audience && this.host?.listFacets(expressionMediaTranscoderFacet).filter(({ packageId, implementation }) =>
        this.host!.allowsAudienceScope(packageId, audience, expressionMediaTranscoderFacet.id) &&
        implementation.cursor && Object.hasOwn(envelope.extensions, implementation.cursor.extension));
      const sortedCompatible = compatible && compatible.length > 0 ? sortFacetsByPriority(compatible) : undefined;
      entry.segments.set(envelope.chunk_seq, {
        envelope: structuredClone(envelope),
        presented: 0,
        stage: "generated_unpresented",
        audience,
        cursor: sortedCompatible?.[0]
      });
    }
    this.intents.set(envelope.intent_id, entry);
  }

  stage(intentId: string, chunkSeq: number) { return this.intents.get(intentId)?.segments.get(chunkSeq)?.stage; }

  acknowledgeInterlocutor(intentId: string, chunkSeq: number, adoptionEventId: string) {
    return acknowledgeInterlocutorSegment(this.intents.get(intentId)?.segments.get(chunkSeq), adoptionEventId);
  }

  receive(receipt: DeliveryReceipt): RecoveredInterruption | undefined {
    const entry = this.intents.get(receipt.intent_id);
    const segment = entry?.segments.get(receipt.chunk_seq);
    if (!entry || !segment || entry.settled) return undefined;
    const authorized = segment.cursor && segment.audience && this.host?.allowsAudienceScope(
      segment.cursor.packageId, segment.audience, expressionMediaTranscoderFacet.id);
    const translated = authorized && segment.cursor && this.host?.invokeFacet(segment.cursor, ({ cursor }) => cursor?.resolve(
      structuredClone(segment.envelope.extensions[cursor.extension]),
      { played_audio_ms: receipt.played_audio_ms, playback_cursor: structuredClone(receipt.playback_cursor) }
    ));
    return applyDeliveryReceiptToIntent(entry, receipt, typeof translated === "number" ? translated : undefined);
  }
}
