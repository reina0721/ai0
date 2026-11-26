import { AudienceScopeSchema, type AudienceScope, type DeliveryReceipt, type ExpressionEnvelope, type GroundingTruthStage } from "@ai0/protocol";
import type { ExtensionCoreHost, FacetRegistration } from "@ai0/extension-core";
import { expressionMediaTranscoderFacet, type ExpressionMediaTranscoder } from "./facets.js";

interface Segment {
  cursor?: FacetRegistration<ExpressionMediaTranscoder>;
  audience?: AudienceScope;
  envelope: ExpressionEnvelope;
  presented: number;
  stage: GroundingTruthStage;
}
interface IntentDelivery {
  segments: Map<number, Segment>;
  stopped?: { receipt: DeliveryReceipt; offset: number };
  settled?: boolean;
}
export interface RecoveredInterruption {
  intent_id: string;
  chunk_seq: number;
  spoken_char_offset: number;
  unsaid_remainder: string;
  interrupted_by_event_id?: string;
}

export class GroundingReceiptTracker {
  private readonly intents = new Map<string, IntentDelivery>();
  constructor(private readonly host?: ExtensionCoreHost) {}

  recordGenerated(envelope: ExpressionEnvelope) {
    const entry = this.intents.get(envelope.intent_id) ?? { segments: new Map<number, Segment>() };
    if (!entry.segments.has(envelope.chunk_seq)) {
      const scope = AudienceScopeSchema.safeParse(envelope.delivery_constraints?.audienceScope ?? "only_owner");
      const audience = scope.success ? scope.data : undefined;
      const compatible = audience && this.host?.listFacets(expressionMediaTranscoderFacet).filter(({ packageId, implementation }) =>
        this.host!.allowsAudienceScope(packageId, audience, expressionMediaTranscoderFacet.id) &&
        implementation.cursor && Object.hasOwn(envelope.extensions, implementation.cursor.extension));
      entry.segments.set(envelope.chunk_seq, { envelope: structuredClone(envelope), presented: 0, stage: "generated_unpresented",
        audience, cursor: compatible?.length === 1 ? compatible[0] : undefined });
    }
    this.intents.set(envelope.intent_id, entry);
  }

  stage(intentId: string, chunkSeq: number) { return this.intents.get(intentId)?.segments.get(chunkSeq)?.stage; }

  acknowledgeInterlocutor(intentId: string, chunkSeq: number, adoptionEventId: string) {
    const segment = this.intents.get(intentId)?.segments.get(chunkSeq);
    if (!adoptionEventId.trim() || !segment || segment.stage === "generated_unpresented") return false;
    if (segment.envelope.action_type === "invoke_actuator" && segment.stage !== "actuation_verified") return false;
    segment.stage = "interlocutor_grounded";
    return true;
  }

  receive(receipt: DeliveryReceipt): RecoveredInterruption | undefined {
    const entry = this.intents.get(receipt.intent_id);
    const segment = entry?.segments.get(receipt.chunk_seq);
    if (!entry || !segment || entry.settled) return;
    const length = Array.from(segment.envelope.fallback_text).length;
    const authorized = segment.cursor && segment.audience && this.host?.allowsAudienceScope(
      segment.cursor.packageId, segment.audience, expressionMediaTranscoderFacet.id);
    const translated = authorized && segment.cursor && this.host?.invokeFacet(segment.cursor, ({ cursor }) => cursor?.resolve(
      structuredClone(segment.envelope.extensions[cursor.extension]),
      { played_audio_ms: receipt.played_audio_ms, playback_cursor: structuredClone(receipt.playback_cursor) }
    ));
    const reported = typeof translated === "number" && Number.isSafeInteger(translated) && translated >= 0
      ? translated : receipt.spoken_char_offset ?? segment.presented;
    const offset = Math.min(length, Math.max(0, reported));
    if (!entry.stopped) {
      if (["rendered", "completed"].includes(receipt.status)) segment.presented = length;
      else if (receipt.status !== "failed") segment.presented = Math.max(segment.presented, offset);
      if ((segment.presented > 0 || receipt.status === "rendered" || receipt.status === "completed")
          && segment.stage === "generated_unpresented") segment.stage = "physically_presented";
      if (segment.envelope.action_type === "invoke_actuator" && receipt.actuator_outcome?.success
          && segment.stage === "physically_presented") segment.stage = "actuation_verified";
    }
    const boundary = receipt.interruption_boundary;
    if (!boundary && receipt.status !== "interrupted") return;
    if (!entry.stopped) entry.stopped = { receipt: { ...receipt }, offset: segment.presented };
    if (boundary === "silenced") return;
    if (entry.stopped.receipt.chunk_seq !== receipt.chunk_seq) return;
    entry.settled = true;
    const stopped = entry.stopped;
    return {
      intent_id: receipt.intent_id, chunk_seq: receipt.chunk_seq, spoken_char_offset: stopped.offset,
      unsaid_remainder: [...entry.segments].sort(([a], [b]) => a - b).filter(([sequence]) => sequence >= receipt.chunk_seq)
        .map(([sequence, item]) => Array.from(item.envelope.fallback_text).slice(sequence === receipt.chunk_seq ? stopped.offset : 0).join("")).join(""),
      interrupted_by_event_id: stopped.receipt.interrupted_by_event_id ?? receipt.interrupted_by_event_id
    };
  }
}
