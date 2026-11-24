import { randomUUID } from "node:crypto";
import type { AdminRouteHandler } from "@ai0/gateway";
import { AudienceScopeSchema } from "@ai0/protocol";
import {
  listKnowledgeCollections,
  listKnowledgeDocuments,
  readSoulProfileConfig,
  removeDocumentSlices,
  writeSoulProfileConfig
} from "@ai0/storage";
import type { DaemonHandlerContext } from "./admin-handlers.js";
import {
  importKnowledge,
  mountedCollectionIds,
  profileMounts,
  readKnowledgePages,
  searchKnowledge
} from "./knowledge-service.js";

export function knowledgeAdmin(runtime: DaemonHandlerContext): AdminRouteHandler {
  return async (request, context) => {
    const live = context.target_instance === "live";
    const storage = live
      ? runtime.storage
      : context.target_instance === "sandbox:console"
        ? runtime.sandboxStorage
        : runtime.state.sandboxForks.get(context.target_instance);
    if (!storage) return { status: 404, body: { error: "沙盒不存在" } };
    const db = storage.sqlite;
    const { collection, document, action } = context.params;
    const data = (request.body ?? {}) as Record<string, unknown>;
    const all = listKnowledgeCollections(storage);
    const ids = all.map((c) => c.id);
    const config = readSoulProfileConfig(runtime.soulDir);
    const profiles = config.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      collections: profileMounts(storage, p, ids)
    }));
    const bad = (error: string, status = 400) => ({ status, body: { error, message: error } });
    let targetDocument: string | undefined;
    let attemptedName = "";
    try {
      if (!collection) {
        if (request.method === "GET") return { collections: all, profiles };
        const name = String(data.name ?? "").trim();
        if (!name || name.length > 160) return bad("请输入 1 至 160 字的库名");
        const id = randomUUID();
        db.prepare("INSERT INTO knowledge_collections(id,name) VALUES(?,?)").run(id, name);
        return { id };
      }
      if (!ids.includes(collection)) return bad("知识库不存在", 404);
      if (action === "search")
        return searchKnowledge(runtime, storage, String(data.query ?? ""), [collection]);
      if (action === "mount") {
        if (!profiles.some((p) => p.id === data.profileId) || typeof data.mounted !== "boolean")
          return bad("配置档或挂载状态无效");
        if (!live) {
          db.prepare(
            "INSERT INTO knowledge_mount_overrides VALUES(?,?,?) ON CONFLICT(profile_id,collection_id) DO UPDATE SET mounted=excluded.mounted"
          ).run(String(data.profileId), collection, Number(data.mounted));
          return { ok: true };
        }
        writeSoulProfileConfig(runtime.soulDir, {
          ...config,
          profiles: config.profiles.map((p) => {
            if (p.id !== data.profileId) return p;
            const next = new Set(mountedCollectionIds(p.knowledgeCollectionIds, ids));
            if (data.mounted) next.add(collection);
            else next.delete(collection);
            return { ...p, knowledgeCollectionIds: [...next] };
          })
        });
        return { ok: true };
      }
      if (action === "audience") {
        const parsed = AudienceScopeSchema.safeParse(data.audience);
        if (!parsed.success) return bad("受众须为仅本人、指定群组或公开");
        db.prepare("UPDATE knowledge_collections SET audience=? WHERE id=?").run(parsed.data, collection);
        return { ok: true };
      }
      if (action === "import") {
        const bytes =
          typeof data.base64 === "string"
            ? Buffer.from(data.base64, "base64")
            : Buffer.from(String(data.content ?? ""));
        const name = String(data.name ?? "").trim();
        attemptedName = name;
        const explicit = typeof data.documentId === "string";
        const target = db
          .prepare(
            "SELECT id FROM knowledge_documents WHERE collection_id=? AND " + (explicit ? "id=?" : "name=?")
          )
          .get(collection, explicit ? String(data.documentId) : name);
        if (target) targetDocument = String(target.id);
        const result = await importKnowledge(
          runtime,
          storage,
          collection,
          name,
          bytes,
          /\.pdf$/i.test(name) ? "pdf" : "text",
          typeof data.documentId === "string" ? data.documentId : undefined
        );
        const [indexed] = listKnowledgeDocuments(storage, collection, result.id);
        if (!indexed) return bad("文档已移除，请重新导入", 409);
        db.prepare("DELETE FROM knowledge_import_errors WHERE collection_id=? AND name IN (?,?)").run(
          collection,
          name,
          typeof data.retryName === "string" ? data.retryName : name
        );
        if (result.id === targetDocument)
          db.prepare("DELETE FROM knowledge_update_errors WHERE document_id=?").run(result.id);
        return { ...result, document: indexed };
      }
      if (!document)
        return {
          failures: db
            .prepare(
              `SELECT name,reason,NULL AS documentId FROM knowledge_import_errors WHERE collection_id=?
              UNION ALL SELECT e.name,e.reason,e.document_id FROM knowledge_update_errors e
              JOIN knowledge_documents d ON d.id=e.document_id WHERE d.collection_id=? ORDER BY name`
            )
            .all(collection, collection),
          documents: listKnowledgeDocuments(storage, collection),
          cited: db
            .prepare(
              "SELECT document_name title,content_text excerpt,citation_count count FROM knowledge_chunks WHERE collection_id=? AND citation_count>0 ORDER BY citation_count DESC"
            )
            .all(collection)
        };
      const row = db
        .prepare("SELECT * FROM knowledge_documents WHERE collection_id=? AND id=?")
        .get(collection, document);
      if (!row) return bad("文档不存在", 404);
      if (action === "rebuild") {
        attemptedName = String(row.name);
        targetDocument = document;
        const result = await importKnowledge(
          runtime,
          storage,
          collection,
          String(row.name),
          row.original as Uint8Array,
          String(row.format),
          document,
          true
        );
        db.prepare("DELETE FROM knowledge_update_errors WHERE document_id=?").run(document);
        return result;
      }
      if (request.method === "DELETE") {
        storage.runInTransaction(() => {
          removeDocumentSlices(storage, document);
          db.prepare("DELETE FROM knowledge_documents WHERE id=?").run(document);
        });
        return { ok: true };
      }
      return {
        format: row.format,
        pages: await readKnowledgePages(row.original as Uint8Array, String(row.format)),
        chunks: db
          .prepare(
            "SELECT k.chunk_id id,l.location,k.content_text text FROM knowledge_locations l JOIN knowledge_chunks k USING(chunk_id) WHERE document_id=? AND l.active=1 ORDER BY k.chunk_index"
          )
          .all(document)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (collection && targetDocument) {
        db.prepare(
          `INSERT INTO knowledge_update_errors(document_id,name,reason)
          SELECT id,?,? FROM knowledge_documents WHERE collection_id=? AND id=?
          ON CONFLICT(document_id) DO UPDATE SET name=excluded.name,reason=excluded.reason`
        ).run(attemptedName, reason, collection, targetDocument);
      } else if (action === "import" && collection && attemptedName && !data.documentId)
        db.prepare(
          "INSERT INTO knowledge_import_errors VALUES(?,?,?) ON CONFLICT(collection_id,name) DO UPDATE SET reason=excluded.reason"
        ).run(collection, attemptedName, reason);
      return bad(reason);
    }
  };
}
