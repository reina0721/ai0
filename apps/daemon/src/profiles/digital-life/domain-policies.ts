import type { PerceptionClockPort } from "@ai0/perception-core";
import type { HomeostasisAffectState, ReadOnlyCognitiveSnapshot } from "./state.js";
import type { HypothesisRevisionPolicy, ObservationSourceDefaults } from "@ai0/perception-core";
import type { ContinuousStateDescriptor } from "@ai0/protocol";

export const digitalLifeHypothesisRevision: HypothesisRevisionPolicy = (update, hypotheses) =>
  update.perception_confidence !== undefined && update.perception_confidence >= 0.8
    ? hypotheses.find(hypothesis => hypothesis.confidence < 0.5 && hypothesis.text.trim() !== update.summary_text.trim())
    : undefined;

export const liveObservationDefaults: Readonly<ObservationSourceDefaults> = {
  coverage: "live_foveal", freshnessTtlMs: 1200
};

export const COMPANION_HOMEOSTASIS_DESCRIPTORS: readonly ContinuousStateDescriptor[] = [
  { id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 3_600_000, wakeupThresholds: [] },
  { id: "instant_arousal", topology: "unipolar_sigmoid", baseline: 0.35, halfLifeMs: 3_600_000, wakeupThresholds: [] },
  { id: "mood_baseline_val", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 43_200_000, wakeupThresholds: [] },
  ...["circadian_energy", "metabolic_energy", "drive_social_longing", "drive_curiosity"].map(id => ({
    id, topology: "unipolar_sigmoid" as const, baseline: 0.5, halfLifeMs: 43_200_000, wakeupThresholds: []
  }))
];

const HOUR_MS = 3_600_000;
const DEFAULT_DRIVE_MAX = 1;
const DEFAULT_DRIVE_LAMBDA_PER_HOUR = Math.LN2 / 12;
const DEFAULT_PROACTIVE_THRESHOLD = 0.75;

export function computeSecondOrderCoupledAffect(params: {
  v_instant_0: number; v_mood_0: number; v_base: number;
  lambda_emo_per_hour?: number; lambda_mood_per_hour?: number;
  effective_elapsed_ms: number;
}): { instant_valence: number; mood_baseline_val: number } {
  const lambdaMood = params.lambda_mood_per_hour ?? Math.LN2 / 12;
  const lambdaEmo = params.lambda_emo_per_hour ?? Math.LN2 / (20 / 60);
  const hours = elapsedHours(params.effective_elapsed_ms);
  const moodDelta = params.v_mood_0 - params.v_base;
  const moodDecay = Math.exp(-lambdaMood * hours);
  const emoDecay = Math.exp(-lambdaEmo * hours);
  const mood = params.v_base + moodDelta * moodDecay;
  let instant: number;
  if (Math.abs(lambdaEmo - lambdaMood) <= Number.EPSILON * 16) {
    instant = mood + (params.v_instant_0 - params.v_mood_0) * emoDecay +
      lambdaMood * moodDelta * hours * moodDecay;
  } else {
    const kappa = lambdaMood * moodDelta / (lambdaEmo - lambdaMood);
    instant = mood +
      (params.v_instant_0 - params.v_mood_0 - kappa) * emoDecay +
      kappa * moodDecay;
  }
  return { instant_valence: instant, mood_baseline_val: mood };
}

export function computeMonotonicDriveIntegral(params: {
  d0: number; d_max?: number; lambda_drive_per_hour?: number;
  effective_elapsed_ms: number;
}): number {
  const maximum = params.d_max ?? DEFAULT_DRIVE_MAX;
  const lambda = params.lambda_drive_per_hour ?? DEFAULT_DRIVE_LAMBDA_PER_HOUR;
  return maximum - (maximum - params.d0) *
    Math.exp(-lambda * elapsedHours(params.effective_elapsed_ms));
}



export function solveNextWakeupTimestamp(params: {
  t0_ms: number; d_longing_0: number; d_max?: number;
  theta_proactive?: number; lambda_drive_per_hour?: number;
  sleep_dirty_window_ts_ms?: number | null;
  next_commitment_due_ts_ms?: number | null;
}): {
  next_wakeup_ts_ms: number; drive_wake_ts_ms: number;
  trigger_reason: "proactive_drive" | "sleep_consolidation" | "commitment_due";
} {
  const maximum = params.d_max ?? DEFAULT_DRIVE_MAX;
  const threshold = params.theta_proactive ?? DEFAULT_PROACTIVE_THRESHOLD;
  const lambda = params.lambda_drive_per_hour ?? DEFAULT_DRIVE_LAMBDA_PER_HOUR;
  let crossingHours = 0;
  if (params.d_longing_0 < threshold) {
    const ratio = (maximum - threshold) / (maximum - params.d_longing_0);
    crossingHours = ratio > 0 && lambda > 0 ? -Math.log(ratio) / lambda : Infinity;
  }
  const driveWake = params.t0_ms + crossingHours * HOUR_MS;
  const candidates: Array<{ ts: number; reason:
    "proactive_drive" | "sleep_consolidation" | "commitment_due" }> = [
    { ts: driveWake, reason: "proactive_drive" },
  ];
  if (params.sleep_dirty_window_ts_ms != null) {
    candidates.push({ ts: params.sleep_dirty_window_ts_ms, reason: "sleep_consolidation" });
  }
  if (params.next_commitment_due_ts_ms != null) {
    candidates.push({ ts: params.next_commitment_due_ts_ms, reason: "commitment_due" });
  }
  const selected = candidates.reduce((earliest, item) => item.ts < earliest.ts ? item : earliest);
  return { next_wakeup_ts_ms: selected.ts, drive_wake_ts_ms: driveWake,
    trigger_reason: selected.reason };
}

function elapsedHours(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError("Invalid elapsed time");
  return elapsedMs / HOUR_MS;
}


/** Import v1 keys at the checkpoint boundary; only mounted descriptors may consume them. */
export function migrateLegacyAffect(previous?: HomeostasisAffectState): ReadOnlyCognitiveSnapshot["D2_CONTINUOUS_STATES"] {
  const values: Record<string, number> = {};
  for (const { id } of COMPANION_HOMEOSTASIS_DESCRIPTORS) {
    const value = previous?.[id as keyof HomeostasisAffectState];
    if (typeof value === "number" && Number.isFinite(value)) values[id] = value;
  }
  const attributions: ReadOnlyCognitiveSnapshot["D2_CONTINUOUS_STATES"]["attributions"] = {};
  if (previous?.mood_attribution) attributions.instant_valence = { text: previous.mood_attribution,
    audienceScope: previous.mood_attr_scope === "public_all" ? "public_all" : "only_owner", sourceEventIds: [] };
  return { values, attributions };
}

/** A legacy product view for rendering. Never persisted into authoritative state. */
export function projectDigitalLifeAffect(snapshot: Pick<ReadOnlyCognitiveSnapshot, "D2_CONTINUOUS_STATES">): HomeostasisAffectState {
  const { values, attributions } = snapshot.D2_CONTINUOUS_STATES;
  return { instant_valence: values.instant_valence ?? 0, instant_arousal: values.instant_arousal ?? 0,
    mood_baseline_val: values.mood_baseline_val ?? 0, metabolic_energy: values.metabolic_energy ?? 1,
    circadian_energy: values.circadian_energy ?? 1, drive_curiosity: values.drive_curiosity ?? .5,
    drive_social_longing: values.drive_social_longing ?? .5,
    mood_attribution: attributions.instant_valence?.text ?? null, mood_attr_scope: attributions.instant_valence?.audienceScope ?? "only_owner" };
}

export function computeSensoryHabituation(sRaw: number, unchangedElapsedMs: number,
  gammaHabPerMinute = 0.35): number {
  return sRaw * Math.exp(-gammaHabPerMinute * Math.max(0, unchangedElapsedMs) / 60_000);
}


export interface EphemeralBiometricEntry {
  channel_id: string; modality: string; source_key: string; summary_text: string;
  virtual_ts_ms: number; value?: unknown;
}
export class EphemeralBiometricWindow {
  static readonly WINDOW_MS = 15 * 60 * 1000;
  private readonly entries: EphemeralBiometricEntry[] = [];
  constructor(private readonly clock: PerceptionClockPort) {}
  add(entry: Omit<EphemeralBiometricEntry, "virtual_ts_ms"> & { virtual_ts_ms?: number }): void {
    this.prune();
    this.entries.push({ ...entry, virtual_ts_ms: entry.virtual_ts_ms ?? this.clock.nowMs() });
  }
  list(): ReadonlyArray<Readonly<EphemeralBiometricEntry>> {
    this.prune(); return [...this.entries];
  }
  prune(): void {
    const cutoff = this.clock.nowMs() - EphemeralBiometricWindow.WINDOW_MS;
    while (this.entries[0] !== undefined && this.entries[0].virtual_ts_ms < cutoff) this.entries.shift();
  }
}

export interface ThalamicSignal {
  channel_id: string; modality: string; source_key: string; summary_text: string;
  raw_salience: number; confidence: number; sustained_ms: number;
  persistence_hint?: "ephemeral_blackboard" | "durable"; value?: unknown;
}
export interface ThalamicSalienceResult {
  effective_salience: number; unchanged_elapsed_ms: number; wake_w1: boolean;
  route: "w1" | "ephemeral_blackboard" | "filtered";
}
export class ThalamicSalienceGate {
  private readonly unchanged = new Map<string, { summary: string; since: number }>();
  readonly ephemeralWindow: EphemeralBiometricWindow;
  constructor(private readonly clock: PerceptionClockPort) {
    this.ephemeralWindow = new EphemeralBiometricWindow(clock);
  }
  evaluate(signal: ThalamicSignal, minConfidence = 0.6,
    minSustainedMs = 500): ThalamicSalienceResult {
    const now = this.clock.nowMs();
    const key = JSON.stringify([signal.channel_id, signal.modality, signal.source_key]);
    const prior = this.unchanged.get(key);
    const since = prior?.summary === signal.summary_text ? prior.since : now;
    this.unchanged.set(key, { summary: signal.summary_text, since });
    const unchanged_elapsed_ms = Math.max(0, now - since);
    const effective_salience = computeSensoryHabituation(signal.raw_salience, unchanged_elapsed_ms);
    const weak = signal.confidence < minConfidence || signal.sustained_ms < minSustainedMs;
    if (weak && signal.persistence_hint === "ephemeral_blackboard")
      this.ephemeralWindow.add({ ...signal, virtual_ts_ms: now });
    return { effective_salience, unchanged_elapsed_ms, wake_w1: !weak,
      route: !weak ? "w1" : signal.persistence_hint === "ephemeral_blackboard"
        ? "ephemeral_blackboard" : "filtered" };
  }
}
export const evaluateThalamicSalience = (gate: ThalamicSalienceGate, signal: ThalamicSignal,
  options: { minConfidence?: number; minSustainedMs?: number } = {}): ThalamicSalienceResult =>
  gate.evaluate(signal, options.minConfidence ?? 0.6, options.minSustainedMs ?? 500);

