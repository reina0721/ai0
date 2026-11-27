import { expect, it } from "vitest";
import { ExtensionCoreHost } from "@ai0/extension-core";
import { MountedContinuousStates } from "./continuous-domain.js";
import { cognitionStateDynamicsFacet } from "./facets.js";

it("exposes exactly the registered continuous state IDs and forgets removed delegates", () => {
  const host = new ExtensionCoreHost();
  let now = 100;
  const state = new MountedContinuousStates(host, () => now);
  expect(state.snapshot()).toEqual({ values: {}, attributions: {} });
  state.restore({ values: { "queue.capacity": .8, removed: .99 }, attributions: {} });
  expect(state.snapshot().values).toEqual({});
  const mount = (id: string) => host.mountPackage({
    manifest: { manifest_version: "2.0.0", extension_id: id, display_name: id, author: "test", version: "1",
      carrier_kind: "native_code_plugin", facets: [cognitionStateDynamicsFacet.id], permissions: {
        read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false } },
    activate(scope) { scope.contributeFacet(cognitionStateDynamicsFacet, { descriptors: [{
      id: "queue.capacity", topology: "unipolar_sigmoid", baseline: .5, halfLifeMs: 100, wakeupThresholds: []
    }] }); }
  });
  mount("capacity");
  expect(state.snapshot().values["queue.capacity"]).toBeCloseTo(.8);
  const before = state.snapshot().values;
  expect(state.apply({ made_up: .2 }, { "queue.capacity": .7 }, {})).toMatchObject({ reason: "STATE_NOT_REGISTERED" });
  expect(state.snapshot().values).toEqual(before);
  state.apply({}, { "queue.capacity": .9 }, { "queue.capacity": { text: "observation", sourceEventIds: ["e"], audienceScope: "only_owner" } });
  expect(state.snapshot().values["queue.capacity"]).toBeCloseTo(.9);
  now += 100;
  expect(state.snapshot().values["queue.capacity"]).toBeLessThan(.9);
  host.unmountPackage("capacity");
  expect(state.snapshot()).toEqual({ values: {}, attributions: {} });
  mount("capacity");
  expect(state.snapshot().values["queue.capacity"]).toBeCloseTo(.5);
  mount("conflict");
  expect(state.snapshot()).toEqual({ values: {}, attributions: {} });
});
