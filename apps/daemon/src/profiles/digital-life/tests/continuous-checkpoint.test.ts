import { expect, it } from "vitest";
import { VirtualClock } from "@ai0/cognition-core";
import { cognitionStateDynamicsFacet, ExtensionCoreHost } from "@ai0/sdk";
import { AuthoritativeStateCoordinator } from "../state.js";
import type { ReadOnlyCognitiveSnapshot } from "../state.js";

it("restores legacy affect only for explicitly mounted descriptors and never retains it after unload", () => {
  const host = new ExtensionCoreHost();
  const clock = new VirtualClock({ targetInstance: "sandbox:import", wallNowMs: () => 1000 });
  const storage = { getEventById: () => undefined, saveTurnDecisionTrace: () => {} };
  const original = new AuthoritativeStateCoordinator(clock, storage).getSnapshot();
  const { D2_CONTINUOUS_STATES: _removed, ...base } = original;
  const old = { ...base, D2_HOMEOSTASIS_AFFECT: { instant_valence: 0.7, unregistered: 0.6,
    mood_attribution: "legacy note", mood_attr_scope: "only_owner" } };
  const authority = new AuthoritativeStateCoordinator(clock, { ...storage,
    loadCoordinatorState: () => old as unknown as ReadOnlyCognitiveSnapshot }, host);
  expect(authority.getSnapshot().D2_CONTINUOUS_STATES).toEqual({ values: {}, attributions: {} });
  host.mountPackage({
    manifest: { manifest_version: "2.0.0", extension_id: "example.dynamics", display_name: "Dynamics", author: "example",
      version: "1", carrier_kind: "native_code_plugin", facets: [cognitionStateDynamicsFacet.id], permissions: {
        read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false } },
    activate(scope) { scope.contributeFacet(cognitionStateDynamicsFacet, { descriptors: [
      { id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 100, wakeupThresholds: [] },
      { id: "unregistered", topology: "unipolar_sigmoid", baseline: .1, halfLifeMs: 100, wakeupThresholds: [] }
    ] }); }
  });
  const mounted = authority.getSnapshot().D2_CONTINUOUS_STATES;
  expect(mounted.values.instant_valence).toBeCloseTo(.7);
  expect(mounted.values.unregistered).toBeCloseTo(.1);
  expect(mounted.attributions.instant_valence).toEqual({ text: "legacy note", audienceScope: "only_owner", sourceEventIds: [] });
  host.unmountPackage("example.dynamics");
  expect(authority.getSnapshot().D2_CONTINUOUS_STATES).toEqual({ values: {}, attributions: {} });
});
