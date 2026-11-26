import { describe, expect, it } from "vitest";
import { ExtensionCoreHost, cognitionAttentionArbitratorFacet, cognitionContextContributorFacet, cognitionStateDynamicsFacet, expressionIntentDecoratorFacet, perceptionFilterFacet } from "@ai0/sdk";
import type { CommunicativeIntentEnvelope, InteractionChannel } from "@ai0/protocol";
import attention from "../src/index.js";
import homeostasis from "../../companion-homeostasis/src/index.js";
import lorebook from "../../lorebook-contributor/src/index.js";
import conversationalGate from "../../../perception-filters/conversational-gate/src/index.js";

describe("builtin policies", () => {
  it("coalesces commits, isolates channels, and clears pending input on retract", () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(conversationalGate);
    const gate = host.listFacets(perceptionFilterFacet)[0]!.implementation;
    expect(gate.onEvent({ lifecycle: "commit", text: "one" }, "a", 0).kind).toBe("hold");
    gate.onEvent({ lifecycle: "commit", text: "two" }, "a", 10);
    gate.onEvent({ lifecycle: "commit", text: "private" }, "b", 10);
    expect(gate.onEvent({ lifecycle: "retract" }, "b", 14)).toMatchObject({ kind: "observe" });
    expect(gate.flushDue?.(1209)).toEqual([]);
    expect(gate.flushDue?.(1210)).toEqual([{ lifecycle: "commit", text: "one\ntwo" }]);
  });

  it("loads all seven companion descriptors and removes them on ablation", () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(homeostasis, { mood_half_life_minutes: 20 });
    const descriptors = host.listFacets(cognitionStateDynamicsFacet)[0]?.implementation.descriptors;
    expect(descriptors).toHaveLength(7);
    expect(descriptors?.find(descriptor => descriptor.id === "mood_baseline_val")?.halfLifeMs).toBe(1_200_000);
    host.setPackageEnabled(homeostasis.manifest.extension_id, false);
    expect(host.listFacets(cognitionStateDynamicsFacet)).toEqual([]);
  });

  it("locks attention, permits crisis preemption, and gates gaze on the surface", () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(attention);
    const facet = host.listFacets(cognitionAttentionArbitratorFacet)[0]!.implementation;
    const first = { channel_id: "a", salience: 1 };
    const next = { channel_id: "b", salience: 2 };
    const input = { candidates: [first, next], current_channel_id: "a", last_switch_ts_ms: 0, now_ts_ms: 10 };
    expect(facet.arbitrate(input).selected_channel_id).toBe("a");
    expect(facet.arbitrate({ ...input, candidates: [first, { ...next, l0_crisis: true }],
      events: [{ channel_id: "b", event_type: "crisis" }],
      rules: [{ when: { event_type: "crisis" }, then: { action: "notify" } }] })).toEqual({
      selected_channel_id: "b", switched: true, actions: [{ action: "notify" }]
    });
    const decorator = host.listFacets(expressionIntentDecoratorFacet)[0]!.implementation;
    const intent: CommunicativeIntentEnvelope = { intent: "communicate", intentId: "intent",
      correlationEventId: "event", attentionTarget: "owner", deliveryConstraints: { audienceScope: "only_owner" } };
    const channel: InteractionChannel = { protocol_version: "0.1.0", channel_id: "a",
      channel_kind: "webchat", display_name: "Test", venue_type: "private_1on1", latency_budget_ms: 1000,
      current_audience: { scope: "only_owner", member_count: 1 },
      capabilities: { embodiment_surface: null, sensors: ["text"], supported_extensions: [], actuators: [] } };
    expect(decorator.decorate(intent, channel)).toBe(intent);
  });

  it("matches recursive lore once and respects the configured budget", async () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(lorebook, { default_token_budget: 5 });
    const facet = host.listFacets(cognitionContextContributorFacet)[0]!.implementation;
    const entry = (id: string, key: string, content: string) => ({
      entry_id: id, keys: [key], content, enabled: true, priority: 0, recursive_depth: 3, max_token_budget: 30
    });
    const result = await facet.contributeToBlackboard({
      D1_WORKING_TURN: { recent_turns: [{ role: "user", text: "start" }] },
      D5_IDENTITY_NARRATIVE: { lorebook: { book_id: "demo", title: "Demo",
        entries: [entry("a", "start", "bridge"), entry("b", "bridge", "start again")] } }
    }, 100);
    expect(result?.text).toBe("bridge\nstart");
  });
});
