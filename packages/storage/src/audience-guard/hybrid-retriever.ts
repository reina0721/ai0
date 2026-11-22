import type {
  AudienceScope,
  MemoryTier,
  PrincipalTrust
} from "@ai0/protocol";

import type {
  CoordinatorStorageMutator,
  KnowledgeChunk,
  KnowledgeChunkFtsSearchResult,
  MemorySearchResult,
  ReadOnlyStorageView,
  StoredMemory
} from "../sqlite/database-driver.js";

export const HYPOTHESIS_PROMPT_PREFIX =
  "[你当时的主观猜测，未经主人证实] ";

export const HONEST_FORGETFULNESS_DIRECTIVE =
  "[检索结果：关于该细节无确切记忆记录。严禁顺着用户的话编造具体经过，请以符合人设的语气坦诚表示“具体细节我有点记不太清了，你再跟我讲讲？”]";

export const TABOO_AVOIDANCE_DIRECTIVE =
  "[话题封印：当前内容触及主人要求避开的封印话题。严禁主动提及、追问或展开相关细节，请自然绕开该话题。]";

export interface HybridRetrievalFormulaParams {
  w_sem: number;
  w_imp: number;
  alpha_emo: number;
  beta_recall: number;
  h0_base_half_life_hours: number;
  cooldown_penalty_factor: number;
  cooldown_window_hours: number;
  theta_confident: number;
}

export const DEFAULT_HYBRID_RETRIEVAL_FORMULA_PARAMS: Readonly<HybridRetrievalFormulaParams> =
  Object.freeze({
    w_sem: 0.65,
    w_imp: 0.35,
    alpha_emo: 0.4,
    beta_recall: 0.3,
    h0_base_half_life_hours: 168,
    cooldown_penalty_factor: 0.35,
    cooldown_window_hours: 1,
    theta_confident: 0.38
  });

export interface HybridMemoryRetrieverConfig
  extends Partial<HybridRetrievalFormulaParams> {
  formula_params?: Partial<HybridRetrievalFormulaParams>;
  candidate_limit?: number;
  taboo_similarity_threshold?: number;
}

export interface HybridMemoryRetrievalRequest {
  query_text?: string;
  queryText?: string;
  embedding?: ReadonlyArray<number>;
  query_embedding?: ReadonlyArray<number>;
  audience_scope?: AudienceScope;
  audienceScope?: AudienceScope;
  principal_trust?: PrincipalTrust;
  principalTrust?: PrincipalTrust;
  current_virtual_ts?: number;
  currentVirtualTs?: number;
  recentlyRecalledIds?: Iterable<string>;
  recently_recalled_ids?: Iterable<string>;
  memory_tier?: MemoryTier;
  limit?: number;
  candidate_limit?: number;
}

export interface HybridMemoryScoreBreakdown {
  semantic_similarity: number;
  nonnegative_semantic_similarity: number;
  base_half_life_hours: number;
  effective_half_life_hours: number;
  half_life_hours: number;
  delta_t_hours: number;
  elapsed_hours: number;
  decay_factor: number;
  cooldown_factor: number;
  cooldown_penalty: number;
  semantic_component: number;
  importance_emotion_component: number;
  raw_relevance: number;
  final_score: number;
}

export interface HybridMemoryRecall extends MemorySearchResult {
  formatted_prompt_text: string;
  score: number;
  hybrid_score: number;
  relevance_score: number;
  score_breakdown: HybridMemoryScoreBreakdown;
  breakdown: HybridMemoryScoreBreakdown;
}

export interface TriggeredTabooSeal extends HybridMemoryRecall {
  avoidance_directive: string;
}

export interface HybridMemoryRetrievalResult {
  memories: HybridMemoryRecall[];
  results: HybridMemoryRecall[];
  recalled_memories: HybridMemoryRecall[];
  triggered_taboo_seals: TriggeredTabooSeal[];
  active_taboo_seals: TriggeredTabooSeal[];
  calibrated_ignorance_triggered: boolean;
  honest_forgetfulness_directive?: string;
  sql_audience_filter_enforced: string;
  sql_audience_filter_proof: string;
}

export interface HybridKnowledgeRagWeights {
  dense_weight: number;
  sparse_weight: number;
  token_overlap_weight: number;
}

export const DEFAULT_HYBRID_KNOWLEDGE_RAG_WEIGHTS: Readonly<HybridKnowledgeRagWeights> =
  Object.freeze({
    dense_weight: 0.55,
    sparse_weight: 0.3,
    token_overlap_weight: 0.15
  });

export interface HybridKnowledgeRagSlice extends KnowledgeChunk {
  similarity: number;
  dense_similarity: number;
  /** Raw FTS5 BM25 rank. Lower is better; null means no sparse match. */
  bm25_score: number | null;
  /** Reciprocal rank derived from the BM25 ordering. */
  sparse_score: number;
  token_overlap_score: number;
  hybrid_score: number;
  reranker_score?: number;
}

export interface HybridKnowledgeRerankerResult {
  chunk_id: string;
  reranker_score?: number;
  score?: number;
}

export type HybridKnowledgeReranker = (
  query: string,
  chunks: ReadonlyArray<HybridKnowledgeRagSlice>
) => ReadonlyArray<
  string | HybridKnowledgeRagSlice | HybridKnowledgeRerankerResult
>;

export interface HybridKnowledgeRagOptions {
  embedding?: ReadonlyArray<number>;
  collection_id?: string;
  collectionId?: string;
  limit?: number;
  candidate_limit?: number;
  dense_weight?: number;
  sparse_weight?: number;
  token_overlap_weight?: number;
  w_dense?: number;
  w_sparse?: number;
  w_token_overlap?: number;
  reranker?: HybridKnowledgeReranker;
}

export interface HybridKnowledgeRagRequest extends HybridKnowledgeRagOptions {
  query_text?: string;
  queryText?: string;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  finiteNumber(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

function nonnegativeNumber(value: number, label: string): number {
  finiteNumber(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative.`);
  return value;
}

function unitIntervalNumber(value: number, label: string): number {
  finiteNumber(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
  return value;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(1_000, Math.trunc(value)));
}

function resolveFormulaParams(
  overrides: Partial<HybridRetrievalFormulaParams>
): Readonly<HybridRetrievalFormulaParams> {
  const params = {
    ...DEFAULT_HYBRID_RETRIEVAL_FORMULA_PARAMS,
    ...overrides
  };
  nonnegativeNumber(params.w_sem, "w_sem");
  nonnegativeNumber(params.w_imp, "w_imp");
  nonnegativeNumber(params.alpha_emo, "alpha_emo");
  nonnegativeNumber(params.beta_recall, "beta_recall");
  positiveNumber(
    params.h0_base_half_life_hours,
    "h0_base_half_life_hours"
  );
  unitIntervalNumber(
    params.cooldown_penalty_factor,
    "cooldown_penalty_factor"
  );
  nonnegativeNumber(params.cooldown_window_hours, "cooldown_window_hours");
  nonnegativeNumber(params.theta_confident, "theta_confident");
  return Object.freeze(params);
}

function normalizeSimilarity(similarity: number): number {
  return Number.isFinite(similarity) ? similarity : 0;
}

function formattedMemoryText(memory: MemorySearchResult): string {
  return memory.epistemic_type === "inferred_hypothesis"
    ? `${HYPOTHESIS_PROMPT_PREFIX}${memory.content_text}`
    : memory.content_text;
}

/**
 * Human-readable proof of the exact deterministic SQL visibility branch used
 * by `queryMemoriesWithAudienceGuard`. Values are never interpolated into an
 * executable query; the driver uses bound parameters for group scopes.
 */
export function buildSqlAudienceFilter(
  principalTrust: PrincipalTrust,
  audienceScope: AudienceScope
): string {
  if (
    audienceScope === "only_owner" &&
    principalTrust === "owner_verified"
  ) {
    return "visibility_scope IN ('only_owner', 'group:*', 'public_all') AND invalidated_at_ts IS NULL";
  }
  if (audienceScope.startsWith("group:")) {
    return `visibility_scope IN ('${audienceScope}', 'public_all') AND invalidated_at_ts IS NULL`;
  }
  return "visibility_scope = 'public_all' AND invalidated_at_ts IS NULL";
}

export function scoreHybridMemoryCandidate(
  memory: MemorySearchResult,
  currentVirtualTs: number,
  recentlyRecalledIds: ReadonlySet<string> = new Set<string>(),
  formulaParams: Readonly<HybridRetrievalFormulaParams> =
    DEFAULT_HYBRID_RETRIEVAL_FORMULA_PARAMS
): HybridMemoryScoreBreakdown {
  finiteNumber(currentVirtualTs, "currentVirtualTs");
  const params = resolveFormulaParams(formulaParams);
  const recallCount = Math.max(0, memory.recall_count);
  const storedHalfLife =
    Number.isFinite(memory.stability_half_life) &&
    memory.stability_half_life > 0
      ? memory.stability_half_life
      : params.h0_base_half_life_hours;
  const effectiveHalfLife =
    storedHalfLife * (1 + params.beta_recall * Math.log(1 + recallCount));
  const deltaTimeHours = Math.max(
    0,
    (currentVirtualTs - memory.last_recalled_ts) / 3_600_000
  );
  const decayFactor = 2 ** (-deltaTimeHours / effectiveHalfLife);
  const receivesCooldown =
    recentlyRecalledIds.has(memory.memory_id) ||
    (deltaTimeHours < params.cooldown_window_hours && recallCount > 0);
  const cooldownFactor = receivesCooldown
    ? params.cooldown_penalty_factor
    : 1;
  const semanticSimilarity = normalizeSimilarity(memory.similarity);
  const nonnegativeSemanticSimilarity = Math.max(0, semanticSimilarity);
  const semanticComponent = params.w_sem * nonnegativeSemanticSimilarity;
  const importanceEmotionComponent =
    params.w_imp *
    memory.base_importance *
    (1 + params.alpha_emo * Math.abs(memory.emotional_valence));
  const rawRelevance = semanticComponent + importanceEmotionComponent;
  const finalScore = rawRelevance * decayFactor * cooldownFactor;

  return {
    semantic_similarity: semanticSimilarity,
    nonnegative_semantic_similarity: nonnegativeSemanticSimilarity,
    base_half_life_hours: storedHalfLife,
    effective_half_life_hours: effectiveHalfLife,
    half_life_hours: effectiveHalfLife,
    delta_t_hours: deltaTimeHours,
    elapsed_hours: deltaTimeHours,
    decay_factor: decayFactor,
    cooldown_factor: cooldownFactor,
    cooldown_penalty: cooldownFactor,
    semantic_component: semanticComponent,
    importance_emotion_component: importanceEmotionComponent,
    raw_relevance: rawRelevance,
    final_score: finalScore
  };
}

function scoreAndFormatMemory(
  memory: MemorySearchResult,
  currentVirtualTs: number,
  recentlyRecalledIds: ReadonlySet<string>,
  formulaParams: Readonly<HybridRetrievalFormulaParams>
): HybridMemoryRecall {
  const breakdown = scoreHybridMemoryCandidate(
    memory,
    currentVirtualTs,
    recentlyRecalledIds,
    formulaParams
  );
  return {
    ...memory,
    formatted_prompt_text: formattedMemoryText(memory),
    score: breakdown.final_score,
    hybrid_score: breakdown.final_score,
    relevance_score: breakdown.final_score,
    score_breakdown: breakdown,
    breakdown
  };
}

function compareMemoryRecall(
  left: HybridMemoryRecall,
  right: HybridMemoryRecall
): number {
  return (
    right.score - left.score ||
    right.similarity - left.similarity ||
    right.base_importance - left.base_importance ||
    left.memory_id.localeCompare(right.memory_id)
  );
}

export class HybridMemoryRetriever {
  readonly formulaParams: Readonly<HybridRetrievalFormulaParams>;
  readonly formula_params: Readonly<HybridRetrievalFormulaParams>;
  readonly #storage: ReadOnlyStorageView;
  readonly #candidateLimit: number;
  readonly #tabooSimilarityThreshold: number;

  constructor(
    storage: ReadOnlyStorageView | CoordinatorStorageMutator,
    config: HybridMemoryRetrieverConfig = {}
  ) {
    this.#storage = storage;
    const { formula_params: nestedParams, ...topLevelConfig } = config;
    this.formulaParams = resolveFormulaParams({
      ...topLevelConfig,
      ...nestedParams
    });
    this.formula_params = this.formulaParams;
    this.#candidateLimit = normalizeLimit(config.candidate_limit, 100);
    this.#tabooSimilarityThreshold = nonnegativeNumber(
      config.taboo_similarity_threshold ?? 0.45,
      "taboo_similarity_threshold"
    );
  }

  retrieve(request: HybridMemoryRetrievalRequest): HybridMemoryRetrievalResult {
    const audienceScope = request.audience_scope ?? request.audienceScope;
    const principalTrust = request.principal_trust ?? request.principalTrust;
    const currentVirtualTs =
      request.current_virtual_ts ?? request.currentVirtualTs;
    if (audienceScope === undefined) {
      throw new TypeError("audience_scope is required.");
    }
    if (principalTrust === undefined) {
      throw new TypeError("principal_trust is required.");
    }
    if (currentVirtualTs === undefined) {
      throw new TypeError("current_virtual_ts is required.");
    }
    finiteNumber(currentVirtualTs, "current_virtual_ts");

    const queryText = request.query_text ?? request.queryText ?? "";
    const embedding = request.embedding ?? request.query_embedding;
    const limit = normalizeLimit(request.limit, 10);
    const candidateLimit = normalizeLimit(
      request.candidate_limit,
      Math.max(this.#candidateLimit, limit * 8)
    );
    const recentlyRecalledIds = new Set(
      request.recentlyRecalledIds ?? request.recently_recalled_ids ?? []
    );
    const semanticQuery = {
      query_text: queryText === "" ? undefined : queryText,
      embedding
    };

    const candidates = this.#storage.queryMemoriesWithAudienceGuard({
      audience_scope: audienceScope,
      principal_trust: principalTrust,
      ...semanticQuery,
      memory_tier: request.memory_tier,
      current_virtual_ts: currentVirtualTs,
      limit: candidateLimit
    });
    const memories = candidates
      .filter((memory) => memory.memory_tier !== "topic_taboo_seal")
      .map((memory) =>
        scoreAndFormatMemory(
          memory,
          currentVirtualTs,
          recentlyRecalledIds,
          this.formulaParams
        )
      )
      .sort(compareMemoryRecall)
      .slice(0, limit);

    const tabooCandidates = this.#storage.queryMemoriesWithAudienceGuard({
      audience_scope: audienceScope,
      principal_trust: principalTrust,
      ...semanticQuery,
      memory_tier: "topic_taboo_seal",
      current_virtual_ts: currentVirtualTs,
      limit: candidateLimit
    });
    const triggeredTabooSeals = tabooCandidates
      .filter(
        (memory) =>
          normalizeSimilarity(memory.similarity) >
          this.#tabooSimilarityThreshold
      )
      .map((memory): TriggeredTabooSeal => ({
        ...scoreAndFormatMemory(
          memory,
          currentVirtualTs,
          recentlyRecalledIds,
          this.formulaParams
        ),
        avoidance_directive: TABOO_AVOIDANCE_DIRECTIVE
      }))
      .sort(compareMemoryRecall);

    const calibratedIgnoranceTriggered =
      memories.length === 0 ||
      (memories[0]?.score ?? 0) < this.formulaParams.theta_confident;
    const sqlAudienceFilter = buildSqlAudienceFilter(
      principalTrust,
      audienceScope
    );

    return {
      memories,
      results: memories,
      recalled_memories: memories,
      triggered_taboo_seals: triggeredTabooSeals,
      active_taboo_seals: triggeredTabooSeals,
      calibrated_ignorance_triggered: calibratedIgnoranceTriggered,
      ...(calibratedIgnoranceTriggered
        ? { honest_forgetfulness_directive: HONEST_FORGETFULNESS_DIRECTIVE }
        : {}),
      sql_audience_filter_enforced: sqlAudienceFilter,
      sql_audience_filter_proof: sqlAudienceFilter
    };
  }

  retrieveMemories(
    request: HybridMemoryRetrievalRequest
  ): HybridMemoryRetrievalResult {
    return this.retrieve(request);
  }

  retrieveHybridKnowledgeRag(
    query: string | HybridKnowledgeRagRequest,
    options: HybridKnowledgeRagOptions = {}
  ): HybridKnowledgeRagSlice[] {
    return typeof query === "string"
      ? retrieveHybridKnowledgeRag(this.#storage, query, options)
      : retrieveHybridKnowledgeRag(this.#storage, query);
  }
}

function tokenizeForOverlap(text: string): Set<string> {
  const matches = text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}_]+/gu);
  if (matches === null) return new Set<string>();

  const tokens = new Set<string>();
  for (const match of matches) {
    tokens.add(match);
    if (/\p{Script=Han}/u.test(match)) {
      for (const character of match) tokens.add(character);
    }
  }
  return tokens;
}

function tokenOverlapScore(queryTokens: ReadonlySet<string>, text: string): number {
  if (queryTokens.size === 0) return 0;
  const textTokens = tokenizeForOverlap(text);
  let overlapCount = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlapCount += 1;
  }
  return overlapCount / queryTokens.size;
}

function normalizeRagWeight(value: number | undefined, fallback: number): number {
  return value === undefined
    ? fallback
    : nonnegativeNumber(value, "hybrid RAG weight");
}

function normalizeRerankerOutput(
  reranked: ReturnType<HybridKnowledgeReranker>,
  original: ReadonlyArray<HybridKnowledgeRagSlice>
): HybridKnowledgeRagSlice[] {
  const byId = new Map(original.map((slice) => [slice.chunk_id, slice]));
  const normalized: HybridKnowledgeRagSlice[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < reranked.length; index += 1) {
    const item = reranked[index];
    if (item === undefined) continue;
    const chunkId = typeof item === "string" ? item : item.chunk_id;
    if (seen.has(chunkId)) continue;
    const source = byId.get(chunkId);
    if (source === undefined) continue;
    seen.add(chunkId);

    const providedScore =
      typeof item === "string"
        ? undefined
        : item.reranker_score ??
          ("score" in item && typeof item.score === "number"
            ? item.score
            : undefined);
    normalized.push({
      ...source,
      ...(typeof item === "object" && "hybrid_score" in item ? item : {}),
      taint_level: "untrusted_external",
      reranker_score:
        providedScore ?? source.reranker_score ?? source.hybrid_score
    });
  }
  return normalized;
}

export function retrieveHybridKnowledgeRag(
  storage: ReadOnlyStorageView | CoordinatorStorageMutator,
  query: string,
  options?: HybridKnowledgeRagOptions
): HybridKnowledgeRagSlice[];
export function retrieveHybridKnowledgeRag(
  storage: ReadOnlyStorageView | CoordinatorStorageMutator,
  request: HybridKnowledgeRagRequest
): HybridKnowledgeRagSlice[];
export function retrieveHybridKnowledgeRag(
  storage: ReadOnlyStorageView | CoordinatorStorageMutator,
  queryOrRequest: string | HybridKnowledgeRagRequest,
  explicitOptions: HybridKnowledgeRagOptions = {}
): HybridKnowledgeRagSlice[] {
  const request: HybridKnowledgeRagRequest =
    typeof queryOrRequest === "string"
      ? { ...explicitOptions, query_text: queryOrRequest }
      : queryOrRequest;
  const queryText = request.query_text ?? request.queryText ?? "";
  const collectionId = request.collection_id ?? request.collectionId;
  const limit = normalizeLimit(request.limit, 8);
  const candidateLimit = normalizeLimit(
    request.candidate_limit,
    Math.max(100, limit * 8)
  );
  const denseWeight = normalizeRagWeight(
    request.dense_weight ?? request.w_dense,
    DEFAULT_HYBRID_KNOWLEDGE_RAG_WEIGHTS.dense_weight
  );
  const sparseWeight = normalizeRagWeight(
    request.sparse_weight ?? request.w_sparse,
    DEFAULT_HYBRID_KNOWLEDGE_RAG_WEIGHTS.sparse_weight
  );
  const tokenWeight = normalizeRagWeight(
    request.token_overlap_weight ?? request.w_token_overlap,
    DEFAULT_HYBRID_KNOWLEDGE_RAG_WEIGHTS.token_overlap_weight
  );

  const denseCandidates = storage.queryKnowledgeChunks({
    query_text: queryText === "" ? undefined : queryText,
    embedding: request.embedding,
    collection_id: collectionId,
    limit: candidateLimit
  });
  const sparseCandidates = storage.queryKnowledgeChunksByFts({
    query_text: queryText,
    collection_id: collectionId,
    limit: candidateLimit
  });
  const denseById = new Map(
    denseCandidates.map((candidate) => [candidate.chunk_id, candidate])
  );
  const sparseById = new Map(
    sparseCandidates.map((candidate) => [candidate.chunk_id, candidate])
  );
  const sparseRelevanceById = new Map<string, number>();
  for (let index = 0; index < sparseCandidates.length; index += 1) {
    const candidate = sparseCandidates[index];
    if (candidate !== undefined) {
      sparseRelevanceById.set(candidate.chunk_id, 1 / (index + 1));
    }
  }

  const candidateIds = new Set<string>([
    ...denseById.keys(),
    ...sparseById.keys()
  ]);
  const queryTokens = tokenizeForOverlap(queryText);
  const fused: HybridKnowledgeRagSlice[] = [];
  for (const chunkId of candidateIds) {
    const denseCandidate = denseById.get(chunkId);
    const sparseCandidate = sparseById.get(chunkId);
    const source: KnowledgeChunk | KnowledgeChunkFtsSearchResult | undefined =
      denseCandidate ?? sparseCandidate;
    if (source === undefined) continue;

    const denseSimilarity = Math.max(
      0,
      normalizeSimilarity(denseCandidate?.similarity ?? 0)
    );
    const sparseScore = sparseRelevanceById.get(chunkId) ?? 0;
    const overlapScore = tokenOverlapScore(queryTokens, source.content_text);
    const hybridScore =
      denseWeight * denseSimilarity +
      sparseWeight * sparseScore +
      tokenWeight * overlapScore;
    fused.push({
      chunk_id: source.chunk_id,
      collection_id: source.collection_id,
      document_name: source.document_name,
      chunk_index: source.chunk_index,
      content_text: source.content_text,
      metadata_json: source.metadata_json,
      taint_level: "untrusted_external",
      citation_count: source.citation_count,
      last_cited_ts_ms: source.last_cited_ts_ms,
      created_at_ts_ms: source.created_at_ts_ms,
      similarity: denseSimilarity,
      dense_similarity: denseSimilarity,
      bm25_score: sparseCandidate?.bm25_score ?? null,
      sparse_score: sparseScore,
      token_overlap_score: overlapScore,
      hybrid_score: hybridScore
    });
  }

  fused.sort(
    (left, right) =>
      right.hybrid_score - left.hybrid_score ||
      right.dense_similarity - left.dense_similarity ||
      right.sparse_score - left.sparse_score ||
      right.citation_count - left.citation_count ||
      left.chunk_id.localeCompare(right.chunk_id)
  );

  const reranked =
    request.reranker === undefined
      ? fused
      : normalizeRerankerOutput(
          request.reranker(queryText, Object.freeze([...fused])),
          fused
        );
  return reranked.slice(0, limit).map((slice) => ({
    ...slice,
    taint_level: "untrusted_external"
  }));
}

function truncateGist(contentText: string): string {
  const normalized = contentText.replace(/\s+/gu, " ").trim();
  const characters = Array.from(
    normalized === "" ? "(empty knowledge slice)" : normalized
  );
  if (characters.length < 150) return characters.join("");
  return `${characters.slice(0, 148).join("")}…`;
}

/**
 * Crystallizes every cited slice before its collection is unmounted. The
 * coordinator transaction makes the memories and their lineage edges atomic.
 */
export function extractGistCardsBeforeUnmount(
  storage: CoordinatorStorageMutator,
  collectionId: string,
  virtualTsMs: number,
  stateRev: number
): StoredMemory[] {
  if (collectionId.length === 0) {
    throw new TypeError("collectionId must not be empty.");
  }
  finiteNumber(virtualTsMs, "virtualTsMs");
  finiteNumber(stateRev, "stateRev");

  return storage.runInTransaction(() => {
    const citedChunks = storage.listCitedKnowledgeChunks(collectionId);
    return citedChunks.map((chunk) =>
      storage.insertMemoryWithLineage(
        {
          memory_id: `kb-gist:${stateRev}:${chunk.chunk_id}`,
          memory_tier: "kb_crystallized_gist",
          epistemic_type: "reported_hearsay",
          attributed_principal: `knowledge:${collectionId}`,
          visibility_scope: "public_all",
          taint_level: "untrusted_external",
          content_text: truncateGist(chunk.content_text),
          base_importance: 0.5,
          stability_half_life: 168,
          recall_count: 0,
          created_virtual_ts: virtualTsMs,
          last_recalled_ts: virtualTsMs,
          valid_from_virtual_ts: virtualTsMs,
          created_at_rev: stateRev
        },
        [
          {
            parent_type: "knowledge_chunk",
            parent_id: chunk.chunk_id,
            relation_type: "crystallized_from"
          }
        ]
      )
    );
  });
}
