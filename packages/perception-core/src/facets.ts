import { defineFacetPoint, sortFacetsByPriority, type ExtensionCoreHost } from "@ai0/extension-core";
import { InteractionChannelSchema, perceptionSourceContract, type AudienceScope, type InteractionChannel } from "@ai0/protocol";
import type { DebounceInputEvent } from "./sensory.js";
import { perceptionExtractorContract } from "@ai0/protocol";
export const perceptionExtractorFacet = defineFacetPoint(perceptionExtractorContract);

export const perceptionIngressFacet = defineFacetPoint<InteractionChannel>({
  owner: "perception", name: "ingress", version: 1, parse: raw => InteractionChannelSchema.parse(raw)
});
export const perceptionSourceFacet = defineFacetPoint(perceptionSourceContract);

/** Host attribution is bound to a registration. Resource text cannot supply a principal or a revision. */
export interface AdmittedSourceObservation { source: string; sourceKey: string; revision: number; content: string; audience: AudienceScope }
export async function subscribePerceptionSource(host: ExtensionCoreHost, packageId: string, audience: AudienceScope,
  signal: AbortSignal, admit: (observation: AdmittedSourceObservation) => void, sourceKey?: string) {
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
  | { kind: "hold" | "suppress" }
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

export class PerceptionFilterPipeline {
  constructor(private readonly host?: ExtensionCoreHost) {}

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

  flushDue(nowMs: number): DebounceInputEvent[] {
    return this.filters().flatMap(entry => this.host?.invokeFacet(entry, filter => filter.flushDue?.(nowMs)) ?? []);
  }

  private filters() {
    return sortFacetsByPriority(this.host?.listFacets(perceptionFilterFacet) ?? []);
  }
}
