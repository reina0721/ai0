import { computeSensoryHabituation, type IVirtualClock } from "../clock/virtual-clock.js";

export type SensoryCoverage = "live_foveal" | "ambient_peripheral" | "stale" | "disconnected";
export interface CompetingHypothesis { text: string; confidence: number }
export interface SensoryCoverageBucket {
  shell_id: string; modality: string; source_key: string; coverage: SensoryCoverage;
  summary_text: string; frame_span_ms: number; freshness_ttl_ms: number;
  updated_at_virtual_ts: number; static_frame_motion_lock: boolean;
  competing_hypotheses: CompetingHypothesis[]; anti_hallucination_lock?: string;
}
export type SensoryCoverageUpdate = Omit<SensoryCoverageBucket,
  "static_frame_motion_lock" | "anti_hallucination_lock"> & { perception_confidence?: number };
export interface SensoryCoverageUpdateResult {
  bucket: Readonly<SensoryCoverageBucket>; predictive_coding_revision_directive?: string;
}
const scopedKey = (shell: string, modality: string, source: string): string =>
  `${shell}::${modality}::${source}`;

export class SensoryCoverageBucketManager {
  private readonly buckets = new Map<string, SensoryCoverageBucket>();
  constructor(private readonly clock: IVirtualClock) {}
  upsert(update: SensoryCoverageUpdate): SensoryCoverageUpdateResult {
    const key = scopedKey(update.shell_id, update.modality, update.source_key);
    const previous = this.buckets.get(key);
    const contradicted = update.perception_confidence !== undefined && update.perception_confidence >= 0.8
      ? previous?.competing_hypotheses.find((h) =>
          h.confidence < 0.5 && h.text.trim() !== update.summary_text.trim()) : undefined;
    const fields = { ...update };
    delete fields.perception_confidence;
    const bucket: SensoryCoverageBucket = { ...fields,
      competing_hypotheses: [...update.competing_hypotheses],
      static_frame_motion_lock: update.frame_span_ms === 0 };
    this.buckets.set(key, bucket);
    return { bucket: this.refresh(bucket), ...(contradicted && {
      predictive_coding_revision_directive:
        `[感知纠错：刚才看走眼/听岔了，实际是 ${update.summary_text}]` }) };
  }
  get(shell: string, modality: string, source: string): Readonly<SensoryCoverageBucket> | undefined {
    const bucket = this.buckets.get(scopedKey(shell, modality, source));
    return bucket && this.refresh(bucket);
  }
  list(): ReadonlyArray<Readonly<SensoryCoverageBucket>> {
    return [...this.buckets.values()].map((bucket) => this.refresh(bucket));
  }
  private refresh(bucket: SensoryCoverageBucket): SensoryCoverageBucket {
    if (this.clock.nowMs() - bucket.updated_at_virtual_ts > bucket.freshness_ttl_ms) {
      bucket.coverage = "stale";
      bucket.anti_hallucination_lock =
        "sensory_source_stale: do not infer current motion, state, or presence";
    }
    return bucket;
  }
}

export interface EphemeralBiometricEntry {
  shell_id: string; modality: string; source_key: string; summary_text: string;
  virtual_ts_ms: number; value?: unknown;
}
export class EphemeralBiometricWindow {
  static readonly WINDOW_MS = 15 * 60 * 1000;
  private readonly entries: EphemeralBiometricEntry[] = [];
  constructor(private readonly clock: IVirtualClock) {}
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
  shell_id: string; modality: string; source_key: string; summary_text: string;
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
  constructor(private readonly clock: IVirtualClock) {
    this.ephemeralWindow = new EphemeralBiometricWindow(clock);
  }
  evaluate(signal: ThalamicSignal, minConfidence = 0.6,
    minSustainedMs = 500): ThalamicSalienceResult {
    const now = this.clock.nowMs();
    const key = scopedKey(signal.shell_id, signal.modality, signal.source_key);
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
  lifecycle: InputLifecycle; text?: string; virtual_ts_ms?: number;
}
export interface DebounceBatch {
  text: string; debounce_merged_events: number; first_virtual_ts_ms: number;
  last_virtual_ts_ms: number; retracted_observation?: string;
}
export class TurnDebounceAggregator {
  private pending: DebounceBatch | null = null;
  private draft = "";
  constructor(private readonly clock: IVirtualClock, readonly debounceWindowMs = 1200) {}
  ingest(event: DebounceInputEvent): DebounceBatch | null {
    const now = event.virtual_ts_ms ?? this.clock.nowMs();
    if (event.lifecycle === "retract") {
      this.pending = null; this.draft = "";
      return { text: "", debounce_merged_events: 0, first_virtual_ts_ms: now,
        last_virtual_ts_ms: now,
        retracted_observation: "[观察：对方刚才似乎想说什么（打字良久、欲言又止），但最终删掉了]" };
    }
    if (event.lifecycle !== "commit") {
      if (event.text !== undefined) this.draft = event.text;
      return null;
    }
    const text = (event.text ?? this.draft).trim(); this.draft = "";
    if (!text) return null;
    if (this.pending && now - this.pending.last_virtual_ts_ms <= this.debounceWindowMs) {
      this.pending.text = `${this.pending.text}\n${text}`;
      this.pending.last_virtual_ts_ms = now;
      this.pending.debounce_merged_events += 1;
    } else this.pending = { text, debounce_merged_events: 1,
      first_virtual_ts_ms: now, last_virtual_ts_ms: now };
    return { ...this.pending };
  }
  flush(): DebounceBatch | null {
    const result = this.pending && { ...this.pending }; this.pending = null; return result;
  }
}

export type OpportunityLifecycle = "candidate" | "eligible" | "selected" |
  "consumed" | "expired" | "withdrawn";
export interface InteractionOpportunity {
  id: string; lifecycle: OpportunityLifecycle; expires_virtual_ts: number;
  topic_key?: string; payload?: unknown;
}
const terminal = (state: OpportunityLifecycle): boolean =>
  state === "consumed" || state === "expired" || state === "withdrawn";
export class InteractionOpportunityPool {
  private readonly items = new Map<string, InteractionOpportunity>();
  constructor(private readonly clock: IVirtualClock, readonly capacity = 64) {}
  add(opportunity: InteractionOpportunity): boolean {
    this.expireStale();
    if (!this.items.has(opportunity.id) && this.active().length >= this.capacity) return false;
    this.items.set(opportunity.id, { ...opportunity }); return true;
  }
  transition(id: string, lifecycle: OpportunityLifecycle): Readonly<InteractionOpportunity> | undefined {
    this.expireStale(); const item = this.items.get(id);
    if (!item || terminal(item.lifecycle)) return undefined;
    item.lifecycle = lifecycle; return item;
  }
  select(id: string): Readonly<InteractionOpportunity> | undefined {
    return this.transition(id, "selected");
  }
  consume(id: string): Readonly<InteractionOpportunity> | undefined {
    return this.transition(id, "consumed");
  }
  list(): ReadonlyArray<Readonly<InteractionOpportunity>> {
    this.expireStale(); return [...this.items.values()];
  }
  withdrawOnTopicShift(activeTopic?: string): number {
    return this.withdraw((item) => item.topic_key !== activeTopic);
  }
  withdrawForL0Crisis(): number { return this.withdraw(() => true); }
  expireStale(): number {
    const now = this.clock.nowMs(); let count = 0;
    for (const item of this.items.values())
      if (!terminal(item.lifecycle) && now >= item.expires_virtual_ts) {
        item.lifecycle = "expired"; count += 1;
      }
    return count;
  }
  private active(): InteractionOpportunity[] {
    return [...this.items.values()].filter((item) => !terminal(item.lifecycle));
  }
  private withdraw(predicate: (item: InteractionOpportunity) => boolean): number {
    this.expireStale(); let count = 0;
    for (const item of this.active()) if (predicate(item)) {
      item.lifecycle = "withdrawn"; count += 1;
    }
    return count;
  }
}
