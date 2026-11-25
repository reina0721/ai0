import { expect, it, vi } from "vitest";
import { ChronoceptiveSignalSynthesizer, EmbodimentAffordanceRegistry, GroundingReceiptTracker,
  RealizerVocabularyNegotiator, runObservationTurn, TurnLifecycleGate } from "./index.js";
import type { UniversalObservationFrame } from "./index.js";

const frame: UniversalObservationFrame = {
  channel: { modality: "voice", shellId: "mic", sensorCoverage: "live_foveal" },
  attribution: { subjectAnchor: "speaker", principalId: "owner" },
  contextFrame: { socialFrame: "conversation", audienceScope: "only_owner" },
  provenance: { epistemicTier: "untrusted_utterance", trustedGrant: true },
  interpretation: { rawPayload: "hello", primaryCue: "utterance" },
  chronology: { observedAtMs: 90, freshnessTtlMs: 100, turnId: "1", revision: 2 }
};

it("extends activity, cancels revised keys, reuses a finished warmup, and retracts without leaking drafts", async () => {
  const observed: AbortSignal[] = [];
  const warmup = vi.fn(async (draft: string, signal: AbortSignal) => { observed.push(signal); return draft.trim(); });
  const gate = new TurnLifecycleGate(50, (value: string) => value.trim(), warmup);
  expect(gate.interim("draft", 10)).toBe(60);
  await vi.waitFor(() => expect(warmup).toHaveBeenCalledTimes(1));
  expect(gate.interim("draft ", 20)).toBe(70);
  expect(observed[0]?.aborted).toBe(false);
  gate.interim("hello", 30);
  expect(observed[0]?.aborted).toBe(true);
  await vi.waitFor(() => expect(warmup).toHaveBeenCalledTimes(2));
  expect(gate.commit("hello ", frame)).toEqual({ frame, speculative: "hello" });
  gate.interim("private draft", 100);
  expect(gate.retract(125)).toEqual({ kind: "unspoken_hesitation", durationMs: 25 });
  expect(gate.retract(130)).toBeNull();
});

it("projects the frame to the frozen agent data channel", async () => {
  const turn = await runObservationTurn({
    inputs: [{ role: "system_invariant", content: "Policy" }],
    signal: new AbortController().signal,
    executeTool: async () => ({ status: "failed", error: "Unexpected tool" }),
    async *model({ prompt }) {
      expect(prompt.system).toEqual(["Policy"]);
      expect(prompt.observations).toEqual([{ content: JSON.stringify(frame) }]);
      yield { kind: "delta", text: "Hello." };
    }
  }, [frame]);
  expect(turn.rounds[0]?.text).toBe("Hello.");
});

it("subtracts the union of clipped hibernation intervals", () => {
  const hour = 3_600_000;
  const clock = new ChronoceptiveSignalSynthesizer(hour);
  clock.recordHibernation({ startMs: 2 * hour, endMs: 3.5 * hour });
  clock.recordHibernation({ startMs: 3 * hour, endMs: 4 * hour });
  expect(clock.synthesize(9 * hour)).toMatchObject({ description: "6 hours unattended" });
  clock.interact(4 * hour);
  expect(clock.unattendedMs(9 * hour)).toBe(5 * hour);
});

it("negotiates only declared, connected, audience-compatible and quiet capabilities", () => {
  const registry = new EmbodimentAffordanceRegistry();
  registry.mount({ id: "text", connected: true, anchors: [], sensors: {}, audienceScope: "only_owner",
    actuators: [{ token: "render_text", kind: "verbal", quiet: true, semanticAction: "communicate" }] });
  registry.mount({ id: "robot", connected: true, anchors: ["crown_pressure"], sensors: { vision: "blind" },
    audienceScope: "only_owner", actuators: [{ token: "pulse", kind: "nonverbal", quiet: true, semanticAction: "notify" }] });
  registry.mount({ id: "lamp", connected: true, anchors: [], sensors: {}, audienceScope: "public_all",
    actuators: [{ token: "flash", kind: "nonverbal", quiet: true, semanticAction: "notify" }] });
  const realizer = new RealizerVocabularyNegotiator(registry);
  const envelope = { intent: "actuate", actuationHint: { semanticAction: "notify" },
    deliveryConstraints: { audienceScope: "only_owner", requireNonVerbalQuiet: true } } as const;
  expect(registry.coverage("robot", "vision")).toBe("blind");
  expect(realizer.vocabulary().map(entry => entry.token)).toEqual(["render_text", "pulse", "flash"]);
  for (const token of ["user_eyes", "blush_level"]) {
    expect(realizer.negotiate(envelope, token).disposition).toBe("held_pending_compliant_shell");
  }
  expect(realizer.negotiate(envelope)).toMatchObject({ disposition: "bound", selection: { token: "pulse" } });
  registry.disconnect("robot");
  expect(realizer.negotiate(envelope).disposition).toBe("held_pending_compliant_shell");
});

it("keeps physical stop separate from durable acknowledgement and transport uncertainty", async () => {
  const tracker = new GroundingReceiptTracker([{ text: "First. ", endsAtMs: 100 }, { text: "Second.", endsAtMs: 200 }]);
  const playback = { eventId: "interrupt", presentedThroughMs: 100 };
  const stopped = tracker.interrupt(playback.eventId, playback);
  const recorded = vi.fn();
  void stopped.done.then(recorded);
  expect(await stopped.silenced).toEqual(playback);
  expect(recorded).not.toHaveBeenCalled();
  expect(tracker.interrupt(playback.eventId, null)).toBe(stopped);
  tracker.acknowledge(playback.eventId);
  expect(await stopped.done).toMatchObject({ presentedText: "First. ", unsaidRemainder: "Second.",
    groundingStatus: "interrupted_partial" });
  const dropped = tracker.interrupt("drop", null);
  expect(await dropped.silenced).toBeNull();
  expect(dropped.receipt).toMatchObject({ presentedText: "First. ", unsaidRemainder: null, groundingStatus: "unknown" });
});
