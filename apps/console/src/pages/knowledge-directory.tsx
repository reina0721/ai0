import { RippleButton } from "../design-system/primitives/index.js";
import { WorkspaceEntryCard, WorkspaceStatus } from "./workspace-layout.js";
import { useState } from "react";
import { BookOpen, ChevronDown, FolderOpen } from "lucide-react";
import type { KnowledgeCollection } from "@ai0/protocol";

export interface LibraryProfile {
  id: string;
  name: string;
  collections: string[];
}
export type LibraryView = "docs" | "access" | "import" | "failures";

export function libraryHref(id: string, view: LibraryView = "docs") {
  const fragment = new URLSearchParams({ library: id });
  if (view !== "docs") fragment.set("view", view);
  return "/capabilities/knowledge#" + fragment;
}

export function ConversationScope({
  library,
  profiles,
  manage,
  searchable = library.searchableDocuments > 0,
  showManage = false
}: {
  library: KnowledgeCollection;
  profiles: LibraryProfile[];
  manage: () => void;
  searchable?: boolean;
  showManage?: boolean;
}) {
  const mounted = profiles.filter((p) => p.collections.includes(library.id));
  const [expanded, setExpanded] = useState(false);
  const audience = library.audience.startsWith("group:")
    ? "本人及群组 " + library.audience.slice(6)
    : library.audience === "public_all"
      ? "公开"
      : "仅本人";
  if (!mounted.length)
    return (
      <div className="kb-scope">
        <span className="kb-muted">未挂载</span>
        <RippleButton variant="ghost" size="sm" onClick={manage}>
          选择配置档
        </RippleButton>
      </div>
    );
  return (
    <div className="kb-scope">
      <span>
        {!searchable && "已挂载到"}
        {mounted[0]!.name}
      </span>
      {mounted.length > 1 && (
        <RippleButton
          variant="ghost"
          size="sm"
          ariaExpanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          另 {mounted.length - 1} 个 <ChevronDown size={12} />
        </RippleButton>
      )}
      <span className="kb-audience">{audience}</span>
      {!searchable && <small>有可搜索资料后可用</small>}
      {showManage && (
        <RippleButton variant="ghost" size="sm" onClick={manage}>
          管理
        </RippleButton>
      )}
      {expanded && (
        <ul>
          {mounted.slice(1).map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KnowledgeDirectory({
  libraries,
  profiles,
  enter
}: {
  libraries: KnowledgeCollection[];
  profiles: LibraryProfile[];
  enter: (id: string, view: LibraryView) => void;
}) {
  if (!libraries.length)
    return (
      <div className="kb-empty">
        <FolderOpen size={30} />
        <h2>还没有知识库</h2>
        <p>新建知识库后，就可以导入第一份资料。</p>
      </div>
    );
  return (
    <section aria-label="知识库目录" className="kb-catalog">
      <div className="kb-columns" aria-hidden="true">
        <span>库名</span>
        <span>可搜索资料</span>
        <span>对话使用范围</span>
      </div>
      {libraries.map((c) => (
        <WorkspaceEntryCard action={{label:c.name,href:libraryHref(c.id)}} className="kb-directory-row" key={c.id} data-pack-id={c.id}>
          <span className="kb-library-name">
            <BookOpen size={16} />
            <strong>{c.name}</strong>
          </span>
          <div className="kb-cell">
            <span className="kb-mobile-label">可搜索</span>
            <div>
              {c.searchableDocuments ? (
                <WorkspaceStatus data-tone="good">{c.searchableDocuments} 篇可搜</WorkspaceStatus>
              ) : (
                <>
                  <span className="kb-muted">{c.documents ? "暂无可搜资料" : "暂无资料"}</span>{" "}
                  <RippleButton variant="ghost" size="sm" onClick={() => enter(c.id, "import")}>
                    导入文档
                  </RippleButton>
                </>
              )}
              {c.documents > c.searchableDocuments && c.searchableDocuments > 0 && (
                <small> / 共 {c.documents} 篇</small>
              )}
              {c.errors > 0 && (
                <RippleButton
                  variant="danger"
                  size="sm"
                  className="kb-failure-link"
                  onClick={() => enter(c.id, "failures")}
                >
                  {c.errors} 次导入失败 · 查看原因
                </RippleButton>
              )}
            </div>
          </div>
          <div className="kb-cell">
            <span className="kb-mobile-label">对话</span>
            <ConversationScope library={c} profiles={profiles} manage={() => enter(c.id, "access")} />
          </div>
        </WorkspaceEntryCard>
      ))}
    </section>
  );
}
