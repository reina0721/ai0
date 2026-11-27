import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeExtensionAsset, type ExtensionCoreHost } from "@ai0/sdk";

const distilledCardSchema = z.object({
  identity_dna: z.object({ name: z.string(), description: z.string(), personality: z.string() }),
  voice_exemplars: z.array(z.object({ text: z.string(), scene_tags: z.array(z.string()) })),
  lore_entries: z.array(z.record(z.unknown())),
  stripped_jailbreak_lines: z.array(z.string()),
  stripped_pua_lines: z.array(z.string()),
  clean: z.record(z.unknown())
});

export type DistilledSillyTavernCard = z.infer<typeof distilledCardSchema>;

export async function decodeProfileCard(
  host: ExtensionCoreHost,
  raw: unknown,
  format = "sillytavern.card",
  provider?: string
): Promise<DistilledSillyTavernCard> {
  return distilledCardSchema.parse(await decodeExtensionAsset(host, format, "ai0.distilled-card.v1", raw, provider));
}

export async function decodeLorebookSimulation(
  host: ExtensionCoreHost,
  entries: unknown[],
  utterance: string
): Promise<unknown[]> {
  const result = await decodeExtensionAsset(host, "ai0.lorebook.simulation", "ai0.lorebook.activated.v1", { entries, utterance });
  return Array.isArray(result) ? result : [];
}

const FORBIDDEN =
  /^(soul_core\.sqlite|event_log|memories|turn_decision_traces|redaction_ledger|attachments|private_memories|vault[_-]?secrets?)$|api[_-]?(key|token)|owner[_-]?master[_-]?token/i;

function scrub(value: unknown, path: string, excluded: string[]): unknown {
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, `${path}[${i}]`, excluded));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN.test(key)) {
      excluded.push(next);
      continue;
    }
    out[key] = scrub((value as Record<string, unknown>)[key], next, excluded);
  }
  return out;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

export function bundlePrivacyScrubbedCreatorAsset(input: unknown): {
  filename: string;
  sha256: string;
  excluded_keys: string[];
  payload: unknown;
} {
  const excluded: string[] = [];
  const payload = scrub(input, "", excluded);
  return {
    filename: "creator-asset.ai0pack",
    sha256: createHash("sha256").update(stableJson(payload), "utf8").digest("hex"),
    excluded_keys: excluded.sort(),
    payload
  };
}
