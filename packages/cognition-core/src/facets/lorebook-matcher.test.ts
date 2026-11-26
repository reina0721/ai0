import { describe, expect, it } from "vitest";
import { cognitionContextContributorFacet, LorebookMatcher, simulateLorebookActivation } from "../index.js";

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
