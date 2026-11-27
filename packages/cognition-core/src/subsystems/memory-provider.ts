import type {
  AudienceScope,
  CognitionMemoryProvider,
  CognitionMemoryQuery,
  CognitionMemoryRecord,
  CognitionMemoryRevisionInput,
  CognitionMemoryRevisionOutcome
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
 * Enforces AudienceScope privacy visibility, retains full epistemic provenance,
 * and supports belief revision with transitive `basedOnMemoryIds` stale-premise invalidation.
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
    this.records.set(
      record.memoryId,
      structuredClone({
        ...record,
        validityStatus: record.validityStatus ?? "active"
      })
    );
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
      if (!query.includeInvalidated && (record.validityStatus ?? "active") !== "active") {
        continue;
      }
      if (
        !query.includeInvalidated &&
        query.nowMs !== undefined &&
        ((record.validFromMs !== undefined && query.nowMs < record.validFromMs) ||
          (record.validUntilMs !== undefined && query.nowMs >= record.validUntilMs))
      ) {
        continue;
      }
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

  revise(input: CognitionMemoryRevisionInput, signal?: AbortSignal): CognitionMemoryRevisionOutcome {
    signal?.throwIfAborted();
    const target = this.records.get(input.targetMemoryId);
    const invalidatedSet = new Set<string>();

    if (target) {
      const nextStatus = input.relation === "supersedes" ? "superseded" : "refuted_invalidated";
      this.records.set(input.targetMemoryId, {
        ...target,
        validityStatus: nextStatus,
        ...(input.replacementRecord ? { supersededByMemoryId: input.replacementRecord.memoryId } : {}),
        invalidatedAtMs: input.revisedAtMs,
        invalidatedReason: input.reason ?? input.relation
      });
      invalidatedSet.add(input.targetMemoryId);
    }

    if (input.replacementRecord) {
      this.store({
        ...input.replacementRecord,
        validityStatus: "active"
      });
    }

    // BFS transitive stale-premise invalidation over `basedOnMemoryIds` with `all_of` / `any_of` support
    const queue = [input.targetMemoryId];
    const visited = new Set<string>(queue);
    while (queue.length > 0) {
      const brokenId = queue.shift()!;
      for (const [memId, rec] of this.records.entries()) {
        if (memId === input.replacementRecord?.memoryId) continue;
        if ((rec.validityStatus ?? "active") !== "active") continue;
        if (!rec.basedOnMemoryIds?.includes(brokenId)) continue;

        if (rec.premiseQuantifier === "any_of") {
          const minCount = Math.max(1, rec.minPremiseCount ?? 1);
          const remainingActivePremises = rec.basedOnMemoryIds.filter((pid) => {
            const parent = this.records.get(pid);
            return parent !== undefined && (parent.validityStatus ?? "active") === "active";
          }).length;
          if (remainingActivePremises >= minCount) {
            continue;
          }
        }

        this.records.set(memId, {
          ...rec,
          validityStatus: "stale_premise_invalidated",
          invalidatedAtMs: input.revisedAtMs,
          invalidatedReason: `Premise ${brokenId} was ${input.relation === "supersedes" ? "superseded" : "refuted"}`
        });
        invalidatedSet.add(memId);
        if (!visited.has(memId)) {
          visited.add(memId);
          queue.push(memId);
        }
      }
    }

    return {
      updatedTarget: Boolean(target),
      invalidatedMemoryIds: [...invalidatedSet],
      ...(input.replacementRecord ? { replacementRecord: structuredClone(input.replacementRecord) } : {})
    };
  }

  getById(memoryId: string): CognitionMemoryRecord | undefined {
    const rec = this.records.get(memoryId);
    return rec ? structuredClone(rec) : undefined;
  }

  listAll(): readonly CognitionMemoryRecord[] {
    return [...this.records.values()].map((item) => structuredClone(item));
  }

  clear(): void {
    this.records.clear();
  }
}
