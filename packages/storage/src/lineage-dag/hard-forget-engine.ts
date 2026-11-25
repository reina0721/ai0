import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const OWNER_REDACTION = "[REDACTED_BY_OWNER]";
const FORGET_REDACTION = "[REDACTED_BY_FORGET]";

type JsonRecord = Record<string, unknown>;
type SqlBindings = readonly unknown[] | Readonly<Record<string, unknown>>;

/**
 * The storage package deliberately exposes a small structural SQLite contract.
 * It accepts the package DatabaseDriver as well as the underlying better-sqlite3
 * style connection.  Keeping this structural also makes tombstone replay usable
 * while a snapshot manager is swapping driver instances.
 */
export type HardForgetDatabase = object;

export interface MemoryProjectionRow extends JsonRecord {
  memory_id: string;
  content_text: string;
  invalidated_at_ts?: number | null;
}

export interface SurvivingSource {
  kind: "event" | "memory" | "knowledge_chunk";
  id: string;
  summary_text: string;
  relation_type: "derived_from";
}

export type MicroReprojector = (
  survivingSources: readonly SurvivingSource[],
  oldMemory: Readonly<MemoryProjectionRow>,
) => string;

export interface HardForgetRequest {
  target_event_ids?: readonly string[];
  target_memory_ids?: readonly string[];
  dry_run_preview?: boolean;
  microReprojector?: MicroReprojector;
  tombstoneEventId?: string;
  redactedAtTsMs?: number;
  virtualTsMs?: number;
  redactionLedgerPath?: string;
  soulDirPath?: string;
  /** Used by snapshot rollback so replay does not append a second ledger row. */
  skipLedgerAppend?: boolean;
  /** Documents replay intent; existing tombstones are always reused regardless. */
  replayingTombstone?: boolean;
}

export interface ReprojectedMemory {
  memory_id: string;
  old_memory_id: string;
  new_memory_id: string;
  content_text: string;
  surviving_sources: readonly SurvivingSource[];
}

export interface HardForgetImpact {
  root_event_ids: string[];
  hard_deleted_memory_ids: string[];
  reprojected_memory_ids: string[];
  affected_trace_ids: string[];
  affected_commitment_ids: string[];
  affected_checkpoint_revs: number[];
}

export interface HardForgetPreview extends HardForgetImpact {
  dry_run_preview: true;
}

export interface HardForgetResult extends HardForgetImpact {
  dry_run_preview: false;
  reprojected_memories: ReprojectedMemory[];
  tombstone_event_id: string | null;
  redacted_at_wall_ts: number;
}

export interface TopicSealRequest extends Omit<HardForgetRequest, "dry_run_preview"> {
  topic_description: string;
  memory_id?: string;
  attributed_principal?: string;
  visibility_scope?: string;
  created_virtual_ts?: number;
  created_at_rev?: number;
}

export interface TopicSealResult {
  topic_seal_memory_id: string;
  hard_forget_result: HardForgetResult | null;
}

interface LineageRow extends JsonRecord {
  child_memory_id: string;
  parent_type: "event" | "memory" | "knowledge_chunk";
  parent_id: string;
  relation_type: "derived_from";
}

interface EventRow extends JsonRecord {
  event_id: string;
  summary_text: string;
  redacted_at_ts_ms: number | null;
  redacted_by_event: string | null;
  virtual_ts_ms: number;
}

interface TraceRow extends JsonRecord {
  trace_id: string;
  turn_event_id: string;
  step1_perception_json: string;
  step3_memory_recall_json: string;
  step7_emitted_intent_json: string;
}

interface CheckpointRow extends JsonRecord {
  state_rev: number;
  working_memory_json: string;
  state_attributions_json: string;
}

interface CommitmentRow extends JsonRecord {
  commitment_id: string;
  source_event_id: string;
}

interface PlannedReprojection extends ReprojectedMemory {
  old_memory: MemoryProjectionRow;
}

interface HardForgetPlan extends HardForgetImpact {
  requested_event_ids: string[];
  requested_memory_ids: string[];
  tainted_memory_ids: string[];
  topological_memory_ids: string[];
  reprojected: PlannedReprojection[];
  original_event_summaries: string[];
  traces: TraceRow[];
  checkpoints: CheckpointRow[];
  commitments: CommitmentRow[];
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function assertSynchronous<T>(value: T): T {
  if (isPromiseLike(value)) {
    throw new TypeError("HardForgetEngine requires the synchronous SQLite DatabaseDriver");
  }
  return value;
}

function rowsFrom<Row>(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (isRecord(value) && Array.isArray(value.rows)) return value.rows as Row[];
  if (value !== null && typeof value === "object" && Symbol.iterator in value) {
    return [...(value as Iterable<Row>)];
  }
  return [];
}

function findSqliteHandle(input: HardForgetDatabase): JsonRecord {
  const queue: unknown[] = [input];
  const seen = new Set<unknown>();
  const nestedKeys = ["database", "db", "driver", "connection", "raw", "handle", "sqlite"];

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!isRecord(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    if (
      typeof candidate.prepare === "function" ||
      typeof candidate.exec === "function" ||
      typeof candidate.all === "function" ||
      typeof candidate.queryAll === "function"
    ) {
      return candidate;
    }
    for (const key of nestedKeys) queue.push(candidate[key]);
  }

  throw new TypeError("The supplied DatabaseDriver does not expose a synchronous SQLite handle");
}

class SqliteAccess {
  readonly handle: JsonRecord;

  constructor(database: HardForgetDatabase) {
    this.handle = findSqliteHandle(database);
  }

  private prepared(sql: string): JsonRecord | null {
    if (typeof this.handle.prepare !== "function") return null;
    const statement = assertSynchronous(
      (this.handle.prepare as (sql: string) => unknown).call(this.handle, sql),
    );
    if (!isRecord(statement)) throw new TypeError("DatabaseDriver.prepare() returned no statement");
    return statement;
  }

  private invokeStatement(statement: JsonRecord, method: string, bindings: SqlBindings): unknown {
    const callable = statement[method];
    if (typeof callable !== "function") {
      throw new TypeError(`SQLite statement does not implement ${method}()`);
    }
    const fn = callable as (...args: unknown[]) => unknown;
    if (Array.isArray(bindings)) {
      if (bindings.length === 0) return assertSynchronous(fn.call(statement));
      try {
        return assertSynchronous(fn.call(statement, bindings));
      } catch (arrayBindingError) {
        try {
          return assertSynchronous(fn.call(statement, ...bindings));
        } catch {
          throw arrayBindingError;
        }
      }
    }
    return assertSynchronous(fn.call(statement, bindings));
  }

  all<Row>(sql: string, bindings: SqlBindings = []): Row[] {
    const statement = this.prepared(sql);
    if (statement) return rowsFrom<Row>(this.invokeStatement(statement, "all", bindings));

    for (const name of ["all", "queryAll", "query"] as const) {
      const callable = this.handle[name];
      if (typeof callable !== "function") continue;
      const result = assertSynchronous(
        (callable as (...args: unknown[]) => unknown).call(this.handle, sql, bindings),
      );
      return rowsFrom<Row>(result);
    }
    throw new TypeError("DatabaseDriver does not expose prepare().all() or all()");
  }

  get<Row>(sql: string, bindings: SqlBindings = []): Row | undefined {
    const statement = this.prepared(sql);
    if (statement) {
      const result = this.invokeStatement(statement, "get", bindings);
      return result === undefined ? undefined : (result as Row);
    }

    for (const name of ["get", "queryOne"] as const) {
      const callable = this.handle[name];
      if (typeof callable !== "function") continue;
      return assertSynchronous(
        (callable as (...args: unknown[]) => unknown).call(this.handle, sql, bindings),
      ) as Row | undefined;
    }
    return this.all<Row>(sql, bindings)[0];
  }

  run(sql: string, bindings: SqlBindings = []): unknown {
    const statement = this.prepared(sql);
    if (statement) return this.invokeStatement(statement, "run", bindings);

    for (const name of ["run", "execute"] as const) {
      const callable = this.handle[name];
      if (typeof callable !== "function") continue;
      return assertSynchronous(
        (callable as (...args: unknown[]) => unknown).call(this.handle, sql, bindings),
      );
    }
    if ((Array.isArray(bindings) && bindings.length > 0) || !Array.isArray(bindings)) {
      throw new TypeError("DatabaseDriver.exec() cannot bind this SQL statement");
    }
    return this.exec(sql);
  }

  exec(sql: string): unknown {
    const callable = this.handle.exec;
    if (typeof callable !== "function") return this.run(sql);
    return assertSynchronous((callable as (sql: string) => unknown).call(this.handle, sql));
  }

  tableExists(table: string): boolean {
    return Boolean(
      this.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        [table],
      ),
    );
  }

  transaction<T>(operation: () => T): T {
    const transaction = this.handle.transaction;
    if (typeof transaction === "function") {
      let invoked = false;
      let operationResult: T | undefined;
      const wrapped = (): T => {
        invoked = true;
        operationResult = operation();
        return operationResult;
      };
      const result = assertSynchronous(
        (transaction as (callback: () => T) => unknown).call(this.handle, wrapped),
      );
      if (typeof result === "function") {
        return assertSynchronous((result as () => T)());
      }
      if (invoked) return operationResult as T;
      return result as T;
    }

    this.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function containsIdentifier(value: unknown, identifiers: ReadonlySet<string>): boolean {
  if (typeof value === "string") {
    if (identifiers.has(value)) return true;
    for (const identifier of identifiers) if (value.includes(identifier)) return true;
    return false;
  }
  if (Array.isArray(value)) return value.some((item) => containsIdentifier(item, identifiers));
  if (isRecord(value)) return Object.values(value).some((item) => containsIdentifier(item, identifiers));
  return false;
}

function rewriteJson(value: unknown, keyRewriter: (key: string, value: unknown, owner: JsonRecord) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, keyRewriter));
  if (!isRecord(value)) return value;
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = rewriteJson(keyRewriter(key, child, value), keyRewriter);
  }
  return output;
}

function redactPerceptionJson(text: string): string {
  const parsed = parseJson(text);
  if (parsed === undefined) return JSON.stringify({ summary_text: FORGET_REDACTION });
  return JSON.stringify(
    rewriteJson(parsed, (key, value) => (key === "summary_text" ? FORGET_REDACTION : value)),
  );
}

function redactRecallJson(text: string, taintedIds: ReadonlySet<string>): string {
  const parsed = parseJson(text);
  if (parsed === undefined) return JSON.stringify({ recalled_memories: FORGET_REDACTION });

  const visit = (value: unknown, inheritedTaint = false): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item, inheritedTaint));
    if (!isRecord(value)) return value;
    const identityValues = [
      value.memory_id,
      value.memoryId,
      value.id,
      value.recalled_memory_id,
      value.recalledMemoryId,
    ];
    const localTaint =
      inheritedTaint || identityValues.some((candidate) => typeof candidate === "string" && taintedIds.has(candidate));
    const output: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = key === "content_text" && localTaint ? FORGET_REDACTION : visit(child, localTaint);
    }
    return output;
  };

  return JSON.stringify(visit(parsed));
}

function redactIntentJson(text: string): string {
  const parsed = parseJson(text);
  if (parsed === undefined) return JSON.stringify({ fallback_text: FORGET_REDACTION });
  return JSON.stringify(
    rewriteJson(parsed, (key, value) => (key === "fallback_text" ? FORGET_REDACTION : value)),
  );
}

function replaceSensitiveOccurrences(text: string, sensitiveValues: readonly string[]): string {
  let result = text;
  for (const sensitive of sensitiveValues) {
    if (!sensitive || sensitive === OWNER_REDACTION || sensitive === FORGET_REDACTION) continue;
    result = result.split(sensitive).join(FORGET_REDACTION);
  }
  return result;
}

function cleanProjectionText(text: string, originalSummaries: readonly string[]): string {
  return replaceSensitiveOccurrences(
    text.split(OWNER_REDACTION).join("").split(FORGET_REDACTION).join(""),
    originalSummaries,
  )
    .replace(/\s+/gu, " ")
    .trim();
}

export const defaultMicroReprojector: MicroReprojector = (sources) =>
  sources
    .map((source) => source.summary_text)
    .filter((text) => text !== OWNER_REDACTION && text !== FORGET_REDACTION)
    .join("\n")
    .trim();

function insertSorted(queue: string[], value: string): void {
  let index = 0;
  while (index < queue.length && queue[index]!.localeCompare(value) < 0) index += 1;
  queue.splice(index, 0, value);
}

function makeId(prefix: string, now: number): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${now.toString(36)}_${random}`;
}

function normalizeMemoryRow(row: MemoryProjectionRow): MemoryProjectionRow {
  return { ...row, memory_id: String(row.memory_id), content_text: String(row.content_text ?? "") };
}

function buildPlan(
  sql: SqliteAccess,
  request: HardForgetRequest,
  reprojector: MicroReprojector,
): HardForgetPlan {
  const requestedEventIds = uniqueIds(request.target_event_ids);
  const requestedMemoryIds = uniqueIds(request.target_memory_ids);
  if (requestedEventIds.length === 0 && requestedMemoryIds.length === 0) {
    throw new TypeError("Hard Forget requires at least one target event or memory ID");
  }

  const lineageRows = sql.tableExists("memory_lineage_edges")
    ? sql.all<LineageRow>(
        "SELECT child_memory_id, parent_type, parent_id, relation_type FROM memory_lineage_edges WHERE relation_type = 'derived_from'",
      )
    : [];
  const memoryRows = sql.tableExists("memories")
    ? sql.all<MemoryProjectionRow>("SELECT * FROM memories").map(normalizeMemoryRow)
    : [];
  const eventRows = sql.tableExists("event_log")
    ? sql.all<EventRow>(
        "SELECT event_id, summary_text, redacted_at_ts_ms, redacted_by_event, virtual_ts_ms FROM event_log",
      )
    : [];
  const knowledgeRows = sql.tableExists("knowledge_chunks")
    ? sql.all<{ chunk_id: string; content_text: string }>(
        "SELECT chunk_id, content_text FROM knowledge_chunks",
      )
    : [];

  const parentsByChild = new Map<string, LineageRow[]>();
  const childrenByMemory = new Map<string, string[]>();
  const childrenByEvent = new Map<string, string[]>();
  for (const edge of lineageRows) {
    const parents = parentsByChild.get(edge.child_memory_id) ?? [];
    parents.push(edge);
    parentsByChild.set(edge.child_memory_id, parents);
    if (edge.parent_type === "memory") {
      const children = childrenByMemory.get(edge.parent_id) ?? [];
      children.push(edge.child_memory_id);
      childrenByMemory.set(edge.parent_id, children);
    } else if (edge.parent_type === "event") {
      const children = childrenByEvent.get(edge.parent_id) ?? [];
      children.push(edge.child_memory_id);
      childrenByEvent.set(edge.parent_id, children);
    }
  }

  const rootEventIds = new Set(requestedEventIds);
  const upwardQueue = [...requestedMemoryIds];
  const upwardVisited = new Set<string>();
  while (upwardQueue.length > 0) {
    const memoryId = upwardQueue.shift()!;
    if (upwardVisited.has(memoryId)) continue;
    upwardVisited.add(memoryId);
    for (const edge of parentsByChild.get(memoryId) ?? []) {
      if (edge.parent_type === "event") rootEventIds.add(edge.parent_id);
      if (edge.parent_type === "memory") upwardQueue.push(edge.parent_id);
    }
  }

  const taintedIds = new Set<string>();
  const forwardQueue = [...requestedMemoryIds];
  for (const eventId of rootEventIds) {
    forwardQueue.push(...(childrenByEvent.get(eventId) ?? []));
  }
  while (forwardQueue.length > 0) {
    const memoryId = forwardQueue.shift()!;
    if (taintedIds.has(memoryId)) continue;
    taintedIds.add(memoryId);
    forwardQueue.push(...(childrenByMemory.get(memoryId) ?? []));
  }

  const memoriesById = new Map(memoryRows.map((row) => [row.memory_id, row]));
  const eventsById = new Map(eventRows.map((row) => [row.event_id, row]));
  const knowledgeById = new Map(knowledgeRows.map((row) => [row.chunk_id, row.content_text]));
  const existingTaintedIds = new Set([...taintedIds].filter((id) => memoriesById.has(id)));

  const indegrees = new Map<string, number>();
  for (const memoryId of existingTaintedIds) indegrees.set(memoryId, 0);
  for (const memoryId of existingTaintedIds) {
    const indegree = (parentsByChild.get(memoryId) ?? []).filter(
      (edge) => edge.parent_type === "memory" && existingTaintedIds.has(edge.parent_id),
    ).length;
    indegrees.set(memoryId, indegree);
  }
  const topoQueue = [...existingTaintedIds].filter((id) => indegrees.get(id) === 0).sort();
  const topologicalIds: string[] = [];
  while (topoQueue.length > 0) {
    const current = topoQueue.shift()!;
    topologicalIds.push(current);
    for (const child of childrenByMemory.get(current) ?? []) {
      if (!existingTaintedIds.has(child)) continue;
      const next = (indegrees.get(child) ?? 0) - 1;
      indegrees.set(child, next);
      if (next === 0) insertSorted(topoQueue, child);
    }
  }
  if (topologicalIds.length !== existingTaintedIds.size) {
    throw new Error("memory_lineage_edges contains a derived_from cycle; Hard Forget aborted");
  }

  const rootIds = [...rootEventIds].sort();
  const originalSummaries = rootIds
    .map((id) => eventsById.get(id)?.summary_text ?? "")
    .filter((summary) => Boolean(summary) && summary !== OWNER_REDACTION);
  const hardDeletedIds = new Set<string>();
  const projectedTextById = new Map<string, string>();
  const reprojected: PlannedReprojection[] = [];

  for (const memoryId of topologicalIds) {
    const oldMemory = memoriesById.get(memoryId)!;
    const survivingSources: SurvivingSource[] = [];
    for (const edge of parentsByChild.get(memoryId) ?? []) {
      if (edge.parent_type === "event") {
        const event = eventsById.get(edge.parent_id);
        if (!rootEventIds.has(edge.parent_id) && event && event.redacted_at_ts_ms === null) {
          survivingSources.push({
            kind: "event",
            id: edge.parent_id,
            summary_text: event.summary_text,
            relation_type: "derived_from",
          });
        }
      } else if (edge.parent_type === "memory") {
        if (hardDeletedIds.has(edge.parent_id)) continue;
        const parent = memoriesById.get(edge.parent_id);
        if (!parent) continue;
        survivingSources.push({
          kind: "memory",
          id: edge.parent_id,
          summary_text: projectedTextById.get(edge.parent_id) ?? parent.content_text,
          relation_type: "derived_from",
        });
      } else {
        const content = knowledgeById.get(edge.parent_id);
        if (content !== undefined) {
          survivingSources.push({
            kind: "knowledge_chunk",
            id: edge.parent_id,
            summary_text: content,
            relation_type: "derived_from",
          });
        }
      }
    }

    if (survivingSources.length === 0) {
      hardDeletedIds.add(memoryId);
      continue;
    }

    const projected = cleanProjectionText(reprojector(survivingSources, oldMemory), originalSummaries);
    if (!projected) {
      hardDeletedIds.add(memoryId);
      continue;
    }
    projectedTextById.set(memoryId, projected);
    reprojected.push({
    memory_id: memoryId,
      old_memory_id: memoryId,
      new_memory_id: memoryId,
      content_text: projected,
      surviving_sources: survivingSources,
      old_memory: oldMemory,
    });
  }

  const taintedSet = new Set([...existingTaintedIds]);
  const traces = sql.tableExists("turn_decision_traces")
    ? sql.all<TraceRow>(
        "SELECT trace_id, turn_event_id, step1_perception_json, step3_memory_recall_json, step7_emitted_intent_json FROM turn_decision_traces",
      )
    : [];
  const affectedTraces = traces.filter(
    (trace) =>
      rootEventIds.has(trace.turn_event_id) ||
      containsIdentifier(parseJson(trace.step3_memory_recall_json) ?? trace.step3_memory_recall_json, taintedSet),
  );

  const commitments = sql.tableExists("prospective_commitments")
    ? sql.all<CommitmentRow>("SELECT commitment_id, source_event_id FROM prospective_commitments")
    : [];
  const affectedCommitments = commitments.filter((row) => rootEventIds.has(row.source_event_id));

  const sensitiveCheckpointValues = [...rootIds, ...originalSummaries];
  const checkpoints = sql.tableExists("cognitive_state_checkpoints")
    ? sql.all<CheckpointRow>(
        "SELECT state_rev, working_memory_json, state_attributions_json FROM cognitive_state_checkpoints",
      )
    : [];
  const affectedCheckpoints = checkpoints.filter((row) => {
    const material = `${row.working_memory_json}\n${row.state_attributions_json ?? ""}`;
    return sensitiveCheckpointValues.some((value) => Boolean(value) && material.includes(value));
  });

  return {
    requested_event_ids: requestedEventIds,
    requested_memory_ids: requestedMemoryIds,
    root_event_ids: rootIds,
    tainted_memory_ids: [...existingTaintedIds].sort(),
    topological_memory_ids: topologicalIds,
    hard_deleted_memory_ids: topologicalIds.filter((id) => hardDeletedIds.has(id)),
    reprojected_memory_ids: reprojected.map((entry) => entry.memory_id),
    reprojected,
    original_event_summaries: originalSummaries,
    traces: affectedTraces,
    checkpoints: affectedCheckpoints,
    commitments: affectedCommitments,
    affected_trace_ids: affectedTraces.map((row) => row.trace_id).sort(),
    affected_commitment_ids: affectedCommitments.map((row) => row.commitment_id).sort(),
    affected_checkpoint_revs: affectedCheckpoints.map((row) => Number(row.state_rev)).sort((a, b) => a - b),
  };
}

function publicImpact(plan: HardForgetPlan): HardForgetImpact {
  return {
    root_event_ids: [...plan.root_event_ids],
    hard_deleted_memory_ids: [...plan.hard_deleted_memory_ids],
    reprojected_memory_ids: [...plan.reprojected_memory_ids],
    affected_trace_ids: [...plan.affected_trace_ids],
    affected_commitment_ids: [...plan.affected_commitment_ids],
    affected_checkpoint_revs: [...plan.affected_checkpoint_revs],
  };
}

function tombstoneAlreadyExists(sql: SqliteAccess, tombstoneId: string): boolean {
  return Boolean(
    sql.get<{ event_id: string }>(
      "SELECT event_id FROM event_log WHERE event_id = ? AND event_category = 'memory_redacted_tombstone'",
      [tombstoneId],
    ),
  );
}

function chooseTombstoneId(
  sql: SqliteAccess,
  plan: HardForgetPlan,
  request: HardForgetRequest,
  redactedAt: number,
): string | null {
  if (plan.root_event_ids.length === 0) return null;
  if (request.tombstoneEventId) return request.tombstoneEventId;
  for (const eventId of plan.root_event_ids) {
    const row = sql.get<{ redacted_by_event: string | null }>(
      "SELECT redacted_by_event FROM event_log WHERE event_id = ?",
      [eventId],
    );
    if (row?.redacted_by_event && tombstoneAlreadyExists(sql, row.redacted_by_event)) {
      return row.redacted_by_event;
    }
  }
  return makeId("evt_redaction", redactedAt);
}

function appendTombstone(
  sql: SqliteAccess,
  plan: HardForgetPlan,
  tombstoneId: string | null,
  redactedAt: number,
  request: HardForgetRequest,
): void {
  if (!tombstoneId || tombstoneAlreadyExists(sql, tombstoneId)) return;
  const maxima = sql.get<{ max_virtual_ts: number | null; max_state_rev: number | null }>(
    "SELECT MAX(virtual_ts_ms) AS max_virtual_ts, MAX(state_rev_after) AS max_state_rev FROM event_log",
  );
  const virtualTs = request.virtualTsMs ?? Number(maxima?.max_virtual_ts ?? redactedAt);
  const stateRev = Number(maxima?.max_state_rev ?? 0);
  const payload = JSON.stringify({
    target_event_ids: plan.root_event_ids,
    target_memory_ids: plan.requested_memory_ids,
  });
  sql.run(
    `INSERT INTO event_log (
       event_id, wall_ts_ms, virtual_ts_ms, source_shell_id, principal_id,
       principal_trust, venue_type, audience_scope, event_category, modality,
       summary_text, payload_json, state_rev_after, active_modules_mask
     ) VALUES (?, ?, ?, 'kernel.internal', 'system', 'tool_output',
       'internal_background', 'only_owner', 'memory_redacted_tombstone', 'system',
       ?, ?, ?, 0)`,
    [
      tombstoneId,
      redactedAt,
      virtualTs,
      `Owner redaction tombstone (${plan.root_event_ids.length} event(s))`,
      payload,
      stateRev,
    ],
  );
}

function deleteMemoryVector(sql: SqliteAccess, memoryId: string): void {
  if (!sql.tableExists("memories_vec")) return;
  const columns = sql.all<{ name: string }>("PRAGMA table_info(memories_vec)").map((row) => row.name);
  const key = ["memory_id", "id"].find((candidate) => columns.includes(candidate));
  if (!key) return;
  sql.run(`DELETE FROM memories_vec WHERE ${key} = ?`, [memoryId]);
}

function mutateFromPlan(
  sql: SqliteAccess,
  plan: HardForgetPlan,
  request: HardForgetRequest,
  redactedAt: number,
): { tombstoneId: string | null } {
  const tombstoneId = chooseTombstoneId(sql, plan, request, redactedAt);
  appendTombstone(sql, plan, tombstoneId, redactedAt, request);

  for (const eventId of plan.root_event_ids) {
    sql.run(
      `UPDATE event_log
       SET summary_text = ?, payload_json = '{}', redacted_at_ts_ms = ?, redacted_by_event = ?
       WHERE event_id = ?`,
      [OWNER_REDACTION, redactedAt, tombstoneId, eventId],
    );
  }

  const reprojectedById = new Map(plan.reprojected.map((entry) => [entry.memory_id, entry]));
  const hardDeleted = new Set(plan.hard_deleted_memory_ids);
      for (const memoryId of plan.topological_memory_ids) {
    deleteMemoryVector(sql, memoryId);
    if (hardDeleted.has(memoryId)) {
      sql.run(
        "DELETE FROM memory_lineage_edges WHERE child_memory_id = ? OR (parent_type = 'memory' AND parent_id = ?)",
        [memoryId, memoryId],
      );
      sql.run("DELETE FROM memories WHERE memory_id = ?", [memoryId]);
      continue;
    }

    const reprojection = reprojectedById.get(memoryId);
    if (!reprojection) continue;
    sql.run(
      "UPDATE memories SET content_text = ?, invalidated_at_ts = NULL WHERE memory_id = ?",
      [reprojection.content_text, memoryId],
    );
    if (sql.tableExists("memories_vec")) {
      sql.run(
        "INSERT OR REPLACE INTO memories_vec (memory_id, embedding_json) VALUES (?, ?)",
        [memoryId, JSON.stringify(computeDeterministicEmbedding(reprojection.content_text))],
      );
    }
    sql.run("DELETE FROM memory_lineage_edges WHERE child_memory_id = ?", [memoryId]);
    for (const source of reprojection.surviving_sources) {
      const parentType = source.kind === "knowledge_chunk" ? "knowledge_chunk" : source.kind;
      sql.run(
        `INSERT OR IGNORE INTO memory_lineage_edges
         (child_memory_id, parent_type, parent_id, relation_type)
         VALUES (?, ?, ?, 'derived_from')`,
        [memoryId, parentType, source.id],
      );
    }
  }

  const tainted = new Set(plan.tainted_memory_ids);
  const hasShellProcess = sql.tableExists("shell_run_process");
  for (const trace of plan.traces) {
    if (hasShellProcess) {
      sql.run("DELETE FROM shell_run_process WHERE event_id=?", [trace.turn_event_id]);
      // A turn which recalled the forgotten memory can still be delivering its reply.
      // Prevent a late delivery snapshot from restoring its withdrawn reasoning.
      sql.run("UPDATE event_log SET payload_json=json_set(payload_json,'$.shell_process_redacted',1) WHERE event_id=? AND redacted_at_ts_ms IS NULL",
        [trace.turn_event_id]);
    }
    sql.run(
      `UPDATE turn_decision_traces
       SET step1_perception_json = ?, step3_memory_recall_json = ?, step7_emitted_intent_json = ?
       WHERE trace_id = ?`,
      [
        redactPerceptionJson(trace.step1_perception_json),
        redactRecallJson(trace.step3_memory_recall_json, tainted),
        redactIntentJson(trace.step7_emitted_intent_json),
        trace.trace_id,
      ],
    );
  }

  const checkpointSensitiveValues = [...plan.root_event_ids, ...plan.original_event_summaries];
  for (const checkpoint of plan.checkpoints) {
    let working = checkpoint.working_memory_json;
    const saved = JSON.parse(working);
    if (saved?.format === "ai0.coordinator.v1") {
      const snapshot = saved.snapshot;
      const sensitive = (value: unknown) => checkpointSensitiveValues.some(part => part && JSON.stringify(value).includes(part));
      snapshot.D1_WORKING_TURN.recent_turns = snapshot.D1_WORKING_TURN.recent_turns.filter((turn: unknown) => !sensitive(turn));
      snapshot.D1_WORKING_TURN.unsaid_remainder = null;
      snapshot.D5_IDENTITY_NARRATIVE.pending_approvals = snapshot.D5_IDENTITY_NARRATIVE.pending_approvals.filter((item: unknown) => !sensitive(item));
      snapshot.D5_IDENTITY_NARRATIVE.active_tensions = snapshot.D5_IDENTITY_NARRATIVE.active_tensions.filter((item: unknown) => !sensitive(item));
      working = JSON.stringify(saved);
    }
    sql.run(
      `UPDATE cognitive_state_checkpoints
       SET working_memory_json = ?, state_attributions_json = ?
       WHERE state_rev = ?`,
      [
        replaceSensitiveOccurrences(working, checkpointSensitiveValues),
        replaceSensitiveOccurrences(checkpoint.state_attributions_json, checkpointSensitiveValues),
        checkpoint.state_rev,
      ],
    );
  }

  for (const commitment of plan.commitments) {
    sql.run("DELETE FROM prospective_commitments WHERE commitment_id = ?", [commitment.commitment_id]);
  }

  return { tombstoneId };
}

export interface LegacyRedactionLedgerEntry {
  target_event_ids: string[];
  target_memory_ids: string[];
  redacted_at_wall_ts: number | string;
}

function ledgerEntries(value: unknown): RedactionLedgerEntry[] {
  const raw = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
  return raw
    .filter(isRecord)
    .map((entry) => ({
      target_event_ids: uniqueIds(
        Array.isArray(entry.target_event_ids)
          ? entry.target_event_ids.filter((item): item is string => typeof item === "string")
          : [],
      ),
      target_memory_ids: uniqueIds(
        Array.isArray(entry.target_memory_ids)
          ? entry.target_memory_ids.filter((item): item is string => typeof item === "string")
          : [],
      ),
      redacted_at_wall_ts:
        typeof entry.redacted_at_wall_ts === "number"
          ? entry.redacted_at_wall_ts
          : Number(entry.redacted_at_wall_ts) || Date.now(),
    }))
    .filter((entry) => entry.target_event_ids.length > 0 || entry.target_memory_ids.length > 0);
}

async function appendLedgerEntry(path: string, entry: RedactionLedgerEntry): Promise<void> {
  let existing: RedactionLedgerEntry[] = [];
  try {
    existing = ledgerEntries(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") throw error;
  }
  const output = `${JSON.stringify([...existing, entry], null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(temporary, output, "utf8");
  try {
    await rename(temporary, path);
  } catch {
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

export class HardForgetEngine {
  readonly database: HardForgetDatabase;

  constructor(database: HardForgetDatabase) {
    this.database = database;
  }

  preview(request: HardForgetRequest): HardForgetPreview {
    const sql = new SqliteAccess(this.database);
    const plan = buildPlan(sql, request, request.microReprojector ?? defaultMicroReprojector);
    return { ...publicImpact(plan), dry_run_preview: true };
  }

  previewHardForgetRadius(request: HardForgetRequest): HardForgetPreview {
    return this.preview({ ...request, dry_run_preview: true });
  }

  async execute(request: HardForgetRequest): Promise<HardForgetResult | HardForgetPreview> {
    if (request.dry_run_preview) return this.preview(request);
    const sql = new SqliteAccess(this.database);
    const redactedAt = request.redactedAtTsMs ?? Date.now();
    try {
      sql.exec("PRAGMA secure_delete = ON");
    } catch {
      // Some test adapters do not expose PRAGMA; managed table scrubbing still proceeds.
    }

    let plan!: HardForgetPlan;
    let tombstoneId: string | null = null;
    sql.transaction(() => {
      plan = buildPlan(sql, request, request.microReprojector ?? defaultMicroReprojector);
      tombstoneId = mutateFromPlan(sql, plan, request, redactedAt).tombstoneId;
    });

    try {
      sql.exec("PRAGMA incremental_vacuum");
    } catch {
      // incremental_vacuum is unavailable for some SQLite builds and in-memory tests.
    }

    const ledgerPath = request.redactionLedgerPath ??
      (request.soulDirPath ? join(request.soulDirPath, "state", "redaction_ledger.json") : undefined);
    if (ledgerPath && !request.skipLedgerAppend) {
      await appendLedgerEntry(ledgerPath, {
        target_event_ids: plan.root_event_ids,
        target_memory_ids: plan.requested_memory_ids,
        redacted_at_wall_ts: redactedAt,
      });
    }

    return {
      ...publicImpact(plan),
      dry_run_preview: false,
      reprojected_memories: plan.reprojected.map(({ old_memory: _oldMemory, ...entry }) => entry),
      tombstone_event_id: tombstoneId,
      redacted_at_wall_ts: redactedAt,
    };
  }

  async executeHardForget(request: HardForgetRequest): Promise<HardForgetResult | HardForgetPreview> {
    return this.execute(request);
  }

  async executeTopicSeal(request: TopicSealRequest): Promise<TopicSealResult> {
    const hasForgetTargets =
      uniqueIds(request.target_event_ids).length > 0 || uniqueIds(request.target_memory_ids).length > 0;
    const hardForgetResult = hasForgetTargets
      ? ((await this.execute({ ...request, dry_run_preview: false })) as HardForgetResult)
      : null;

    const sql = new SqliteAccess(this.database);
    const now = request.redactedAtTsMs ?? Date.now();
    const virtualTs = request.created_virtual_ts ?? request.virtualTsMs ?? now;
    const memoryId = request.memory_id ?? makeId("mem_topic_seal", now);
    const maxRev = sql.get<{ max_rev: number | null }>(
      "SELECT MAX(created_at_rev) AS max_rev FROM memories",
    );
    sql.transaction(() => {
      sql.run(
        `INSERT INTO memories (
           memory_id, memory_tier, epistemic_type, attributed_principal,
           visibility_scope, taint_level, content_text, emotional_valence,
           emotional_arousal, base_importance, stability_half_life, recall_count,
           created_virtual_ts, last_recalled_ts, valid_from_virtual_ts,
           valid_until_virtual_ts, expires_virtual_ts, grounding_status,
           invalidated_at_ts, created_at_rev
         ) VALUES (?, 'topic_taboo_seal', 'observed_firsthand', ?, ?,
           'trusted_owner', ?, -1.0, 1.0, 1.0, 876000.0, 0, ?, ?, ?,
           NULL, NULL, 'not_applicable', NULL, ?)`,
        [
    memoryId,
          request.attributed_principal ?? "owner",
          request.visibility_scope ?? "only_owner",
        request.topic_description,
          virtualTs,
          virtualTs,
          virtualTs,
          request.created_at_rev ?? Number(maxRev?.max_rev ?? 0),
        ],
      );
      if (sql.tableExists("memories_vec")) {
        sql.run(
          "INSERT OR REPLACE INTO memories_vec (memory_id, embedding_json) VALUES (?, ?)",
          [memoryId, JSON.stringify(computeDeterministicEmbedding(request.topic_description))],
        );
      }
    });

    return { topic_seal_memory_id: memoryId, hard_forget_result: hardForgetResult };
  }
}

export function previewHardForgetRadius(
  database: HardForgetDatabase,
  request: HardForgetRequest,
): HardForgetPreview {
  return new HardForgetEngine(database).preview(request);
}

export async function executeHardForget(
  database: HardForgetDatabase,
  request: HardForgetRequest,
): Promise<HardForgetResult | HardForgetPreview> {
  return new HardForgetEngine(database).execute(request);
}

export async function executeTopicSeal(
  database: HardForgetDatabase,
  request: TopicSealRequest,
): Promise<TopicSealResult> {
  return new HardForgetEngine(database).executeTopicSeal(request);
}

export { FORGET_REDACTION, OWNER_REDACTION };
import { computeDeterministicEmbedding } from "../sqlite/database-driver.js";
import type { RedactionLedgerEntry } from "../snapshot-git/soul-directory.js";
