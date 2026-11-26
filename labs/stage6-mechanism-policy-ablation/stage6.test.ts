import { describe, expect, it } from "vitest";
import type { AgentOptions } from "../stage1-agent-core/index.js";
import { expressionRealizerFacet, perceptionIngressFacet } from "../stage5-composite-channel-facets/index.js";
import type { ExtensionPackageDefinition } from "../stage5-composite-channel-facets/index.js";
import { FiveCoreHarness, agentToolProviderFacet, attentionArbitrator, companionHomeostasis,
  conversationalGate, lorebookContributor } from "./index.js";
import type { RawPerceptionEvent } from "./index.js";

const permissions = { readDomains: [], proposeDomains: [], maxAudienceScope: "only_owner" as const, networkAccess: false };

function channel(id: string, channelId: string, venueType: string, embodied = false): ExtensionPackageDefinition {
  return { id, displayName: channelId, version: "1", permissions,
    facets: [perceptionIngressFacet.id, expressionRealizerFacet.id],
    activate(scope) {
      scope.contributeFacet(perceptionIngressFacet, { channelId, venueType, defaultAudienceScope: "only_owner",
        modalities: { text: "live_foveal", audio: "peripheral" } });
      scope.contributeFacet(expressionRealizerFacet, { channelId, venueType, audienceScope: "only_owner", verbal: true,
        embodimentSurface: embodied ? { surfaceId: "avatar",
          supportedTokens: [{ token: "avatar:gaze", semanticAction: "gaze", kind: "nonverbal", quiet: true }] } : null });
    }
  };
}

function event(channelId: string, text: string, nowMs: number, overrides: Partial<RawPerceptionEvent> = {}): RawPerceptionEvent {
  return { channelId, text, nowMs, modality: "text", lifecycle: "commit", principalId: "owner", ...overrides };
}

function companionProfile() {
  const prompts: Parameters<AgentOptions["model"]>[0]["prompt"][] = [];
  const harness = new FiveCoreHarness(async function* ({ prompt }) {
    prompts.push(prompt);
    yield { kind: "delta", text: "I am listening." };
  });
  harness.extensions.mount(channel("builtin.webchat", "webchat", "web_console"));
  harness.extensions.mount(channel("channel.desktop-stage", "desktop-stage", "desktop_stage", true));
  harness.extensions.mount(conversationalGate());
  harness.extensions.mount(companionHomeostasis());
  harness.extensions.mount(attentionArbitrator());
  harness.extensions.mount(lorebookContributor([
    { id: "map", keywords: ["atlas"], content: "Atlas maps stations", priority: 0, references: ["relay", "archive"] },
    { id: "relay", keywords: [], content: "Relay sleeps", priority: 1, references: ["map"] },
    { id: "archive", keywords: [], content: "Archive opens", priority: 2 }
  ], 5));
  return { harness, prompts };
}

describe("five-core policy ablation", () => {
  it("runs two immediate headless turns with verified tool grounding and neutral cancellation", async () => {
    const promptObservations: string[][] = [];
    const harness = new FiveCoreHarness(async function* ({ prompt, rounds }) {
      if (!rounds.length) {
        promptObservations.push(prompt.observations.map(input => input.content));
        expect(prompt.developer).toEqual(["Tool read_symbol: Look up a symbol in the task index"]);
        yield { kind: "tool", id: "lookup", name: "read_symbol", input: prompt.observations[0]?.content };
      } else {
        const result = rounds[0]?.receipts[0]?.result;
        yield { kind: "delta", text: result?.status === "verified" ? String(result.value) : "Lookup failed" };
      }
    });
    const symbols = new Map([["dispatch", "src/main.ts:12"], ["parse", "src/parser.ts:7"]]);
    const toolpack: ExtensionPackageDefinition = {
      id: "toolpack.coding", displayName: "Coding", version: "1", permissions, facets: [agentToolProviderFacet.id],
      activate(scope) {
        scope.contributeFacet(agentToolProviderFacet, { tools: [{
          name: "read_symbol", description: "Look up a symbol in the task index",
          execute(call) {
            const value = typeof call.input === "string" ? symbols.get(call.input) : undefined;
            return value ? { status: "verified", value } : { status: "failed", error: "Symbol not found" };
          }
        }] });
      }
    };
    harness.extensions.mount(channel("channel.cli", "cli", "cli"));
    harness.extensions.mount(toolpack);
    expect(harness.extensions.listPackages().map(pkg => pkg.id)).toEqual(["channel.cli", "toolpack.coding"]);
    expect(harness.cognition.dynamics.evolveTo(0)).toEqual({});
    expect(harness.cognition.dynamics.solveNextWakeupMs(0)).toBeNull();
    const first = await harness.ingestEvent(event("cli", "dispatch", 0));
    const second = await harness.ingestEvent(event("cli", "parse", 150));
    expect(first.turns).toMatchObject([{ executedAtMs: 0, agent: { goalVerification: "verified" },
      attention: { selectedChannelId: "cli", focus: { lockedUntilMs: 0 } },
      delivery: { delivered: true, delivery: { channelId: "cli", text: "src/main.ts:12" } } }]);
    expect(second.turns).toMatchObject([{ executedAtMs: 150, agent: { goalVerification: "verified" },
      delivery: { delivered: true, delivery: { channelId: "cli", text: "src/parser.ts:7" } } }]);
    const retracted = await harness.ingestEvent(event("cli", "discard", 200, { lifecycle: "retract" }));
    expect(retracted).toEqual({ observations: [], turns: [],
      cancellation: { kind: "neutral_retract", lifecycle: "retract", cancelled: true, channelId: "cli" } });
    expect(promptObservations).toEqual([["dispatch"], ["parse"]]);
  });

  it("coalesces chat, evolves state, budgets recursive lore and negotiates focus and gaze", async () => {
    const { harness, prompts } = companionProfile();
    expect((await harness.ingestEvent(event("webchat", "show atlas", 0))).turns).toEqual([]);
    expect((await harness.ingestEvent(event("webchat", "nearby", 400))).turns).toEqual([]);
    expect(await harness.advanceTime(1599)).toEqual([]);
    expect(prompts).toEqual([]);
    const batch = await harness.advanceTime(1600);
    expect(batch).toMatchObject([{ executedAtMs: 1600, observation: { text: "show atlas\nnearby" },
      attention: { selectedChannelId: "webchat", focus: { lockedUntilMs: 6600 } },
      delivery: { delivered: true, delivery: { channelId: "webchat", text: "I am listening." } } }]);
    const webDelivery = batch[0]?.delivery;
    expect(webDelivery?.delivered && webDelivery.delivery.metadata?.gaze_lead_ms).toBeUndefined();
    expect(prompts[0]?.developer).toEqual([expect.stringMatching(/^Homeostasis /), "Atlas maps stations", "Relay sleeps"]);
    const dynamics = harness.cognition.dynamics;
    const initial = dynamics.evolveTo(1600);
    expect(Object.keys(initial)).toEqual(["instant_valence", "instant_arousal", "circadian_energy", "drive_social_longing"]);
    expect(dynamics.solveNextWakeupMs(1600)).toBe(2600);
    const evolved = dynamics.evolveTo(2600);
    expect(evolved.instant_valence).toBeCloseTo(Math.tanh(0.5), 14);
    for (const name of Object.keys(initial)) expect(evolved[name]).not.toBe(initial[name]);
    expect(dynamics.solveNextWakeupMs(2600)).toBeNull();

    const firstDesktop = await harness.ingestEvent(event("desktop-stage", "hum", 2600, { lifecycle: "ambient", modality: "audio" }));
    expect(firstDesktop.turns).toMatchObject([{ attention: { selectedChannelId: "webchat", focusSwitched: false } }]);
    const urgent = await harness.ingestEvent(event("desktop-stage", "alert", 2700,
      { lifecycle: "ambient", urgent: true, salience: 1 }));
    expect(urgent.turns).toMatchObject([{ attention: { selectedChannelId: "desktop-stage", focusSwitched: true },
      delivery: { delivered: true, delivery: { metadata: { gaze_lead_ms: 180 } } } }]);
    const retract = await harness.ingestEvent(event("webchat", "draft", 7700, { lifecycle: "retract" }));
    expect(retract.turns).toMatchObject([{ attention: { selectedChannelId: "webchat", focusSwitched: true },
      observation: { text: "[观察：对方欲言又止撤回了输入]" } }]);
    const noise = (now: number, text = "hum", salience = 0) =>
      harness.ingestEvent(event("desktop-stage", text, now, { lifecycle: "ambient", modality: "audio", salience }));
    expect((await noise(7800)).turns).toHaveLength(1);
    expect((await noise(7801)).turns).toHaveLength(0);
    expect((await noise(7802, "fan")).turns).toHaveLength(1);
    expect((await noise(7803, "hum", 1)).turns).toHaveLength(1);
  });

  it("hot-ablates buffering and homeostasis on the same running cores", async () => {
    const { harness, prompts } = companionProfile();
    expect((await harness.ingestEvent(event("webchat", "atlas", 0))).turns).toHaveLength(0);
    expect(await harness.advanceTime(1200)).toHaveLength(1);
    expect(harness.cognition.dynamics.evolveTo(1200)).toHaveProperty("instant_valence");
    expect((await harness.ingestEvent(event("webchat", "pending fragment", 1300))).turns).toHaveLength(0);

    harness.extensions.disable("builtin.conversational-gate");
    harness.extensions.unmount("builtin.companion-homeostasis");
    expect(harness.cognition.dynamics.evolveTo(1300)).toEqual({});
    expect(harness.cognition.dynamics.solveNextWakeupMs(1300)).toBeNull();
    const direct = await harness.ingestEvent(event("desktop-stage", "atlas", 1400, { urgent: true }));
    expect(direct.turns).toMatchObject([{ executedAtMs: 1400, observation: { text: "atlas" },
      attention: { selectedChannelId: "desktop-stage", focusSwitched: true },
      delivery: { delivered: true, delivery: { metadata: { gaze_lead_ms: 180 } } } }]);
    expect(prompts[1]?.developer).toEqual(["Atlas maps stations", "Relay sleeps"]);
    const retract = await harness.ingestEvent(event("webchat", "draft", 1500, { lifecycle: "retract" }));
    expect(retract).toEqual({ observations: [], turns: [],
      cancellation: { kind: "neutral_retract", lifecycle: "retract", cancelled: true, channelId: "webchat" } });
    expect(await harness.advanceTime(3000)).toEqual([]);
    expect(prompts).toHaveLength(2);
    expect(harness.channels.listChannels().map(item => item.channelId)).toEqual(["webchat", "desktop-stage"]);
  });
});
