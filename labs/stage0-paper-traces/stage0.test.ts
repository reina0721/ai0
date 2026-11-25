import { describe, expect, it } from "vitest";
import { advanceDelivery, advanceDeployment, bindShell, deploymentStatus, freshDeployment, verifyDeployment, verifyGrounding } from "./index.js";
import type { GroundingLedger, MountedShell } from "./index.js";

function generated(): GroundingLedger {
  return { generated: { clauses: ["Sentence 1. ", "Sentence 2."], commands: ["pulse"] },
    presented: {}, actuated: [], acknowledged: [], pending: [], uncertain: [],
    activeShell: "voice", userGrounded: "unpresented" };
}

const cat = { id: "cat", assetAnchors: ["cat_ear_left", "cat_ear_right"] };
const hands = { id: "hands", assetAnchors: ["hand_left", "hand_right"] };
const soul = { id: "soul", originCardId: cat.id, episodes: ["first conversation"] };
const text: MountedShell = { id: "text", soulId: soul.id, cardId: cat.id, fixedAnchors: [],
  supportsCardAsset: false, sensors: {}, actuators: ["text"] };
const pet = { ...text, id: "pet", supportsCardAsset: true, actuators: ["avatar"] };
const robot = { ...text, id: "robot", fixedAnchors: ["crown_pressure"],
  sensors: { vision: "blind", pressure: "live_foveal" }, actuators: ["posture", "haptic"] };

describe("paper traces", () => {
  it("carries only the exact unsaid suffix from voice to text", () => {
    let trace = advanceDelivery(generated(), { kind: "dispatch", index: 0 });
    trace = advanceDelivery(trace, { kind: "present", index: 0, shell: "voice" });
    trace = advanceDelivery(trace, { kind: "dispatch", index: 1 });
    trace = advanceDelivery(trace, { kind: "interrupt" });
    expect(trace).toMatchObject({ activeShell: "voice", pending: [], uncertain: [] });
    trace = advanceDelivery(trace, { kind: "actuate", id: "pulse" });
    trace = advanceDelivery(trace, { kind: "switch", id: "text" });
    expect(trace).toMatchObject({ activeShell: "text", pending: [], uncertain: [] });
    expect(trace.actuated).toEqual(["pulse"]);
    expect(trace.acknowledged).toEqual([]);
    expect(verifyGrounding(trace)).toEqual({ presentedPrefix: "Sentence 1. ", unsaidRemainder: "Sentence 2.", userGrounded: "partial" });
    expect(() => advanceDelivery(trace, { kind: "dispatch", index: 0 })).toThrow();
    trace = advanceDelivery(trace, { kind: "dispatch", index: 1 });
    trace = advanceDelivery(trace, { kind: "present", index: 1, shell: "text" });
    trace = advanceDelivery(trace, { kind: "ground", index: 1 });
    expect(trace).toMatchObject({ presented: { 0: "voice", 1: "text" }, acknowledged: [1], pending: [], uncertain: [] });
    expect(verifyGrounding(trace)).toEqual({
      presentedPrefix: "Sentence 1. Sentence 2.", unsaidRemainder: "", userGrounded: "partial"
    });
  });

  it("retains unresolved delivery on transport drop", () => {
    const pending = advanceDelivery(generated(), { kind: "dispatch", index: 0 });
    const dropped = advanceDelivery(pending, { kind: "drop" });
    expect(dropped.uncertain).toEqual([0]);
    expect(verifyGrounding(dropped)).toMatchObject({ unsaidRemainder: null, userGrounded: "unknown" });
    expect(() => verifyGrounding({ ...dropped, userGrounded: "grounded" })).toThrow();
    expect(() => verifyGrounding({ ...dropped, uncertain: [] })).toThrow();
  });

  it("rebinds a continuous identity across three shells and invalidates old asset anchors", () => {
    const bindings = [text, pet, robot].map(shell => bindShell(shell, cat, soul));
    expect(bindings.map(binding => binding.anchors)).toEqual([[], cat.assetAnchors, ["crown_pressure"]]);
    expect(bindings.map(binding => binding.soul)).toEqual([soul, soul, soul]);
    expect(bindings[2]).toMatchObject({ sensors: { vision: "blind" }, actuators: ["posture", "haptic"] });
    expect(bindShell({ ...pet, cardId: hands.id }, hands, soul).anchors).toEqual(hands.assetAnchors);
  });

  it("starts blank, enforces L0–L5, records suspension, and demotes safely", () => {
    const fresh = freshDeployment();
    const statuses = [deploymentStatus(fresh)];
    expect(fresh).toMatchObject({ cards: [], souls: [], shells: [], host: { verifiedProviders: [] } });
    expect(verifyDeployment(fresh)).toBe("L0");
    expect(() => advanceDeployment(fresh, { kind: "awaken", id: cat.id })).toThrow();
    let state = advanceDeployment(fresh, { kind: "claim", id: "owner" });
    expect(verifyDeployment(state)).toBe("L1");
    statuses.push(deploymentStatus(state));
    state = advanceDeployment(state, { kind: "verify_provider", id: "provider" });
    expect(verifyDeployment(state)).toBe("L2");
    statuses.push(deploymentStatus(state));
    expect(() => advanceDeployment(state, { kind: "mount", shell: text })).toThrow();
    state = advanceDeployment(state, { kind: "import_card", card: cat });
    state = advanceDeployment(state, { kind: "awaken", id: cat.id });
    expect(verifyDeployment(state)).toBe("L3");
    statuses.push(deploymentStatus(state));
    state = advanceDeployment(state, { kind: "mount", shell: { ...text, soulId: cat.id } });
    expect(verifyDeployment(state)).toBe("L4");
    statuses.push(deploymentStatus(state));
    state = advanceDeployment(state, { kind: "hibernate", nowMs: 20 });
    expect(verifyDeployment(state)).toBe("L5");
    statuses.push(deploymentStatus(state));
    expect(state.shells).toHaveLength(1);
    state = advanceDeployment(state, { kind: "resume", nowMs: 40 });
    expect(verifyDeployment(state)).toBe("L4");
    statuses.push(deploymentStatus(state));
    expect(statuses).toEqual([
      "UNCLAIMED", "CLAIMED_NO_PROVIDER", "PROVIDER_READY_NO_SOUL", "SOUL_AWAKENED_NO_SHELL",
      "LIVE_READY", "HIBERNATING", "LIVE_READY"
    ]);
    expect(state.hibernation).toEqual([{ startMs: 20, endMs: 40 }]);
    state = advanceDeployment(state, { kind: "unmount", id: text.id });
    expect(verifyDeployment(state)).toBe("L3");
    state = advanceDeployment(state, { kind: "hibernate", nowMs: 50 });
    state = advanceDeployment(state, { kind: "resume", nowMs: 60 });
    expect(verifyDeployment(state)).toBe("L3");
    state = advanceDeployment(state, { kind: "revoke_providers", nowMs: 70 });
    expect(verifyDeployment(state)).toBe("L1");
    expect(state.souls).toHaveLength(1);
  });
});
