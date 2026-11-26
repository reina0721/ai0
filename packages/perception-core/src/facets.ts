import { defineFacetPoint, sortFacetsByPriority, type ExtensionCoreHost } from "@ai0/extension-core";
import { InteractionChannelSchema, type InteractionChannel } from "@ai0/protocol";
import type { DebounceInputEvent } from "./sensory.js";

export const perceptionIngressFacet = defineFacetPoint<InteractionChannel>({
  owner: "perception", name: "ingress", version: 1, parse: raw => InteractionChannelSchema.parse(raw)
});

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
