import { ExtPerceptionV1Schema, type AudienceScope, type BodyAnchorDescriptor, type HandshakeManifest,
  type PerceptionEnvelope, type UniversalObservationFrame } from "@ai0/protocol";
import type { PerceptionClockPort } from "./sensory.js";

export interface ObservationAdmission {
  shellId: string;
  principalId: string;
  audienceScope: AudienceScope;
  observedAtMs: number;
}

export function normalizePerceptionEnvelopeToFrame(envelope: PerceptionEnvelope, admission: ObservationAdmission): UniversalObservationFrame {
  const frame = envelope.frame;
  if (frame && frame.channel.modality !== envelope.modality) throw new Error("FRAME_MODALITY_MISMATCH");
  const extension = ExtPerceptionV1Schema.safeParse(envelope.extensions["ext.perception.v1"]);
  const sensory = extension.success ? extension.data : undefined;
  return {
    ...frame,
    channel: { ...frame?.channel, modality: envelope.modality, shellId: admission.shellId,
      sensorCoverage: sensory?.coverage ?? frame?.channel.sensorCoverage ?? "live_foveal", sourceKey: sensory?.source_key ?? frame?.channel.sourceKey },
    attribution: { ...frame?.attribution, subjectAnchor: frame?.attribution.subjectAnchor ?? envelope.actor.platform_uid,
      principalId: admission.principalId },
    contextFrame: { ...frame?.contextFrame, socialFrame: frame?.contextFrame.socialFrame ?? "unspecified", audienceScope: admission.audienceScope },
    provenance: { epistemicTier: "untrusted_utterance", trustedGrant: false },
    interpretation: { ...frame?.interpretation, primaryCue: frame?.interpretation.primaryCue ?? envelope.summary_text,
      rawPayload: frame ? frame.interpretation.rawPayload : envelope.extensions },
    chronology: { ...frame?.chronology, observedAtMs: admission.observedAtMs,
      freshnessTtlMs: sensory?.freshness_ttl_ms ?? frame?.chronology.freshnessTtlMs ?? 1200,
      turnId: envelope.event_id, revision: frame?.chronology.revision ?? 0 }
  };
}

export class ObservationNormalizer {
  constructor(private readonly clock: PerceptionClockPort) {}
  normalize(envelope: PerceptionEnvelope, admission: Omit<ObservationAdmission, "observedAtMs">) {
    return normalizePerceptionEnvelopeToFrame(envelope, { ...admission, observedAtMs: this.clock.nowMs() });
  }
}

export class EmbodimentAffordanceRegistry {
  private readonly shells = new Map<string, { manifest: HandshakeManifest; anchors: BodyAnchorDescriptor[] }>();

  mount(manifest: HandshakeManifest, cardAnchors: readonly BodyAnchorDescriptor[] = []) {
    const capabilities = manifest.capabilities;
    const anchors = new Map<string, BodyAnchorDescriptor>();
    for (const id of capabilities.embodiment_anchors ?? []) anchors.set(id, { id });
    for (const anchor of capabilities.supports_card_assets ? cardAnchors : []) anchors.set(anchor.id, anchor);
    for (const anchor of capabilities.body_anchors ?? []) anchors.set(anchor.id, anchor);
    this.shells.set(manifest.shell_id, structuredClone({ manifest, anchors: [...anchors.values()] }));
  }

  unmount(shellId: string) { this.shells.delete(shellId); }
  disconnect(shellId: string) { this.unmount(shellId); }

  coverage(shellId: string, modality: string, sourceKey?: string) {
    const capabilities = this.shells.get(shellId)?.manifest.capabilities;
    if (!capabilities) return "disconnected" as const;
    if (!capabilities.sensors.includes(modality)) return "blind" as const;
    return capabilities.sensor_affordances?.find(sensor => sensor.modality === modality
      && (sourceKey === undefined || sourceKey === sensor.source_key))?.coverage ?? "on_demand";
  }

  connectedShells(audience?: AudienceScope) {
    return structuredClone([...this.shells.values()].filter(({ manifest }) =>
      audience === undefined || manifest.current_audience.scope === audience));
  }
}

export class ChronoceptiveSignalSynthesizer {
  private lastInteractionMs: number;
  constructor(private readonly clock: PerceptionClockPort) { this.lastInteractionMs = clock.nowMs(); }

  interact(nowMs = this.clock.nowMs()) { this.lastInteractionMs = Math.max(this.lastInteractionMs, nowMs); }

  unattendedMs(nowMs = this.clock.nowMs()) {
    return Math.max(0, this.clock.effectiveElapsedMs?.(this.lastInteractionMs, nowMs) ?? nowMs - this.lastInteractionMs);
  }

  synthesize(audienceScope: AudienceScope = "only_owner"): UniversalObservationFrame {
    const now = this.clock.nowMs();
    const unattendedMs = this.unattendedMs(now);
    return {
      channel: { modality: "system_chronoception", shellId: "cognition.internal", sensorCoverage: "live_foveal", primitive: "endogenous_chronoception" },
      attribution: { subjectAnchor: "self", principalId: "system" },
      contextFrame: { socialFrame: "internal_background", audienceScope },
      provenance: { epistemicTier: "system_chronoception", trustedGrant: true },
      interpretation: { primaryCue: "unattended_duration", rawPayload: { unattendedMs } },
      chronology: { observedAtMs: now, freshnessTtlMs: 0, turnId: String(now), revision: 0 }
    };
  }
}
