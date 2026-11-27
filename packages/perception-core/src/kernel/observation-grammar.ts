import { ExtPerceptionV1Schema, type AudienceScope, type PerceptionEnvelope, type UniversalObservationFrame } from "@ai0/protocol";
import type { PerceptionClockPort } from "./sensory.js";

export interface ObservationAdmission {
  channelId: string;
  principalId: string;
  audienceScope: AudienceScope;
  observedAtMs: number;
  sourceDefaults?: ObservationSourceDefaults;
}

export interface ObservationSourceDefaults {
  coverage?: UniversalObservationFrame["channel"]["sensorCoverage"];
  freshnessTtlMs?: number;
}

export function normalizePerceptionEnvelopeToFrame(envelope: PerceptionEnvelope, admission: ObservationAdmission): UniversalObservationFrame {
  const frame = envelope.frame;
  if (frame && frame.channel.modality !== envelope.modality) throw new Error("FRAME_MODALITY_MISMATCH");
  const extension = ExtPerceptionV1Schema.safeParse(envelope.extensions["ext.perception.v1"]);
  const sensory = extension.success ? extension.data : undefined;
  const interpretation = { ...frame?.interpretation };
  delete interpretation.extractions;
  return {
    ...frame,
    channel: {
      ...frame?.channel,
      modality: envelope.modality,
      channelId: admission.channelId,
      sensorCoverage: sensory?.coverage ?? frame?.channel.sensorCoverage ?? admission.sourceDefaults?.coverage ?? "unknown",
      sourceKey: sensory?.source_key ?? frame?.channel.sourceKey
    },
    attribution: {
      ...frame?.attribution,
      subjectAnchor: frame?.attribution.subjectAnchor ?? envelope.actor.platform_uid,
      principalId: admission.principalId
    },
    contextFrame: {
      ...frame?.contextFrame,
      socialFrame: frame?.contextFrame.socialFrame ?? "unspecified",
      audienceScope: admission.audienceScope
    },
    provenance: { epistemicTier: "untrusted_utterance", trustedGrant: false },
    interpretation: {
      ...interpretation,
      primaryCue: frame?.interpretation.primaryCue ?? envelope.summary_text,
      rawPayload: frame ? frame.interpretation.rawPayload : envelope.extensions
    },
    chronology: {
      ...frame?.chronology,
      observedAtMs: admission.observedAtMs,
      freshnessTtlMs: sensory?.freshness_ttl_ms ?? frame?.chronology.freshnessTtlMs ?? admission.sourceDefaults?.freshnessTtlMs ?? 0,
      turnId: envelope.event_id,
      revision: frame?.chronology.revision ?? 0
    }
  };
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
      channel: { modality: "system_chronoception", channelId: "cognition.internal", sensorCoverage: "live_foveal", primitive: "endogenous_chronoception" },
      attribution: { subjectAnchor: "self", principalId: "system" },
      contextFrame: { socialFrame: "internal_background", audienceScope },
      provenance: { epistemicTier: "system_chronoception", trustedGrant: true },
      interpretation: { primaryCue: "unattended_duration", rawPayload: { unattendedMs } },
      chronology: { observedAtMs: now, freshnessTtlMs: 0, turnId: String(now), revision: 0 }
    };
  }
}
