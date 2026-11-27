import type { AudienceScope } from "@ai0/protocol";
import type { SensoryCoverage as Coverage } from "./sensory.js";

export interface ContextEntry {
  audienceScope: AudienceScope;
  payload: unknown;
  coverage?: Coverage;
  observedAtMs?: number;
  freshnessTtlMs?: number;
}
type CoverageLock = { coverage: "blind" | "disconnected"; reason: string };

export class ScopedContextRegistry {
  private readonly buckets = new Map<string, ContextEntry[]>();
  private readonly locks = new Map<string, CoverageLock>();
  private readonly history: { sourceKey: string; entry: ContextEntry }[] = [];

  constructor(private readonly historyLimit = 400) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) throw new RangeError("Invalid history limit");
  }

  update(sourceKey: string, mode: "replace-self" | "append-self", entry: ContextEntry) {
    const snapshot = structuredClone(entry);
    const { coverage, observedAtMs, freshnessTtlMs } = snapshot;
    if (coverage && !["blind", "disconnected", "stale"].includes(coverage)
      && (observedAtMs === undefined || !Number.isFinite(observedAtMs)
        || freshnessTtlMs === undefined || !Number.isFinite(freshnessTtlMs) || freshnessTtlMs < 0)) {
      throw new Error("Coverage requires a finite freshness window");
    }
    this.buckets.set(sourceKey, mode === "replace-self"
      ? [snapshot] : [...(this.buckets.get(sourceKey) ?? []), snapshot]);
    this.history.push({ sourceKey, entry: snapshot });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  lockBlindness(sourceKey: string, reason: string) {
    this.locks.set(sourceKey, { coverage: "blind", reason });
  }

  disconnect(sourceKey: string) {
    this.locks.set(sourceKey, { coverage: "disconnected", reason: "writer_disconnected" });
  }

  readmit(sourceKey: string) {
    this.buckets.delete(sourceKey);
    this.locks.delete(sourceKey);
  }

  removeWriter(sourceKey: string) {
    this.buckets.delete(sourceKey);
  }

  contextHistory(audience: AudienceScope) {
    return structuredClone(this.history.filter(({ sourceKey, entry }) => !this.locks.has(sourceKey) && (entry.audienceScope === audience || entry.audienceScope === "public_all")));
  }

  snapshotForAudience(audience: AudienceScope, nowMs: number) {
    if (!Number.isFinite(nowMs)) throw new RangeError("Invalid snapshot time");
    return structuredClone([...this.buckets].flatMap(([sourceKey, entries]) =>
      entries.filter(entry => (entry.audienceScope === audience || entry.audienceScope === "public_all")).map(entry => {
        const lock = this.locks.get(sourceKey);
        const expired = entry.observedAtMs !== undefined && entry.freshnessTtlMs !== undefined
          && (nowMs < entry.observedAtMs || nowMs - entry.observedAtMs > entry.freshnessTtlMs);
        const coverage = lock?.coverage ?? (expired && entry.coverage !== "blind" && entry.coverage !== "disconnected"
          ? "stale" : entry.coverage);
        const unavailable = coverage === "blind" || coverage === "disconnected" || coverage === "stale";
        return { ...entry, sourceKey, coverage, payload: unavailable ? undefined : entry.payload, reason: lock?.reason };
      })
    ));
  }
}

export interface ReflexSignal {
  streamId: string;
  regimeChanged?: boolean;
  critical?: boolean;
}
export interface ReflexRule<S> {
  id: string;
  matches(signal: S): boolean;
  execute(signal: S): void;
}

export class ReflexGate<S extends ReflexSignal> {
  private readonly suppressed = new Map<string, number>();

  constructor(private readonly rules: readonly ReflexRule<S>[] = []) {}

  evaluate(signal: S) {
    const count = this.suppressed.get(signal.streamId) ?? 0;
    const rule = signal.critical || signal.regimeChanged ? undefined : this.rules.find(entry => entry.matches(signal));
    if (rule) {
      rule.execute(signal);
      this.suppressed.set(signal.streamId, count + 1);
      return { escalateToConscious: false as const, reason: { kind: "routine", rule: rule.id },
        suppressedRoutineCount: count + 1, llmTokens: 0 };
    }
    this.suppressed.delete(signal.streamId);
    return { escalateToConscious: true as const,
      reason: { kind: signal.critical ? "critical" : signal.regimeChanged ? "regime_transition" : "novel" },
      suppressedRoutineCount: count };
  }
}
