import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeExtensionAsset, extensionAssetCodecFacet, type ExtensionCoreHost } from "@ai0/sdk";

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
const distilledCard = z.object({
  identity_dna: z.object({ name: z.string(), description: z.string(), personality: z.string() }),
  voice_exemplars: z.array(z.object({ text: z.string(), scene_tags: z.array(z.string()) })),
  lore_entries: z.array(z.record(z.unknown())), stripped_jailbreak_lines: z.array(z.string()),
  stripped_pua_lines: z.array(z.string()), clean: z.record(z.unknown())
});
const cardTarget = "ai0.distilled-card.v1";
const cardFormat = "sillytavern.card";
export function mountCardCodec(host: ExtensionCoreHost) {
  host.mountPackage({ manifest: {
    manifest_version: "2.0.0", carrier_kind: "native_code_plugin", extension_id: "profile.card-codec",
    display_name: "SillyTavern card", author: "ai0", version: "1", facets: [extensionAssetCodecFacet.id],
    permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false }
  }, activate(scope) {
    scope.contributeFacet(extensionAssetCodecFacet, { format: cardFormat, target: cardTarget,
      decode: raw => distillSillyTavernCard(z.record(z.unknown()).parse(raw)) });
  } });
}
export async function decodeProfileCard(host: ExtensionCoreHost, raw: unknown, format = cardFormat, provider?: string) {
  return distilledCard.parse(await decodeExtensionAsset(host, format, cardTarget, raw, provider));
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
