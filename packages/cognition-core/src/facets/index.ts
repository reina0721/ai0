import { defineFacetPoint, type ExtensionCoreHost } from "@ai0/extension-core";
import { ContinuousStateDescriptorSchema, type ContinuousStateDescriptor, type StateDomain } from "@ai0/protocol";
import type { ReadOnlyCognitiveSnapshot, StateMutationProposal } from "../coordinator/authoritative-state-coordinator.js";

export type ReadableCognitiveSnapshot = Partial<Omit<ReadOnlyCognitiveSnapshot, "domain_revs">> & {
  domain_revs: Partial<ReadOnlyCognitiveSnapshot["domain_revs"]>;
};

export interface CognitionContextContributor {
  priority?: number;
  contributeToBlackboard(snapshot: ReadableCognitiveSnapshot, maxTokens: number):
    { slot_id: string; text: string } | null | Promise<{ slot_id: string; text: string } | null>;
}
export interface CognitionSleepOrgan {
  onSleepCycleWakeup(snapshot: ReadableCognitiveSnapshot, events: readonly unknown[]):
    StateMutationProposal[] | Promise<StateMutationProposal[]>;
}
export interface AttentionArbitratorPort {
  arbitrate: typeof evaluateMultiChannelAttentionAndEca;
}

export const cognitionStateDynamicsFacet = defineFacetPoint<{ descriptors: readonly ContinuousStateDescriptor[] }>({
  owner: "cognition", name: "state_dynamics", version: 1,
  parse(raw) {
    const value = raw as { descriptors?: unknown[] } | null;
    if (!Array.isArray(value?.descriptors)) throw new TypeError("Missing state descriptors");
    return { descriptors: value.descriptors.map(descriptor => ContinuousStateDescriptorSchema.parse(descriptor)) };
  }
});

export const cognitionAttentionArbitratorFacet = defineFacetPoint<AttentionArbitratorPort>({
  owner: "cognition", name: "attention_arbitrator", version: 1,
  parse(raw) {
    const value = raw as AttentionArbitratorPort | null;
    if (typeof value?.arbitrate !== "function") throw new TypeError("Invalid attention arbitrator");
    return value;
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

export const cognitionSleepOrganFacet = defineFacetPoint<CognitionSleepOrgan>({
  owner: "cognition", name: "sleep_organ", version: 1,
  parse(raw) {
    const value = raw as CognitionSleepOrgan | null;
    if (typeof value?.onSleepCycleWakeup !== "function") throw new TypeError("Invalid sleep organ");
    return value;
  }
});

export function selectReadableSnapshot(host: ExtensionCoreHost, id: string,
  snapshot: ReadOnlyCognitiveSnapshot): ReadableCognitiveSnapshot {
  const domain_revs = Object.fromEntries(Object.entries(snapshot.domain_revs)
    .filter(([domain]) => host.allowsReadDomain(id, domain as StateDomain)));
  const domains = Object.entries(snapshot).filter(([domain]) => host.allowsReadDomain(id, domain as StateDomain));
  return structuredClone({ ...Object.fromEntries(domains), state_rev: snapshot.state_rev, domain_revs });
}

export interface LorebookEntry {
  id?: string | number; keys?: string[]; key?: string[]; secondary_keys?: string[];
  secondaryKeys?: string[]; content: string; enabled?: boolean; priority?: number;
  max_tokens?: number;
}

export class LorebookMatcher {
  constructor(private readonly entries: readonly LorebookEntry[]) {}

  match(text: string): LorebookEntry[] {
    return simulateLorebookActivation([...this.entries], text);
  }

  toContextContributor({ slotId = "lorebook", priority }: {
    slotId?: string; priority?: number;
  } = {}): CognitionContextContributor {
    return {
      priority,
      contributeToBlackboard: (snapshot, maxTokens) => {
        const turn = snapshot.D1_WORKING_TURN?.recent_turns.findLast(turn => turn.role === "user");
        if (!turn || maxTokens <= 0) return null;
        const text = this.match(turn.text).map(entry => entry.content).join("\n")
          .slice(0, Math.floor(maxTokens * 2.5));
        return text ? { slot_id: slotId, text } : null;
      }
    };
  }
}

export function simulateLorebookActivation(lorebook: LorebookEntry[] | { entries: LorebookEntry[] },
  testUtterance: string): LorebookEntry[] {
  const entries = (Array.isArray(lorebook) ? lorebook : lorebook.entries).filter(e => e.enabled !== false);
  const activated: LorebookEntry[] = [], used = new Set<LorebookEntry>(); let frontier = testUtterance;
  for (let depth = 0; depth < 3; depth++) {
    const haystack = frontier.toLocaleLowerCase(), found = entries.filter(entry => {
      if (used.has(entry)) return false;
      const primary = entry.keys ?? entry.key ?? [], secondary = entry.secondary_keys ?? entry.secondaryKeys ?? [];
      return primary.some(k => haystack.includes(k.toLocaleLowerCase()))
        && secondary.every(k => haystack.includes(k.toLocaleLowerCase()));
    }).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    if (!found.length) break;
    for (const entry of found) {
      used.add(entry); const maxChars = Math.max(0, Math.floor((entry.max_tokens ?? 256) * 2.5));
      activated.push({ ...entry, content: entry.content.slice(0, maxChars) });
    }
    frontier = found.map(e => e.content).join("\n");
  }
  return activated;
}

export interface ChannelAttentionCandidate { channel_id: string; salience: number; preferred?: boolean; l0_crisis?: boolean; }
export interface CrossChannelEvent { channel_id: string; event_type: string; payload?: unknown; }
export interface EcaRule { when: { channel_id?: string; event_type: string };
  if?: { selected_channel_id?: string; min_salience?: number }; then: { action: string; target_channel_id?: string }; }
export function evaluateMultiChannelAttentionAndEca(params: {
  candidates: ChannelAttentionCandidate[]; current_channel_id: string | null;
  last_switch_ts_ms: number; now_ts_ms: number; events?: CrossChannelEvent[]; rules?: EcaRule[];
  hysteresis_ms?: number;
}): { selected_channel_id: string | null; switched: boolean; actions: EcaRule["then"][] } {
  const ranked = [...params.candidates].sort((a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || b.salience - a.salience);
  const crisis = ranked.filter(x => x.l0_crisis).sort((a, b) => b.salience - a.salience)[0];
  const proposed = crisis ?? ranked[0], currentExists = ranked.some(x => x.channel_id === params.current_channel_id);
  const maySwitch = !!crisis || !currentExists || params.now_ts_ms - params.last_switch_ts_ms >= (params.hysteresis_ms ?? 4000);
  const selected = proposed && maySwitch ? proposed.channel_id : params.current_channel_id;
  const selectedCandidate = ranked.find(x => x.channel_id === selected);
  const actions = (params.rules ?? []).flatMap(rule => (params.events ?? []).some(event =>
    event.event_type === rule.when.event_type && (!rule.when.channel_id || rule.when.channel_id === event.channel_id)
    && (!rule.if?.selected_channel_id || rule.if.selected_channel_id === selected)
    && (rule.if?.min_salience === undefined || (selectedCandidate?.salience ?? -Infinity) >= rule.if.min_salience))
    ? [{ ...rule.then }] : []);
  return { selected_channel_id: selected ?? null, switched: selected !== params.current_channel_id, actions };
}

