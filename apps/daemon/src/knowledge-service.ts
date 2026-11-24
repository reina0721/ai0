import { randomUUID } from "node:crypto";
import type { AudienceScope, KnowledgeSearch, ModelSlotBinding } from "@ai0/protocol";
import {
  knowledgeCandidates,
  knowledgeDigest,
  knowledgeWords,
  prepareKnowledgeLibrary,
  PROVIDER_VENDOR_TEMPLATES,
  readHostInfrastructureConfig,
  readSoulProfileConfig,
  resolveEffectiveSourceApiKeys,
  saveIndexedDocument,
  type CoordinatorStorageMutator,
  type LocatedText
} from "@ai0/storage";

export interface KnowledgeRuntime {
  soulDir: string;
  hostDir: string;
}
export const presetCollections: Record<string, string> = {
  kb_harbor_astronomy: "kb.practical_astronomy",
  kb_project_architecture: "kb.ai0_architecture_handbook"
};
export function mountedCollectionIds(ids: string[], available: string[]) {
  return [...new Set(ids.map((id) => (available.includes(id) ? id : (presetCollections[id] ?? id))))];
}
export function profileMounts(
  storage: CoordinatorStorageMutator,
  profile: { id: string; knowledgeCollectionIds: string[] },
  available?: string[]
) {
  const overrides = storage.sqlite
    .prepare("SELECT collection_id,mounted FROM knowledge_mount_overrides WHERE profile_id=?")
    .all(profile.id);
  if (!overrides.length && !available) return profile.knowledgeCollectionIds;
  const ids =
    available ??
    storage.sqlite
      .prepare("SELECT id FROM knowledge_collections")
      .all()
      .map((r) => String(r.id));
  const mounted = new Set(mountedCollectionIds(profile.knowledgeCollectionIds, ids));
  for (const row of overrides) {
    if (row.mounted) mounted.add(String(row.collection_id));
    else mounted.delete(String(row.collection_id));
  }
  return [...mounted];
}
export function allowedCollections(
  storage: CoordinatorStorageMutator,
  mounted: string[] | undefined,
  audience: AudienceScope,
  owner: boolean
) {
  prepareKnowledgeLibrary(storage);
  const all = storage.sqlite.prepare("SELECT id,audience FROM knowledge_collections").all() as unknown as {
    id: string;
    audience: AudienceScope;
  }[];
  const mounts =
    mounted &&
    mountedCollectionIds(
      mounted,
      all.map((c) => c.id)
    );
  return all
    .filter(
      (c) =>
        (!mounts || mounts.includes(c.id)) &&
        (c.audience === "public_all" ||
          (audience === "only_owner" && owner) ||
          (audience.startsWith("group:") && audience === c.audience))
    )
    .map((c) => c.id);
}

function provider(runtime: KnowledgeRuntime, binding: ModelSlotBinding, kind: "embedding" | "rerank") {
  const infra = readHostInfrastructureConfig(runtime.hostDir);
  const sourceId =
    infra.providerSources.find((s) => s.id === binding.providerId)?.id ??
    infra.providerSources.find((s) => binding.providerId === s.id + "__" + kind)?.id ??
    binding.providerId;
  const instance = infra.modelInstances.find((m) =>
    binding.modelInstanceId
      ? m.id === binding.modelInstanceId
      : m.sourceId === sourceId && m.modelId === binding.modelId && m.capabilityKind === kind
  );
  const source = infra.providerSources.find((s) => s.id === (instance?.sourceId ?? sourceId));
  if (
    !source?.enabled ||
    !source.supportedCapabilities.includes(kind) ||
    instance?.enabled === false ||
    (binding.modelInstanceId && (!instance || instance.capabilityKind !== kind))
  )
    throw Error("绑定的模型或服务商不可用");
  const keys = resolveEffectiveSourceApiKeys(runtime.hostDir, source);
  if (
    !keys.length &&
    PROVIDER_VENDOR_TEMPLATES.some((t) => t.requiresApiKey && t.defaultBaseUrl === source.baseUrl)
  )
    throw Error("请配置服务商凭据");
  const base = source.baseUrl.replace(/\/+$/, "");
  const model = instance?.modelId ?? binding.modelId;
  const key = JSON.stringify([source.id, base, model]);
  async function call(payload: Record<string, unknown>, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(Math.min(15000, source!.timeoutMs ?? 8000));
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for (const apiKey of keys.length ? keys : [""]) {
      const response = await fetch(base + (kind === "embedding" ? "/embeddings" : "/rerank"), {
        method: "POST",
        headers: {
          ...source!.customHeaders,
          "content-type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {})
        },
        body: JSON.stringify({ model, ...payload }),
        signal: requestSignal
      });
      if (response.ok) return response.json();
      if (apiKey && apiKey !== keys.at(-1) && [401, 403, 429].includes(response.status)) continue;
      throw Error("服务返回 HTTP " + response.status);
    }
    throw Error("模型服务不可用");
  }
  return { key, call };
}

async function embed(client: ReturnType<typeof provider>, input: string[], signal?: AbortSignal) {
  const response = (await client.call({ input }, signal)) as {
    data?: { index: number; embedding: number[] }[];
  };
  const data = response.data?.slice().sort((a, b) => a.index - b.index);
  if (
    !Array.isArray(data) ||
    data.length !== input.length ||
    data.some(
      (r, i) =>
        r.index !== i ||
        !Array.isArray(r.embedding) ||
        !r.embedding.length ||
        r.embedding.length !== data[0]?.embedding.length ||
        !r.embedding.every(Number.isFinite)
    )
  )
    throw Error("向量格式或维度无效");
  return data.map((r) => r.embedding);
}

export async function readKnowledgePages(original: Uint8Array, format: string) {
  if (format !== "pdf") {
    try {
      return [new TextDecoder("utf-8", { fatal: true }).decode(original).replace(/\r\n?/g, "\n")];
    } catch {
      throw Error("文本文件需要使用 UTF-8 编码");
    }
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: Uint8Array.from(original),
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join("")
      );
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

function splitPages(pages: string[], pdf: boolean, size: number, overlap: number) {
  const slices: LocatedText[] = [];
  for (const [page, text] of pages.entries()) {
    const sections = [...text.matchAll(/^(?=#{1,6}[ \t])/gm)].map((m) => m.index);
    const boundaries = [...new Set([0, ...sections, text.length])];
    let lineBase = 1;
    for (let n = 1; n < boundaries.length; n++) {
      const section = text.slice(boundaries[n - 1], boundaries[n]);
      const heading = /^#{1,6}\s+([^\n]+)/.exec(section)?.[1];
      let line = lineBase;
      for (let start = 0; start < section.length; ) {
        let end = Math.min(start + size, section.length);
        if (end < section.length) {
          const boundary = section.lastIndexOf("\n", end - 1) + 1;
          if (boundary > start + Math.max(size / 2, overlap)) end = boundary;
        }
        const part = section.slice(start, end);
        const last = line + (part.trimEnd().match(/\n/g)?.length ?? 0);
        if (part.trim())
          slices.push({
            text: part.trim(),
            location: pdf
              ? "第 " + (page + 1) + " 页"
              : (heading ? heading + " · " : "") + "第 " + line + "–" + last + " 行"
          });
        if (end === section.length) break;
        const next = Math.max(start + 1, end - overlap);
        line += section.slice(start, next).match(/\n/g)?.length ?? 0;
        start = next;
      }
      lineBase += section.match(/\n/g)?.length ?? 0;
    }
  }
  return slices;
}

export async function importKnowledge(
  runtime: KnowledgeRuntime,
  storage: CoordinatorStorageMutator,
  collection: string,
  name: string,
  original: Uint8Array,
  format: string,
  documentId?: string,
  rebuild = false
) {
  prepareKnowledgeLibrary(storage);
  if (!name.trim() || !original.length || original.length > 16 * 1024 * 1024)
    throw Error("请输入文件名并选择 16 MB 以内的非空文件");
  const db = storage.sqlite;
  if (!db.prepare("SELECT id FROM knowledge_collections WHERE id=?").get(collection))
    throw Error("知识库不存在");
  const digest = knowledgeDigest(original);
  const match = db
    .prepare(
      "SELECT id,revision,embedding_key FROM knowledge_documents WHERE collection_id=? AND " +
        (documentId ? "id=?" : "name=?")
    )
    .get(collection, documentId ?? name);
  if (documentId && !match) throw Error("文档不存在");
  const same = db
    .prepare("SELECT id FROM knowledge_documents WHERE collection_id=? AND digest=?")
    .get(collection, digest);
  if (same && !rebuild && (!documentId || same.id === documentId))
    return { id: String(same.id), chunksCreated: 0, reused: true };
  if (same && same.id !== match?.id) throw Error("库内已有相同内容的文档");
  const pages = await readKnowledgePages(original, format);
  const config = readSoulProfileConfig(runtime.soulDir).capabilities.knowledge;
  const slices = splitPages(pages, format === "pdf", config.chunkSize, config.chunkOverlap);
  if (!slices.length)
    throw Error(format === "pdf" ? "未提取到文字，请选择带文字层的 PDF" : "文档没有可索引文字");
  let vectors: number[][] | undefined;
  let embeddingKey = "",
    warning = "";
  if (config.embeddingBinding) {
    try {
      const client = provider(runtime, config.embeddingBinding, "embedding");
      const values: number[][] = [];
      for (let i = 0; i < slices.length; i += 32)
        values.push(
          ...(await embed(
            client,
            slices.slice(i, i + 32).map((s) => s.text)
          ))
        );
      if (values.some((v) => v.length !== values[0]!.length)) throw Error("向量维度发生变化");
      vectors = values;
      embeddingKey = client.key;
    } catch (error) {
      if (match?.embedding_key) throw Error("向量索引失败，已保留上一版 · " + message(error));
      warning = "仅全文索引 · " + message(error);
    }
  }
  const id = String(match?.id ?? randomUUID());
  const existing = db
    .prepare("SELECT id FROM knowledge_documents WHERE collection_id=? AND digest=?")
    .get(collection, digest);
  if (!rebuild && existing && (!documentId || existing.id === documentId))
    return { id: String(existing.id), chunksCreated: 0, reused: true };
  saveIndexedDocument(storage, {
    id,
    collection,
    name,
    original,
    format,
    digest,
    slices,
    vectors,
    embeddingKey,
    warning,
    revision: Number(match?.revision ?? 0) + 1
  });
  return { id, chunksCreated: slices.length, reused: false, warning };
}
const message = (error: unknown) => {
  if (error instanceof TypeError && error.message === "fetch failed") return "无法连接模型服务";
  if (error instanceof Error && error.name === "TimeoutError") return "模型服务响应超时";
  return error instanceof Error ? error.message : String(error);
};

export async function searchKnowledge(
  runtime: KnowledgeRuntime,
  storage: CoordinatorStorageMutator,
  query: string,
  allowed: string[],
  signal?: AbortSignal,
  currentAllowed?: () => string[]
): Promise<KnowledgeSearch> {
  const config = readSoulProfileConfig(runtime.soulDir).capabilities.knowledge;
  const stages: string[] = [],
    warnings: string[] = [];
  const empty = { results: [], stages, warnings, honestForgetTriggered: true };
  if (!allowed.length || !query.trim()) return empty;
  let embedding: { key: string; vector: number[] } | undefined;
  if (config.embeddingBinding) {
    try {
      const client = provider(runtime, config.embeddingBinding, "embedding");
      const rows = storage.sqlite
        .prepare(
          `SELECT d.embedding_key AS key,json_array_length(v.embedding_json) dim
        FROM knowledge_documents d LEFT JOIN knowledge_locations l ON l.document_id=d.id AND l.active=1
        LEFT JOIN knowledge_chunks_vec v USING(chunk_id) WHERE collection_id IN (SELECT value FROM json_each(?))
        GROUP BY key,dim`
        )
        .all(JSON.stringify(allowed));
      if (rows.some((r) => r.key === client.key)) {
        const [vector] = await embed(client, [query], signal);
        if (rows.some((r) => r.key === client.key && r.dim === vector!.length))
          embedding = { key: client.key, vector: vector! };
        if (rows.some((r) => r.key !== client.key || r.dim !== vector!.length))
          warnings.push("部分向量索引需要重建");
      } else if (rows.length) warnings.push("向量索引待建立");
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push("向量检索不可用 · " + message(error));
    }
  }
  stages.push("FTS5 BM25");
  if (embedding) stages.push("向量召回");
  if (currentAllowed) {
    const stillAllowed = new Set(currentAllowed());
    allowed = allowed.filter((id) => stillAllowed.has(id));
  }
  const hits = knowledgeCandidates(storage, allowed, query, Math.max(24, config.topK * 4), embedding);
  const terms = new Set(knowledgeWords(query));
  const sparseOrder = hits.filter((h) => h.bm25 !== null).sort((a, b) => a.bm25! - b.bm25!);
  for (const h of hits) {
    const words = new Set(knowledgeWords(h.excerpt));
    const coverage = [...terms].filter((t) => words.has(t)).length / Math.max(1, terms.size);
    const sparse = h.bm25 === null ? 0 : coverage * (0.8 + 0.2 / (1 + sparseOrder.indexOf(h)));
    const dense = h.denseSim === null ? 0 : Math.max(0, h.denseSim);
    h.score =
      embedding && h.denseSim !== null
        ? (dense * config.denseWeight + sparse * config.bm25Weight) /
          (config.denseWeight + config.bm25Weight || 1)
        : sparse;
  }
  hits.sort((a, b) => b.score - a.score);
  if (config.rerankBinding && hits.length) {
    try {
      const items = hits.slice(0, Math.max(16, config.topK * 2));
      const client = provider(runtime, config.rerankBinding, "rerank");
      const data = (await client.call({ query, documents: items.map((h) => h.excerpt) }, signal)) as {
        results?: { index: number; relevance_score: number }[];
      };
      if (
        !data.results?.length ||
        data.results.some(
          (r) => !Number.isInteger(r.index) || !items[r.index] || !Number.isFinite(r.relevance_score)
        ) ||
        new Set(data.results.map((r) => r.index)).size !== data.results.length
      )
        throw Error("精排响应无效");
      const ranked = data.results
        .map((r) => ({ ...items[r.index]!, score: r.relevance_score, rerankScore: r.relevance_score }))
        .sort((a, b) => b.score - a.score);
      hits.splice(0, hits.length, ...ranked);
      stages.push("模型精排");
    } catch (error) {
      signal?.throwIfAborted();
      warnings.push("精排不可用 · " + message(error));
    }
  }
  const results = hits.slice(0, config.topK);
  return {
    results,
    stages,
    warnings,
    honestForgetTriggered: !results.length || results[0]!.score < config.honestForgetThreshold
  };
}
