import type {
  AudienceScope,
  CognitionMemoryProvider,
  CognitionMemoryQuery,
  CognitionMemoryRecord
} from "@ai0/protocol";

function recordVisibleToAudience(recordScope: AudienceScope, queryScope: AudienceScope): boolean {
  if (queryScope === "only_owner") return true;
  if (recordScope === "public_all") return true;
  return recordScope === queryScope;
}

function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`/\\|-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

/**
 * Built-in L1 in-memory replaceable implementation of `cognition.memory_provider@1`.
 * Enforces AudienceScope privacy visibility and supports hot-swapping with SQLite or vector providers.
 */
export class InMemoryCognitiveMemoryProvider implements CognitionMemoryProvider {
  readonly priority: number;
  private readonly maxEntries: number;
  private readonly records = new Map<string, CognitionMemoryRecord>();

  constructor(options: { priority?: number; maxEntries?: number; initialRecords?: readonly CognitionMemoryRecord[] } = {}) {
    this.priority = options.priority ?? 100;
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    for (const record of options.initialRecords ?? []) {
      this.store(record);
    }
  }

  store(record: CognitionMemoryRecord): void {
    this.records.delete(record.memoryId);
    this.records.set(record.memoryId, structuredClone(record));
    while (this.records.size > this.maxEntries) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey === undefined) break;
      this.records.delete(oldestKey);
    }
  }

  retrieve(query: CognitionMemoryQuery, signal?: AbortSignal): readonly CognitionMemoryRecord[] {
    signal?.throwIfAborted();
    const limit = Math.max(1, query.limit ?? 8);
    const tierFilter = query.tiers && query.tiers.length > 0 ? new Set(query.tiers) : undefined;
    const tokens = tokenizeQuery(query.query);
    const loweredFull = query.query.trim().toLowerCase();

    const scored: Array<{ record: CognitionMemoryRecord; score: number }> = [];
    for (const record of this.records.values()) {
      if (!recordVisibleToAudience(record.audienceScope, query.audienceScope)) continue;
      if (tierFilter && !tierFilter.has(record.memoryTier)) continue;

      const haystack = record.content.toLowerCase();
      let score = 0;
      if (!loweredFull) {
        score = 1;
      } else {
        if (haystack.includes(loweredFull)) score += 3;
        for (const token of tokens) {
          if (haystack.includes(token)) score += 1;
        }
      }
      if (loweredFull && score === 0) continue;
      scored.push({
        record: { ...structuredClone(record), score },
        score
      });
    }

    scored.sort((a, b) => b.score - a.score || b.record.createdAtMs - a.record.createdAtMs);
    return scored.slice(0, limit).map((item) => item.record);
  }

  listAll(): readonly CognitionMemoryRecord[] {
    return [...this.records.values()].map((item) => structuredClone(item));
  }

  clear(): void {
    this.records.clear();
  }
}
