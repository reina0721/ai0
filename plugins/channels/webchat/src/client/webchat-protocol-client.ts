import {
  ExpressionEnvelopeSchema,
  ExtMediaSidebandV1Schema,
  HandshakeManifestSchema,
  PerceptionEnvelopeSchema,
  computeSpokenCharOffsetFromAudioMs,
  type AudienceScope,
  type ControlSignal,
  type DeliveryReceipt,
  type ExpressionEnvelope,
  type HandshakeManifest,
  type PerceptionEnvelope,
  type PrincipalTrust,
  type SensorModality
} from "@ai0/protocol";
export type WebChatInterruptionReceipt = DeliveryReceipt & {
  actual_played_audio_ms: number;
};
export type WebChatBargeInSignal = Omit<ControlSignal, "signal_type" | "payload"> & {
  signal_type: "barge_in_interrupt";
  payload: Record<string, unknown>;
};
export type WebChatOutboundFrame =
  | { jsonrpc: "2.0"; id: string; method: "ai0.handshake"; params: HandshakeManifest }
  | { jsonrpc: "2.0"; method: "ai0.perception.commit"; params: PerceptionEnvelope }
  | { jsonrpc: "2.0"; method: "ai0.receipt"; params: WebChatInterruptionReceipt }
  | { jsonrpc: "2.0"; method: "ai0.control"; params: WebChatBargeInSignal };

export interface WebChatProtocolTransport {
  send(frame: WebChatOutboundFrame): void | Promise<void>;
}
export interface WebChatProtocolClientOptions {
  authToken?: string;
  audienceScope?: AudienceScope;
  principalTrust?: PrincipalTrust;
  nowMs?: () => number;
}
export interface CommitPerceptionInput {
  summary_text: string;
  modality: SensorModality;
  actor?: { platform_uid: string; display_name: string };
  confidence?: number;
  sustained_ms?: number;
  persistence_hint?: PerceptionEnvelope["persistence_hint"];
  extensions?: Record<string, unknown>;
}
export interface BargeInResult {
  receipt: WebChatInterruptionReceipt;
  control: WebChatBargeInSignal;
  unsaid_remainder: string;
}

export class WebChatProtocolClient {
  private readonly chunks = new Map<string, Map<number, ExpressionEnvelope>>();
  private readonly listeners = new Set<(chunk: ExpressionEnvelope) => void>();
  private readonly nowMs: () => number;
  private activeIntentId?: string;
  private sequence = 0;

  constructor(
    private readonly transport: WebChatProtocolTransport,
    private readonly options: WebChatProtocolClientOptions = {}
  ) {
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  buildHandshakeManifest(authToken = this.options.authToken ?? ""): HandshakeManifest {
    return HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      channel_id: "builtin.webchat.default",
      channel_kind: "webchat",
      display_name: "Built-in WebChat",
      venue_type: "private_1on1",
      current_audience: { scope: this.options.audienceScope ?? "only_owner", member_count: 1 },
      latency_budget_ms: 1_200,
      capabilities: {
        embodiment_surface: null,
        sensors: ["text", "typing_activity", "vad_activity", "window_focus"],
        supported_extensions: ["ext.affect.v1", "ext.rhythm.v1", "ext.media.sideband.v1"],
        expression_vocabulary: { voice_emotion_tags: ["warm_neutral", "bright", "soft"] },
        actuators: []
      },
      auth_token: authToken
    });
  }

  async sendHandshake(authToken?: string): Promise<HandshakeManifest> {
    const manifest = this.buildHandshakeManifest(authToken);
    await this.transport.send({ jsonrpc: "2.0", id: `handshake-${++this.sequence}`,
      method: "ai0.handshake", params: manifest });
    return manifest;
  }

  commitText(text: string): Promise<PerceptionEnvelope> {
    return this.commitPerception({ summary_text: text, modality: "text" });
  }

  async commitPerception(input: CommitPerceptionInput): Promise<PerceptionEnvelope> {
    const eventId = `webchat-${this.nowMs()}-${++this.sequence}`;
    const extensions = { ...input.extensions,
      "ext.gateway.context.v1": {
        audience_scope: this.options.audienceScope ?? "only_owner",
        principal_trust: this.options.principalTrust ?? "owner_verified"
      } };
    const envelope = PerceptionEnvelopeSchema.parse({
      event_id: eventId, timestamp: new Date(this.nowMs()).toISOString(),
      actor: input.actor ?? { platform_uid: "owner", display_name: "Owner" },
      lifecycle: "commit", modality: input.modality, summary_text: input.summary_text,
      confidence: input.confidence ?? 1,
      ...(input.sustained_ms === undefined ? {} : { sustained_ms: input.sustained_ms }),
      persistence_hint: input.persistence_hint ?? "permanent", extensions
    });
    await this.transport.send({ jsonrpc: "2.0", method: "ai0.perception.commit", params: envelope });
    return envelope;
  }

  receiveExpressionChunk(input: ExpressionEnvelope): ExpressionEnvelope {
    const chunk = ExpressionEnvelopeSchema.parse(input);
    const stream = this.chunks.get(chunk.intent_id) ?? new Map<number, ExpressionEnvelope>();
    stream.set(chunk.chunk_seq, chunk);
    this.chunks.set(chunk.intent_id, stream);
    this.activeIntentId = chunk.intent_id;
    for (const listener of this.listeners) listener(chunk);
    return chunk;
  }

  onExpression(listener: (chunk: ExpressionEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getExpressionText(intentId: string): string {
    return [...(this.chunks.get(intentId)?.entries() ?? [])]
      .sort(([left], [right]) => left - right).map(([, chunk]) => chunk.fallback_text).join("");
  }

  async interruptCurrent(options: { intentId?: string; chunkSeq?: number;
    spokenCharOffset?: number; actualPlayedAudioMs: number;
    interruptedByEventId?: string }): Promise<BargeInResult> {
    const intentId = options.intentId ?? this.activeIntentId;
    if (!intentId) throw new Error("NO_ACTIVE_EXPRESSION");
    const stream = this.chunks.get(intentId);
    const chunkSeq = options.chunkSeq ?? Math.max(...(stream?.keys() ?? []));
    const chunk = stream?.get(chunkSeq);
    if (!stream || !chunk) throw new Error("UNKNOWN_EXPRESSION_CHUNK");
    const sideband = ExtMediaSidebandV1Schema.safeParse(chunk.extensions["ext.media.sideband.v1"]);
    const measured = sideband.success
      ? computeSpokenCharOffsetFromAudioMs(sideband.data.char_offset_timestamps_ms,
        options.actualPlayedAudioMs) : 0;
    const offset = Math.max(0, Math.min(Array.from(chunk.fallback_text).length,
      options.spokenCharOffset ?? measured));
    const unsaid = [...stream.entries()].sort(([a], [b]) => a - b)
      .filter(([seq]) => seq >= chunkSeq).map(([seq, item]) => seq === chunkSeq
        ? Array.from(item.fallback_text).slice(offset).join("") : item.fallback_text).join("");
    const receipt: WebChatInterruptionReceipt = { intent_id: intentId, chunk_seq: chunkSeq,
      status: "interrupted", spoken_char_offset: offset,
      played_audio_ms: options.actualPlayedAudioMs,
      actual_played_audio_ms: options.actualPlayedAudioMs,
      ...(options.interruptedByEventId ? { interrupted_by_event_id: options.interruptedByEventId } : {}) };
    const control: WebChatBargeInSignal = { signal_type: "barge_in_interrupt",
      target_intent_id: intentId, payload: { protocol_signal_type: "barge_in_cancel",
        spoken_char_offset: offset, unsaid_remainder: unsaid } };
    await this.transport.send({ jsonrpc: "2.0", method: "ai0.receipt", params: receipt });
    await this.transport.send({ jsonrpc: "2.0", method: "ai0.control", params: control });
    this.activeIntentId = undefined;
    return { receipt, control, unsaid_remainder: unsaid };
  }
}
