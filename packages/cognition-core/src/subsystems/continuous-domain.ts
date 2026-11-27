import type { ExtensionCoreHost, FacetRegistration } from "@ai0/extension-core";
import type { AudienceScope, ContinuousStateDescriptor } from "@ai0/protocol";
import { ContinuousStateMetaEngine } from "../kernel/continuous-state-engine.js";
import { cognitionStateDynamicsFacet } from "./facets.js";

export interface StateAttribution { text: string; audienceScope: AudienceScope; sourceEventIds: string[] }
export interface ContinuousDomainSnapshot { values: Record<string, number>; attributions: Record<string, StateAttribution> }
type Source = FacetRegistration<{ descriptors: readonly ContinuousStateDescriptor[] }>;
type Cell = { owner: Source; engine: ContinuousStateMetaEngine; attribution?: StateAttribution };

/** An unloaded or ambiguous descriptor contributes no live state. */
export class MountedContinuousStates {
  private readonly cells = new Map<string, Cell>();
  private seed: ContinuousDomainSnapshot = { values: {}, attributions: {} };
  constructor(private readonly host: ExtensionCoreHost | undefined, private readonly now: () => number) {}

  restore(snapshot: ContinuousDomainSnapshot) {
    this.cells.clear();
    this.seed = structuredClone(snapshot);
  }

  private synchronize() {
    const active = new Map<string, { owner: Source; descriptor: ContinuousStateDescriptor } | null>();
    for (const owner of this.host?.listFacets(cognitionStateDynamicsFacet) ?? []) {
      for (const descriptor of owner.implementation.descriptors) {
        active.set(descriptor.id, active.has(descriptor.id) ? null : { owner, descriptor });
      }
    }
    const time = this.now();
    for (const [id, cell] of this.cells) if (cell.owner !== active.get(id)?.owner) this.cells.delete(id);
    for (const [id, source] of active) {
      if (!source || this.cells.has(id)) continue;
      const engine = new ContinuousStateMetaEngine([source.descriptor], time);
      const value = this.seed.values[id];
      if (Number.isFinite(value)) engine.setValue(id, value!, time);
      this.cells.set(id, { owner: source.owner, engine, attribution: this.seed.attributions[id] });
      delete this.seed.values[id];
      delete this.seed.attributions[id];
    }
    return time;
  }

  snapshot(): ContinuousDomainSnapshot {
    const time = this.synchronize();
    return {
      values: Object.fromEntries([...this.cells].map(([id, cell]) => [id, cell.engine.evolveTo(time)[id]!])),
      attributions: Object.fromEntries([...this.cells].flatMap(([id, cell]) =>
        cell.attribution ? [[id, structuredClone(cell.attribution)]] : []))
    };
  }

  apply(impulses: Record<string, number>, values: Record<string, number>, attributions: Record<string, StateAttribution>) {
    const time = this.synchronize();
    const ids = [...Object.keys(impulses), ...Object.keys(values), ...Object.keys(attributions)];
    if (!ids.length || ids.some(id => !this.cells.has(id))) return { reason: "STATE_NOT_REGISTERED" };
    if (![...Object.values(impulses), ...Object.values(values)].every(Number.isFinite)) return { reason: "INVALID_STATE_VALUE" };
    for (const [id, value] of Object.entries(values)) this.cells.get(id)!.engine.setValue(id, value, time);
    for (const [id, impulse] of Object.entries(impulses)) this.cells.get(id)!.engine.impulse(id, impulse, time);
    for (const [id, attribution] of Object.entries(attributions)) this.cells.get(id)!.attribution = structuredClone(attribution);
    return {};
  }
}
