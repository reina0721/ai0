import { randomUUID } from "node:crypto";
import { VirtualClock, type IVirtualClock } from "@ai0/cognition-core";
import type { ExtensionCoreHost } from "@ai0/extension-core";
import {
  GroundingReceiptTracker,
  RealizerVocabularyNegotiator,
  type EmbodiedPresentationStyle,
  type PresentationRenderer
} from "@ai0/expression-core";
import {
  EmbodimentAffordanceRegistry,
  ObservationNormalizer,
  PerceptionFilterPipeline,
  perceptionFilterFacet,
  TurnDebounceAggregator,
  type DebounceBatch,
  type DebounceInputEvent,
  type ObservationSourceDefaults
} from "@ai0/perception-core";
import {
  AudienceScopeSchema,
  DeliveryReceiptSchema,
  ExpressionEnvelopeSchema,
  HandshakeAckSchema,
  HandshakeManifestSchema,
  parseKnownExtensions,
  PerceptionEnvelopeSchema,
  type AudienceScope,
  type DeliveryReceipt,
  type ExpressionEnvelope,
  type HandshakeAck,
  type HandshakeManifest,
  type PerceptionEnvelope,
  type PrincipalTrust
} from "@ai0/protocol";
import { enforceAudienceScope } from "../kernel/audience-ceiling.js";
import {
  issueScopedCapabilityToken,
  ScopedCapabilityTokenError,
  verifyScopedCapabilityToken,
  type ScopedCapabilityClaims
} from "../kernel/capability-token.js";

export const CHANNEL_PROTOCOL_PATH = "/protocol/v0/channel";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type DebounceState = "IDLE" | "BUFFERING" | "COMMITTED";
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

export interface ChannelProtocolGatewayOptions {
  renderPresentation?: PresentationRenderer;
  presentationStyle?: Readonly<EmbodiedPresentationStyle>;
  sourceDefaults?: Readonly<ObservationSourceDefaults>;
  extensionHost?: ExtensionCoreHost;
  debounceWindowMs?: number;
  formatRetractedObservation?: () => string | undefined;
  entityNature?: string;
  clock?: IVirtualClock;
  w1?: W1InterruptionSink;
  sendExpression?: (expression: ExpressionEnvelope) => void | Promise<void>;
}

interface ChannelSession {
  lastSeen: number;
  target: "live" | "sandbox";
  direction: "inbound" | "outbound";
  manifest: HandshakeManifest;
  claims: ScopedCapabilityClaims;
  debounce: TurnDebounceAggregator;
  debounceState: DebounceState;
  debounceDueAt?: number;
}

export class ChannelProtocolGateway {
  readonly clock: IVirtualClock;
  readonly affordances = new EmbodimentAffordanceRegistry();
  readonly negotiator: RealizerVocabularyNegotiator;
  readonly grounding: GroundingReceiptTracker;
  private readonly normalizer: ObservationNormalizer;
  private readonly perceptionFilters: PerceptionFilterPipeline;
  private readonly sessions = new Map<string, ChannelSession>();
  private readonly expressionChunks = new Map<string, Map<number, ExpressionEnvelope>>();

  constructor(private readonly options: ChannelProtocolGatewayOptions = {}) {
    this.clock = options.clock ?? new VirtualClock({ targetInstance: "live" });
    this.grounding = new GroundingReceiptTracker(options.extensionHost);
    this.normalizer = new ObservationNormalizer(this.clock, options.extensionHost);
    this.perceptionFilters = new PerceptionFilterPipeline(options.extensionHost);
    this.negotiator = new RealizerVocabularyNegotiator(
      options.extensionHost,
      options.presentationStyle,
      options.renderPresentation
    );
  }

  issueScopedCapabilityToken(claims: ScopedCapabilityClaims, secretKey: string): string {
    return issueScopedCapabilityToken(claims, secretKey);
  }

  verifyScopedCapabilityToken(token: string, secretKey: string): ScopedCapabilityClaims {
    return verifyScopedCapabilityToken(token, secretKey, this.clock.nowMs());
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
    const now = this.clock.nowMs();
    const manifest = HandshakeManifestSchema.parse(manifestInput);
    const claims = verifyScopedCapabilityToken(manifest.auth_token, secretKey, now);
    if (claims.channel_id !== manifest.channel_id) throw new ScopedCapabilityTokenError("INVALID_CLAIMS");
    manifest.current_audience.scope = enforceAudienceScope(
      manifest.current_audience.scope,
      claims.max_audience_privacy_ceiling
    );
    manifest.capabilities.sensors = manifest.capabilities.sensors.filter(sensor =>
      claims.allowed_modalities.includes(sensor)
    );
    const sessionId = randomUUID();
    const session: ChannelSession = {
      lastSeen: now,
      target: claims.target ?? "live",
      direction,
      manifest,
      claims,
      debounce: new TurnDebounceAggregator(
        this.clock,
        this.options.debounceWindowMs,
        this.options.formatRetractedObservation
      ),
      debounceState: "IDLE"
    };
    this.sessions.set(sessionId, session);
    this.affordances.mount(manifest);
    this.negotiator.mount(manifest);
    const ack = HandshakeAckSchema.parse({
      session_id: sessionId,
      accepted_version: "0.1.0",
      enforced_venue_type: manifest.venue_type,
      max_audience_privacy_ceiling: claims.max_audience_privacy_ceiling,
      entity_nature: this.options.entityNature ?? "artificial_intelligence_agent",
      server_virtual_ts_ms: now
    });
    return { ack, sessionId };
  }

  listConnections(target: string) {
    const now = this.clock.nowMs();
    const result = [];
    for (const [id, session] of this.sessions) {
      if (now >= Math.min(session.claims.expires_at_ts_ms, session.lastSeen + 45_000)) {
        this.removeSession(id);
        continue;
      }
      if (session.target !== (target === "live" ? "live" : "sandbox")) continue;
      result.push({
        session_id: id,
        channel_id: session.manifest.channel_id,
        venue_type: session.manifest.venue_type,
        audience_scope: session.manifest.current_audience.scope,
        modality: session.manifest.capabilities.sensors[0],
        capabilities: session.manifest.capabilities,
        last_active_ts_ms: session.lastSeen
      });
    }
    return result;
  }

  connectionForGrant(id: string, token: string) {
    const now = this.clock.nowMs();
    const session = this.sessions.get(id);
    if (
      !session ||
      session.manifest.auth_token !== token ||
      now >= Math.min(session.lastSeen + 45_000, session.claims.expires_at_ts_ms)
    ) {
      return undefined;
    }
    return {
      target: session.target,
      channel: session.manifest.channel_id,
      audience: session.manifest.current_audience.scope,
      actuators: session.manifest.capabilities.actuators,
      principal: session.claims.principal_id ?? "unknown"
    };
  }

  updateConnection(id: string, token: string, close: boolean, capabilities?: HandshakeManifest["capabilities"]) {
    const now = this.clock.nowMs();
    const session = this.sessions.get(id);
    if (
      !session ||
      session.manifest.auth_token !== token ||
      session.lastSeen + 45_000 <= now ||
      session.claims.expires_at_ts_ms <= now
    ) {
      return false;
    }
    if (close) this.removeSession(id);
    else {
      if (capabilities) {
        const updated = HandshakeManifestSchema.parse({ ...session.manifest, capabilities });
        updated.capabilities.sensors = updated.capabilities.sensors.filter(sensor =>
          session.claims.allowed_modalities.includes(sensor)
        );
        session.manifest = updated;
        this.affordances.mount(updated);
        this.negotiator.mount(updated);
      }
      session.lastSeen = now;
    }
    return true;
  }

  disconnectPlugin(id: string, target: string) {
    for (const [key, session] of this.sessions) {
      if (session.target === target && session.claims.plugin_id === id) this.removeSession(key);
    }
  }

  disconnectTarget(target: "live" | "sandbox"): void {
    for (const [id, session] of this.sessions) {
      if (session.target === target) this.removeSession(id);
    }
  }

  private removeSession(id: string): void {
    const channel = this.sessions.get(id)?.manifest.channel_id;
    this.sessions.delete(id);
    if (!channel || [...this.sessions.values()].some(session => session.manifest.channel_id === channel)) return;
    this.affordances.unmount(channel);
    this.negotiator.unmount(channel);
  }

  parseEnvelopeExtensions(extensions: Record<string, unknown>, supportedExtensions?: readonly string[]) {
    const host = this.options.extensionHost;
    return parseKnownExtensions(
      extensions,
      supportedExtensions,
      host
        ? (key, payload) => {
            const match = /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\.([a-z][a-z0-9_]*)@(\d+)$/.exec(key);
            if (!match) return undefined;
            const [, ns, name, verStr] = match;
            const ver = Number(verStr);
            if (host.getDynamicContract("perception_event", ns!, name!, ver)) {
              return host.validateDynamicContractPayload("perception_event", ns!, name!, ver, payload);
            }
            if (host.getDynamicContract("expression_protocol", ns!, name!, ver)) {
              return host.validateDynamicContractPayload("expression_protocol", ns!, name!, ver, payload);
            }
            return undefined;
          }
        : undefined
    );
  }

  private preparePerceptionContext(sessionId: string, input: PerceptionEnvelope | Record<string, unknown>) {
    const session = this.requireSession(sessionId);
    const original = input as Record<string, unknown>;
    const envelope = PerceptionEnvelopeSchema.parse(input);
    if (!session.claims.allowed_modalities.includes(envelope.modality))
      throw new Error(`MODALITY_NOT_ALLOWED:${envelope.modality}`);
    const extension = isRecord(envelope.extensions["ext.gateway.context.v1"])
      ? (envelope.extensions["ext.gateway.context.v1"] as Record<string, unknown>)
      : {};
    const claimedAudience = AudienceScopeSchema.parse(
      original.audience_scope ?? extension.audience_scope ?? session.manifest.current_audience.scope
    );
    const claimedTrust: PrincipalTrust = session.claims.principal_id === "owner:local" ? "owner_verified" : "stranger";
    const audience = enforceAudienceScope(claimedAudience, session.claims.max_audience_privacy_ceiling);
    const declared = envelope.extensions["ext.perception.v1"];
    const sourceKey = envelope.frame?.channel.sourceKey ?? (isRecord(declared) ? declared.source_key : undefined);
    const sources = session.manifest.capabilities.sensor_affordances?.filter(item => item.modality === envelope.modality);
    const source = sourceKey === undefined && sources?.length === 1 ? sources[0] : sources?.find(item => item.source_key === sourceKey);
    const admission = {
      channelId: session.manifest.channel_id,
      principalId: session.claims.principal_id ?? "unknown",
      audienceScope: audience,
      sourceDefaults: {
        coverage: source?.coverage ?? this.options.sourceDefaults?.coverage,
        freshnessTtlMs: source?.freshness_ttl_ms ?? this.options.sourceDefaults?.freshnessTtlMs
      }
    };
    return { session, envelope, audience, claimedAudience, claimedTrust, admission };
  }

  private finalizePerceptionIngest(
    session: ChannelSession,
    envelope: PerceptionEnvelope,
    frame: NonNullable<PerceptionEnvelope["frame"]>,
    audience: AudienceScope,
    claimedAudience: AudienceScope,
    claimedTrust: PrincipalTrust
  ): { envelope: GatewayPerceptionEnvelope; state: DebounceState; committed?: DebounceBatch } {
    const sanitized: GatewayPerceptionEnvelope = {
      ...envelope,
      frame,
      audience_scope: audience,
      principal_trust: audience === claimedAudience ? claimedTrust : "stranger"
    };
    const now = this.clock.nowMs();
    const resolvedText = frame.provenance.transducedVia
      ? frame.interpretation.primaryCue || envelope.summary_text
      : envelope.summary_text;
    let event: DebounceInputEvent = { lifecycle: envelope.lifecycle, text: resolvedText, frame, virtual_ts_ms: now };
    const useConfiguredPolicy = !this.options.extensionHost?.listFacets(perceptionFilterFacet).length;
    if (!useConfiguredPolicy) {
      const result = this.perceptionFilters.ingest(structuredClone(event), session.manifest.channel_id, now);
      if (result.kind === "hold" || result.kind === "suppress") {
        return { envelope: sanitized, state: session.debounceState };
      }
      if (result.kind === "neutral_retract") {
        event = { lifecycle: "retract", virtual_ts_ms: now };
      } else if ("event" in result) {
        event = { ...result.event };
        if (event.frame) {
          event.frame = {
            ...event.frame,
            channel: { ...event.frame.channel, channelId: frame.channel.channelId, modality: frame.channel.modality },
            attribution: { ...event.frame.attribution, principalId: frame.attribution.principalId },
            contextFrame: { ...event.frame.contextFrame, audienceScope: audience },
            provenance: frame.provenance
          };
        }
        sanitized.lifecycle = event.lifecycle;
        sanitized.summary_text = event.text ?? "";
        sanitized.frame = event.frame;
      }
    }
    const batch = session.debounce.ingest(event, useConfiguredPolicy);
    if (event.lifecycle === "retract") {
      session.debounceDueAt = undefined;
      session.debounceState = batch ? "COMMITTED" : "IDLE";
      return { envelope: sanitized, state: session.debounceState, ...(batch ? { committed: batch } : {}) };
    }
    if (!batch) return { envelope: sanitized, state: session.debounceState };
    if (!useConfiguredPolicy || session.debounce.debounceWindowMs === 0) {
      session.debounce.flush();
      session.debounceDueAt = undefined;
      session.debounceState = "COMMITTED";
      return { envelope: sanitized, state: session.debounceState, committed: batch };
    }
    session.debounceState = "BUFFERING";
    session.debounceDueAt = this.clock.nowMs() + session.debounce.debounceWindowMs;
    return { envelope: sanitized, state: session.debounceState };
  }

  handlePerception(sessionId: string, input: PerceptionEnvelope | Record<string, unknown>): {
    envelope: GatewayPerceptionEnvelope; state: DebounceState; committed?: DebounceBatch;
  } {
    const { session, envelope, audience, claimedAudience, claimedTrust, admission } =
      this.preparePerceptionContext(sessionId, input);
    const frame = this.normalizer.normalize(envelope, admission);
    return this.finalizePerceptionIngest(session, envelope, frame, audience, claimedAudience, claimedTrust);
  }

  async handlePerceptionAsync(
    sessionId: string,
    input: PerceptionEnvelope | Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{
    envelope: GatewayPerceptionEnvelope; state: DebounceState; committed?: DebounceBatch;
  }> {
    const { session, envelope, audience, claimedAudience, claimedTrust, admission } =
      this.preparePerceptionContext(sessionId, input);
    const frame = await this.normalizer.transduceAndNormalize(envelope, admission, signal);
    return this.finalizePerceptionIngest(session, envelope, frame, audience, claimedAudience, claimedTrust);
  }

  flushDebounce(sessionId: string): DebounceBatch | undefined {
    const session = this.requireSession(sessionId);
    if (session.debounceState !== "BUFFERING" || this.clock.nowMs() < (session.debounceDueAt ?? Infinity)) return undefined;
    const batch = session.debounce.flush() ?? undefined;
    session.debounceState = batch ? "COMMITTED" : "IDLE";
    session.debounceDueAt = undefined;
    return batch;
  }

  getDebounceState(sessionId: string): DebounceState {
    return this.requireSession(sessionId).debounceState;
  }

  resetDebounce(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.debounce.flush();
    session.debounceState = "IDLE";
    session.debounceDueAt = undefined;
  }

  async dispatchExpression(expressionInput: ExpressionEnvelope): Promise<ExpressionEnvelope> {
    const expression = ExpressionEnvelopeSchema.parse(expressionInput);
    const chunks = this.expressionChunks.get(expression.intent_id) ?? new Map<number, ExpressionEnvelope>();
    if (chunks.has(expression.chunk_seq)) throw new Error("DUPLICATE_EXPRESSION_CHUNK");
    if (expression.chunk_seq > 0 && !chunks.has(expression.chunk_seq - 1)) throw new Error("OUT_OF_ORDER_EXPRESSION_CHUNK");
    chunks.set(expression.chunk_seq, expression);
    this.expressionChunks.set(expression.intent_id, chunks);
    this.grounding.recordGenerated(expression);
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
    const receipt = DeliveryReceiptSchema.parse({
      ...receiptInput,
      ...(playedMs === undefined ? {} : { played_audio_ms: playedMs })
    });
    if (
      (receipt.status === "interrupted" || receipt.interruption_boundary) &&
      !this.expressionChunks.get(receipt.intent_id)?.has(receipt.chunk_seq)
    ) {
      throw new Error("UNKNOWN_EXPRESSION_CHUNK");
    }
    const record = this.grounding.receive(receipt);
    if (record) this.options.w1?.recordInterruption(record);
    return record;
  }

  private requireSession(sessionId: string): ChannelSession {
    const now = this.clock.nowMs();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("UNKNOWN_CHANNEL_SESSION");
    if (Math.min(session.lastSeen + 45_000, session.claims.expires_at_ts_ms) <= now) {
      throw new ScopedCapabilityTokenError("EXPIRED");
    }
    session.lastSeen = now;
    return session;
  }
}
