import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  AudienceScopeSchema,
  DeliveryReceiptSchema,
  ExpressionEnvelopeSchema,
  ExtMediaSidebandV1Schema,
  HandshakeAckSchema,
  HandshakeManifestSchema,
  PerceptionEnvelopeSchema,
  PrincipalTrustSchema,
  computeSpokenCharOffsetFromAudioMs,
  type AudienceScope,
  type DeliveryReceipt,
  type ExpressionEnvelope,
  type HandshakeAck,
  type HandshakeManifest,
  type PerceptionEnvelope,
  type PrincipalTrust
} from "@ai0/protocol";
import {
  TurnDebounceAggregator,
  VirtualClock,
  type DebounceBatch,
  type IVirtualClock
} from "@ai0/kernel";

export const SHELL_PROTOCOL_PATH = "/protocol/v0/shell";
export const SHELL_DEBOUNCE_WINDOW_MS = 1_200;

export interface ScopedCapabilityClaims {
  shell_id: string;
  max_audience_privacy_ceiling: AudienceScope;
  allowed_modalities: string[];
  expires_at_ts_ms: number;
}

export class ScopedCapabilityTokenError extends Error {
  constructor(readonly code: "MALFORMED" | "INVALID_SIGNATURE" | "EXPIRED" | "INVALID_CLAIMS") {
    super(`SCOPED_CAPABILITY_TOKEN_${code}`);
    this.name = "ScopedCapabilityTokenError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateClaims(value: unknown): ScopedCapabilityClaims {
  if (!isRecord(value) || typeof value.shell_id !== "string" || value.shell_id.length === 0 ||
      !AudienceScopeSchema.safeParse(value.max_audience_privacy_ceiling).success ||
      !Array.isArray(value.allowed_modalities) ||
      value.allowed_modalities.some((item) => typeof item !== "string") ||
      typeof value.expires_at_ts_ms !== "number" || !Number.isFinite(value.expires_at_ts_ms)) {
    throw new ScopedCapabilityTokenError("INVALID_CLAIMS");
  }
  return {
    shell_id: value.shell_id,
    max_audience_privacy_ceiling: value.max_audience_privacy_ceiling as AudienceScope,
    allowed_modalities: [...value.allowed_modalities] as string[],
    expires_at_ts_ms: value.expires_at_ts_ms
  };
}

export function issueScopedCapabilityToken(
  claims: ScopedCapabilityClaims,
  secretKey: string
): string {
  if (!secretKey) throw new TypeError("secretKey must not be empty.");
  const encoded = Buffer.from(JSON.stringify(validateClaims(claims))).toString("base64url");
  const signature = createHmac("sha256", secretKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyScopedCapabilityToken(
  token: string,
  secretKey: string
): ScopedCapabilityClaims {
  if (!secretKey) throw new TypeError("secretKey must not be empty.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ScopedCapabilityTokenError("MALFORMED");
  const expected = createHmac("sha256", secretKey).update(parts[0]).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(parts[1], "base64url"); }
  catch { throw new ScopedCapabilityTokenError("MALFORMED"); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new ScopedCapabilityTokenError("INVALID_SIGNATURE");
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new ScopedCapabilityTokenError("MALFORMED"); }
  const claims = validateClaims(decoded);
  if (claims.expires_at_ts_ms <= Date.now()) throw new ScopedCapabilityTokenError("EXPIRED");
  return claims;
}

export type DebounceState = "IDLE" | "BUFFERING_1200MS" | "COMMITTED";
export type GatewayPerceptionEnvelope = PerceptionEnvelope & {
  audience_scope: AudienceScope;
  principal_trust: PrincipalTrust;
};
export type GatewayDeliveryReceipt = DeliveryReceipt & { actual_played_audio_ms?: number };

export interface InterruptionRecord {
  intent_id: string;
  chunk_seq: number;
  spoken_char_offset: number;
  unsaid_remainder: string;
  interrupted_by_event_id?: string;
}
export interface W1InterruptionSink {
  recordInterruption(record: InterruptionRecord): void;
}
export interface ShellProtocolGatewayOptions {
  clock?: IVirtualClock;
  w1?: W1InterruptionSink;
  sendExpression?: (expression: ExpressionEnvelope) => void | Promise<void>;
}

interface ShellSession {
  direction: "inbound" | "outbound";
  manifest: HandshakeManifest;
  claims: ScopedCapabilityClaims;
  debounce: TurnDebounceAggregator;
  debounceState: DebounceState;
  debounceDueAt?: number;
}

function audienceRank(scope: AudienceScope): number {
  return scope === "only_owner" ? 2 : scope === "public_all" ? 0 : 1;
}

function enforceAudienceScope(claimed: AudienceScope, ceiling: AudienceScope): AudienceScope {
  if (audienceRank(claimed) > audienceRank(ceiling)) return ceiling;
  if (claimed.startsWith("group:") && ceiling.startsWith("group:") && claimed !== ceiling) return ceiling;
  return claimed;
}

export class ShellProtocolGateway {
  readonly clock: IVirtualClock;
  private readonly sessions = new Map<string, ShellSession>();
  private readonly expressionChunks = new Map<string, Map<number, ExpressionEnvelope>>();

  constructor(private readonly options: ShellProtocolGatewayOptions = {}) {
    this.clock = options.clock ?? new VirtualClock({ targetInstance: "live" });
  }

  issueScopedCapabilityToken(claims: ScopedCapabilityClaims, secretKey: string): string {
    return issueScopedCapabilityToken(claims, secretKey);
  }

  verifyScopedCapabilityToken(token: string, secretKey: string): ScopedCapabilityClaims {
    return verifyScopedCapabilityToken(token, secretKey);
  }

  handleInboundHandshake(manifest: HandshakeManifest, secretKey: string): HandshakeAck {
    return this.registerHandshake(manifest, secretKey, "inbound").ack;
  }

  handleOutboundHandshake(manifest: HandshakeManifest, secretKey: string): HandshakeAck {
    return this.registerHandshake(manifest, secretKey, "outbound").ack;
  }

  handleHandshake(manifest: HandshakeManifest, secretKey: string): HandshakeAck {
    return this.handleInboundHandshake(manifest, secretKey);
  }

  private registerHandshake(
    manifestInput: HandshakeManifest,
    secretKey: string,
    direction: "inbound" | "outbound"
  ): { ack: HandshakeAck; sessionId: string } {
    const manifest = HandshakeManifestSchema.parse(manifestInput);
    const claims = verifyScopedCapabilityToken(manifest.auth_token, secretKey);
    if (claims.shell_id !== manifest.shell_id) throw new ScopedCapabilityTokenError("INVALID_CLAIMS");
    const sessionId = randomUUID();
    const session: ShellSession = { direction, manifest, claims,
      debounce: new TurnDebounceAggregator(this.clock, SHELL_DEBOUNCE_WINDOW_MS), debounceState: "IDLE" };
    this.sessions.set(sessionId, session);
    const ack = HandshakeAckSchema.parse({ session_id: sessionId, accepted_version: "0.1.0",
      enforced_venue_type: manifest.venue_type,
      max_audience_privacy_ceiling: claims.max_audience_privacy_ceiling,
      entity_nature: "artificial_intelligence_digital_life", server_virtual_ts_ms: this.clock.nowMs() });
    return { ack, sessionId };
  }

  handlePerception(sessionId: string, input: PerceptionEnvelope | Record<string, unknown>): {
    envelope: GatewayPerceptionEnvelope; state: DebounceState; committed?: DebounceBatch;
  } {
    const session = this.requireSession(sessionId);
    const original = input as Record<string, unknown>;
    const envelope = PerceptionEnvelopeSchema.parse(input);
    if (!session.claims.allowed_modalities.includes(envelope.modality))
      throw new Error(`MODALITY_NOT_ALLOWED:${envelope.modality}`);
    const extension = isRecord(envelope.extensions["ext.gateway.context.v1"])
      ? envelope.extensions["ext.gateway.context.v1"] as Record<string, unknown> : {};
    const claimedAudience = AudienceScopeSchema.parse(
      original.audience_scope ?? extension.audience_scope ?? session.manifest.current_audience.scope);
    const claimedTrust = PrincipalTrustSchema.parse(original.principal_trust ?? extension.principal_trust ?? "stranger");
    const audience = enforceAudienceScope(claimedAudience, session.claims.max_audience_privacy_ceiling);
    const sanitized: GatewayPerceptionEnvelope = { ...envelope, audience_scope: audience,
      principal_trust: audience === claimedAudience ? claimedTrust : "stranger" };
    const batch = session.debounce.ingest({ lifecycle: envelope.lifecycle, text: envelope.summary_text,
      virtual_ts_ms: this.clock.nowMs() });
    if (envelope.lifecycle === "retract") {
      session.debounceState = "COMMITTED"; session.debounceDueAt = undefined;
      return { envelope: sanitized, state: session.debounceState, ...(batch ? { committed: batch } : {}) };
    }
    session.debounceState = "BUFFERING_1200MS";
    session.debounceDueAt = this.clock.nowMs() + SHELL_DEBOUNCE_WINDOW_MS;
    return { envelope: sanitized, state: session.debounceState };
  }

  flushDebounce(sessionId: string): DebounceBatch | undefined {
    const session = this.requireSession(sessionId);
    if (session.debounceState !== "BUFFERING_1200MS" || this.clock.nowMs() < (session.debounceDueAt ?? Infinity))
      return undefined;
    const batch = session.debounce.flush() ?? undefined;
    session.debounceState = batch ? "COMMITTED" : "IDLE"; session.debounceDueAt = undefined;
    return batch;
  }

  getDebounceState(sessionId: string): DebounceState {
    return this.requireSession(sessionId).debounceState;
  }

  resetDebounce(sessionId: string): void {
    const session = this.requireSession(sessionId); session.debounce.flush();
    session.debounceState = "IDLE"; session.debounceDueAt = undefined;
  }

  async dispatchExpression(expressionInput: ExpressionEnvelope): Promise<ExpressionEnvelope> {
    const expression = ExpressionEnvelopeSchema.parse(expressionInput);
    const chunks = this.expressionChunks.get(expression.intent_id) ?? new Map<number, ExpressionEnvelope>();
    if (chunks.has(expression.chunk_seq)) throw new Error("DUPLICATE_EXPRESSION_CHUNK");
    if (expression.chunk_seq > 0 && !chunks.has(expression.chunk_seq - 1))
      throw new Error("OUT_OF_ORDER_EXPRESSION_CHUNK");
    chunks.set(expression.chunk_seq, expression); this.expressionChunks.set(expression.intent_id, chunks);
    await this.options.sendExpression?.(expression);
    return expression;
  }

  async dispatchExpressionChunks(expressions: readonly ExpressionEnvelope[]): Promise<ExpressionEnvelope[]> {
    const dispatched: ExpressionEnvelope[] = [];
    for (const expression of expressions) dispatched.push(await this.dispatchExpression(expression));
    return dispatched;
  }

  handleDeliveryReceipt(receiptInput: GatewayDeliveryReceipt): InterruptionRecord | undefined {
    const playedMs = receiptInput.actual_played_audio_ms ?? receiptInput.played_audio_ms;
    const receipt = DeliveryReceiptSchema.parse({ ...receiptInput,
      ...(playedMs === undefined ? {} : { played_audio_ms: playedMs }) });
    if (receipt.status !== "interrupted") return undefined;
    const chunks = this.expressionChunks.get(receipt.intent_id);
    const current = chunks?.get(receipt.chunk_seq);
    if (!chunks || !current) throw new Error("UNKNOWN_EXPRESSION_CHUNK");
    const sideband = ExtMediaSidebandV1Schema.safeParse(current.extensions["ext.media.sideband.v1"]);
    const computedOffset = playedMs !== undefined && sideband.success
      ? computeSpokenCharOffsetFromAudioMs(sideband.data.char_offset_timestamps_ms, playedMs)
      : receipt.spoken_char_offset ?? 0;
    const offset = Math.max(0, Math.min(Array.from(current.fallback_text).length, computedOffset));
    const unsaidRemainder = [...chunks.entries()].sort(([left], [right]) => left - right)
      .filter(([sequence]) => sequence >= receipt.chunk_seq)
      .map(([sequence, chunk]) => sequence === receipt.chunk_seq
        ? Array.from(chunk.fallback_text).slice(offset).join("") : chunk.fallback_text).join("");
    const record: InterruptionRecord = { intent_id: receipt.intent_id, chunk_seq: receipt.chunk_seq,
      spoken_char_offset: offset, unsaid_remainder: unsaidRemainder,
      ...(receipt.interrupted_by_event_id ? { interrupted_by_event_id: receipt.interrupted_by_event_id } : {}) };
    this.options.w1?.recordInterruption(record);
    return record;
  }

  private requireSession(sessionId: string): ShellSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("UNKNOWN_SHELL_SESSION");
    if (session.claims.expires_at_ts_ms <= Date.now()) throw new ScopedCapabilityTokenError("EXPIRED");
    return session;
  }
}
