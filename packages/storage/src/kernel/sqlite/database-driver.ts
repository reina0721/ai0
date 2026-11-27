import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue
} from "node:sqlite";

import {
  VerifiableTurnTraceSchema,
  type AudienceScope,
  type ChannelRunProcess,
  type EpistemicType,
  type GroundingStatus,
  type LineageRelationType,
  type MemoryTier,
  type MilestoneCategory,
  type PrincipalTrust,
  type TaintLevel,
  type VerifiableTurnTrace
} from "@ai0/protocol";

import {
  type EventListQuery,
  type EventLogEntry,
  type StoredEventLogEntry
} from "../event-log/index.js";
import { applyStorageSchema } from "./schema-ddl.js";

const DEFAULT_QUERY_LIMIT = 100;
const EMBEDDING_DIMENSIONS = 16;
const TARGET_INSTANCE_STORAGE_KEY = "__ai0_target_instance";

export type LineageParentType = "event" | "memory" | "knowledge_chunk";
export type CommitmentKind =
  | "agent_promise"
  | "user_upcoming_event"
  | "curiosity_agenda";
export type CommitmentTriggerType =
  | "at_virtual_ts"
  | "on_next_interaction_after_ts"
  | "on_idle_window";
export type CommitmentStatus =
  | "pending"
  | "due"
  | "fulfilled"
  | "missed"
  | "cancelled";

export interface MemoryInput {
  memory_id: string;
  memory_tier: MemoryTier;
  epistemic_type: EpistemicType;
  attributed_principal: string;
  visibility_scope: AudienceScope;
  taint_level: TaintLevel;
  content_text: string;
  emotional_valence?: number;
  emotional_arousal?: number;
  base_importance?: number;
  stability_half_life?: number;
  recall_count?: number;
  created_virtual_ts: number;
  last_recalled_ts: number;
  valid_from_virtual_ts: number;
  valid_until_virtual_ts?: number | null;
  expires_virtual_ts?: number | null;
  grounding_status?: GroundingStatus;
  invalidated_at_ts?: number | null;
  created_at_rev: number;
  premise_quantifier?: "all_of" | "any_of";
  min_premise_count?: number;
}

export interface StoredMemory extends MemoryInput {
  emotional_valence: number;
  emotional_arousal: number;
  base_importance: number;
  stability_half_life: number;
  recall_count: number;
  valid_until_virtual_ts: number | null;
  expires_virtual_ts: number | null;
  grounding_status: GroundingStatus;
  invalidated_at_ts: number | null;
}

export interface MemoryLineageEdgeInput {
  child_memory_id?: string;
  parent_type: LineageParentType;
  parent_id: string;
  relation_type?: LineageRelationType;
}

export interface MemoryLineageEdge {
  child_memory_id: string;
  parent_type: LineageParentType;
  parent_id: string;
  relation_type: LineageRelationType;
}

export interface MemoryAudienceQuery {
  audience_scope: AudienceScope;
  principal_trust: PrincipalTrust;
  query_text?: string;
  embedding?: ReadonlyArray<number>;
  memory_tier?: MemoryTier;
  memory_ids?: readonly string[];
  current_virtual_ts?: number;
  limit?: number;
}

export interface MemorySearchResult extends StoredMemory {
  similarity: number;
}

export interface ProspectiveCommitmentInput {
  commitment_id: string;
  commitment_kind: CommitmentKind;
  visibility_scope: AudienceScope;
  taint_level?: TaintLevel;
  description: string;
  trigger_type: CommitmentTriggerType;
  trigger_virtual_ts: number;
  deadline_virtual_ts?: number | null;
  status: CommitmentStatus;
  source_event_id: string;
  resolved_event_id?: string | null;
}

export interface ProspectiveCommitment extends ProspectiveCommitmentInput {
  taint_level: TaintLevel;
  deadline_virtual_ts: number | null;
  resolved_event_id: string | null;
}

export interface CommitmentListQuery {
  status?: CommitmentStatus;
  due_at_or_before_virtual_ts?: number;
  limit?: number;
}

export interface CognitiveStateCheckpoint {
  state_rev: number;
  virtual_ts_ms: number;
  caused_by_event_id: string;
  continuous_states_json: string;
  state_attributions_json: string;
  relationship_json: string;
  user_model_json: string;
  working_memory_json: string;
  hibernation_intervals_json: string;
  next_wakeup_ts_ms?: number | null;
}

export type TurnTraceDeliveryReceipt = NonNullable<
  VerifiableTurnTrace["steps"]["step8_delivery_receipt"]
>;

export interface KnowledgeChunkInput {
  chunk_id: string;
  collection_id: string;
  document_name: string;
  chunk_index: number;
  content_text: string;
  metadata_json?: string;
  taint_level?: "untrusted_external";
  citation_count?: number;
  last_cited_ts_ms?: number | null;
  created_at_ts_ms: number;
}

export interface KnowledgeChunk extends KnowledgeChunkInput {
  metadata_json: string;
  taint_level: "untrusted_external";
  citation_count: number;
  last_cited_ts_ms: number | null;
}

export interface KnowledgeChunkQuery {
  query_text?: string;
  embedding?: ReadonlyArray<number>;
  collection_id?: string;
  limit?: number;
}

export interface KnowledgeChunkSearchResult extends KnowledgeChunk {
  similarity: number;
}

export interface KnowledgeChunkFtsQuery {
  query_text: string;
  collection_id?: string;
  limit?: number;
}

export interface KnowledgeChunkFtsSearchResult extends KnowledgeChunk {
  /** Raw SQLite FTS5 BM25 rank. Lower values are more relevant. */
  bm25_score: number;
}

export interface SoulMilestoneInput {
  milestone_id: string;
  title: string;
  category: MilestoneCategory;
  unlocked_virtual_ts: number;
  trigger_event_id: string;
  unlocked_rewards_json?: string;
  state_rev_unlocked: number;
}

export interface SoulMilestone extends SoulMilestoneInput {
  unlocked_rewards_json: string;
}

export interface Sb243AnnualMetric {
  year_month: string;
  crisis_referral_triggered_count: number;
}

export interface TablePragmaStatus {
  journal_mode: string;
  foreign_keys: number;
  secure_delete: number;
}

/**
 * The capability handed to workers and cognitive organs. It intentionally has
 * no write operation, no database handle, and no raw-SQL escape hatch.
 */
export interface ReadOnlyStorageView {
  getLatestCheckpoint(): CognitiveStateCheckpoint | undefined;
  listEvents(query?: EventListQuery): StoredEventLogEntry[];
  getEventById(eventId: string): StoredEventLogEntry | undefined;
  queryMemoriesWithAudienceGuard(
    query: MemoryAudienceQuery
  ): MemorySearchResult[];
  getMemoryLineage(memoryId: string): MemoryLineageEdge[];
  listCommitments(
    query?: CommitmentListQuery | CommitmentStatus
  ): ProspectiveCommitment[];
  listDecisionTraces(limit?: number): VerifiableTurnTrace[];
  getDecisionTraceByEvent(eventId: string): VerifiableTurnTrace | undefined;
  queryKnowledgeChunks(
    query: KnowledgeChunkQuery | string
  ): KnowledgeChunkSearchResult[];
  queryKnowledgeChunksByFts(
    query: KnowledgeChunkFtsQuery
  ): KnowledgeChunkFtsSearchResult[];
  listCitedKnowledgeChunks(collectionId: string): KnowledgeChunk[];
  listMilestones(limit?: number): SoulMilestone[];
  getSb243Metrics(): Sb243AnnualMetric[];
  getSb243Metrics(yearMonth: string): Sb243AnnualMetric | undefined;
  getLastAliveHeartbeat(): number | null;
  getTablePragmaStatus(): TablePragmaStatus;
}

export interface StorageBeliefRevisionInput {
  readonly target_memory_id: string;
  readonly relation: "supersedes" | "contradicts";
  readonly replacement_memory?: {
    readonly memory_id: string;
    readonly content_text: string;
    readonly memory_tier: string;
    readonly epistemic_type: string;
    readonly visibility_scope: AudienceScope;
    readonly taint_level: TaintLevel;
    readonly attributed_principal?: string;
    readonly source_event_ids: readonly string[];
  };
  readonly virtual_ts_ms: number;
  readonly state_rev: number;
  readonly cancel_dependent_commitments?: boolean;
}

export interface StorageBeliefRevisionResult {
  readonly target_updated: boolean;
  readonly replacement_memory?: StoredMemory;
  readonly invalidated_memory_ids: readonly string[];
  readonly affected_commitment_ids: readonly string[];
}

export interface StoredToolExecutionIdempotency {
  readonly idempotency_key: string;
  readonly scope_id: string;
  readonly tool_name: string;
  readonly input_hash: string;
  readonly result_json: string;
  readonly recorded_at_step: number;
  readonly created_virtual_ts: number;
}

export interface CoordinatorStorageOptions {
  initializeSchema?: boolean;
}

function normalizeStorageMemoryTier(tier: string): MemoryTier {
  if (
    tier === "episodic_experience" ||
    tier === "semantic_fact" ||
    tier === "relational_tacit" ||
    tier === "kb_crystallized_gist" ||
    tier === "topic_taboo_seal"
  ) {
    return tier;
  }
  return "episodic_experience";
}

function normalizeStorageEpistemicType(epistemicType: string): EpistemicType {
  if (
    epistemicType === "observed_firsthand" ||
    epistemicType === "reported_hearsay" ||
    epistemicType === "inferred_hypothesis" ||
    epistemicType === "imagined_narrative"
  ) {
    return epistemicType;
  }
  return "observed_firsthand";
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_QUERY_LIMIT;
  return Math.max(1, Math.min(1_000, Math.trunc(limit)));
}

function buildFts5MatchExpression(queryText: string): string | undefined {
  const tokens = queryText
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}_]+/gu);
  if (tokens === null) return undefined;

  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return undefined;
  return uniqueTokens
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function plainRow<T>(row: Record<string, SQLOutputValue>): T {
  return { ...row } as T;
}

function plainRows<T>(rows: Record<string, SQLOutputValue>[]): T[] {
  return rows.map((row) => plainRow<T>(row));
}

function parseEmbedding(value: SQLOutputValue): number[] | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some(
        (component) =>
          typeof component !== "number" || !Number.isFinite(component)
      )
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function vecCosineSimilarity(
  vectorAJson: SQLOutputValue,
  vectorBJson: SQLOutputValue
): number {
  const vectorA = parseEmbedding(vectorAJson);
  const vectorB = parseEmbedding(vectorBJson);
  if (vectorA === undefined || vectorB === undefined) return 0;
  if (vectorA.length !== vectorB.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < vectorA.length; index += 1) {
    const componentA = vectorA[index];
    const componentB = vectorB[index];
    if (componentA === undefined || componentB === undefined) return 0;
    dotProduct += componentA * componentB;
    magnitudeA += componentA * componentA;
    magnitudeB += componentB * componentB;
  }

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  const similarity = dotProduct / Math.sqrt(magnitudeA * magnitudeB);
  return Math.max(-1, Math.min(1, similarity));
}

/** A stable local fallback for archives that have no external embedder. */
export function computeDeterministicEmbedding(text: string): number[] {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase("en-US");
  const paddedCharacters = Array.from(`^^${normalizedText}$$`);
  const embedding = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);

  for (let offset = 0; offset <= paddedCharacters.length - 3; offset += 1) {
    const trigram = paddedCharacters.slice(offset, offset + 3).join("");
    let hash = 2_166_136_261;
    for (const character of trigram) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    const dimension = hash & (EMBEDDING_DIMENSIONS - 1);
    const sign = (hash & EMBEDDING_DIMENSIONS) === 0 ? 1 : -1;
    const previous = embedding[dimension] ?? 0;
    embedding[dimension] = previous + sign;
  }

  const norm = Math.sqrt(
    embedding.reduce((sum, component) => sum + component * component, 0)
  );
  if (norm === 0) return embedding;
  return embedding.map((component) => component / norm);
}

function embeddingJson(
  externalEmbedding: ReadonlyArray<number> | undefined,
  fallbackText: string
): string {
  const embedding =
    externalEmbedding === undefined
      ? computeDeterministicEmbedding(fallbackText)
      : Array.from(externalEmbedding);
  if (
    embedding.length === 0 ||
    embedding.some((component) => !Number.isFinite(component))
  ) {
    throw new TypeError("Embeddings must contain finite numeric components.");
  }
  return JSON.stringify(embedding);
}

function registerVectorFunction(database: DatabaseSync): void {
  database.function(
    "vec_cosine_similarity",
    { deterministic: true },
    vecCosineSimilarity
  );
}

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

/**
 * The sole authoritative write capability. Only the kernel's
 * AuthoritativeStateCoordinator should retain this class.
 */
export class CoordinatorStorageMutator implements ReadOnlyStorageView {
  get sqlite(): DatabaseSync {
    return this.#database;
  }

  readonly #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string, options: CoordinatorStorageOptions = {}) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.#database = new DatabaseSync(databasePath);
    registerVectorFunction(this.#database);
    if (options.initializeSchema !== false) {
      applyStorageSchema(this.#database);
    } else {
      this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;");
    }
  }

  /** Narrows the capability at the type boundary used by workers and organs. */
  asReadOnlyView(): ReadOnlyStorageView {
    return this;
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  runInTransaction<T>(
    operation: (storage: CoordinatorStorageMutator) => T
  ): T {
    if (this.#database.isTransaction) return operation(this);

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation(this);
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  appendEvent(event: EventLogEntry): StoredEventLogEntry {
    this.#database
      .prepare(
        `INSERT INTO event_log (
          event_id, wall_ts_ms, virtual_ts_ms, source_channel_id,
          principal_id, principal_trust, venue_type, audience_scope,
          event_category, modality, summary_text, payload_json,
          state_rev_after, active_modules_mask, redacted_at_ts_ms,
          redacted_by_event
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.event_id,
        event.wall_ts_ms,
        event.virtual_ts_ms,
        event.source_channel_id,
        event.principal_id,
        event.principal_trust,
        event.venue_type,
        event.audience_scope,
        event.event_category,
        event.modality,
        event.summary_text,
        event.payload_json,
        event.state_rev_after,
        event.active_modules_mask,
        event.redacted_at_ts_ms ?? null,
        event.redacted_by_event ?? null
      );

    const stored = this.getEventById(event.event_id);
    if (stored === undefined) throw new Error("Appended event could not be read back.");
    return stored;
  }

  insertMemoryWithLineage(
    memory: MemoryInput,
    edges: ReadonlyArray<MemoryLineageEdgeInput>,
    embedding?: ReadonlyArray<number>
  ): StoredMemory {
    return this.runInTransaction(() => {
      this.#database
        .prepare(
          `INSERT INTO memories (
            memory_id, memory_tier, epistemic_type, attributed_principal,
            visibility_scope, taint_level, content_text, emotional_valence,
            emotional_arousal, base_importance, stability_half_life,
            recall_count, created_virtual_ts, last_recalled_ts,
            valid_from_virtual_ts, valid_until_virtual_ts, expires_virtual_ts,
            grounding_status, invalidated_at_ts, created_at_rev
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          memory.memory_id,
          memory.memory_tier,
          memory.epistemic_type,
          memory.attributed_principal,
          memory.visibility_scope,
          memory.taint_level,
          memory.content_text,
          memory.emotional_valence ?? 0,
          memory.emotional_arousal ?? 0,
          memory.base_importance ?? 0.5,
          memory.stability_half_life ?? 168,
          memory.recall_count ?? 0,
          memory.created_virtual_ts,
          memory.last_recalled_ts,
          memory.valid_from_virtual_ts,
          memory.valid_until_virtual_ts ?? null,
          memory.expires_virtual_ts ?? null,
          memory.grounding_status ?? "not_applicable",
          memory.invalidated_at_ts ?? null,
          memory.created_at_rev
        );

      const insertEdge = this.#database.prepare(
        `INSERT INTO memory_lineage_edges (
          child_memory_id, parent_type, parent_id, relation_type
        ) VALUES (?, ?, ?, ?)`
      );
      for (const edge of edges) {
        if (
          edge.child_memory_id !== undefined &&
          edge.child_memory_id !== memory.memory_id
        ) {
          throw new Error(
            "A lineage edge child_memory_id must match the inserted memory."
          );
        }
        insertEdge.run(
          memory.memory_id,
          edge.parent_type,
          edge.parent_id,
          edge.relation_type ?? "derived_from"
        );
      }

      this.#database
        .prepare(
          "INSERT INTO memories_vec (memory_id, embedding_json) VALUES (?, ?)"
        )
        .run(memory.memory_id, embeddingJson(embedding, memory.content_text));

      if (memory.premise_quantifier !== undefined || memory.min_premise_count !== undefined) {
        this.setMemoryPremisePolicy(
          memory.memory_id,
          memory.premise_quantifier ?? "all_of",
          memory.min_premise_count ?? 1
        );
      }

      const stored = this.getMemoryById(memory.memory_id);
      if (stored === undefined) throw new Error("Inserted memory could not be read back.");
      return stored;
    });
  }

  supersedeMemory(
    oldMemoryId: string,
    newMemory: MemoryInput,
    edges: ReadonlyArray<MemoryLineageEdgeInput>,
    validUntilVirtualTs: number
  ): StoredMemory {
    return this.runInTransaction(() => {
      const updateResult = this.#database
        .prepare(
          "UPDATE memories SET valid_until_virtual_ts = ? WHERE memory_id = ?"
        )
        .run(validUntilVirtualTs, oldMemoryId);
      if (Number(updateResult.changes) !== 1) {
        throw new Error(`Cannot supersede missing memory: ${oldMemoryId}`);
      }

      const hasSupersedesEdge = edges.some(
        (edge) =>
          edge.parent_type === "memory" &&
          edge.parent_id === oldMemoryId &&
          (edge.relation_type ?? "derived_from") === "supersedes"
      );
      const completeEdges = hasSupersedesEdge
        ? edges
        : [
            ...edges,
            {
              parent_type: "memory" as const,
              parent_id: oldMemoryId,
              relation_type: "supersedes" as const
            }
          ];
      return this.insertMemoryWithLineage(newMemory, completeEdges);
    });
  }

  updateMemoryGroundingStatus(
    memoryId: string,
    status: GroundingStatus
  ): void {
    const result = this.#database
      .prepare("UPDATE memories SET grounding_status = ? WHERE memory_id = ?")
      .run(status, memoryId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Cannot update missing memory: ${memoryId}`);
    }
  }

  getMemoryRecord(memoryId: string): StoredMemory | undefined {
    return this.getMemoryById(memoryId);
  }

  bindChannelPrincipal(
    channelId: string,
    externalId: string,
    principalId: string
  ): void {
    this.#database
      .prepare(
        `INSERT INTO channel_principal_bindings (channel_id, external_id, principal_id)
         VALUES (?, ?, ?)
         ON CONFLICT(channel_id, external_id) DO UPDATE SET principal_id = excluded.principal_id`
      )
      .run(channelId, externalId, principalId);
  }

  resolveChannelPrincipal(
    channelId: string,
    externalId: string
  ): string | undefined {
    const row = this.#database
      .prepare(
        `SELECT principal_id FROM channel_principal_bindings
         WHERE channel_id = ? AND external_id = ?`
      )
      .get(channelId, externalId);
    return typeof row?.principal_id === "string" ? row.principal_id : undefined;
  }

  setMemoryPremisePolicy(
    memoryId: string,
    quantifier: "all_of" | "any_of",
    minPremiseCount = 1
  ): void {
    const safeMin = Math.max(1, Math.trunc(minPremiseCount));
    this.#database
      .prepare(
        `INSERT INTO memory_premise_policies (memory_id, quantifier, min_premise_count)
         VALUES (?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           quantifier = excluded.quantifier,
           min_premise_count = excluded.min_premise_count`
      )
      .run(memoryId, quantifier, safeMin);
  }

  getMemoryPremisePolicy(memoryId: string): {
    quantifier: "all_of" | "any_of";
    min_premise_count: number;
  } {
    const row = this.#database
      .prepare(
        `SELECT quantifier, min_premise_count FROM memory_premise_policies
         WHERE memory_id = ?`
      )
      .get(memoryId);
    return {
      quantifier: row?.quantifier === "any_of" ? "any_of" : "all_of",
      min_premise_count: Math.max(1, Number(row?.min_premise_count ?? 1))
    };
  }

  saveToolExecutionIdempotency(entry: StoredToolExecutionIdempotency): void {
    this.#database
      .prepare(
        `INSERT INTO tool_execution_idempotency (
          idempotency_key, scope_id, tool_name, input_hash,
          result_json, recorded_at_step, created_virtual_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          result_json = excluded.result_json,
          recorded_at_step = excluded.recorded_at_step`
      )
      .run(
        entry.idempotency_key,
        entry.scope_id,
        entry.tool_name,
        entry.input_hash,
        entry.result_json,
        entry.recorded_at_step,
        entry.created_virtual_ts
      );
  }

  getToolExecutionIdempotency(
    idempotencyKey: string
  ): StoredToolExecutionIdempotency | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM tool_execution_idempotency WHERE idempotency_key = ?`
      )
      .get(idempotencyKey);
    return row === undefined
      ? undefined
      : plainRow<StoredToolExecutionIdempotency>(row);
  }

  listToolExecutionIdempotencyByScope(
    scopeId: string
  ): StoredToolExecutionIdempotency[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM tool_execution_idempotency
         WHERE scope_id = ?
         ORDER BY recorded_at_step ASC`
      )
      .all(scopeId);
    return plainRows<StoredToolExecutionIdempotency>(rows);
  }

  /**
   * Epistemic Belief Revision (distinct from privacy HardForget):
   * Retains historical falsified/superseded memory text for audit, marks `grounding_status = 'disputed_retired'`
   * and `invalidated_at_ts` / `valid_until_virtual_ts`, inserts any replacement memory with `supersedes` or
   * `contradicts` lineage edge, cascades invalidation across derived child memories (`derived_from` /
   * `crystallized_from`), and flags/cancels pending commitments sharing refuted source events.
   */
  reviseBeliefLineage(
    input: StorageBeliefRevisionInput
  ): StorageBeliefRevisionResult {
    return this.runInTransaction(() => {
      const target = this.getMemoryById(input.target_memory_id);
      if (target === undefined) {
        return {
          target_updated: false,
          invalidated_memory_ids: [],
          affected_commitment_ids: []
        };
      }

      const retireStmt = this.#database.prepare(
        `UPDATE memories
         SET valid_until_virtual_ts = COALESCE(valid_until_virtual_ts, ?),
             invalidated_at_ts = COALESCE(invalidated_at_ts, ?),
             grounding_status = 'disputed_retired'
         WHERE memory_id = ?`
      );
      retireStmt.run(
        input.virtual_ts_ms,
        input.virtual_ts_ms,
        input.target_memory_id
      );

      let storedReplacement: StoredMemory | undefined;
      if (input.replacement_memory !== undefined) {
        const rep = input.replacement_memory;
        const existingRep = this.getMemoryById(rep.memory_id);
        if (existingRep !== undefined) {
          storedReplacement = existingRep;
        } else {
          const edges: MemoryLineageEdgeInput[] = [
            {
              parent_type: "memory",
              parent_id: input.target_memory_id,
              relation_type: input.relation
            },
            ...rep.source_event_ids.map((eventId) => ({
              parent_type: "event" as const,
              parent_id: eventId,
              relation_type: "derived_from" as const
            }))
          ];
          storedReplacement = this.insertMemoryWithLineage(
            {
              memory_id: rep.memory_id,
              memory_tier: normalizeStorageMemoryTier(rep.memory_tier),
              epistemic_type: normalizeStorageEpistemicType(rep.epistemic_type),
              attributed_principal:
                rep.attributed_principal ?? target.attributed_principal,
              visibility_scope: rep.visibility_scope,
              taint_level: rep.taint_level,
              content_text: rep.content_text,
              created_virtual_ts: input.virtual_ts_ms,
              last_recalled_ts: input.virtual_ts_ms,
              valid_from_virtual_ts: input.virtual_ts_ms,
              created_at_rev: input.state_rev
            },
            edges
          );
        }
      }

      const invalidated = new Set<string>([input.target_memory_id]);
      const queue: string[] = [input.target_memory_id];
      const childStmt = this.#database.prepare(
        `SELECT child_memory_id FROM memory_lineage_edges
         WHERE parent_type = 'memory'
           AND parent_id = ?
           AND relation_type IN ('derived_from', 'crystallized_from')`
      );
      const policyStmt = this.#database.prepare(
        `SELECT quantifier, min_premise_count FROM memory_premise_policies WHERE memory_id = ?`
      );
      const activeParentCountStmt = this.#database.prepare(
        `SELECT COUNT(*) AS cnt
         FROM memory_lineage_edges e
         JOIN memories p ON p.memory_id = e.parent_id
         WHERE e.child_memory_id = ?
           AND e.parent_type = 'memory'
           AND e.relation_type IN ('derived_from', 'crystallized_from')
           AND p.invalidated_at_ts IS NULL`
      );
      while (queue.length > 0) {
        const currentParentId = queue.shift()!;
        const childRows = childStmt.all(currentParentId) as Array<{
          child_memory_id: string;
        }>;
        for (const row of childRows) {
          const childId = String(row.child_memory_id);
          if (invalidated.has(childId)) continue;
          const policyRow = policyStmt.get(childId) as
            | { quantifier?: string; min_premise_count?: number }
            | undefined;
          if (policyRow?.quantifier === "any_of") {
            const minCount = Math.max(1, Number(policyRow.min_premise_count ?? 1));
            const activeRow = activeParentCountStmt.get(childId) as { cnt?: number } | undefined;
            if (Number(activeRow?.cnt ?? 0) >= minCount) {
              continue;
            }
          }
          invalidated.add(childId);
          retireStmt.run(input.virtual_ts_ms, input.virtual_ts_ms, childId);
          queue.push(childId);
        }
      }

      const eventParents = new Set<string>();
      const eventParentStmt = this.#database.prepare(
        `SELECT parent_id FROM memory_lineage_edges
         WHERE child_memory_id = ? AND parent_type = 'event'`
      );
      for (const memId of invalidated) {
        const rows = eventParentStmt.all(memId) as Array<{ parent_id: string }>;
        for (const r of rows) {
          eventParents.add(String(r.parent_id));
        }
      }

      const affectedCommitments: string[] = [];
      if (eventParents.size > 0) {
        const commitmentRows = this.#database
          .prepare(
            `SELECT commitment_id FROM prospective_commitments
             WHERE source_event_id IN (SELECT value FROM json_each(?))
               AND status IN ('pending', 'due')`
          )
          .all(JSON.stringify([...eventParents])) as Array<{
          commitment_id: string;
        }>;
        for (const c of commitmentRows) {
          affectedCommitments.push(String(c.commitment_id));
        }
        if (
          affectedCommitments.length > 0 &&
          input.cancel_dependent_commitments === true
        ) {
          this.#database
            .prepare(
              `UPDATE prospective_commitments
               SET status = 'cancelled'
               WHERE commitment_id IN (SELECT value FROM json_each(?))`
            )
            .run(JSON.stringify(affectedCommitments));
        }
      }

      return {
        target_updated: true,
        ...(storedReplacement !== undefined
          ? { replacement_memory: storedReplacement }
          : {}),
        invalidated_memory_ids: [...invalidated],
        affected_commitment_ids: affectedCommitments
      };
    });
  }

  upsertCommitment(
    commitment: ProspectiveCommitmentInput
  ): ProspectiveCommitment {
    this.#database
      .prepare(
        `INSERT INTO prospective_commitments (
          commitment_id, commitment_kind, visibility_scope, taint_level,
          description, trigger_type, trigger_virtual_ts, deadline_virtual_ts,
          status, source_event_id, resolved_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(commitment_id) DO UPDATE SET
          commitment_kind = excluded.commitment_kind,
          visibility_scope = excluded.visibility_scope,
          taint_level = excluded.taint_level,
          description = excluded.description,
          trigger_type = excluded.trigger_type,
          trigger_virtual_ts = excluded.trigger_virtual_ts,
          deadline_virtual_ts = excluded.deadline_virtual_ts,
          status = excluded.status,
          source_event_id = excluded.source_event_id,
          resolved_event_id = excluded.resolved_event_id`
      )
      .run(
        commitment.commitment_id,
        commitment.commitment_kind,
        commitment.visibility_scope,
        commitment.taint_level ?? "trusted_owner",
        commitment.description,
        commitment.trigger_type,
        commitment.trigger_virtual_ts,
        commitment.deadline_virtual_ts ?? null,
        commitment.status,
        commitment.source_event_id,
        commitment.resolved_event_id ?? null
      );

    const stored = this.#database
      .prepare(
        "SELECT * FROM prospective_commitments WHERE commitment_id = ?"
      )
      .get(commitment.commitment_id);
    if (stored === undefined) throw new Error("Commitment could not be read back.");
    return plainRow<ProspectiveCommitment>(stored);
  }

  saveCheckpoint(
    checkpoint: CognitiveStateCheckpoint
  ): CognitiveStateCheckpoint {
    this.#database
      .prepare(
        `INSERT INTO cognitive_state_checkpoints (
          state_rev,
          virtual_ts_ms,
          caused_by_event_id,
          continuous_states_json,
          state_attributions_json,
          relationship_json,
          user_model_json,
          working_memory_json,
          hibernation_intervals_json,
          next_wakeup_ts_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(state_rev) DO UPDATE SET
          virtual_ts_ms = excluded.virtual_ts_ms,
          caused_by_event_id = excluded.caused_by_event_id,
          continuous_states_json = excluded.continuous_states_json,
          state_attributions_json = excluded.state_attributions_json,
          relationship_json = excluded.relationship_json,
          user_model_json = excluded.user_model_json,
          working_memory_json = excluded.working_memory_json,
          hibernation_intervals_json = excluded.hibernation_intervals_json,
          next_wakeup_ts_ms = excluded.next_wakeup_ts_ms`
      )
      .run(
        checkpoint.state_rev,
        checkpoint.virtual_ts_ms,
        checkpoint.caused_by_event_id,
        checkpoint.continuous_states_json,
        checkpoint.state_attributions_json,
        checkpoint.relationship_json,
        checkpoint.user_model_json,
        checkpoint.working_memory_json,
        checkpoint.hibernation_intervals_json,
        checkpoint.next_wakeup_ts_ms ?? null
      );
    return this.getCheckpointByRevision(checkpoint.state_rev) ?? checkpoint;
  }

  saveTurnDecisionTrace(trace: VerifiableTurnTrace): VerifiableTurnTrace {
    const validatedTrace = VerifiableTurnTraceSchema.parse(trace);
    const storedStepOne = {
      ...validatedTrace.steps.step1_perception,
      [TARGET_INSTANCE_STORAGE_KEY]: validatedTrace.target_instance
    };
    this.#database
      .prepare(
        `INSERT INTO turn_decision_traces (
          trace_id, turn_event_id, virtual_ts_ms, state_rev_before,
          state_rev_after, step1_perception_json, step2_gate_safety_json,
          step3_memory_recall_json, step4_homeostasis_json,
          step5_strategy_proposal_json, step6_tool_auth_json,
          step7_emitted_intent_json, step8_delivery_receipt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trace_id) DO UPDATE SET
          turn_event_id = excluded.turn_event_id,
          virtual_ts_ms = excluded.virtual_ts_ms,
          state_rev_before = excluded.state_rev_before,
          state_rev_after = excluded.state_rev_after,
          step1_perception_json = excluded.step1_perception_json,
          step2_gate_safety_json = excluded.step2_gate_safety_json,
          step3_memory_recall_json = excluded.step3_memory_recall_json,
          step4_homeostasis_json = excluded.step4_homeostasis_json,
          step5_strategy_proposal_json = excluded.step5_strategy_proposal_json,
          step6_tool_auth_json = excluded.step6_tool_auth_json,
          step7_emitted_intent_json = excluded.step7_emitted_intent_json,
          step8_delivery_receipt_json = excluded.step8_delivery_receipt_json`
      )
      .run(
        validatedTrace.trace_id,
        validatedTrace.turn_event_id,
        validatedTrace.virtual_ts_ms,
        validatedTrace.state_rev_before,
        validatedTrace.state_rev_after,
        JSON.stringify(storedStepOne),
        JSON.stringify(validatedTrace.steps.step2_gate_safety),
        JSON.stringify(validatedTrace.steps.step3_memory_recall),
        JSON.stringify(validatedTrace.steps.step4_homeostasis),
        JSON.stringify(validatedTrace.steps.step5_strategy_proposal),
        JSON.stringify(validatedTrace.steps.step6_tool_auth),
        JSON.stringify(validatedTrace.steps.step7_emitted_intent),
        validatedTrace.steps.step8_delivery_receipt === null
          ? null
          : JSON.stringify(validatedTrace.steps.step8_delivery_receipt)
      );
    return validatedTrace;
  }

  updateTurnTraceDeliveryReceipt(
    turnEventId: string,
    receipt: TurnTraceDeliveryReceipt
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE turn_decision_traces
         SET step8_delivery_receipt_json = ?
         WHERE turn_event_id = ?`
      )
      .run(JSON.stringify(receipt), turnEventId);
    if (Number(result.changes) === 0) {
      throw new Error(`Cannot update trace for missing event: ${turnEventId}`);
    }
  }

  insertKnowledgeChunk(
    chunk: KnowledgeChunkInput,
    embedding?: ReadonlyArray<number>
  ): KnowledgeChunk {
    return this.runInTransaction(() => {
      this.#database
        .prepare(
          `INSERT INTO knowledge_chunks (
            chunk_id, collection_id, document_name, chunk_index,
            content_text, metadata_json, taint_level, citation_count,
            last_cited_ts_ms, created_at_ts_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          chunk.chunk_id,
          chunk.collection_id,
          chunk.document_name,
          chunk.chunk_index,
          chunk.content_text,
          chunk.metadata_json ?? "{}",
          chunk.taint_level ?? "untrusted_external",
          chunk.citation_count ?? 0,
          chunk.last_cited_ts_ms ?? null,
          chunk.created_at_ts_ms
        );
      this.#database
        .prepare(
          `INSERT INTO knowledge_chunks_fts (
            chunk_id, collection_id, content_text
          ) VALUES (?, ?, ?)`
        )
        .run(chunk.chunk_id, chunk.collection_id, chunk.content_text);
      this.#database
        .prepare(
          `INSERT INTO knowledge_chunks_vec (chunk_id, embedding_json)
           VALUES (?, ?)`
        )
        .run(chunk.chunk_id, embeddingJson(embedding, chunk.content_text));

      const stored = this.#database
        .prepare("SELECT * FROM knowledge_chunks WHERE chunk_id = ?")
        .get(chunk.chunk_id);
      if (stored === undefined) throw new Error("Knowledge chunk could not be read back.");
      return plainRow<KnowledgeChunk>(stored);
    });
  }

  incrementKnowledgeCitation(
    chunkId: string,
    citedAtTsMs: number
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE knowledge_chunks
         SET citation_count = citation_count + 1, last_cited_ts_ms = ?
         WHERE chunk_id = ?`
      )
      .run(citedAtTsMs, chunkId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Cannot cite missing knowledge chunk: ${chunkId}`);
    }
  }

  unlockMilestone(milestone: SoulMilestoneInput): SoulMilestone {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO soul_milestones_ledger (
          milestone_id, title, category, unlocked_virtual_ts,
          trigger_event_id, unlocked_rewards_json, state_rev_unlocked
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        milestone.milestone_id,
        milestone.title,
        milestone.category,
        milestone.unlocked_virtual_ts,
        milestone.trigger_event_id,
        milestone.unlocked_rewards_json ?? "{}",
        milestone.state_rev_unlocked
      );
    const stored = this.#database
      .prepare(
        "SELECT * FROM soul_milestones_ledger WHERE milestone_id = ?"
      )
      .get(milestone.milestone_id);
    if (stored === undefined) throw new Error("Milestone could not be read back.");
    return plainRow<SoulMilestone>(stored);
  }

  incrementSb243CrisisCount(yearMonth: string): Sb243AnnualMetric {
    this.#database
      .prepare(
        `INSERT INTO sb243_annual_metrics (
          year_month, crisis_referral_triggered_count
        ) VALUES (?, 1)
        ON CONFLICT(year_month) DO UPDATE SET
          crisis_referral_triggered_count = crisis_referral_triggered_count + 1`
      )
      .run(yearMonth);
    const metric = this.getSb243Metrics(yearMonth);
    if (metric === undefined) throw new Error("SB 243 metric could not be read back.");
    return metric;
  }

  setLastAliveHeartbeat(tsMs: number): void {
    assertFiniteTimestamp(tsMs, "Heartbeat timestamp");
    this.#database
      .prepare(
        `INSERT INTO kernel_runtime_meta (meta_key, meta_value)
         VALUES ('last_alive_heartbeat_ts', ?)
         ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value`
      )
      .run(String(Math.trunc(tsMs)));
  }

  getLatestCheckpoint(): CognitiveStateCheckpoint | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM cognitive_state_checkpoints
         ORDER BY state_rev DESC LIMIT 1`
      )
      .get();
    return row === undefined ? undefined : plainRow<CognitiveStateCheckpoint>(row);
  }

  listEvents(query: EventListQuery = {}): StoredEventLogEntry[] {
    const conditions: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (query.after_event_seq !== undefined) {
      conditions.push("event_seq > ?");
      parameters.push(query.after_event_seq);
    }
    if (query.audience_scope !== undefined) {
      conditions.push("audience_scope = ?");
      parameters.push(query.audience_scope);
    }
    if (query.event_category !== undefined) {
      conditions.push("event_category = ?");
      parameters.push(query.event_category);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    parameters.push(clampLimit(query.limit));
    const rows = this.#database
      .prepare(
        `SELECT * FROM event_log ${where}
         ORDER BY event_seq ASC LIMIT ?`
      )
      .all(...parameters);
    return plainRows<StoredEventLogEntry>(rows);
  }

  getEventById(eventId: string): StoredEventLogEntry | undefined {
    const row = this.#database
      .prepare("SELECT * FROM event_log WHERE event_id = ?")
      .get(eventId);
    return row === undefined ? undefined : plainRow<StoredEventLogEntry>(row);
  }

  queryMemoriesWithAudienceGuard(
    query: MemoryAudienceQuery
  ): MemorySearchResult[] {
    const hasVectorQuery =
      query.embedding !== undefined || query.query_text !== undefined;
    const parameters: SQLInputValue[] = [];
    const selectSimilarity = hasVectorQuery
      ? "vec_cosine_similarity(v.embedding_json, ?) AS similarity"
      : "0.0 AS similarity";
    if (hasVectorQuery) {
      parameters.push(
        embeddingJson(query.embedding, query.query_text ?? "")
      );
    }

    const join = hasVectorQuery
      ? "INNER JOIN memories_vec v ON v.memory_id = m.memory_id"
      : "";
    const conditions = ["m.invalidated_at_ts IS NULL"];
    if (
      query.audience_scope === "only_owner" &&
      query.principal_trust === "owner_verified"
    ) {
      conditions.push(
        "(m.visibility_scope = 'only_owner' OR m.visibility_scope = 'public_all' OR m.visibility_scope LIKE 'group:%')"
      );
    } else if (query.audience_scope.startsWith("group:")) {
      conditions.push("m.visibility_scope IN (?, 'public_all')");
      parameters.push(query.audience_scope);
    } else {
      conditions.push("m.visibility_scope = 'public_all'");
    }
    if (query.memory_ids) {
      conditions.push("m.memory_id IN (SELECT value FROM json_each(?))");
      parameters.push(JSON.stringify(query.memory_ids));
    }
    if (query.memory_tier !== undefined) {
      conditions.push("m.memory_tier = ?");
      parameters.push(query.memory_tier);
    }
    if (query.current_virtual_ts !== undefined) {
      assertFiniteTimestamp(
        query.current_virtual_ts,
        "current_virtual_ts"
      );
      conditions.push("m.valid_from_virtual_ts <= ?");
      parameters.push(query.current_virtual_ts);
      conditions.push(
        "(m.valid_until_virtual_ts IS NULL OR m.valid_until_virtual_ts > ?)"
      );
      parameters.push(query.current_virtual_ts);
      conditions.push(
        "(m.expires_virtual_ts IS NULL OR m.expires_virtual_ts > ?)"
      );
      parameters.push(query.current_virtual_ts);
    }
    parameters.push(clampLimit(query.limit));

    const rows = this.#database
      .prepare(
        `SELECT m.*, ${selectSimilarity}
         FROM memories m
         ${join}
         WHERE ${conditions.join(" AND ")}
         ORDER BY similarity DESC, m.base_importance DESC,
                  m.created_virtual_ts DESC
         LIMIT ?`
      )
      .all(...parameters);
    return plainRows<MemorySearchResult>(rows);
  }

  getMemoryLineage(memoryId: string): MemoryLineageEdge[] {
    return plainRows<MemoryLineageEdge>(
      this.#database
        .prepare(
          `SELECT * FROM memory_lineage_edges
           WHERE child_memory_id = ?
              OR (parent_type = 'memory' AND parent_id = ?)
           ORDER BY child_memory_id, parent_type, parent_id`
        )
        .all(memoryId, memoryId)
    );
  }

  listCommitments(
    query: CommitmentListQuery | CommitmentStatus = {}
  ): ProspectiveCommitment[] {
    const normalizedQuery =
      typeof query === "string" ? { status: query } : query;
    const conditions: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (normalizedQuery.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(normalizedQuery.status);
    }
    if (normalizedQuery.due_at_or_before_virtual_ts !== undefined) {
      conditions.push("trigger_virtual_ts <= ?");
      parameters.push(normalizedQuery.due_at_or_before_virtual_ts);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    parameters.push(clampLimit(normalizedQuery.limit));
    return plainRows<ProspectiveCommitment>(
      this.#database
        .prepare(
          `SELECT * FROM prospective_commitments ${where}
           ORDER BY trigger_virtual_ts ASC LIMIT ?`
        )
        .all(...parameters)
    );
  }

  listDecisionTraces(limit?: number): VerifiableTurnTrace[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM turn_decision_traces
         ORDER BY virtual_ts_ms DESC, trace_id DESC LIMIT ?`
      )
      .all(clampLimit(limit));
    return rows.map((row) => this.deserializeTurnTrace(row));
  }

  listChannelDecisionTraces(
    channelId: string,
    limit = 50,
    audienceScope: AudienceScope = "only_owner",
    principalId?: string,
    thread?: string
  ): VerifiableTurnTrace[] {
    const rows = this.#database
      .prepare(
        `SELECT trace.* FROM turn_decision_traces AS trace
         JOIN event_log AS event ON event.event_id = trace.turn_event_id
         WHERE event.source_channel_id = ?
           AND event.audience_scope = ?
           AND event.redacted_at_ts_ms IS NULL
           AND (? IS NULL OR event.principal_id = ?)
           AND (json_extract(event.payload_json,'$.thread') IS ?)
         ORDER BY event.event_seq DESC LIMIT ?`
      )
      .all(channelId, audienceScope, principalId ?? null, principalId ?? null, thread ?? null, clampLimit(limit));
    return rows.map((row) => this.deserializeTurnTrace(row));
  }

  listChannelRunEvents(channelId: string, audience: AudienceScope, principal?: string, thread?: string): StoredEventLogEntry[] {
    return plainRows<StoredEventLogEntry>(this.#database.prepare(
      `SELECT e.* FROM event_log e WHERE e.source_channel_id=? AND e.audience_scope=?
       AND (? IS NULL OR e.principal_id=?) AND json_extract(e.payload_json,'$.thread') IS ?
       AND e.redacted_at_ts_ms IS NULL AND (
         EXISTS (SELECT 1 FROM turn_decision_traces t WHERE t.turn_event_id=e.event_id) OR
         json_extract(e.payload_json,'$.channel_run_status') IN ('cancelled','failed','held_pending_compliant_channel'))
       ORDER BY e.event_seq DESC LIMIT 50`
    ).all(channelId, audience, principal ?? null, principal ?? null, thread ?? null));
  }

  saveChannelRunProcess(eventId: string, process: ChannelRunProcess): void {
    this.#database.prepare(
      `INSERT OR REPLACE INTO channel_run_process(event_id, snapshot_json)
       SELECT event_id, ? FROM event_log WHERE event_id = ? AND redacted_at_ts_ms IS NULL
       AND json_extract(payload_json,'$.channel_process_redacted') IS NULL`
    ).run(JSON.stringify(process), eventId);
  }

  getChannelRunProcess(eventId: string): ChannelRunProcess | undefined {
    const row = this.#database.prepare("SELECT snapshot_json FROM channel_run_process WHERE event_id = ?").get(eventId);
    return row ? JSON.parse(String(row.snapshot_json)) as ChannelRunProcess : undefined;
  }

  holdChannelRunIntent(channelId: string, eventId: string, intent: import("@ai0/protocol").CommunicativeIntentEnvelope): void {
    this.#database.prepare(
      `UPDATE event_log SET payload_json = json_set(payload_json, '$.channel_run_status', 'held_pending_compliant_channel',
         '$.pending_intent', json(?))
       WHERE event_id = ? AND source_channel_id = ? AND redacted_at_ts_ms IS NULL
         AND json_extract(payload_json,'$.channel_process_redacted') IS NULL`
    ).run(JSON.stringify({ id: intent.intentId, kind: intent.intent, correlation: intent.correlationEventId,
      constraints: intent.deliveryConstraints }), eventId, channelId);
  }

  markChannelRunEnded(
    channelId: string,
    eventId: string,
    status: "cancelled" | "failed"
  ): void {
    this.#database.prepare(
      `UPDATE event_log SET payload_json = json_set(json_remove(payload_json, '$.pending_intent'), '$.channel_run_status', ?)
       WHERE event_id = ? AND source_channel_id = ?
         AND redacted_at_ts_ms IS NULL`
    ).run(status, eventId, channelId);
  }

  getDecisionTraceByEvent(eventId: string): VerifiableTurnTrace | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM turn_decision_traces
         WHERE turn_event_id = ?
         ORDER BY virtual_ts_ms DESC LIMIT 1`
      )
      .get(eventId);
    return row === undefined ? undefined : this.deserializeTurnTrace(row);
  }

  queryKnowledgeChunks(
    query: KnowledgeChunkQuery | string
  ): KnowledgeChunkSearchResult[] {
    const normalizedQuery =
      typeof query === "string" ? { query_text: query } : query;
    const hasVectorQuery =
      normalizedQuery.embedding !== undefined ||
      normalizedQuery.query_text !== undefined;
    const parameters: SQLInputValue[] = [];
    const selectSimilarity = hasVectorQuery
      ? "vec_cosine_similarity(v.embedding_json, ?) AS similarity"
      : "0.0 AS similarity";
    if (hasVectorQuery) {
      parameters.push(
        embeddingJson(
          normalizedQuery.embedding,
          normalizedQuery.query_text ?? ""
        )
      );
    }
    const join = hasVectorQuery
      ? "INNER JOIN knowledge_chunks_vec v ON v.chunk_id = k.chunk_id"
      : "";
    const conditions = ["k.taint_level = 'untrusted_external'"];
    if (normalizedQuery.collection_id !== undefined) {
      conditions.push("k.collection_id = ?");
      parameters.push(normalizedQuery.collection_id);
    }
    parameters.push(clampLimit(normalizedQuery.limit));
    return plainRows<KnowledgeChunkSearchResult>(
      this.#database
        .prepare(
          `SELECT k.*, ${selectSimilarity}
           FROM knowledge_chunks k
           ${join}
           WHERE ${conditions.join(" AND ")}
           ORDER BY similarity DESC, k.citation_count DESC,
                    k.chunk_index ASC
           LIMIT ?`
        )
        .all(...parameters)
    );
  }

  queryKnowledgeChunksByFts(
    query: KnowledgeChunkFtsQuery
  ): KnowledgeChunkFtsSearchResult[] {
    const matchExpression = buildFts5MatchExpression(query.query_text);
    if (matchExpression === undefined) return [];

    const conditions = [
      "knowledge_chunks_fts MATCH ?",
      "k.taint_level = 'untrusted_external'"
    ];
    const parameters: SQLInputValue[] = [matchExpression];
    if (query.collection_id !== undefined) {
      conditions.push("k.collection_id = ?");
      parameters.push(query.collection_id);
    }
    parameters.push(clampLimit(query.limit));

    return plainRows<KnowledgeChunkFtsSearchResult>(
      this.#database
        .prepare(
          `SELECT k.*, bm25(knowledge_chunks_fts) AS bm25_score
           FROM knowledge_chunks_fts
           INNER JOIN knowledge_chunks k
             ON k.chunk_id = knowledge_chunks_fts.chunk_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY bm25_score ASC, k.citation_count DESC,
                    k.chunk_index ASC, k.chunk_id ASC
           LIMIT ?`
        )
        .all(...parameters)
    );
  }

  listCitedKnowledgeChunks(collectionId: string): KnowledgeChunk[] {
    return plainRows<KnowledgeChunk>(
      this.#database
        .prepare(
          `SELECT * FROM knowledge_chunks
           WHERE collection_id = ?
             AND citation_count > 0
             AND taint_level = 'untrusted_external'
           ORDER BY citation_count DESC, last_cited_ts_ms DESC,
                    chunk_index ASC, chunk_id ASC`
        )
        .all(collectionId)
    );
  }

  listMilestones(limit?: number): SoulMilestone[] {
    return plainRows<SoulMilestone>(
      this.#database
        .prepare(
          `SELECT * FROM soul_milestones_ledger
           ORDER BY unlocked_virtual_ts DESC, milestone_id ASC LIMIT ?`
        )
        .all(clampLimit(limit))
    );
  }

  getSb243Metrics(): Sb243AnnualMetric[];
  getSb243Metrics(yearMonth: string): Sb243AnnualMetric | undefined;
  getSb243Metrics(
    yearMonth?: string
  ): Sb243AnnualMetric[] | Sb243AnnualMetric | undefined {
    if (yearMonth !== undefined) {
      const row = this.#database
        .prepare(
          "SELECT * FROM sb243_annual_metrics WHERE year_month = ?"
        )
        .get(yearMonth);
      return row === undefined ? undefined : plainRow<Sb243AnnualMetric>(row);
    }
    return plainRows<Sb243AnnualMetric>(
      this.#database
        .prepare(
          `SELECT * FROM sb243_annual_metrics
           ORDER BY year_month ASC`
        )
        .all()
    );
  }

  getLastAliveHeartbeat(): number | null {
    const row = this.#database
      .prepare(
        `SELECT meta_value FROM kernel_runtime_meta
         WHERE meta_key = 'last_alive_heartbeat_ts'`
      )
      .get();
    if (row === undefined || typeof row.meta_value !== "string") return null;
    const value = Number(row.meta_value);
    return Number.isFinite(value) ? value : null;
  }

  getTablePragmaStatus(): TablePragmaStatus {
    const journalMode = this.#database.prepare("PRAGMA journal_mode").get();
    const foreignKeys = this.#database.prepare("PRAGMA foreign_keys").get();
    const secureDelete = this.#database.prepare("PRAGMA secure_delete").get();
    return {
      journal_mode:
        typeof journalMode?.journal_mode === "string"
          ? journalMode.journal_mode
          : "",
      foreign_keys: Number(foreignKeys?.foreign_keys ?? 0),
      secure_delete: Number(secureDelete?.secure_delete ?? 0)
    };
  }

  private getMemoryById(memoryId: string): StoredMemory | undefined {
    const row = this.#database
      .prepare("SELECT * FROM memories WHERE memory_id = ?")
      .get(memoryId);
    return row === undefined ? undefined : plainRow<StoredMemory>(row);
  }

  private getCheckpointByRevision(
    stateRevision: number
  ): CognitiveStateCheckpoint | undefined {
    const row = this.#database
      .prepare(
        "SELECT * FROM cognitive_state_checkpoints WHERE state_rev = ?"
      )
      .get(stateRevision);
    return row === undefined ? undefined : plainRow<CognitiveStateCheckpoint>(row);
  }

  private deserializeTurnTrace(
    row: Record<string, SQLOutputValue>
  ): VerifiableTurnTrace {
    const storedStepOne: unknown = JSON.parse(String(row.step1_perception_json));
    if (
      storedStepOne === null ||
      typeof storedStepOne !== "object" ||
      Array.isArray(storedStepOne)
    ) {
      throw new Error("Stored turn trace step 1 is not a JSON object.");
    }
    const stepOneRecord = { ...storedStepOne } as Record<string, unknown>;
    const targetInstance =
      typeof stepOneRecord[TARGET_INSTANCE_STORAGE_KEY] === "string"
        ? stepOneRecord[TARGET_INSTANCE_STORAGE_KEY]
        : "live";
    delete stepOneRecord[TARGET_INSTANCE_STORAGE_KEY];

    return VerifiableTurnTraceSchema.parse({
      trace_id: String(row.trace_id),
      target_instance: targetInstance,
      turn_event_id: String(row.turn_event_id),
      virtual_ts_ms: Number(row.virtual_ts_ms),
      state_rev_before: Number(row.state_rev_before),
      state_rev_after: Number(row.state_rev_after),
      steps: {
        step1_perception: stepOneRecord,
        step2_gate_safety: JSON.parse(String(row.step2_gate_safety_json)),
        step3_memory_recall: JSON.parse(String(row.step3_memory_recall_json)),
        step4_homeostasis: JSON.parse(String(row.step4_homeostasis_json)),
        step5_strategy_proposal: JSON.parse(
          String(row.step5_strategy_proposal_json)
        ),
        step6_tool_auth: JSON.parse(String(row.step6_tool_auth_json)),
        step7_emitted_intent: JSON.parse(
          String(row.step7_emitted_intent_json)
        ),
        step8_delivery_receipt:
          row.step8_delivery_receipt_json === null
            ? null
            : JSON.parse(String(row.step8_delivery_receipt_json))
      }
    });
  }
}
