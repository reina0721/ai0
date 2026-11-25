import { expect, it, vi } from "vitest";
import { CharacterCardResolver, ReflexGate, ScopedContextRegistry } from "./index.js";
import type { HostModuleDefaults, ReflexSignal } from "./index.js";

it("isolates writer buckets and audiences, bounds history, and removes stale payloads", () => {
  const registry = new ScopedContextRegistry(3);
  const payload = { cue: "private" };
  registry.update("cam", "replace-self", { audienceScope: "only_owner", payload,
    coverage: "live_foveal", observedAtMs: 10, freshnessTtlMs: 10 });
  payload.cue = "mutated";
  registry.update("text", "append-self", { audienceScope: "public_all", payload: "one" });
  registry.update("text", "append-self", { audienceScope: "public_all", payload: "two" });
  expect(registry.snapshotForAudience("public_all", 20).map(entry => entry.payload)).toEqual(["one", "two"]);
  expect(registry.snapshotForAudience("only_owner", 20)[0]?.payload).toEqual({ cue: "private" });
  expect(registry.snapshotForAudience("only_owner", 21)[0]).toMatchObject({ coverage: "stale", payload: undefined });
  registry.lockBlindness("cam", "grant revoked");
  expect(registry.snapshotForAudience("only_owner", 20)[0]).toMatchObject({ coverage: "blind", reason: "grant revoked" });
  registry.disconnect("cam");
  expect(registry.snapshotForAudience("only_owner", 20)[0]).toMatchObject({ coverage: "disconnected", payload: undefined });
  registry.update("text", "replace-self", { audienceScope: "public_all", payload: "latest" });
  registry.removeWriter("cam");
  expect(registry.snapshotForAudience("only_owner", 20).map(entry => entry.payload)).toEqual(["latest"]);
  expect(registry.contextHistory("only_owner")).toHaveLength(3);
});

it("runs routine reflexes locally and escalates critical and regime transitions", () => {
  const execute = vi.fn();
  const gate = new ReflexGate<ReflexSignal & { delta: number; active: boolean }>([
    { id: "deadband", matches: signal => signal.active && Math.abs(signal.delta) < 3, execute }
  ]);
  const routine = { streamId: "x", delta: -1, active: true };
  expect(gate.evaluate(routine)).toMatchObject({ escalateToConscious: false, llmTokens: 0 });
  expect(gate.evaluate({ ...routine, critical: true })).toMatchObject({
    escalateToConscious: true, reason: { kind: "critical" }, suppressedRoutineCount: 1
  });
  expect(gate.evaluate({ ...routine, regimeChanged: true }).reason.kind).toBe("regime_transition");
  expect(gate.evaluate({ ...routine, active: false }).reason.kind).toBe("novel");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("preserves unknown card data and resolves provider/model/voice inheritance without mutating defaults", () => {
  const registry = new CharacterCardResolver();
  const defaults: HostModuleDefaults = Object.freeze({
    consciousness: Object.freeze({ provider: "host", model: "chat" }), vision: Object.freeze({}),
    speech: Object.freeze({ provider: "tts", model: "voice-model", voice_id: "voice" })
  });
  const card = { spec: "chara_card_v3" as const, spec_version: "3.0", data: { name: "Card", extensions: {
    editor: { nested: [1, { title: "keep" }] }, airi: { modules: {
      consciousness: { provider: "custom", model: "" }, speech: { provider: "speech-noop" }
    } }
  } } };
  expect(registry.size).toBe(0);
  registry.register("card", card);
  expect(registry.export("card")).toEqual(card);
  card.data.extensions.editor.nested.push(4);
  expect(registry.export("card").data.extensions?.editor).toEqual({ nested: [1, { title: "keep" }] });
  expect(registry.resolve("card", defaults)).toMatchObject({
    consciousness: { provider: "custom", model: undefined }, speech: defaults.speech
  });
  registry.register("second", { data: { name: "Second" }, modules: { speech: { model: "other" } } });
  expect(registry.resolve("second", defaults).speech).toEqual({ provider: "tts", model: "other", voice_id: undefined });
  expect(defaults.speech.voice_id).toBe("voice");
});
