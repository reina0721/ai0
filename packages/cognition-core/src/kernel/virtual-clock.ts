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

function assertFiniteNonNegative(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value < 0) throw new RangeError(`${name} must be non-negative.`);
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}
