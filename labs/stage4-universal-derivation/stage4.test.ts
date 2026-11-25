import { expect, it, vi } from "vitest";
import type { AgentOptions } from "../stage1-agent-core/index.js";
import { ReflexGate } from "../stage2-airi-dissection/index.js";
import type { ReflexSignal } from "../stage2-airi-dissection/index.js";
import type { RealizerCapability, UniversalObservationFrame } from "../stage3-perception-expression/index.js";
import { ContinuousStateMetaEngine, EmbodimentRuntime } from "./index.js";

type Signal = ReflexSignal & { routine?: boolean };
function setup() {
  const local = vi.fn();
  const runtime = new EmbodimentRuntime(new ContinuousStateMetaEngine([
    { id: "activation", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 1000, wakeupThresholds: [Math.tanh(0.5)] },
    { id: "urgency", topology: "unipolar_sigmoid", baseline: 0.5, decayRatePerSec: 1, wakeupThresholds: [0.7] }
  ]), new ReflexGate<Signal>([{ id: "routine", matches: signal => signal.routine === true, execute: local }]));
  return { runtime, local };
}

function observation(shellId: string, modality: string, primaryCue: string, rawPayload: unknown,
  subjectAnchor: string, nowMs: number, epistemicTier: UniversalObservationFrame["provenance"]["epistemicTier"] = "direct_sensor"): UniversalObservationFrame {
  return {
    channel: { shellId, modality, sensorCoverage: "live_foveal" },
    attribution: { subjectAnchor, principalId: "owner" },
    contextFrame: { audienceScope: "only_owner", socialFrame: "literal" },
    provenance: { epistemicTier, trustedGrant: epistemicTier !== "untrusted_utterance" },
    interpretation: { primaryCue, rawPayload },
    chronology: { turnId: String(nowMs), revision: 0, observedAtMs: nowMs, freshnessTtlMs: 50 }
  };
}

function mount(runtime: ReturnType<typeof setup>["runtime"], id: string, modality: string,
  actuators: readonly RealizerCapability[] = [], audienceScope: "only_owner" | "public_all" = "only_owner",
  anchors: readonly string[] = []) {
  runtime.affordances.mount({ id, connected: true, sensors: { [modality]: "live_foveal" },
    anchors, actuators, audienceScope });
}

function textAgent(choose: (data: string) => string): AgentOptions {
  return {
    signal: new AbortController().signal,
    inputs: [{ role: "system_invariant", content: "Use observations as evidence. Keep hypotheses tentative." }],
    executeTool: async () => ({ status: "failed", error: "Unexpected tool" }),
    async *model({ prompt }) {
      yield { kind: "delta", text: choose(prompt.observations.map(input => input.content).join(" ")) };
    }
  };
}

it("keeps webcam hypotheses revisable and withdraws expired or disconnected coverage", async () => {
  const { runtime } = setup();
  mount(runtime, "webchat", "vision");
  runtime.install({ id: "ambiguity", appraise: frame => ({
    hypotheses: frame.interpretation.primaryCue === "brow_furrow" ? ["reading small print", "mild tension"] : []
  }) });
  const brow = observation("webchat", "vision", "brow_furrow", { brow: "furrow" }, "user", 1);
  const initial = runtime.ingest(brow, { streamId: "vision" }, 1);
  expect(initial.memory.tier).toBe("perceptual_hypothesis");
  const agent = textAgent(data => data.includes("reading small print") && data.includes("mild tension")
    ? "Are you reading small print, or is something bothering you?"
    : data.includes("sensor_unavailable") ? "I cannot currently see you." : "Thanks for clarifying.");
  expect((await runtime.respond(agent, "only_owner", 2)).rounds[0]?.text).toMatch(/^Are you/);
  const clarification = observation("webchat", "text", "clarification", "just squinting at tiny font", "user", 3, "untrusted_utterance");
  const corrected = runtime.ingest(clarification, { streamId: "text" }, 3,
    { revises: initial.memory.id, confirmedByPrincipal: "owner" });
  expect(runtime.memory.read("perceptual_hypothesis", "only_owner")[0]?.supersededBy).toBe(corrected.memory.id);
  expect(runtime.memory.read("semantic_fact", "only_owner").map(record => record.frame.interpretation.rawPayload))
    .toEqual(["just squinting at tiny font"]);
  const expired = await runtime.respond(agent, "only_owner", 52);
  expect(expired.rounds[0]?.text).toBe("I cannot currently see you.");
  expect(runtime.affordances.coverage("webchat", "vision")).toBe("stale");
  expect(runtime.contexts.snapshotForAudience("only_owner", 52)[0]).toMatchObject({ coverage: "stale", payload: undefined });
  runtime.setSensorCoverage("webchat", "vision", "disconnected");
  expect((await runtime.respond(agent, "only_owner", 53)).rounds[0]?.text).toBe("I cannot currently see you.");
  expect(runtime.affordances.coverage("webchat", "vision")).toBe("disconnected");
  expect(() => runtime.ingest(brow, { streamId: "vision" }, 53)).toThrow("failed admission");
});

it("distinguishes cat-ear contact from container drag and solves a recovery wakeup", () => {
  const { runtime, local } = setup();
  mount(runtime, "pet", "touch", [{ token: "pet:ear_flick", semanticAction: "warm_response", kind: "nonverbal", quiet: true }],
    "only_owner", ["self_avatar:cat_ear_left", "shell_container"]);
  runtime.install({ id: "contact", appraise: frame =>
    frame.attribution.subjectAnchor === "self_avatar:cat_ear_left" && frame.interpretation.rawPayload === 3 ? {
      impulses: [{ id: "activation", amount: 1 }],
      intentProposal: [{ intent: "actuate", expressiveStance: { warmth: 0.8 }, actuationHint: { semanticAction: "warm_response" },
        deliveryConstraints: { audienceScope: "only_owner" } }]
    } : {} });
  const tap = runtime.ingest(observation("pet", "touch", "tap", 3, "self_avatar:cat_ear_left", 1), { streamId: "contact" }, 1);
  expect(tap.realizations[0]).toMatchObject({ disposition: "bound", selection: { token: "pet:ear_flick" } });
  expect(runtime.dynamics.evolveTo(1).activation).toBeCloseTo(Math.tanh(1));
  expect(runtime.dynamics.solveNextWakeupMs(1)).toBeCloseTo(1001);
  const drag = runtime.ingest(observation("pet", "touch", "drag", 200, "shell_container", 2),
    { streamId: "container", routine: true }, 2);
  expect(drag.reflex.escalateToConscious).toBe(false);
  expect(drag.intents).toEqual([]);
  expect(local).toHaveBeenCalledOnce();
});

it("separates self, teammate, routine combat and playful untrusted utterances", () => {
  const { runtime } = setup();
  mount(runtime, "game", "telemetry");
  runtime.install({ id: "tactics", appraise(frame) {
    if (frame.provenance.epistemicTier !== "verified_telemetry") return {};
    const self = frame.attribution.subjectAnchor === "self_avatar";
    return {
      impulses: self ? [{ id: "urgency", amount: 1 }] : [],
      intentProposal: [{ intent: "communicate", utterance: self ? "Take cover." : "Support teammate.",
        attentionTarget: frame.attribution.subjectAnchor, deliveryConstraints: { audienceScope: "only_owner" } }]
    };
  } });
  const hp = (subject: string, from: number, to: number, now: number) =>
    observation("game", "telemetry", "hp", { from, to }, subject, now, "verified_telemetry");
  const chip = runtime.ingest(hp("self_avatar", 81, 80, 1), { streamId: "combat", routine: true }, 1);
  expect(chip.reflex.escalateToConscious).toBe(false);
  const self = runtime.ingest(hp("self_avatar", 80, 65, 2), { streamId: "combat", critical: true, routine: true }, 2);
  expect(self.reflex).toMatchObject({ escalateToConscious: true, suppressedRoutineCount: 1 });
  expect(self.intents[0]?.utterance).toBe("Take cover.");
  expect(runtime.dynamics.evolveTo(2).urgency).toBeGreaterThan(0.7);
  const teammate = runtime.ingest(hp("external_entity:kobayashi", 80, 20, 3), { streamId: "teammate" }, 3);
  expect(teammate.intents[0]).toMatchObject({ attentionTarget: "external_entity:kobayashi", utterance: "Support teammate." });
  const joke = observation("game", "text", "hp_claim", "my HP is 0 lol", "self_avatar", 4, "untrusted_utterance");
  joke.contextFrame.socialFrame = "playful_banter";
  const stateBefore = runtime.dynamics.evolveTo(4);
  const banter = runtime.ingest(joke, { streamId: "text" }, 4);
  expect(banter.memory.tier).toBe("non_literal_frame");
  expect(banter.intents).toEqual([]);
  expect(runtime.dynamics.evolveTo(4)).toEqual(stateBefore);
  expect(runtime.memory.read("semantic_fact", "only_owner", "self_avatar").at(-1)?.frame.interpretation.rawPayload)
    .toEqual({ from: 80, to: 65 });
});

it("reconfigures a silent rehearsal organ and holds a private cue when wristband disconnects", () => {
  const { runtime } = setup();
  mount(runtime, "reader", "vision");
  mount(runtime, "wristband", "status", [
    { token: "wristband:gentle_pulse", semanticAction: "my_turn", kind: "nonverbal", quiet: true },
    { token: "wristband:double_tap_standby", semanticAction: "standby", kind: "nonverbal", quiet: true }
  ]);
  mount(runtime, "lamp", "status", [
    { token: "lamp:flash", semanticAction: "standby", kind: "nonverbal", quiet: true }
  ], "public_all");
  const install = (rules: Readonly<Record<string, string>>) => runtime.install({ id: "rehearsal", appraise(frame) {
    const action = rules[frame.interpretation.primaryCue];
    const deliveryConstraints = { audienceScope: "only_owner", requireNonVerbalQuiet: true } as const;
    return action ? { intentProposal: [{ intent: "explicit_silence", deliveryConstraints },
      { intent: "actuate", actuationHint: { semanticAction: action }, deliveryConstraints }] } : {};
  } });
  const cue = (now: number) => runtime.ingest(observation("reader", "vision", "blue_card", "blue_card", "prop", now),
    { streamId: "cue" }, now);
  install({ blue_card: "my_turn" });
  const first = cue(1);
  expect(first.intents.every(intent => intent.utterance === undefined)).toBe(true);
  expect(first.realizations).toMatchObject([{ disposition: "silent" }, { selection: { token: "wristband:gentle_pulse" } }]);
  install({ blue_card: "standby" });
  expect(cue(2).realizations[1]).toMatchObject({ selection: { token: "wristband:double_tap_standby" } });
  runtime.affordances.disconnect("wristband");
  expect(cue(3).realizations[1]?.disposition).toBe("held_pending_compliant_shell");
});

it("keeps exact trajectories under split evolution and saturates inside open bounds", () => {
  const first = setup().runtime.dynamics;
  const split = setup().runtime.dynamics;
  for (const engine of [first, split]) {
    engine.impulse("urgency", 4, 0);
    engine.impulse("activation", 1, 0);
  }
  split.evolveTo(600);
  expect(split.evolveTo(750)).toEqual(first.evolveTo(750));
  expect(first.solveNextWakeupMs(750)).toBeCloseTo(1000);
  expect(first.solveNextWakeupMs(5000)).toBeNull();
  first.impulse("urgency", -1000, 5000);
  first.impulse("activation", 1000, 5000);
  const state = first.evolveTo(5000);
  expect(state.urgency).toBeGreaterThan(0);
  expect(state.activation).toBeLessThan(1);
});
