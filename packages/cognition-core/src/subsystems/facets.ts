import { defineFacetPoint, type ExtensionHostView } from "@ai0/extension-core";
import {
  cognitionMemoryProviderContract,
  cognitionProposalPolicyContract,
  cognitionResponseContractPoint,
  ContinuousStateDescriptorSchema,
  type ContinuousStateDescriptor,
  type StateDomain
} from "@ai0/protocol";
import type { ReadOnlyCognitiveSnapshot, StateMutationProposal } from "./cognitive-coordinator.js";

export type ReadableCognitiveSnapshot = Partial<Omit<ReadOnlyCognitiveSnapshot, "domain_revs">> & {
  state_rev: number;
  domain_revs: Partial<ReadOnlyCognitiveSnapshot["domain_revs"]>;
};

export interface CognitionContextContributor<Snapshot = Readonly<Record<string, unknown>>> {
  priority?: number;
  contributeToBlackboard(
    snapshot: Snapshot,
    maxTokens: number,
    request?: { text: string }
  ): { slot_id: string; text: string } | null | Promise<{ slot_id: string; text: string } | null>;
}

export interface CognitionSleepOrgan {
  onTurnCompleted?(turnTrace: unknown): unknown[] | Promise<unknown[]>;
  onSleepCycleWakeup(
    snapshot: ReadableCognitiveSnapshot,
    events: readonly unknown[]
  ): StateMutationProposal[] | Promise<StateMutationProposal[]>;
}

export interface ChannelAttentionCandidate {
  channel_id: string;
  salience: number;
  preferred?: boolean;
  l0_crisis?: boolean;
}
export interface CrossChannelEvent {
  channel_id: string;
  event_type: string;
  payload?: unknown;
}
export interface EcaRule {
  when: { channel_id?: string; event_type: string };
  if?: { selected_channel_id?: string; min_salience?: number };
  then: { action: string; target_channel_id?: string };
}

export function evaluateMultiChannelAttentionAndEca(params: {
  candidates: ChannelAttentionCandidate[];
  current_channel_id: string | null;
  last_switch_ts_ms: number;
  now_ts_ms: number;
  events?: CrossChannelEvent[];
  rules?: EcaRule[];
  hysteresis_ms?: number;
}): { selected_channel_id: string | null; switched: boolean; actions: EcaRule["then"][] } {
  const ranked = [...params.candidates].sort(
    (a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || b.salience - a.salience
  );
  const crisis = ranked.filter(x => x.l0_crisis).sort((a, b) => b.salience - a.salience)[0];
  const proposed = crisis ?? ranked[0];
  const currentExists = ranked.some(x => x.channel_id === params.current_channel_id);
  const maySwitch = !!crisis || !currentExists || params.now_ts_ms - params.last_switch_ts_ms >= (params.hysteresis_ms ?? 4000);
  const selected = proposed && maySwitch ? proposed.channel_id : params.current_channel_id;
  const selectedCandidate = ranked.find(x => x.channel_id === selected);
  const actions = (params.rules ?? []).flatMap(rule =>
    (params.events ?? []).some(event =>
      event.event_type === rule.when.event_type &&
      (!rule.when.channel_id || rule.when.channel_id === event.channel_id) &&
      (!rule.if?.selected_channel_id || rule.if.selected_channel_id === selected) &&
      (rule.if?.min_salience === undefined || (selectedCandidate?.salience ?? -Infinity) >= rule.if.min_salience)
    )
      ? [{ ...rule.then }]
      : []
  );
  return { selected_channel_id: selected ?? null, switched: selected !== params.current_channel_id, actions };
}

export interface AttentionArbitratorPort {
  arbitrate: typeof evaluateMultiChannelAttentionAndEca;
}

export const cognitionProposalPolicyFacet = defineFacetPoint(cognitionProposalPolicyContract);
export const cognitionMemoryProviderFacet = defineFacetPoint(cognitionMemoryProviderContract);

export const cognitionStateDynamicsFacet = defineFacetPoint<{ descriptors: readonly ContinuousStateDescriptor[] }>({
  owner: "cognition", name: "state_dynamics", version: 1,
  parse(raw) {
    const value = raw as { descriptors?: unknown[] } | null;
    if (!Array.isArray(value?.descriptors)) throw new TypeError("Missing state descriptors");
    return { descriptors: value.descriptors.map(descriptor => ContinuousStateDescriptorSchema.parse(descriptor)) };
  }
});

export const cognitionContextContributorFacet = defineFacetPoint<CognitionContextContributor>({
  owner: "cognition", name: "context_contributor", version: 1,
  parse(raw) {
    const value = raw as CognitionContextContributor | null;
    if (typeof value?.contributeToBlackboard !== "function" ||
        (value.priority !== undefined && !Number.isFinite(value.priority))) throw new TypeError("Invalid context contributor");
    return value;
  }
});

export const cognitionResponseContractFacet = defineFacetPoint(cognitionResponseContractPoint);

export const cognitionAttentionArbitratorFacet = defineFacetPoint<AttentionArbitratorPort>({
  owner: "cognition", name: "attention_arbitrator", version: 1,
  parse(raw) {
    const value = raw as AttentionArbitratorPort | null;
    if (typeof value?.arbitrate !== "function") throw new TypeError("Invalid attention arbitrator");
    return value;
  }
});

export const cognitionSleepOrganFacet = defineFacetPoint<CognitionSleepOrgan>({
  owner: "cognition", name: "sleep_organ", version: 1,
  parse(raw) {
    const value = raw as CognitionSleepOrgan | null;
    if (typeof value?.onSleepCycleWakeup !== "function") throw new TypeError("Invalid sleep organ");
    return value;
  }
});

export function selectReadableSnapshot(
  host: ExtensionHostView,
  packageId: string,
  snapshot: ReadOnlyCognitiveSnapshot
): ReadableCognitiveSnapshot {
  const canRead = (domain: string) => host.allowsReadDomain(packageId, domain as StateDomain);
  const domain_revs = Object.fromEntries(
    Object.entries(snapshot.domain_revs).filter(([domain]) => canRead(domain))
  ) as Partial<ReadOnlyCognitiveSnapshot["domain_revs"]>;
  const domains = Object.entries(snapshot).filter(([domain]) => canRead(domain));
  return structuredClone({ ...Object.fromEntries(domains), state_rev: snapshot.state_rev, domain_revs });
}

export function computeSensoryHabituation(sRaw: number, unchangedElapsedMs: number, gammaHabPerMinute = 0.35): number {
  return sRaw * Math.exp((-gammaHabPerMinute * Math.max(0, unchangedElapsedMs)) / 60_000);
}

export interface EphemeralBiometricEntry {
  channel_id: string;
  modality: string;
  source_key: string;
  summary_text: string;
  virtual_ts_ms: number;
  value?: unknown;
}

export class EphemeralBiometricWindow {
  static readonly WINDOW_MS = 15 * 60 * 1000;
  private readonly entries: EphemeralBiometricEntry[] = [];
  constructor(private readonly clock: { nowMs(): number }) {}
  add(entry: Omit<EphemeralBiometricEntry, "virtual_ts_ms"> & { virtual_ts_ms?: number }): void {
    this.prune();
    this.entries.push({ ...entry, virtual_ts_ms: entry.virtual_ts_ms ?? this.clock.nowMs() });
  }
  list(): ReadonlyArray<Readonly<EphemeralBiometricEntry>> {
    this.prune();
    return [...this.entries];
  }
  prune(): void {
    const cutoff = this.clock.nowMs() - EphemeralBiometricWindow.WINDOW_MS;
    while (this.entries[0] !== undefined && this.entries[0].virtual_ts_ms < cutoff) this.entries.shift();
  }
}

export interface ThalamicSignal {
  channel_id: string;
  modality: string;
  source_key: string;
  summary_text: string;
  raw_salience: number;
  confidence: number;
  sustained_ms: number;
  persistence_hint?: "ephemeral_blackboard" | "durable";
  value?: unknown;
}

export interface ThalamicSalienceResult {
  effective_salience: number;
  unchanged_elapsed_ms: number;
  wake_w1: boolean;
  route: "w1" | "ephemeral_blackboard" | "filtered";
}

export class ThalamicSalienceGate {
  private readonly unchanged = new Map<string, { summary: string; since: number }>();
  readonly ephemeralWindow: EphemeralBiometricWindow;
  constructor(private readonly clock: { nowMs(): number }) {
    this.ephemeralWindow = new EphemeralBiometricWindow(clock);
  }
  evaluate(signal: ThalamicSignal, minConfidence = 0.6, minSustainedMs = 500): ThalamicSalienceResult {
    const now = this.clock.nowMs();
    const key = JSON.stringify([signal.channel_id, signal.modality, signal.source_key]);
    const prior = this.unchanged.get(key);
    const since = prior?.summary === signal.summary_text ? prior.since : now;
    this.unchanged.set(key, { summary: signal.summary_text, since });
    const unchanged_elapsed_ms = Math.max(0, now - since);
    const effective_salience = computeSensoryHabituation(signal.raw_salience, unchanged_elapsed_ms);
    const weak = signal.confidence < minConfidence || signal.sustained_ms < minSustainedMs;
    if (weak && signal.persistence_hint === "ephemeral_blackboard") {
      this.ephemeralWindow.add({ ...signal, virtual_ts_ms: now });
    }
    return {
      effective_salience,
      unchanged_elapsed_ms,
      wake_w1: !weak,
      route: !weak ? "w1" : signal.persistence_hint === "ephemeral_blackboard" ? "ephemeral_blackboard" : "filtered"
    };
  }
}

export const evaluateThalamicSalience = (
  gate: ThalamicSalienceGate,
  signal: ThalamicSignal,
  options: { minConfidence?: number; minSustainedMs?: number } = {}
): ThalamicSalienceResult => gate.evaluate(signal, options.minConfidence ?? 0.6, options.minSustainedMs ?? 500);
