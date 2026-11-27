import { createHash } from "node:crypto";
import type { AgentToolResult } from "@ai0/protocol";

export interface ExecutionIdempotencyEntry {
  readonly idempotencyKey: string;
  readonly scopeId: string;
  readonly toolName: string;
  readonly inputHash: string;
  readonly result: AgentToolResult;
  readonly recordedAtStep: number;
}

export interface ExecutionIdempotencyStorePort {
  get(idempotencyKey: string): ExecutionIdempotencyEntry | undefined;
  set(entry: ExecutionIdempotencyEntry): void;
  listByScope?(scopeId: string): readonly ExecutionIdempotencyEntry[];
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (rec[key] !== undefined) {
        out[key] = canonicalizeValue(rec[key]);
      }
    }
    return out;
  }
  return value;
}

export function computeToolInputDigest(input: unknown): string {
  const serialized = JSON.stringify(canonicalizeValue(input ?? null));
  return createHash("sha256").update(serialized).digest("hex").slice(0, 32);
}

export function computeToolIdempotencyKey(
  scopeId: string,
  toolName: string,
  input: unknown
): { idempotencyKey: string; inputHash: string } {
  const inputHash = computeToolInputDigest(input);
  return {
    idempotencyKey: `${scopeId}::${toolName}::${inputHash}`,
    inputHash
  };
}

/**
 * Durable-execution idempotency ledger for side-effecting tool invocations.
 * Prevents duplicate external side effects when a crashed multi-step loop or W2 task
 * replays from an earlier checkpoint cursor.
 */
export class ExecutionIdempotencyLedger implements ExecutionIdempotencyStorePort {
  private readonly memoryEntries = new Map<string, ExecutionIdempotencyEntry>();
  private replayHits = 0;

  constructor(private readonly backingStore?: ExecutionIdempotencyStorePort) {}

  get totalReplayHits(): number {
    return this.replayHits;
  }

  get(idempotencyKey: string): ExecutionIdempotencyEntry | undefined {
    const cached = this.memoryEntries.get(idempotencyKey);
    if (cached) return structuredClone(cached);
    const persisted = this.backingStore?.get(idempotencyKey);
    if (persisted) {
      this.memoryEntries.set(idempotencyKey, structuredClone(persisted));
      return structuredClone(persisted);
    }
    return undefined;
  }

  lookupAndCountReplay(idempotencyKey: string): ExecutionIdempotencyEntry | undefined {
    const found = this.get(idempotencyKey);
    if (found) {
      this.replayHits += 1;
    }
    return found;
  }

  set(entry: ExecutionIdempotencyEntry): void {
    const cloned = structuredClone(entry);
    this.memoryEntries.set(entry.idempotencyKey, cloned);
    this.backingStore?.set(cloned);
  }

  listByScope(scopeId: string): readonly ExecutionIdempotencyEntry[] {
    if (this.backingStore?.listByScope) {
      return this.backingStore.listByScope(scopeId);
    }
    const prefix = `${scopeId}::`;
    const out: ExecutionIdempotencyEntry[] = [];
    for (const [key, val] of this.memoryEntries.entries()) {
      if (key.startsWith(prefix)) {
        out.push(structuredClone(val));
      }
    }
    return out;
  }
}
