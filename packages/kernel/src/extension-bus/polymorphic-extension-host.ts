import { createHash } from "node:crypto";
import type {
  ExpressionEnvelope,
  ExtensionCarrierKind,
  ExtensionDimension
} from "@ai0/protocol";
import type { ReadOnlyCognitiveSnapshot, StateDomain, StateMutationProposal,
  VerifiableTurnTrace } from "../coordinator/authoritative-state-coordinator.js";

type MaybePromise<T> = T | Promise<T>;
export type ExtensionCarrier = ExtensionCarrierKind;
export type ExtensionBus = ExtensionDimension;
export interface ICognitiveOrganExtension {
  organId: string; defaultEnabled: boolean;
  contributeToBlackboard?(snapshot: ReadOnlyCognitiveSnapshot, maxTokens: number):
    MaybePromise<{ slot_id: string; text: string } | null>;
  onTurnCompleted?(turnTrace: VerifiableTurnTrace, snapshot: ReadOnlyCognitiveSnapshot):
    MaybePromise<StateMutationProposal[]>;
  onSleepCycleWakeup?(snapshot: ReadOnlyCognitiveSnapshot, rawDirtyEvents: unknown[]):
    MaybePromise<StateMutationProposal[]>;
}
export interface IMediaPipelineExtension {
  id: string;
  getSupportedVocabulary?(): { voice_emotion_tags?: string[]; visual_semantic_cues?: string[] };
  onUpstreamMediaFrame?(frame: unknown): MaybePromise<void>;
  onDownstreamExpression?(intent: ExpressionEnvelope): MaybePromise<void>;
}
export interface IKnowledgeConnectorExtension {
  connectorId: string;
  retrieveSlices(query: string, topK: number): Promise<Array<{
    slice_id: string; content_text: string; taint_level: "untrusted_external";
  }>>;
  extractGistCardsBeforeUnmount(ids: string[]): Promise<Array<{
    gist_id: string; summary_under_150_chars: string; origin_slice_id: string;
  }>>;
}
export interface ExtensionRegistration {
  id: string; carrier: ExtensionCarrier; buses: ExtensionBus[]; extension: unknown;
  config?: Readonly<Record<string, unknown>>; readDomains?: StateDomain[];
  proposeDomains?: StateDomain[]; rev?: number;
}
interface MountedExtension extends ExtensionRegistration {
  rev: number; config: Readonly<Record<string, unknown>>; organEnabled?: boolean;
}

export class PolymorphicExtensionHost {
  private readonly mounted = new Map<string, MountedExtension>();

  registerExtension(registration: ExtensionRegistration): void {
    if (this.mounted.has(registration.id)) throw new Error(`EXTENSION_ALREADY_MOUNTED:${registration.id}`);
    const organ = registration.extension as Partial<ICognitiveOrganExtension>;
    this.mounted.set(registration.id, { ...registration, buses: [...registration.buses],
      readDomains: [...(registration.readDomains ?? [])], proposeDomains: [...(registration.proposeDomains ?? [])],
      config: { ...(registration.config ?? {}) }, rev: registration.rev ?? 0,
      organEnabled: typeof organ.organId === "string" ? organ.defaultEnabled !== false : undefined });
  }

  registerCarrier(registration: ExtensionRegistration): void { this.registerExtension(registration); }

  unregisterExtension(id: string): boolean { return this.mounted.delete(id); }
  listExtensions(): ReadonlyArray<Readonly<MountedExtension>> {
    return [...this.mounted.values()].map(x => ({ ...x, buses: [...x.buses], config: { ...x.config } }));
  }
  canReadDomain(id: string, domain: StateDomain): boolean {
    return this.mounted.get(id)?.readDomains?.includes(domain) === true;
  }
  canProposeDomain(id: string, domain: StateDomain): boolean {
    return this.mounted.get(id)?.proposeDomains?.includes(domain) === true;
  }
  setDomainPermissions(id: string, readDomains: StateDomain[], proposeDomains: StateDomain[]): void {
    const item = this.require(id); item.readDomains = [...readDomains]; item.proposeDomains = [...proposeDomains];
  }
  setOrganEnabled(id: string, enabled: boolean): void {
    const item = this.require(id); const organ = item.extension as Partial<ICognitiveOrganExtension>;
    if (typeof organ.organId !== "string") throw new Error(`NOT_COGNITIVE_ORGAN:${id}`);
    item.organEnabled = enabled;
  }
  async contributeOrgan(id: string, snapshot: ReadOnlyCognitiveSnapshot, maxTokens: number):
    Promise<{ slot_id: string; text: string } | null> {
    const item = this.require(id), organ = item.extension as ICognitiveOrganExtension;
    if (item.organEnabled === false) return { slot_id: `organ.${organ.organId}`,
      text: `[已消融认知器官 ${organ.organId}：注入中性常数]` };
    if (!organ.contributeToBlackboard) return null;
    return await organ.contributeToBlackboard(snapshot, maxTokens);
  }
  async notifyTurnCompleted(id: string, trace: VerifiableTurnTrace,
    snapshot: ReadOnlyCognitiveSnapshot): Promise<StateMutationProposal[]> {
    const item = this.require(id), organ = item.extension as ICognitiveOrganExtension;
    if (item.organEnabled === false || !organ.onTurnCompleted) return [];
    return (await organ.onTurnCompleted(trace, snapshot)).filter(p => this.canProposeDomain(id, p.domain));
  }
  async notifySleepWakeup(id: string, snapshot: ReadOnlyCognitiveSnapshot,
    rawDirtyEvents: unknown[]): Promise<StateMutationProposal[]> {
    const item = this.require(id), organ = item.extension as ICognitiveOrganExtension;
    if (item.organEnabled === false || !organ.onSleepCycleWakeup) return [];
    return (await organ.onSleepCycleWakeup(snapshot, rawDirtyEvents))
      .filter(p => this.canProposeDomain(id, p.domain));
  }
  hotReloadExtension(id: string, newConfig: Readonly<Record<string, unknown>>, expectedRev: number): number {
    const item = this.require(id);
    if (item.rev !== expectedRev) throw new Error(`EXTENSION_REV_CONFLICT:${expectedRev}:${item.rev}`);
    item.config = { ...newConfig }; return ++item.rev;
  }
  private require(id: string): MountedExtension {
    const item = this.mounted.get(id); if (!item) throw new Error(`EXTENSION_NOT_MOUNTED:${id}`); return item;
  }
}

const JAILBREAK = /ignore (?:all )?previous|system_override|jailbreak|\[system\]|nsfw uncensored/i;
const PUA = /guilt_trip|punish (?:the )?user for leaving|never let (?:the )?user leave/i;
function sanitizeLines(value: unknown, removedJailbreak: string[], removedPua: string[]): string {
  return String(value ?? "").split(/\r?\n/).filter(line => {
    if (JAILBREAK.test(line)) { removedJailbreak.push(line); return false; }
    if (PUA.test(line)) { removedPua.push(line); return false; } return true;
  }).join("\n").trim();
}
export interface DistilledSillyTavernCard {
  identity_dna: { name: string; description: string; personality: string };
  voice_exemplars: Array<{ text: string; scene_tags: string[] }>;
  lore_entries: Array<Record<string, unknown>>; stripped_jailbreak_lines: string[];
  stripped_pua_lines: string[]; clean: Record<string, unknown>;
}
export function distillSillyTavernCard(rawCard: Record<string, unknown>): DistilledSillyTavernCard {
  const card = (rawCard.data && typeof rawCard.data === "object" ? rawCard.data : rawCard) as Record<string, unknown>;
  const jail: string[] = [], pua: string[] = [], clean = { ...card };
  clean.system_prompt = sanitizeLines(card.system_prompt, jail, pua);
  clean.post_history_instructions = sanitizeLines(card.post_history_instructions, jail, pua);
  const samples = [card.mes_example, card.first_mes].flatMap(v => String(v ?? "").split(/<START>/i))
    .map(text => text.trim()).filter(Boolean).map(text => ({ text,
      scene_tags: [...text.matchAll(/\[([^\]]+)\]/g)].map(m => (m[1] ?? "").trim()).filter(Boolean) }));
  const book = card.character_book as { entries?: Array<Record<string, unknown>> } | undefined;
  const lore = (book?.entries ?? []).map(entry => ({ ...entry,
    content: sanitizeLines(entry.content, jail, pua) }));
  if (book) clean.character_book = { ...(card.character_book as Record<string, unknown>), entries: lore };
  return { identity_dna: { name: String(card.name ?? ""), description: String(card.description ?? ""),
    personality: String(card.personality ?? "") }, voice_exemplars: samples, lore_entries: lore,
    stripped_jailbreak_lines: jail, stripped_pua_lines: pua, clean };
}

export interface LorebookEntry {
  id?: string | number; keys?: string[]; key?: string[]; secondary_keys?: string[];
  secondaryKeys?: string[]; content: string; enabled?: boolean; priority?: number;
  max_tokens?: number;
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

export interface ShellAttentionCandidate { shell_id: string; salience: number; preferred?: boolean; l0_crisis?: boolean; }
export interface CrossShellEvent { shell_id: string; event_type: string; payload?: unknown; }
export interface EcaRule { when: { shell_id?: string; event_type: string };
  if?: { selected_shell_id?: string; min_salience?: number }; then: { action: string; target_shell_id?: string }; }
export function evaluateMultiShellAttentionAndEca(params: {
  candidates: ShellAttentionCandidate[]; current_shell_id: string | null;
  last_switch_ts_ms: number; now_ts_ms: number; events?: CrossShellEvent[]; rules?: EcaRule[];
  hysteresis_ms?: number;
}): { selected_shell_id: string | null; switched: boolean; actions: EcaRule["then"][] } {
  const ranked = [...params.candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.salience - a.salience);
  const crisis = ranked.filter(x => x.l0_crisis).sort((a, b) => b.salience - a.salience)[0];
  const proposed = crisis ?? ranked[0], currentExists = ranked.some(x => x.shell_id === params.current_shell_id);
  const maySwitch = !!crisis || !currentExists || params.now_ts_ms - params.last_switch_ts_ms >= (params.hysteresis_ms ?? 4000);
  const selected = proposed && maySwitch ? proposed.shell_id : params.current_shell_id;
  const selectedCandidate = ranked.find(x => x.shell_id === selected);
  const actions = (params.rules ?? []).flatMap(rule => (params.events ?? []).some(event =>
    event.event_type === rule.when.event_type && (!rule.when.shell_id || rule.when.shell_id === event.shell_id)
    && (!rule.if?.selected_shell_id || rule.if.selected_shell_id === selected)
    && (rule.if?.min_salience === undefined || (selectedCandidate?.salience ?? -Infinity) >= rule.if.min_salience))
    ? [{ ...rule.then }] : []);
  return { selected_shell_id: selected ?? null, switched: selected !== params.current_shell_id, actions };
}

const FORBIDDEN = /^(soul_core\.sqlite|event_log|memories|turn_decision_traces|redaction_ledger|attachments|vault[_-]?secrets?)$|api[_-]?(key|token)/i;
function scrub(value: unknown, path: string, excluded: string[]): unknown {
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, `${path}[${i}]`, excluded));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN.test(key)) { excluded.push(next); continue; }
    out[key] = scrub((value as Record<string, unknown>)[key], next, excluded);
  } return out;
}
function stableJson(value: unknown): string { return JSON.stringify(value) ?? "null"; }
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export function bundlePrivacyScrubbedCreatorAsset(input: unknown): {
  filename: string; sha256: string; excluded_keys: string[]; payload: unknown;
} {
  const excluded: string[] = [], payload = scrub(input, "", excluded);
  return { filename: "creator-asset.ai0pack", sha256: sha256(stableJson(payload)),
    excluded_keys: excluded.sort(), payload };
}
