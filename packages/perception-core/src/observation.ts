import { ExtPerceptionV1Schema, type AudienceScope, type BodyAnchorDescriptor, type HandshakeManifest,
  type PerceptionEnvelope, type UniversalObservationFrame } from "@ai0/protocol";
import type { PerceptionClockPort } from "./sensory.js";
import type { ExtensionCoreHost } from "@ai0/extension-core";
import { perceptionExtractorFacet } from "./facets.js";

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
    channel: { ...frame?.channel, modality: envelope.modality, channelId: admission.channelId,
      sensorCoverage: sensory?.coverage ?? frame?.channel.sensorCoverage ?? admission.sourceDefaults?.coverage ?? "unknown", sourceKey: sensory?.source_key ?? frame?.channel.sourceKey },
    attribution: { ...frame?.attribution, subjectAnchor: frame?.attribution.subjectAnchor ?? envelope.actor.platform_uid,
      principalId: admission.principalId },
    contextFrame: { ...frame?.contextFrame, socialFrame: frame?.contextFrame.socialFrame ?? "unspecified", audienceScope: admission.audienceScope },
    provenance: { epistemicTier: "untrusted_utterance", trustedGrant: false },
    interpretation: { ...interpretation, primaryCue: frame?.interpretation.primaryCue ?? envelope.summary_text,
      rawPayload: frame ? frame.interpretation.rawPayload : envelope.extensions },
    chronology: { ...frame?.chronology, observedAtMs: admission.observedAtMs,
      freshnessTtlMs: sensory?.freshness_ttl_ms ?? frame?.chronology.freshnessTtlMs ?? admission.sourceDefaults?.freshnessTtlMs ?? 0,
      turnId: envelope.event_id, revision: frame?.chronology.revision ?? 0 }
  };
}

export class ObservationNormalizer {
  constructor(private readonly clock: PerceptionClockPort, private readonly host?: ExtensionCoreHost) {}
  normalize(envelope: PerceptionEnvelope, admission: Omit<ObservationAdmission, "observedAtMs">) {
    const frame = normalizePerceptionEnvelopeToFrame(envelope, { ...admission, observedAtMs: this.clock.nowMs() });
    const host = this.host;
    if (!host) return frame;
    const extractions = host.listFacets(perceptionExtractorFacet).flatMap(entry => {
      const { modality, extension } = entry.implementation;
      if (modality !== frame.channel.modality || !Object.hasOwn(envelope.extensions, extension) ||
        !host.allowsAudienceScope(entry.packageId, admission.audienceScope, entry.facetId)) return [];
      const extracted = host.invokeFacet(entry, facet => {
        const result = facet.extract(structuredClone(envelope.extensions[extension]));
        if (!result) return;
        if (typeof result.cue !== "string" || !result.cue) throw new TypeError("Invalid extracted cue");
        return { cue: result.cue, data: structuredClone(result.data) };
      });
      return extracted ? [{ source: entry.packageId, generation: entry.generation, ...extracted }] : [];
    });
    if (extractions.length) frame.interpretation.extractions = extractions;
    return frame;
  }
}

export class EmbodimentAffordanceRegistry {
  private readonly channels = new Map<string, { manifest: HandshakeManifest; anchors: BodyAnchorDescriptor[] }>();

  mount(manifest: HandshakeManifest, cardAnchors: readonly BodyAnchorDescriptor[] = []) {
    const capabilities = manifest.capabilities;
    const anchors = new Map<string, BodyAnchorDescriptor>();
    for (const id of capabilities.embodiment_anchors ?? []) anchors.set(id, { id });
    for (const anchor of capabilities.supports_card_assets ? cardAnchors : []) anchors.set(anchor.id, anchor);
    for (const anchor of capabilities.body_anchors ?? []) anchors.set(anchor.id, anchor);
    this.channels.set(manifest.channel_id, structuredClone({ manifest, anchors: [...anchors.values()] }));
  }

  unmount(channelId: string) { this.channels.delete(channelId); }
  disconnect(channelId: string) { this.unmount(channelId); }

  coverage(channelId: string, modality: string, sourceKey?: string) {
    const capabilities = this.channels.get(channelId)?.manifest.capabilities;
    if (!capabilities) return "disconnected" as const;
    if (!capabilities.sensors.includes(modality)) return "blind" as const;
    return capabilities.sensor_affordances?.find(sensor => sensor.modality === modality
      && (sourceKey === undefined || sourceKey === sensor.source_key))?.coverage ?? "unknown";
  }

  connectedChannels(audience?: AudienceScope) {
    return structuredClone([...this.channels.values()].filter(({ manifest }) =>
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
      channel: { modality: "system_chronoception", channelId: "cognition.internal", sensorCoverage: "live_foveal", primitive: "endogenous_chronoception" },
      attribution: { subjectAnchor: "self", principalId: "system" },
      contextFrame: { socialFrame: "internal_background", audienceScope },
      provenance: { epistemicTier: "system_chronoception", trustedGrant: true },
      interpretation: { primaryCue: "unattended_duration", rawPayload: { unattendedMs } },
      chronology: { observedAtMs: now, freshnessTtlMs: 0, turnId: String(now), revision: 0 }
    };
  }
}
