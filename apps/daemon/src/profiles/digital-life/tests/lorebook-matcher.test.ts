import { describe, expect, it } from "vitest";
import { ExtensionCoreHost } from "@ai0/sdk";
import { VirtualClock } from "@ai0/cognition-core";
import { AuthoritativeStateCoordinator, selectReadableSnapshot } from "../index.js";
import {
  cognitionContextContributorFacet
} from "@ai0/cognition-core";
import {
  LorebookMatcher,
  simulateLorebookActivation
} from "../index.js";

describe("LorebookMatcher", () => {
  const entries = [
    { id: "harbor", keys: ["harbor"], secondary_keys: ["north"], content: "See the lighthouse." },
    { id: "lighthouse", key: ["lighthouse"], content: "Built in 1890." },
    { id: "disabled", keys: ["harbor"], content: "Hidden", enabled: false }
  ];
  const matcher = new LorebookMatcher(entries);

  it("shares case-insensitive, recursive matching with the activation simulator", () => {
    const text = "NORTH HARBOR";
    expect(matcher.match(text).map(entry => entry.id)).toEqual(["harbor", "lighthouse"]);
    expect(matcher.match(text)).toEqual(simulateLorebookActivation(entries, text));
    expect(matcher.match("harbor")).toEqual([]);
  });

  it("contributes lore from the latest readable user turn within the token budget", async () => {
    const contributor = cognitionContextContributorFacet.parse(matcher.toContextContributor({ slotId: "world" }));
    const snapshot = {
      domain_revs: {},
      D1_WORKING_TURN: {
        active_focus_channel_id: "text",
        recent_turns: [
          { role: "user" as const, text: "North Harbor", event_id: "user" },
          { role: "assistant" as const, text: "What about it?", event_id: "assistant" }
        ],
        unsaid_remainder: null,
        pending_opportunities: []
      }
    };
    expect(await contributor.contributeToBlackboard(snapshot, 4)).toEqual({ slot_id: "world", text: "See the li" });
    expect(await contributor.contributeToBlackboard({ domain_revs: {} }, 4)).toBeNull();
  });
});

it("limits a legacy state grant to mounted companion fields", () => {
  const host = new ExtensionCoreHost();
  const id = "thirdparty.legacy";
  host.mountPackage({ manifest: {
    extension_id: id, manifest_version: "2.0.0", version: "1", author: "test", display_name: id,
    carrier_kind: "native_code_plugin", facets: [cognitionContextContributorFacet.id],
    permissions: { read_blackboard_domains: ["D2_HOMEOSTASIS_AFFECT"], propose_mutation_domains: [],
      network_access: false, max_audience_scope: "only_owner" }
  } });
  const clock = new VirtualClock({ targetInstance: "sandbox:legacy", initialVirtualTsMs: 0 });
  const coordinator = new AuthoritativeStateCoordinator(clock, { getEventById: () => undefined, saveTurnDecisionTrace() {} });
  const snapshot = coordinator.getSnapshot();
  const read = (values: Record<string, number>) => selectReadableSnapshot(host, id, {
    ...snapshot, D2_CONTINUOUS_STATES: { values, attributions: {} }
  });
  expect(read({ private_rating: .5 })).not.toHaveProperty("D2_HOMEOSTASIS_AFFECT");
  const view = read({ private_rating: .5, drive_curiosity: .3 });
  expect(view.D2_HOMEOSTASIS_AFFECT).toEqual({ drive_curiosity: .3 });
  expect(view).not.toHaveProperty("D2_CONTINUOUS_STATES");
  expect(view.domain_revs).not.toHaveProperty("D2_CONTINUOUS_STATES");
});
