import { defineFacetPoint, sortFacetsByPriority, type ExtensionHostView } from "@ai0/extension-core";
import {
  InteractionChannelSchema,
  perceptionExtractorContract,
  perceptionSourceContract,
  perceptionTransducerContract,
  type AudienceScope,
  type InteractionChannel,
  type PerceptionEnvelope,
  type PrincipalTrust,
  type TaintLevel,
  type UniversalObservationFrame
} from "@ai0/protocol";
import { normalizePerceptionEnvelopeToFrame, type ObservationAdmission } from "../kernel/observation-grammar.js";
import type { DebounceInputEvent, PerceptionClockPort } from "../kernel/sensory.js";

export const perceptionExtractorFacet = defineFacetPoint(perceptionExtractorContract);
export const perceptionTransducerFacet = defineFacetPoint(perceptionTransducerContract);

export const perceptionIngressFacet = defineFacetPoint<InteractionChannel>({
  owner: "perception", name: "ingress", version: 1, parse: raw => InteractionChannelSchema.parse(raw)
});
export const perceptionSourceFacet = defineFacetPoint(perceptionSourceContract);

/** Host attribution is bound to a registration. Resource text cannot supply a principal or a revision. */
export interface AdmittedSourceObservation { source: string; sourceKey: string; revision: number; content: string; audience: AudienceScope }
export async function subscribePerceptionSource(
  host: ExtensionHostView,
  packageId: string,
  audience: AudienceScope,
  signal: AbortSignal,
  admit: (observation: AdmittedSourceObservation) => void,
  sourceKey?: string
) {
  const entries = host.listFacets(perceptionSourceFacet).filter(entry => entry.packageId === packageId &&
    (sourceKey === undefined || entry.implementation.sourceKey === sourceKey));
  if (!entries.length || !host.allowsAudienceScope(packageId, audience, perceptionSourceFacet.id)) throw new Error("Perception source unavailable");
  const lifetime = new AbortController();
  try {
    for (const entry of entries) {
      const lease = host.leaseFacet(entry);
      const combined = AbortSignal.any([signal, lifetime.signal, lease.signal]);
      let revision = 0;
      let close: (() => void | Promise<void>) | undefined;
      const stop = () => { lease.dispose(); if (close) void Promise.resolve(close()).catch(() => undefined); };
      combined.addEventListener("abort", stop, { once: true });
      try {
        combined.throwIfAborted();
        close = await entry.implementation.subscribe(content => {
          if (!combined.aborted && typeof content === "string" && host.allowsAudienceScope(packageId, audience, perceptionSourceFacet.id))
            admit({ source: packageId, sourceKey: entry.implementation.sourceKey ?? packageId, revision: ++revision, content, audience });
        }, combined);
        if (combined.aborted) { stop(); combined.throwIfAborted(); }
      } catch (error) { lease.dispose(); throw error; }
    }
  } catch (error) { lifetime.abort(); throw error; }
  return () => lifetime.abort();
}

export type PerceptionFilterResult =
  | { kind: "pass"; event: DebounceInputEvent }
  | { kind: "hold" }
  | { kind: "suppress" }
  | { kind: "observe"; event: DebounceInputEvent };
export interface PerceptionFilter {
  priority?: number;
  onEvent(event: DebounceInputEvent, channelId: string, nowMs: number): PerceptionFilterResult;
  flushDue?(nowMs: number): readonly DebounceInputEvent[];
}

export const perceptionFilterFacet = defineFacetPoint<PerceptionFilter>({
  owner: "perception", name: "filter", version: 1,
  parse(raw) {
    const value = raw as PerceptionFilter | null;
    if (typeof value?.onEvent !== "function" ||
        (value.priority !== undefined && !Number.isFinite(value.priority)) ||
        (value.flushDue !== undefined && typeof value.flushDue !== "function")) {
      throw new TypeError("Invalid perception filter");
    }
    return value;
  }
});

export interface PerceptionFilterTrace {
  readonly packageId: string;
  readonly generation: number;
}

export interface AdmittedChannelMeta {
  readonly eventId: string;
  readonly channelId: string;
  readonly principalId: string;
  readonly principalTrust: PrincipalTrust;
  readonly audienceScope: AudienceScope;
  readonly taintLevel: TaintLevel;
  readonly interactionFrame?: string;
  readonly dynamicContractId?: string;
  readonly transducedVia?: {
    readonly packageId: string;
    readonly generation: number;
    readonly inputModality: string;
    readonly outputModality: string;
  };
}

export interface ProvenanceIngestOutcome {
  readonly kind: "pass" | "hold" | "suppress" | "observe" | "neutral_retract";
  readonly event?: DebounceInputEvent;
  readonly admission: AdmittedChannelMeta;
  readonly appliedFilters: readonly PerceptionFilterTrace[];
}

export interface ProvenanceFlushedEvent {
  readonly event: DebounceInputEvent;
  readonly admission: AdmittedChannelMeta;
  readonly appliedFilters: readonly PerceptionFilterTrace[];
}

export class PerceptionFilterPipeline {
  private readonly pendingByTurnId = new Map<string, { admission: AdmittedChannelMeta; filters: PerceptionFilterTrace[] }>();
  private readonly pendingByChannelKey = new Map<string, { admission: AdmittedChannelMeta; filters: PerceptionFilterTrace[] }>();

  constructor(private readonly host?: ExtensionHostView) {}

  ingest(event: DebounceInputEvent, channelId: string, nowMs: number): PerceptionFilterResult | { kind: "neutral_retract" } {
    let current = event;
    for (const entry of this.filters()) {
      const result = this.host?.invokeFacet(entry, filter => filter.onEvent(current, channelId, nowMs));
      if (!result) continue;
      if (result.kind !== "pass") return result;
      current = result.event;
    }
    return current.lifecycle === "retract" ? { kind: "neutral_retract" } : { kind: "pass", event: current };
  }

  ingestWithProvenance(
    event: DebounceInputEvent,
    admission: AdmittedChannelMeta,
    nowMs: number
  ): ProvenanceIngestOutcome {
    const attachedFrame: UniversalObservationFrame = event.frame ?? {
      channel: {
        modality: "text",
        channelId: admission.channelId,
        sensorCoverage: "live_foveal"
      },
      attribution: {
        subjectAnchor: admission.principalId,
        principalId: admission.principalId
      },
      contextFrame: {
        socialFrame: admission.interactionFrame ?? "literal",
        audienceScope: admission.audienceScope
      },
      provenance: {
        epistemicTier: "untrusted_utterance",
        trustedGrant: admission.principalTrust === "owner_verified",
        ...(admission.principalTrust ? { principalTrust: admission.principalTrust } : {}),
        ...(admission.taintLevel ? { taintLevel: admission.taintLevel } : {}),
        ...(admission.dynamicContractId ? { dynamicContractId: admission.dynamicContractId } : {}),
        ...(admission.transducedVia ? { transducedVia: admission.transducedVia } : {})
      },
      interpretation: {
        rawPayload: event.text ?? "",
        primaryCue: event.text ?? ""
      },
      chronology: {
        observedAtMs: nowMs,
        freshnessTtlMs: 0,
        turnId: admission.eventId,
        revision: 0
      }
    };

    let current: DebounceInputEvent = { ...event, frame: attachedFrame };
    const appliedFilters: PerceptionFilterTrace[] = [];
    const channelGroupKey = JSON.stringify([
      admission.channelId,
      admission.principalId,
      admission.audienceScope
    ]);

    for (const entry of this.filters()) {
      const result = this.host?.invokeFacet(entry, filter => filter.onEvent(current, admission.channelId, nowMs));
      if (!result) continue;
      appliedFilters.push({ packageId: entry.packageId, generation: entry.generation });
      if (result.kind === "hold") {
        this.pendingByTurnId.set(admission.eventId, { admission, filters: [...appliedFilters] });
        this.pendingByChannelKey.set(channelGroupKey, { admission, filters: [...appliedFilters] });
        return { kind: "hold", admission, appliedFilters };
      }
      if (result.kind === "suppress") {
        this.pendingByTurnId.delete(admission.eventId);
        this.pendingByChannelKey.delete(channelGroupKey);
        return { kind: "suppress", admission, appliedFilters };
      }
      if (result.kind === "observe") {
        this.pendingByTurnId.delete(admission.eventId);
        this.pendingByChannelKey.delete(channelGroupKey);
        return { kind: "observe", event: result.event, admission, appliedFilters };
      }
      current = result.event;
    }

    if (current.lifecycle === "retract") {
      this.pendingByTurnId.delete(admission.eventId);
      this.pendingByChannelKey.delete(channelGroupKey);
      return { kind: "neutral_retract", admission, appliedFilters };
    }
    return { kind: "pass", event: current, admission, appliedFilters };
  }

  flushDue(nowMs: number): DebounceInputEvent[] {
    return this.filters().flatMap(entry => this.host?.invokeFacet(entry, filter => filter.flushDue?.(nowMs)) ?? []);
  }

  flushDueWithProvenance(nowMs: number): ProvenanceFlushedEvent[] {
    const out: ProvenanceFlushedEvent[] = [];
    for (const entry of this.filters()) {
      const flushed = this.host?.invokeFacet(entry, filter => filter.flushDue?.(nowMs)) ?? [];
      for (const item of flushed) {
        const turnId = item.frame?.chronology.turnId;
        const channelGroupKey = item.frame
          ? JSON.stringify([
              item.frame.channel.channelId,
              item.frame.attribution.principalId,
              item.frame.contextFrame.audienceScope
            ])
          : undefined;
        const soleFallbackEntry =
          !item.frame && this.pendingByChannelKey.size === 1
            ? [...this.pendingByChannelKey.entries()][0]
            : undefined;
        const tracked =
          (turnId ? this.pendingByTurnId.get(turnId) : undefined) ??
          (channelGroupKey ? this.pendingByChannelKey.get(channelGroupKey) : undefined) ??
          soleFallbackEntry?.[1];
        if (turnId) this.pendingByTurnId.delete(turnId);
        if (channelGroupKey) this.pendingByChannelKey.delete(channelGroupKey);
        if (soleFallbackEntry) {
          this.pendingByChannelKey.delete(soleFallbackEntry[0]);
          this.pendingByTurnId.delete(soleFallbackEntry[1].admission.eventId);
        }

        const resolvedAdmission: AdmittedChannelMeta = tracked?.admission ?? {
          eventId: turnId ?? `evt_flushed_${nowMs}`,
          channelId: item.frame?.channel.channelId ?? "channel.unknown",
          principalId: item.frame?.attribution.principalId ?? "unknown",
          principalTrust: (item.frame?.provenance.principalTrust as PrincipalTrust | undefined) ?? "stranger",
          audienceScope: item.frame?.contextFrame.audienceScope ?? "public_all",
          taintLevel: (item.frame?.provenance.taintLevel as TaintLevel | undefined) ?? "untrusted_external"
        };
        const filterTrace: PerceptionFilterTrace = { packageId: entry.packageId, generation: entry.generation };
        const priorFilters = tracked?.filters ?? [];
        const hasCurrent = priorFilters.some(
          (f) => f.packageId === filterTrace.packageId && f.generation === filterTrace.generation
        );
        out.push({
          event: item,
          admission: resolvedAdmission,
          appliedFilters: hasCurrent ? priorFilters : [...priorFilters, filterTrace]
        });
      }
    }
    return out;
  }

  private filters() {
    return sortFacetsByPriority(this.host?.listFacets(perceptionFilterFacet) ?? []);
  }
}

export class ObservationNormalizer {
  constructor(private readonly clock: PerceptionClockPort, private readonly host?: ExtensionHostView) {}

  normalize(envelope: PerceptionEnvelope, admission: Omit<ObservationAdmission, "observedAtMs">) {
    let dynamicContractId = admission.dynamicContractId;
    let effectiveEnvelope = envelope;
    const host = this.host;
    const dynamicExt = envelope.extensions["ai0.dynamic_event"] as
      | {
          namespace?: string;
          name?: string;
          version?: number;
          targetVersion?: number;
          upcastToLatest?: boolean;
          payload?: unknown;
        }
      | undefined;
    if (
      host &&
      dynamicExt &&
      typeof dynamicExt.namespace === "string" &&
      typeof dynamicExt.name === "string" &&
      typeof dynamicExt.version === "number"
    ) {
      let resolvedTargetVersion = dynamicExt.targetVersion;
      if (resolvedTargetVersion === undefined && dynamicExt.upcastToLatest === true) {
        const candidates = host
          .listDynamicContracts("perception_event")
          .filter((c) => c.namespace === dynamicExt.namespace && c.name === dynamicExt.name);
        if (candidates.length > 0) {
          resolvedTargetVersion = Math.max(...candidates.map((c) => c.version));
        }
      }
      if (resolvedTargetVersion !== undefined && resolvedTargetVersion !== dynamicExt.version) {
        const coercedPayload = host.coerceDynamicContractPayload(
          "perception_event",
          dynamicExt.namespace,
          dynamicExt.name,
          dynamicExt.version,
          resolvedTargetVersion,
          dynamicExt.payload
        );
        effectiveEnvelope = {
          ...envelope,
          extensions: {
            ...envelope.extensions,
            "ai0.dynamic_event": {
              ...dynamicExt,
              version: resolvedTargetVersion,
              payload: coercedPayload
            }
          }
        };
        dynamicContractId = `perception_event:${dynamicExt.namespace}.${dynamicExt.name}@${resolvedTargetVersion}`;
      } else {
        host.validateDynamicContractPayload(
          "perception_event",
          dynamicExt.namespace,
          dynamicExt.name,
          dynamicExt.version,
          dynamicExt.payload
        );
        dynamicContractId = `perception_event:${dynamicExt.namespace}.${dynamicExt.name}@${dynamicExt.version}`;
      }
    }

    const frame = normalizePerceptionEnvelopeToFrame(effectiveEnvelope, {
      ...admission,
      ...(dynamicContractId ? { dynamicContractId } : {}),
      observedAtMs: this.clock.nowMs()
    });
    if (!host) return frame;
    const extractions = host.listFacets(perceptionExtractorFacet).flatMap(entry => {
      const { modality, extension } = entry.implementation;
      if (modality !== frame.channel.modality || !Object.hasOwn(effectiveEnvelope.extensions, extension) ||
        !host.allowsAudienceScope(entry.packageId, admission.audienceScope, entry.facetId)) return [];
      const extracted = host.invokeFacet(entry, facet => {
        const result = facet.extract(structuredClone(effectiveEnvelope.extensions[extension]));
        if (!result) return;
        if (typeof result.cue !== "string" || !result.cue) throw new TypeError("Invalid extracted cue");
        return { cue: result.cue, data: structuredClone(result.data) };
      });
      return extracted ? [{ source: entry.packageId, generation: entry.generation, ...extracted }] : [];
    });
    if (extractions.length) frame.interpretation.extractions = extractions;
    return frame;
  }

  async transduceAndNormalize(
    envelope: PerceptionEnvelope,
    admission: Omit<ObservationAdmission, "observedAtMs">,
    signal?: AbortSignal
  ): Promise<UniversalObservationFrame> {
    const host = this.host;
    if (!host) {
      return this.normalize(envelope, admission);
    }
    const abortSignal = signal ?? new AbortController().signal;
    const transducers = sortFacetsByPriority(host.listFacets(perceptionTransducerFacet)).filter(
      (entry) =>
        entry.implementation.inputModalities.includes(envelope.modality) &&
        host.allowsAudienceScope(entry.packageId, admission.audienceScope, entry.facetId)
    );

    let nextEnvelope = structuredClone(envelope);
    let nextAdmission: Omit<ObservationAdmission, "observedAtMs"> = { ...admission };

    for (const entry of transducers) {
      abortSignal.throwIfAborted();
      const lease = host.leaseFacet(entry);
      const combined = AbortSignal.any([abortSignal, lease.signal]);
      try {
        const rawPayload = nextEnvelope.frame
          ? nextEnvelope.frame.interpretation.rawPayload
          : nextEnvelope.extensions;
        const transduced = await host.invokeFacetAsync(entry, (facet) =>
          facet.transduce(
            {
              modality: nextEnvelope.modality,
              rawPayload: structuredClone(rawPayload),
              channelId: admission.channelId,
              summaryText: nextEnvelope.summary_text
            },
            combined
          )
        );
        if (!transduced) continue;

        let dynamicContractId = nextAdmission.dynamicContractId;
        if (transduced.dynamicEventContract) {
          const { namespace, name, version } = transduced.dynamicEventContract;
          if (host.getDynamicContract("perception_event", namespace, name, version)) {
            host.validateDynamicContractPayload(
              "perception_event",
              namespace,
              name,
              version,
              transduced.data ?? { primaryCue: transduced.primaryCue }
            );
          }
          dynamicContractId = `perception_event:${namespace}.${name}@${version}`;
        }

        const originalModality = nextEnvelope.modality;
        nextEnvelope = {
          ...nextEnvelope,
          modality: transduced.outputModality,
          summary_text: transduced.summaryText ?? transduced.primaryCue,
          ...(transduced.confidence !== undefined ? { confidence: transduced.confidence } : {}),
          frame: {
            channel: {
              modality: transduced.outputModality,
              channelId: admission.channelId,
              sensorCoverage: nextEnvelope.frame?.channel.sensorCoverage ?? "live_foveal"
            },
            attribution: {
              subjectAnchor: nextEnvelope.frame?.attribution.subjectAnchor ?? nextEnvelope.actor.platform_uid,
              principalId: admission.principalId
            },
            contextFrame: {
              socialFrame: nextEnvelope.frame?.contextFrame.socialFrame ?? "unspecified",
              audienceScope: admission.audienceScope
            },
            provenance: {
              epistemicTier: transduced.epistemicTier ?? admission.epistemicTier ?? "direct_sensor",
              trustedGrant: admission.trustedGrant ?? true
            },
            interpretation: {
              rawPayload: transduced.data !== undefined ? structuredClone(transduced.data) : rawPayload,
              primaryCue: transduced.primaryCue,
              ...(transduced.competingHypotheses
                ? { competingHypotheses: [...transduced.competingHypotheses] }
                : {})
            },
            chronology: {
              observedAtMs: this.clock.nowMs(),
              freshnessTtlMs: nextEnvelope.frame?.chronology.freshnessTtlMs ?? 0,
              turnId: nextEnvelope.event_id,
              revision: nextEnvelope.frame?.chronology.revision ?? 0
            }
          }
        };
        nextAdmission = {
          ...nextAdmission,
          epistemicTier: transduced.epistemicTier ?? nextAdmission.epistemicTier ?? "direct_sensor",
          transducedVia: {
            packageId: entry.packageId,
            generation: entry.generation,
            inputModality: originalModality,
            outputModality: transduced.outputModality
          },
          ...(dynamicContractId ? { dynamicContractId } : {})
        };
        break;
      } finally {
        lease.dispose();
      }
    }

    return this.normalize(nextEnvelope, nextAdmission);
  }
}
