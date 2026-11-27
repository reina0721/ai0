import { createHash, randomUUID } from "node:crypto";
import type { KnowledgeCollection, KnowledgeDocument, KnowledgeHit, KnowledgeSource } from "@ai0/protocol";
import type { CoordinatorStorageMutator } from "./database-driver.js";

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
export function knowledgeWords(text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLowerCase())]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment);
}
export const knowledgeDigest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const migrated = new WeakSet<CoordinatorStorageMutator>();

export function prepareKnowledgeLibrary(storage: CoordinatorStorageMutator) {
  if (migrated.has(storage)) return;
  const db = storage.sqlite;
  storage.runInTransaction(() => {
    db.prepare(
      "UPDATE memories SET visibility_scope='only_owner' WHERE memory_tier='kb_crystallized_gist' AND visibility_scope<>'only_owner' AND attributed_principal LIKE 'knowledge:%'"
    ).run();
    const legacy = db
      .prepare(
        `SELECT k.* FROM knowledge_chunks k LEFT JOIN knowledge_locations l USING(chunk_id)
      WHERE l.chunk_id IS NULL ORDER BY collection_id,document_name,chunk_index,created_at_ts_ms`
      )
      .all();
    const groups = new Map<string, typeof legacy>();
    for (const row of legacy) {
      const key = JSON.stringify([row.collection_id, row.document_name]);
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    for (const rows of groups.values()) {
      const { collection_id: collection, document_name: title } = rows[0]!;
      db.prepare("INSERT OR IGNORE INTO knowledge_collections(id,name) VALUES(?,?)").run(
        collection!,
        String(collection).replace(/^kb\./, "").replaceAll("_", " ")
      );
      const original = Buffer.from(rows.map((r) => r.content_text).join("\n"));
      const id = randomUUID();
      db.prepare(
        `INSERT INTO knowledge_documents(id,collection_id,name,digest,original,format,revision)
        VALUES(?,?,?,?,?,'legacy',1)`
      ).run(id, collection!, title!, "legacy:" + id, original);
      for (const row of rows) {
        db.prepare(
          "INSERT INTO knowledge_locations(chunk_id,document_id,location,legacy_citations) VALUES(?,?,?,?)"
        ).run(row.chunk_id!, id, "历史切片 " + (Number(row.chunk_index) + 1), row.citation_count!);
        db.prepare("UPDATE knowledge_chunks SET citation_count=0 WHERE chunk_id=?").run(row.chunk_id!);
        db.prepare("DELETE FROM knowledge_chunks_fts WHERE chunk_id=?").run(row.chunk_id!);
        indexText(storage, String(row.chunk_id), String(collection), String(row.content_text));
      }
    }
  });
  migrated.add(storage);
}

function indexText(storage: CoordinatorStorageMutator, chunkId: string, collection: string, content: string) {
  const db = storage.sqlite;
  db.prepare("INSERT INTO knowledge_chunks_fts(chunk_id,collection_id,content_text) VALUES(?,?,?)").run(
    chunkId,
    collection,
    knowledgeWords(content).join(" ")
  );
}

export function listKnowledgeCollections(storage: CoordinatorStorageMutator): KnowledgeCollection[] {
  prepareKnowledgeLibrary(storage);
  return storage.sqlite
    .prepare(
      `SELECT c.id,c.name,c.audience,COUNT(DISTINCT d.id) documents,
    COUNT(DISTINCT CASE WHEN l.active=1 THEN d.id END) searchableDocuments,
    COUNT(CASE WHEN l.active=1 THEN 1 END) chunks,COALESCE(SUM(k.citation_count),0) citations,
    (SELECT COUNT(*) FROM knowledge_import_errors err WHERE err.collection_id=c.id) +
    COUNT(DISTINCT err.document_id) errors,
    COUNT(DISTINCT CASE WHEN d.warning<>'' THEN d.id END) warnings
    FROM knowledge_collections c LEFT JOIN knowledge_documents d ON d.collection_id=c.id
    LEFT JOIN knowledge_update_errors err ON err.document_id=d.id
    LEFT JOIN knowledge_locations l ON l.document_id=d.id LEFT JOIN knowledge_chunks k USING(chunk_id)
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE,c.id`
    )
    .all() as unknown as KnowledgeCollection[];
}

export function listKnowledgeDocuments(
  storage: CoordinatorStorageMutator,
  collection: string,
  documentId?: string
): KnowledgeDocument[] {
  return storage.sqlite
    .prepare(
      `SELECT d.id,name,revision,warning,COUNT(l.chunk_id) chunks FROM knowledge_documents d
    LEFT JOIN knowledge_locations l ON d.id=l.document_id AND l.active=1 WHERE collection_id=?
    ${documentId ? "AND d.id=?" : ""} GROUP BY d.id ORDER BY name`
    )
    .all(collection, ...(documentId ? [documentId] : [])) as unknown as KnowledgeDocument[];
}

export interface LocatedText {
  location: string;
  text: string;
}
export interface IndexedDocument {
  id: string;
  collection: string;
  name: string;
  original: Uint8Array;
  format: string;
  digest: string;
  revision: number;
  warning: string;
  embeddingKey: string;
  slices: LocatedText[];
  vectors?: number[][];
}

export function removeDocumentSlices(storage: CoordinatorStorageMutator, id: string) {
  const db = storage.sqlite;
  const select = "SELECT chunk_id FROM knowledge_locations WHERE document_id=?";
  db.prepare("DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (" + select + ")").run(id);
  db.prepare("DELETE FROM knowledge_chunks WHERE chunk_id IN (" + select + ")").run(id);
}

export function saveIndexedDocument(storage: CoordinatorStorageMutator, doc: IndexedDocument) {
  const db = storage.sqlite;
  storage.runInTransaction(() => {
    const current = db.prepare("SELECT revision FROM knowledge_documents WHERE id=?").get(doc.id);
    if (Number(current?.revision ?? 0) !== doc.revision - 1) throw Error("文档已更新，请刷新后重试");
    // Retire the previous generation atomically. Keep only slices needed by citations or lineage.
    const previous = "SELECT chunk_id FROM knowledge_locations WHERE document_id=? AND active=1";
    db.prepare("DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (" + previous + ")").run(doc.id);
    db.prepare("DELETE FROM knowledge_chunks_vec WHERE chunk_id IN (" + previous + ")").run(doc.id);
    db.prepare(
      `DELETE FROM knowledge_chunks WHERE chunk_id IN (${previous}) AND
      NOT EXISTS (SELECT 1 FROM knowledge_turn_sources s WHERE s.chunk_id=knowledge_chunks.chunk_id) AND
      NOT EXISTS (SELECT 1 FROM memory_lineage_edges e WHERE e.parent_id=knowledge_chunks.chunk_id AND e.parent_type='knowledge_chunk')`
    ).run(doc.id);
    db.prepare("UPDATE knowledge_locations SET active=0 WHERE document_id=?").run(doc.id);
    db.prepare(
      `INSERT INTO knowledge_documents(id,collection_id,name,digest,original,format,revision,warning,embedding_key)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,digest=excluded.digest,
      original=excluded.original,format=excluded.format,revision=excluded.revision,warning=excluded.warning,
      embedding_key=excluded.embedding_key`
    ).run(
      doc.id,
      doc.collection,
      doc.name,
      doc.digest,
      doc.original,
      doc.format,
      doc.revision,
      doc.warning,
      doc.embeddingKey
    );
    const chunk =
      db.prepare(`INSERT INTO knowledge_chunks(chunk_id,collection_id,document_name,chunk_index,content_text,created_at_ts_ms)
      VALUES(?,?,?,?,?,?)`);
    const loc = db.prepare("INSERT INTO knowledge_locations(chunk_id,document_id,location) VALUES(?,?,?)");
    const vec = db.prepare("INSERT INTO knowledge_chunks_vec VALUES(?,?)");
    doc.slices.forEach((s, i) => {
      const id = randomUUID();
      chunk.run(id, doc.collection, doc.name, i, s.text, Date.now());
      loc.run(id, doc.id, s.location);
      indexText(storage, id, doc.collection, s.text);
      if (doc.vectors) vec.run(id, JSON.stringify(doc.vectors[i]));
    });
  });
}

const sourceColumns = `k.chunk_id chunkId,k.collection_id collectionId,d.id documentId,k.document_name title,
  l.location,k.content_text excerpt,k.taint_level`;
const sourceJoin = `knowledge_chunks k JOIN knowledge_locations l USING(chunk_id)
  JOIN knowledge_documents d ON d.id=l.document_id`;

export function knowledgeCandidates(
  storage: CoordinatorStorageMutator,
  collections: string[],
  query: string,
  limit: number,
  embedding?: { key: string; vector: number[] }
) {
  const db = storage.sqlite;
  const allowed = "l.active=1 AND k.collection_id IN (SELECT value FROM json_each(?))";
  const ids = JSON.stringify(collections);
  const terms = [...new Set(knowledgeWords(query))].slice(0, 64);
  const hits = new Map<string, KnowledgeHit>();
  if (terms.length) {
    const match = terms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(" OR ");
    const rows = db
      .prepare(
        `SELECT ${sourceColumns},bm25(knowledge_chunks_fts) bm25
      FROM ${sourceJoin} JOIN knowledge_chunks_fts f ON f.chunk_id=k.chunk_id
      WHERE knowledge_chunks_fts MATCH ? AND ${allowed} ORDER BY bm25,k.chunk_id LIMIT ?`
      )
      .all(match, ids, limit) as unknown as (KnowledgeSource & { bm25: number })[];
    rows.forEach((r) => hits.set(r.chunkId, { ...r, denseSim: null, rerankScore: null, score: 0 }));
  }
  if (embedding) {
    const rows = db
      .prepare(
        `SELECT ${sourceColumns},vec_cosine_similarity(v.embedding_json,?) denseSim
      FROM ${sourceJoin} JOIN knowledge_chunks_vec v USING(chunk_id) WHERE ${allowed}
      AND d.embedding_key=? AND json_array_length(v.embedding_json)=? ORDER BY denseSim DESC,k.chunk_id LIMIT ?`
      )
      .all(
        JSON.stringify(embedding.vector),
        ids,
        embedding.key,
        embedding.vector.length,
        limit
      ) as unknown as (KnowledgeSource & { denseSim: number })[];
    rows.forEach((r) =>
      hits.set(r.chunkId, { ...r, bm25: hits.get(r.chunkId)?.bm25 ?? null, rerankScore: null, score: 0 })
    );
  }
  return [...hits.values()];
}

export function turnKnowledgeSources(storage: CoordinatorStorageMutator, event: string, collections: string[]) {
  return storage.sqlite
    .prepare(
      `SELECT ${sourceColumns},s.marker FROM ${sourceJoin}
    JOIN knowledge_turn_sources s USING(chunk_id) WHERE s.event_id=?
    AND k.collection_id IN (SELECT value FROM json_each(?)) ORDER BY marker`
    )
    .all(event, JSON.stringify(collections)) as unknown as (KnowledgeSource & { marker: number })[];
}

export function countDeliveredSources(
  storage: CoordinatorStorageMutator,
  event: string,
  delivered: string,
  now: number
) {
  const db = storage.sqlite;
  const count = db.prepare(
    "UPDATE knowledge_chunks SET citation_count=citation_count+1,last_cited_ts_ms=? WHERE chunk_id=?"
  );
  for (const source of db
    .prepare("SELECT chunk_id,marker FROM knowledge_turn_sources WHERE event_id=? AND counted=0")
    .all(event)) {
    if (!delivered.includes("[K" + source.marker + "]")) continue;
    count.run(now, source.chunk_id!);
    db.prepare("UPDATE knowledge_turn_sources SET counted=1 WHERE event_id=? AND chunk_id=?").run(
      event,
      source.chunk_id!
    );
  }
}
