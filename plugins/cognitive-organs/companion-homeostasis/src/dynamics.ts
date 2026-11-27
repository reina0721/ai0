import type { ContinuousStateDescriptor } from "@ai0/protocol";

export const COMPANION_HOMEOSTASIS_DESCRIPTORS: readonly ContinuousStateDescriptor[] = Object.freeze([
  { id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 30 * 60_000, wakeupThresholds: [] },
  { id: "instant_arousal", topology: "unipolar_sigmoid", baseline: 0.3, halfLifeMs: 20 * 60_000, wakeupThresholds: [] },
  { id: "mood_baseline_val", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 24 * 3_600_000, wakeupThresholds: [] },
  { id: "drive_social_longing", topology: "unipolar_sigmoid", baseline: 0.85, halfLifeMs: 12 * 3_600_000, wakeupThresholds: [0.75] },
  { id: "drive_curiosity", topology: "unipolar_sigmoid", baseline: 0.8, halfLifeMs: 18 * 3_600_000, wakeupThresholds: [0.75] },
  { id: "circadian_energy", topology: "unipolar_sigmoid", baseline: 0.85, halfLifeMs: 8 * 3_600_000, wakeupThresholds: [] },
  { id: "metabolic_energy", topology: "unipolar_sigmoid", baseline: 0.9, halfLifeMs: 12 * 3_600_000, wakeupThresholds: [0.25] }
]);

export const COMPANION_ROLE_PRESETS = Object.freeze({
  romantic_partner: {
    label: "亲密伴侣",
    emotionalSensitivity: 78,
    maxProactivePerDay: 3,
    subtextTensionIntensity: 72,
    corePersonalityPrompt: "温柔细腻、注重共情与陪伴感，尊重对方边界，绝不使用冷暴力或愧疚诱导。"
  },
  best_friend: {
    label: "日常挚友",
    emotionalSensitivity: 58,
    maxProactivePerDay: 2,
    subtextTensionIntensity: 55,
    corePersonalityPrompt: "松弛自然、真诚幽默，像多年老友一样接梗与倾听，相处毫无压力。"
  },
  vtuber_partner: {
    label: "互动搭档",
    emotionalSensitivity: 66,
    maxProactivePerDay: 2,
    subtextTensionIntensity: 84,
    corePersonalityPrompt: "节奏明快、富有表现力，在公开场合自觉保持专业社交分寸。"
  }
});

export interface CoupledAffectInput {
  v_instant_0: number;
  v_mood_0: number;
  v_base: number;
  effective_elapsed_ms: number;
  half_life_fast_ms?: number;
  half_life_slow_ms?: number;
  coupling_alpha?: number;
}

export interface CoupledAffectResult {
  instant_valence: number;
  mood_baseline_val: number;
}

function clampBipolar(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function clampUnit(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function computeSecondOrderCoupledAffect(
  input: CoupledAffectInput
): CoupledAffectResult {
  const dtHours = Math.max(0, input.effective_elapsed_ms) / 3_600_000;
  const halfFastH = (input.half_life_fast_ms ?? 30 * 60_000) / 3_600_000;
  const halfSlowH = (input.half_life_slow_ms ?? 24 * 3_600_000) / 3_600_000;
  const lambdaFast = Math.LN2 / Math.max(0.01, halfFastH);
  const lambdaSlow = Math.LN2 / Math.max(0.05, halfSlowH);
  const alpha = input.coupling_alpha ?? 0.25;

  const slowDecay = Math.exp(-lambdaSlow * dtHours);
  const fastDecay = Math.exp(-lambdaFast * dtHours);

  const denom = lambdaFast - lambdaSlow;
  const crossIntegral =
    Math.abs(denom) < 1e-6
      ? dtHours * slowDecay
      : (slowDecay - fastDecay) / denom;

  const moodVal = clampBipolar(
    input.v_base +
      (input.v_mood_0 - input.v_base) * slowDecay +
      alpha * (input.v_instant_0 - input.v_mood_0) * crossIntegral
  );

  const instantVal = clampBipolar(
    moodVal + (input.v_instant_0 - input.v_mood_0) * fastDecay
  );

  return {
    instant_valence: instantVal,
    mood_baseline_val: moodVal
  };
}

export function computeMonotonicDriveIntegral(params: {
  d0: number;
  d_max: number;
  lambda_drive_per_hour: number;
  effective_elapsed_ms: number;
}): number {
  const dtHours = Math.max(0, params.effective_elapsed_ms) / 3_600_000;
  const dMax = clampUnit(params.d_max);
  const d0 = Math.min(dMax, clampUnit(params.d0));
  const decay = Math.exp(-Math.max(1e-6, params.lambda_drive_per_hour) * dtHours);
  return clampUnit(dMax - (dMax - d0) * decay);
}

export function solveNextWakeupTimestamp(params: {
  t0_ms: number;
  d_longing_0: number;
  d_max: number;
  theta_proactive: number;
  lambda_drive_per_hour: number;
  circadian_anchor_ts_ms?: number;
  promised_followup_ts_ms?: number;
}): {
  next_wakeup_virtual_ts_ms: number;
  drive_wake_ts_ms: number;
  reason: "drive_threshold" | "circadian_anchor" | "promised_followup";
} {
  const dMax = clampUnit(params.d_max);
  const theta = Math.min(dMax - 1e-6, clampUnit(params.theta_proactive));
  const d0 = clampUnit(params.d_longing_0);
  const lambda = Math.max(1e-6, params.lambda_drive_per_hour);

  let driveWakeTs = params.t0_ms;
  if (d0 < theta) {
    const ratio = (dMax - d0) / Math.max(1e-9, dMax - theta);
    const deltaHours = Math.log(Math.max(1, ratio)) / lambda;
    driveWakeTs = Math.ceil(params.t0_ms + deltaHours * 3_600_000);
  }

  let bestTs = driveWakeTs;
  let reason: "drive_threshold" | "circadian_anchor" | "promised_followup" = "drive_threshold";

  if (params.circadian_anchor_ts_ms !== undefined && params.circadian_anchor_ts_ms < bestTs) {
    bestTs = params.circadian_anchor_ts_ms;
    reason = "circadian_anchor";
  }
  if (params.promised_followup_ts_ms !== undefined && params.promised_followup_ts_ms < bestTs) {
    bestTs = params.promised_followup_ts_ms;
    reason = "promised_followup";
  }

  return {
    next_wakeup_virtual_ts_ms: bestTs,
    drive_wake_ts_ms: driveWakeTs,
    reason
  };
}
