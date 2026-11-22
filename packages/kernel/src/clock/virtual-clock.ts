export type TargetInstance = "live" | `sandbox:${string}`;

export class LiveInstanceClockTamperForbiddenError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("The virtual clock of a live instance cannot be advanced manually.");
    this.name = "LiveInstanceClockTamperForbiddenError";
  }
}

export interface HibernationInterval {
  start_ts_ms: number;
  end_ts_ms: number;
  gap_ms: number;
}

export interface IVirtualClock {
  readonly targetInstance: TargetInstance;
  nowMs(): number;
  effectiveElapsedMs(fromVirtualTsMs: number, toVirtualTsMs?: number): number;
  advanceBy(durationMs: number, mode?: "active_unattended" | "hibernation"): number;
  recordBootAndDetectHibernation(lastAliveHeartbeatTsMs: number | null,
    bootTsMs?: number): HibernationInterval | null;
  getHibernationIntervals(): ReadonlyArray<HibernationInterval>;
}

const HIBERNATION_THRESHOLD_MS = 5 * 60 * 1000;
const HOUR_MS = 3_600_000;
const DEFAULT_DRIVE_MAX = 1;
const DEFAULT_DRIVE_LAMBDA_PER_HOUR = Math.LN2 / 12;
const DEFAULT_PROACTIVE_THRESHOLD = 0.75;

export interface VirtualClockOptions {
  targetInstance: TargetInstance;
  initialVirtualTsMs?: number;
  wallNowMs?: () => number;
}

/** The sole kernel boundary at which physical wall time is admitted. */
export class VirtualClock implements IVirtualClock {
  readonly targetInstance: TargetInstance;
  private virtualTsMs: number;
  private readonly wallNowMs: () => number;
  private readonly hibernationIntervals: HibernationInterval[] = [];

  constructor(options: VirtualClockOptions) {
    this.targetInstance = options.targetInstance;
    this.wallNowMs = options.wallNowMs ?? (() => Date.now());
    this.virtualTsMs = options.initialVirtualTsMs ?? this.wallNowMs();
  }

  nowMs(): number {
    return this.targetInstance === "live" ? this.wallNowMs() : this.virtualTsMs;
  }

  effectiveElapsedMs(fromVirtualTsMs: number, toVirtualTsMs = this.nowMs()): number {
    if (toVirtualTsMs <= fromVirtualTsMs) return 0;
    const overlaps = this.hibernationIntervals
      .map(({ start_ts_ms, end_ts_ms }) => ({
        start: Math.max(fromVirtualTsMs, start_ts_ms),
        end: Math.min(toVirtualTsMs, end_ts_ms),
      }))
      .filter(({ start, end }) => end > start)
      .sort((a, b) => a.start - b.start);
    let deductedMs = 0;
    let coveredEnd = fromVirtualTsMs;
    for (const overlap of overlaps) {
      const start = Math.max(overlap.start, coveredEnd);
      if (overlap.end > start) deductedMs += overlap.end - start;
      coveredEnd = Math.max(coveredEnd, overlap.end);
    }
    return Math.max(0, toVirtualTsMs - fromVirtualTsMs - deductedMs);
  }

  advanceBy(durationMs: number,
    mode: "active_unattended" | "hibernation" = "active_unattended"): number {
    if (this.targetInstance === "live") {
      throw new LiveInstanceClockTamperForbiddenError();
    }
    assertFiniteNonNegative(durationMs, "durationMs");
    const start = this.virtualTsMs;
    this.virtualTsMs += durationMs;
    if (mode === "hibernation" && durationMs > 0) {
      this.recordHibernation(start, this.virtualTsMs);
    }
    return this.virtualTsMs;
  }

  recordBootAndDetectHibernation(lastAliveHeartbeatTsMs: number | null,
    bootTsMs = this.nowMs()): HibernationInterval | null {
    if (lastAliveHeartbeatTsMs === null) return null;
    assertFiniteNumber(lastAliveHeartbeatTsMs, "lastAliveHeartbeatTsMs");
    assertFiniteNumber(bootTsMs, "bootTsMs");
    if (bootTsMs - lastAliveHeartbeatTsMs <= HIBERNATION_THRESHOLD_MS) return null;
    return this.recordHibernation(lastAliveHeartbeatTsMs, bootTsMs);
  }

  getHibernationIntervals(): ReadonlyArray<HibernationInterval> {
    return this.hibernationIntervals.map((interval) => ({ ...interval }));
  }

  private recordHibernation(start: number, end: number): HibernationInterval {
    const interval = { start_ts_ms: start, end_ts_ms: end, gap_ms: end - start };
    this.hibernationIntervals.push(interval);
    this.hibernationIntervals.sort((a, b) => a.start_ts_ms - b.start_ts_ms);
    return { ...interval };
  }
}

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

export function computeSensoryHabituation(sRaw: number, unchangedElapsedMs: number,
  gammaHabPerMinute = 0.35): number {
  return sRaw * Math.exp(-gammaHabPerMinute * Math.max(0, unchangedElapsedMs) / 60_000);
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
  assertFiniteNonNegative(elapsedMs, "effective_elapsed_ms");
  return elapsedMs / HOUR_MS;
}

function assertFiniteNonNegative(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative.`);
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}
