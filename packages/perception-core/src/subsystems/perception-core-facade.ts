import type { DynamicContractSnapshot, ExtensionCoreHost, ExtensionHostView } from "@ai0/extension-core";
import type {
  AudienceScope,
  BodyAnchorDescriptor,
  HandshakeManifest,
  PerceptionEnvelope,
  UniversalObservationFrame
} from "@ai0/protocol";
import { ChronoceptiveSignalSynthesizer, type ObservationAdmission } from "../kernel/observation-grammar.js";
import {
  SensoryCoverageBucketManager,
  type DebounceInputEvent,
  type PerceptionClockPort
} from "../kernel/sensory.js";
import { EmbodimentAffordanceRegistry } from "./affordances.js";
import {
  ObservationNormalizer,
  PerceptionFilterPipeline,
  subscribePerceptionSource,
  type AdmittedChannelMeta,
  type AdmittedSourceObservation,
  type ProvenanceFlushedEvent,
  type ProvenanceIngestOutcome
} from "./facets.js";

export interface PerceptionCoreOptions {
  readonly clock: PerceptionClockPort;
  readonly host?: ExtensionHostView;
}

/**
 * Cohesive PerceptionCore uniting lifecycle, dynamic 3-axis extension loading
 * (X: channel ingress/sources, Y: cross-channel modality transducers/extractors, Z: internal filters)
 * plus emergent `perception_event` dynamic contracts and verifiable origin provenance.
 */
export class PerceptionCore {
  readonly clock: PerceptionClockPort;
  readonly host?: ExtensionHostView;
  readonly affordances: EmbodimentAffordanceRegistry;
  readonly coverage: SensoryCoverageBucketManager;
  readonly filters: PerceptionFilterPipeline;
  readonly normalizer: ObservationNormalizer;
  readonly chronoception: ChronoceptiveSignalSynthesizer;

  private active = true;
  private unsubscribeHost?: () => void;
  private readonly sourceDisposers: Array<() => void> = [];

  constructor(options: PerceptionCoreOptions) {
    this.clock = options.clock;
    this.host = options.host;
    this.affordances = new EmbodimentAffordanceRegistry();
    this.coverage = new SensoryCoverageBucketManager(options.clock);
    this.filters = new PerceptionFilterPipeline(options.host);
    this.normalizer = new ObservationNormalizer(options.clock, options.host);
    this.chronoception = new ChronoceptiveSignalSynthesizer(options.clock);

    const maybeCoreHost = options.host as Partial<ExtensionCoreHost> | undefined;
    if (typeof maybeCoreHost?.onDidChange === "function") {
      this.unsubscribeHost = maybeCoreHost.onDidChange(() => {
        // Dynamic transducers, extractors, filters, and perception_event contracts are queried live.
      });
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
    for (const dispose of this.sourceDisposers.splice(0)) {
      dispose();
    }
  }

  dispose(): void {
    this.stop();
    this.unsubscribeHost?.();
    this.unsubscribeHost = undefined;
  }

  mountChannel(manifest: HandshakeManifest, cardAnchors: readonly BodyAnchorDescriptor[] = []): void {
    this.affordances.mount(manifest, cardAnchors);
  }

  unmountChannel(channelId: string): void {
    this.affordances.unmount(channelId);
  }

  listDynamicEventContracts(): readonly DynamicContractSnapshot[] {
    return this.host?.listDynamicContracts("perception_event") ?? [];
  }

  async transduceAndIngestEnvelope(
    envelope: PerceptionEnvelope,
    admission: Omit<ObservationAdmission, "observedAtMs"> & {
      eventId?: string;
      interactionFrame?: string;
      bypassFilters?: boolean;
    },
    signal?: AbortSignal
  ): Promise<{
    readonly frame: UniversalObservationFrame;
    readonly disposition: ProvenanceIngestOutcome;
  }> {
    if (!this.active) {
      throw new Error("PerceptionCore is stopped");
    }
    const frame = await this.normalizer.transduceAndNormalize(envelope, admission, signal);
    const meta: AdmittedChannelMeta = {
      eventId: admission.eventId ?? envelope.event_id,
      channelId: admission.channelId,
      principalId: admission.principalId,
      principalTrust: (admission.principalTrust ?? "stranger") as AdmittedChannelMeta["principalTrust"],
      audienceScope: admission.audienceScope,
      taintLevel: admission.taintLevel ?? "untrusted_external",
      ...(admission.interactionFrame ? { interactionFrame: admission.interactionFrame } : {}),
      ...(typeof frame.provenance.dynamicContractId === "string"
        ? { dynamicContractId: frame.provenance.dynamicContractId }
        : {}),
      ...(frame.provenance.transducedVia
        ? {
            transducedVia: frame.provenance.transducedVia as AdmittedChannelMeta["transducedVia"]
          }
        : {})
    };

    if (admission.bypassFilters) {
      return {
        frame,
        disposition:
          envelope.lifecycle === "retract"
            ? { kind: "neutral_retract", admission: meta, appliedFilters: [] }
            : {
                kind: "pass",
                event: {
                  frame,
                  lifecycle: envelope.lifecycle,
                  text: frame.interpretation.primaryCue,
                  virtual_ts_ms: this.clock.nowMs()
                },
                admission: meta,
                appliedFilters: []
              }
      };
    }

    const debounceEvent: DebounceInputEvent = {
      frame,
      lifecycle: envelope.lifecycle,
      text: frame.interpretation.primaryCue,
      virtual_ts_ms: this.clock.nowMs()
    };
    const disposition = this.filters.ingestWithProvenance(debounceEvent, meta, this.clock.nowMs());
    if (disposition.appliedFilters.length > 0) {
      frame.provenance.filteredVia = disposition.appliedFilters;
    }
    return { frame, disposition };
  }

  flushDue(nowMs = this.clock.nowMs()): readonly ProvenanceFlushedEvent[] {
    if (!this.active) return [];
    return this.filters.flushDueWithProvenance(nowMs);
  }

  async connectSource(
    packageId: string,
    audience: AudienceScope,
    admit: (observation: AdmittedSourceObservation) => void,
    sourceKey?: string
  ): Promise<() => void> {
    if (!this.host) {
      throw new Error("ExtensionHostView is required to connect a perception source");
    }
    const controller = new AbortController();
    const stop = await subscribePerceptionSource(this.host, packageId, audience, controller.signal, admit, sourceKey);
    const dispose = () => {
      controller.abort();
      stop();
    };
    this.sourceDisposers.push(dispose);
    return dispose;
  }
}
