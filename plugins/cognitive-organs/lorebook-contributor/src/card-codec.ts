import type { SdkCognitionContextContributor } from "@ai0/sdk";

export interface DistilledSillyTavernCard {
  identity_dna: { name: string; description: string; personality: string };
  voice_exemplars: Array<{ text: string; scene_tags: string[] }>;
  lore_entries: Array<Record<string, unknown>>;
  stripped_jailbreak_lines: string[];
  stripped_pua_lines: string[];
  clean: Record<string, unknown>;
}

const JAILBREAK = /ignore (?:all )?previous|system_override|jailbreak|\[system\]|nsfw uncensored/i;
const PUA = /guilt_trip|punish (?:the )?user for leaving|never let (?:the )?user leave/i;

function sanitizeLines(value: unknown, removedJailbreak: string[], removedPua: string[]): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      if (JAILBREAK.test(line)) {
        removedJailbreak.push(line);
        return false;
      }
      if (PUA.test(line)) {
        removedPua.push(line);
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

export function distillSillyTavernCard(rawCard: Record<string, unknown>): DistilledSillyTavernCard {
  const card = (rawCard.data && typeof rawCard.data === "object" ? rawCard.data : rawCard) as Record<string, unknown>;
  const jail: string[] = [];
  const pua: string[] = [];
  const clean: Record<string, unknown> = { ...card };
  clean.system_prompt = sanitizeLines(card.system_prompt, jail, pua);
  clean.post_history_instructions = sanitizeLines(card.post_history_instructions, jail, pua);
  const samples = [card.mes_example, card.first_mes]
    .flatMap((v) => String(v ?? "").split(/<START>/i))
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      scene_tags: [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean)
    }));
  const book = card.character_book as { entries?: Array<Record<string, unknown>> } | undefined;
  const lore = (book?.entries ?? []).map((entry) => ({
    ...entry,
    content: sanitizeLines(entry.content, jail, pua)
  }));
  if (book) clean.character_book = { ...(card.character_book as Record<string, unknown>), entries: lore };
  return {
    identity_dna: {
      name: String(card.name ?? ""),
      description: String(card.description ?? ""),
      personality: String(card.personality ?? "")
    },
    voice_exemplars: samples,
    lore_entries: lore,
    stripped_jailbreak_lines: jail,
    stripped_pua_lines: pua,
    clean
  };
}

export interface LorebookSimEntry {
  id: string;
  keys?: string[];
  key?: string[];
  secondary_keys?: string[];
  content: string;
  priority?: number;
  enabled?: boolean;
  recursive_depth?: number;
}

export interface ActivatedLoreEntry {
  id: string;
  matched_key: string;
  depth: number;
  priority: number;
  content: string;
}

export class LorebookMatcher {
  private readonly entries: readonly LorebookSimEntry[];
  private readonly maxDepth: number;

  constructor(entries: readonly LorebookSimEntry[], options: { maxDepth?: number } = {}) {
    this.entries = [...entries];
    this.maxDepth = Math.max(0, options.maxDepth ?? 3);
  }

  match(utterance: string): ActivatedLoreEntry[] {
    const activeEntries = this.entries
      .filter((e) => e.enabled !== false && Boolean(e.content?.trim()))
      .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));

    const activated: ActivatedLoreEntry[] = [];
    const visited = new Set<string>();
    let frontierText = utterance.toLowerCase();

    for (let depth = 0; depth <= this.maxDepth; depth += 1) {
      const newlyTriggered: string[] = [];
      for (const entry of activeEntries) {
        const entryId = entry.id;
        if (visited.has(entryId)) continue;
        if (depth > (entry.recursive_depth ?? this.maxDepth)) continue;
        const primaryKeys = (entry.keys ?? entry.key ?? []).filter(Boolean);
        const hitKey = primaryKeys.find((k) => frontierText.includes(k.toLowerCase()));
        if (!hitKey) continue;
        const secondaryOk = (entry.secondary_keys ?? []).every((sk) =>
          frontierText.includes(sk.toLowerCase())
        );
        if (!secondaryOk) continue;

        visited.add(entryId);
        activated.push({
          id: entryId,
          matched_key: hitKey,
          depth,
          priority: entry.priority ?? 50,
          content: entry.content
        });
        newlyTriggered.push(entry.content.toLowerCase());
      }
      if (newlyTriggered.length === 0) break;
      frontierText = newlyTriggered.join("\n");
    }

    return activated;
  }

  toContextContributor(options: { slotId?: string; priority?: number } = {}): SdkCognitionContextContributor {
    const slotId = options.slotId ?? "slot.lorebook_triggered";
    return {
      priority: options.priority ?? 10,
      contributeToBlackboard: (snapshot: Readonly<Record<string, unknown>>, maxTokens: number) => {
        const working = snapshot.D1_WORKING_TURN as { recent_turns?: { role: string; text: string }[] } | undefined;
        const lastUserTurn = [...(working?.recent_turns ?? [])]
          .reverse()
          .find((turn) => turn.role === "user");
        if (!lastUserTurn?.text || maxTokens <= 0) return null;
        const hits = this.match(lastUserTurn.text);
        if (hits.length === 0) return null;
        const charBudget = Math.max(1, Math.floor(maxTokens * 2.5));
        const text = hits.map((hit) => hit.content).join("\n").slice(0, charBudget);
        return text ? { slot_id: slotId, text } : null;
      }
    };
  }
}

export function simulateLorebookActivation(
  entries: readonly LorebookSimEntry[],
  utterance: string,
  maxDepth = 3
): ActivatedLoreEntry[] {
  return new LorebookMatcher(entries, { maxDepth }).match(utterance);
}
