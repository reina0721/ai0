import type { AudienceScope, UniversalObservationFrame } from "@ai0/protocol";

export interface PerceptionClockPort { nowMs(): number; effectiveElapsedMs?(fromMs: number, toMs?: number): number }

export function computeSensoryHabituation(sRaw: number, unchangedElapsedMs: number,
  gammaHabPerMinute = 0.35): number {
  return sRaw * Math.exp(-gammaHabPerMinute * Math.max(0, unchangedElapsedMs) / 60_000);
}

export type SensoryCoverage = UniversalObservationFrame["channel"]["sensorCoverage"];
export interface CompetingHypothesis { text: string; confidence: number }
export interface SensoryCoverageBucket {
  channel_id: string; modality: string; source_key: string; coverage: SensoryCoverage;
  summary_text: string; frame_span_ms: number; freshness_ttl_ms: number;
  audience_scope?: AudienceScope; updated_at_virtual_ts: number; static_frame_motion_lock: boolean;
  competing_hypotheses: CompetingHypothesis[]; anti_hallucination_lock?: string;
}
export type SensoryCoverageUpdate = Omit<SensoryCoverageBucket,
  "static_frame_motion_lock" | "anti_hallucination_lock"> & { perception_confidence?: number; authorized?: boolean };
export interface SensoryCoverageUpdateResult {
  bucket: Readonly<SensoryCoverageBucket>;
  predictive_coding_revision?: { previous_hypothesis: string; actual_summary: string };
  predictive_coding_revision_directive?: string;
}
const scopedKey = (channel: string, modality: string, source: string): string =>
  JSON.stringify([channel, modality, source]);

export class SensoryCoverageBucketManager {
  private readonly blind = new Map<string, string>();
  private readonly buckets = new Map<string, SensoryCoverageBucket>();
  constructor(private readonly clock: PerceptionClockPort) {}
  upsert(update: SensoryCoverageUpdate, formatRevisionDirective?: (actual: string) => string): SensoryCoverageUpdateResult {
    const key = scopedKey(update.channel_id, update.modality, update.source_key);
    const age = this.clock.nowMs() - update.updated_at_virtual_ts;
    if (update.authorized && age >= 0 && age <= update.freshness_ttl_ms && !["blind", "stale", "disconnected"].includes(update.coverage)) this.blind.delete(key);
    const previous = this.buckets.get(key);
    const contradicted = update.perception_confidence !== undefined && update.perception_confidence >= 0.8
      ? previous?.competing_hypotheses.find((h) =>
          h.confidence < 0.5 && h.text.trim() !== update.summary_text.trim()) : undefined;
    const fields = { ...update };
    delete fields.perception_confidence;
    delete fields.authorized;
    const bucket: SensoryCoverageBucket = { ...fields,
      competing_hypotheses: [...update.competing_hypotheses],
      static_frame_motion_lock: update.frame_span_ms === 0 };
    this.buckets.set(key, bucket);
    const refreshed = this.refresh(bucket);
    if (!contradicted || ["blind", "stale", "disconnected"].includes(refreshed.coverage)) return { bucket: refreshed };
    return {
      bucket: refreshed,
      predictive_coding_revision: { previous_hypothesis: contradicted.text, actual_summary: update.summary_text },
      ...(formatRevisionDirective && { predictive_coding_revision_directive: formatRevisionDirective(update.summary_text) })
    };
  }
  get(channel: string, modality: string, source: string): Readonly<SensoryCoverageBucket> | undefined {
    const bucket = this.buckets.get(scopedKey(channel, modality, source));
    return bucket && this.refresh(bucket);
  }
  lockBlindness(channel: string, modality: string, source: string, reason: string): void {
    this.blind.set(scopedKey(channel, modality, source), reason);
  }
  list(audience?: AudienceScope): ReadonlyArray<Readonly<SensoryCoverageBucket>> {
    return [...this.buckets.values()].filter(bucket => audience === undefined || bucket.audience_scope === "public_all" || bucket.audience_scope === audience).map(bucket => this.refresh(bucket));
  }
  private refresh(bucket: SensoryCoverageBucket): SensoryCoverageBucket {
    const blind = this.blind.get(scopedKey(bucket.channel_id, bucket.modality, bucket.source_key));
    const age = this.clock.nowMs() - bucket.updated_at_virtual_ts;
    const coverage = blind !== undefined ? "blind" :
      bucket.coverage !== "disconnected" && bucket.coverage !== "blind" && (age < 0 || age > bucket.freshness_ttl_ms) ? "stale" : bucket.coverage;
    if (coverage === "blind" || coverage === "disconnected" || coverage === "stale") {
      return { ...bucket, coverage, summary_text: "", competing_hypotheses: [],
        anti_hallucination_lock: coverage === "blind" ? "sensor_blind: " + (blind ?? "permission unavailable") : "sensory_source_" + coverage };
    }
    return structuredClone(bucket);
  }
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
    const key = scopedKey(signal.channel_id, signal.modality, signal.source_key);
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

export type InputLifecycle = "activity" | "interim" | "commit" | "retract";
export interface DebounceInputEvent {
  frame?: UniversalObservationFrame; lifecycle: InputLifecycle; text?: string; virtual_ts_ms?: number;
}
export interface DebounceBatch {
  frames: UniversalObservationFrame[]; text: string; debounce_merged_events: number; first_virtual_ts_ms: number;
  last_virtual_ts_ms: number; retracted_observation?: string;
}
export class TurnDebounceAggregator {
  private pending: DebounceBatch | null = null;
  private draft = "";
  constructor(private readonly clock: PerceptionClockPort, readonly debounceWindowMs = 0,
    private readonly formatRetractedObservation?: () => string | undefined) {}
  ingest(event: DebounceInputEvent, useConfiguredPolicy = true): DebounceBatch | null {
    const now = event.virtual_ts_ms ?? this.clock.nowMs();
    if (event.lifecycle === "retract") {
      this.draft = "";
      this.pending = null;
      const observation = useConfiguredPolicy ? this.formatRetractedObservation?.() : undefined;
      return observation === undefined ? null : { frames: [], text: "", debounce_merged_events: 0,
        first_virtual_ts_ms: now, last_virtual_ts_ms: now, retracted_observation: observation };
    }
    if (event.lifecycle !== "commit") {
      if (event.text !== undefined) this.draft = event.text;
      return null;
    }
    const text = (event.text ?? this.draft).trim(); this.draft = "";
    if (!text && !event.frame) return null;
    if (useConfiguredPolicy && this.debounceWindowMs > 0 && this.pending && now - this.pending.last_virtual_ts_ms <= this.debounceWindowMs) {
      if (event.frame) this.pending.frames.push(structuredClone(event.frame));
      this.pending.text = `${this.pending.text}\n${text}`;
      this.pending.last_virtual_ts_ms = now;
      this.pending.debounce_merged_events += 1;
    } else this.pending = { frames: event.frame ? [structuredClone(event.frame)] : [], text, debounce_merged_events: 1,
      first_virtual_ts_ms: now, last_virtual_ts_ms: now };
    return structuredClone(this.pending);
  }
  flush(): DebounceBatch | null {
    const result = this.pending && { ...this.pending }; this.pending = null; return result;
  }
}
