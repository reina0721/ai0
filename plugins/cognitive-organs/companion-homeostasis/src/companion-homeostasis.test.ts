import { describe, expect, it } from "vitest";
import {
  COMPANION_HOMEOSTASIS_DESCRIPTORS,
  companionResponseContract,
  computeMonotonicDriveIntegral,
  computeSecondOrderCoupledAffect,
  solveNextWakeupTimestamp
} from "./index.js";

describe("companion-homeostasis plugin", () => {
  it("computes second-order coupled affect ODE and exact inverse drive wakeup timestamps", () => {
    const t0 = 1_800_000_000_000;
    expect(COMPANION_HOMEOSTASIS_DESCRIPTORS).toHaveLength(7);

    const atZero = computeSecondOrderCoupledAffect({
      v_instant_0: 0.8,
      v_mood_0: 0.4,
      v_base: 0.1,
      effective_elapsed_ms: 0
    });
    expect(atZero.instant_valence).toBeCloseTo(0.8, 10);
    expect(atZero.mood_baseline_val).toBeCloseTo(0.4, 10);

    const after24h = computeSecondOrderCoupledAffect({
      v_instant_0: 0.8,
      v_mood_0: 0.4,
      v_base: 0.1,
      effective_elapsed_ms: 24 * 3_600_000
    });
    expect(after24h.mood_baseline_val).toBeLessThan(0.4);
    expect(after24h.mood_baseline_val).toBeGreaterThan(0.1);
    expect(after24h.instant_valence).toBeCloseTo(after24h.mood_baseline_val, 2);

    const wake = solveNextWakeupTimestamp({
      t0_ms: t0,
      d_longing_0: 0.2,
      d_max: 1.0,
      theta_proactive: 0.75,
      lambda_drive_per_hour: Math.LN2 / 12
    });
    const evolved = computeMonotonicDriveIntegral({
      d0: 0.2,
      d_max: 1.0,
      lambda_drive_per_hour: Math.LN2 / 12,
      effective_elapsed_ms: wake.drive_wake_ts_ms - t0
    });
    expect(evolved).toBeGreaterThanOrEqual(0.75);
    expect(evolved).toBeCloseTo(0.75, 8);
  });

  it("parses fenced JSON responses cleanly in companionResponseContract", () => {
    const fenced = "```json\n" + JSON.stringify({
      surface_utterance: "你好呀",
      theatrical_subtext: "轻声问候",
      masked_placeholder: "",
      chosen_strategy: "greet",
      interaction_frame: "gentle_support",
      vocal_emotion_tag: "warm",
      facial_expression: "smile",
      valence_impulse: "+small"
    }) + "\n```";
    const parsed = companionResponseContract.parse(fenced);
    expect(companionResponseContract.toOutput(parsed).surface_utterance).toBe("你好呀");
    expect(companionResponseContract.stateImpulses?.(parsed, { instant_valence: 0 })).toEqual({ instant_valence: 0.1 });
  });
});
