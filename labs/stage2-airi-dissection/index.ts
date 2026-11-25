export type AudienceScope = "only_owner" | "public_all";
export type Coverage = "live_foveal" | "peripheral" | "on_demand" | "blind" | "disconnected" | "stale";
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
    return structuredClone(this.history.filter(({ entry }) => audience === "only_owner" || entry.audienceScope === "public_all"));
  }

  snapshotForAudience(audience: AudienceScope, nowMs: number) {
    if (!Number.isFinite(nowMs)) throw new RangeError("Invalid snapshot time");
    return structuredClone([...this.buckets].flatMap(([sourceKey, entries]) =>
      entries.filter(entry => audience === "only_owner" || entry.audienceScope === "public_all").map(entry => {
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

export interface ModuleSelection { provider?: string; model?: string; voice_id?: string }
type ModuleKey = "consciousness" | "vision" | "speech";
export type HostModuleDefaults = Readonly<Record<ModuleKey, Readonly<ModuleSelection>>>;
export interface CardData {
  name: string;
  extensions?: Record<string, unknown>;
  [field: string]: unknown;
}
type CardDocument = { spec: "chara_card_v3"; data: CardData; [field: string]: unknown };
export type CardInput = CardDocument | { data: CardData; modules?: Partial<Record<ModuleKey, ModuleSelection>> };

function readSelection(value: unknown): ModuleSelection {
  if (typeof value !== "object" || !value) return {};
  const fields = value as Record<string, unknown>;
  return {
    provider: typeof fields.provider === "string" ? fields.provider.trim() : undefined,
    model: typeof fields.model === "string" ? fields.model.trim() : undefined,
    voice_id: typeof fields.voice_id === "string" ? fields.voice_id.trim() : undefined
  };
}

function moduleOverride(card: CardInput, key: ModuleKey) {
  if (!("spec" in card) && card.modules?.[key]) return readSelection(card.modules[key]);
  const ns = card.data.extensions?.airi;
  if (typeof ns !== "object" || !ns || !("modules" in ns)) return {};
  const { modules } = ns;
  return typeof modules === "object" && modules ? readSelection((modules as Record<string, unknown>)[key]) : {};
}

function resolveSelection(key: ModuleKey, override: ModuleSelection, fallback: ModuleSelection) {
  const inherit = key === "speech" && override.provider === "speech-noop";
  const provider = (inherit ? undefined : override.provider) || fallback.provider;
  const model = (inherit ? undefined : override.model) || (provider === fallback.provider ? fallback.model : undefined);
  if (key !== "speech") return { provider, model };
  return { provider, model, voice_id: (inherit ? undefined : override.voice_id)
    || (provider === fallback.provider && model === fallback.model ? fallback.voice_id : undefined) };
}

export class CharacterCardResolver {
  private readonly cards = new Map<string, CardInput>();

  get size() { return this.cards.size; }

  register(id: string, card: CardInput) {
    if (this.cards.has(id) || !id) throw new Error("Invalid or duplicate card id");
    if ("spec" in card && card.spec !== "chara_card_v3") throw new Error("Unsupported card spec");
    this.cards.set(id, structuredClone(card));
  }

  export(id: string): CardDocument {
    const card = this.get(id);
    return "spec" in card ? structuredClone(card) : { spec: "chara_card_v3", spec_version: "3.0",
      data: structuredClone(card.data) };
  }

  resolve(id: string, defaults: HostModuleDefaults): HostModuleDefaults {
    const card = this.get(id);
    return {
      consciousness: resolveSelection("consciousness", moduleOverride(card, "consciousness"), defaults.consciousness),
      vision: resolveSelection("vision", moduleOverride(card, "vision"), defaults.vision),
      speech: resolveSelection("speech", moduleOverride(card, "speech"), defaults.speech)
    };
  }

  private get(id: string) {
    const card = this.cards.get(id);
    if (!card) throw new Error("Unknown card");
    return card;
  }
}
