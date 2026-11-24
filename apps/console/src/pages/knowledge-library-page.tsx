import { useInRouterContext, useLocation } from "react-router";
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AudienceScopeSchema,
  type KnowledgeCollection,
  type KnowledgeDocument,
  type KnowledgeSearch
} from "@ai0/protocol";
import {
  Search,
  ChevronRight,
  FileText,
  MessagesSquare,
  Plus,
  Settings2,
  ArrowLeft,
  Upload
} from "lucide-react";
import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactActionMenu,
  CompactDisclosure,
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../design-system/primitives/index.js";
import { WorkspaceHeader, WorkspaceConfirm, useAdminResource } from "./workspace.js";
import {
  WorkspaceEntryCard,
  WorkspaceField,
  WorkspacePage,
  WorkspaceStatus
} from "./workspace-layout.js";
import { KnowledgeSettings } from "./knowledge-settings.js";
import {
  KnowledgeDirectory,
  libraryHref,
  ConversationScope,
  type LibraryProfile,
  type LibraryView
} from "./knowledge-directory.js";
import { KnowledgeIntake, type ImportReceipt } from "./knowledge-intake.js";
import { KnowledgeReader } from "./knowledge-reader.js";
import "./knowledge-library.css";

const base = "capabilities/knowledge/collections";
interface Catalog {
  collections: KnowledgeCollection[];
  profiles: LibraryProfile[];
}
interface Detail {
  failures: { name: string; reason: string; documentId: string | null }[];
  documents: KnowledgeDocument[];
  cited: { title: string; excerpt: string; count: number }[];
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Back({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <RippleButton variant="ghost" size="sm" type="button" className="kb-back" onClick={onClick}>
      <ArrowLeft size={14} />
      {children}
    </RippleButton>
  );
}
function Feedback({ error }: { error: string }) {
  return error ? (
    <p className="kb-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function KnowledgeLibraryPage() {
  const routed = useInRouterContext();
  return routed ? <RoutedKnowledgeLibrary /> : <LibraryWorkspace fragment="" />;
}
function RoutedKnowledgeLibrary() {
  return <LibraryWorkspace fragment={useLocation().hash} />;
}
function LibraryWorkspace({ fragment }: { fragment: string }) {
  const ctx = useConsole();
  const { data: catalog, error, refresh: refreshDirectory } = useAdminResource<Catalog>(base);
  const params = new URLSearchParams(fragment.slice(1));
  const id = params.get("library") ?? "";
  const view = params.get("view");
  const initialView: LibraryView =
    view === "access" || view === "import" || view === "failures" ? view : "docs";
  const [panel, setPanel] = useState<"directory" | "create" | "settings">("directory");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");
  const refresh = () => {
    refreshDirectory();
    void ctx?.refreshSnapshot();
  };
  const back = () => {
    if (id) ctx?.navigateConsole("/capabilities/knowledge");
    setPanel("directory");
    setFault("");
  };
  const selected = catalog?.collections.find((c) => c.id === id);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!ctx || busy || !name.trim()) return;
    setBusy(true);
    setFault("");
    try {
      const row = await ctx.postAdmin<{ id: string }>(base, { name: name.trim() });
      ctx.navigateConsole(libraryHref(row.id));
      setName("");
      setPanel("directory");
      refresh();
    } catch (e) {
      setFault(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspacePage className="kb-page" data-rag-page="true">
      {panel === "settings" ? (
        <>
          <KnowledgeSettings back={back} />
        </>
      ) : panel === "create" ? (
        <>
          <Back onClick={back}>知识库目录</Back>
          <WorkspaceHeader title="新建知识库" />
          <form className="kb-form" onSubmit={create}>
            <WorkspaceField as="label">
              <span>库名</span>
              <CompactInput
                ariaLabel="库名"
                autoFocus
                required
                maxLength={160}
                value={name}
                onInput={setName}
              />
            </WorkspaceField>
            <small>新库默认仅本人可见，可在库内设置受众与挂载。</small>
            <RippleButton variant="primary" type="submit" disabled={busy || !name.trim()}>
              创建知识库
            </RippleButton>
          </form>
        </>
      ) : id ? (
        <>
          {selected && catalog ? (
            <CollectionView
              initialView={initialView}
              key={fragment}
              collection={selected}
              profiles={catalog.profiles}
              back={back}
              refreshCatalog={refresh}
            />
          ) : (
            <>
              {catalog ? (
                <>
                  <p role="status">当前实例中找不到这个知识库。</p>
                  <Back onClick={back}>知识库目录</Back>
                </>
              ) : (
                <small>正在读取知识库…</small>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <WorkspaceHeader title="知识库">
            <RippleButton variant="secondary" onClick={() => setPanel("settings")}>
              <Settings2 size={14} />
              检索设置
            </RippleButton>
            <RippleButton variant="primary" disabled={!ctx?.ownerToken} onClick={() => setPanel("create")}>
              <Plus size={15} />
              新建知识库
            </RippleButton>
          </WorkspaceHeader>
          {!catalog && !error && <small role="status">正在读取目录…</small>}
          {catalog && (
            <KnowledgeDirectory
              libraries={catalog.collections}
              profiles={catalog.profiles}
              enter={(key, view) => ctx?.navigateConsole(libraryHref(key, view))}
            />
          )}
        </>
      )}
      <Feedback error={error || fault} />
      {error && (
        <RippleButton variant="ghost" size="sm" className="kb-back" onClick={refreshDirectory}>
          重新读取
        </RippleButton>
      )}
    </WorkspacePage>
  );
}

function CollectionView({
  initialView,
  collection: c,
  profiles,
  back,
  refreshCatalog
}: {
  initialView: LibraryView;
  collection: KnowledgeCollection;
  profiles: Catalog["profiles"];
  back: () => void;
  refreshCatalog: () => void;
}) {
  const ctx = useConsole()!;
  const path = base + "/" + encodeURIComponent(c.id);
  const { data: detail, error, refresh: refreshDetail } = useAdminResource<Detail>(path);
  const [tab, setTab] = useState<"docs" | "search" | "access">(initialView === "access" ? "access" : "docs");
  const [panel, setPanel] = useState<"list" | "import" | "original">(
    initialView === "import" ? "import" : "list"
  );
  const [focusedChunk, setFocusedChunk] = useState("");
  const [document, setDocument] = useState<KnowledgeDocument>();
  const [remove, setRemove] = useState<KnowledgeDocument>();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<KnowledgeSearch>();
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState(c.audience.startsWith("group:") ? "group" : c.audience);
  const [group, setGroup] = useState(c.audience.startsWith("group:") ? c.audience.slice(6) : "");
  const audienceValue = audience === "group" ? "group:" + group.trim() : audience;
  const validAudience = AudienceScopeSchema.safeParse(audienceValue).success;
  const [intakeKey, setIntakeKey] = useState(0);
  const [retryName, setRetryName] = useState("");
  const [failuresOnly, setFailuresOnly] = useState(initialView === "failures");
  const returnToList = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  function read(doc: KnowledgeDocument, chunk = "") {
    const active = window.document.activeElement;
    const positions: [Element, number][] = [];
    for (let el = listRef.current as Element | null; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight) positions.push([el, el.scrollTop]);
    }
    returnToList.current = () => {
      const button =
        active instanceof HTMLElement && listRef.current?.contains(active)
          ? active
          : listRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]');
      button?.focus({ preventScroll: true });
      for (const [el, top] of positions) el.scrollTop = top;
    };
    setDocument(doc);
    setFocusedChunk(chunk);
    setFailuresOnly(false);
    setTab("docs");
    setPanel("original");
  }
  useLayoutEffect(() => {
    if (panel !== "list" || tab !== "docs") return;
    returnToList.current?.();
    returnToList.current = null;
  }, [panel, tab]);
  function startImport(doc?: KnowledgeDocument, retry = "") {
    setDocument(doc);
    setRetryName(retry);
    setIntakeKey((n) => n + 1);
    setFault("");
    setPanel("import");
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setFault("");
    try {
      await fn();
    } catch (e) {
      setFault(errorText(e));
      refreshDetail();
      refreshCatalog();
    } finally {
      setBusy(false);
    }
  }
  const refresh = () => {
    refreshDetail();
    refreshCatalog();
  };
  const switchTab = (t: typeof tab) => {
    setFailuresOnly(false);
    setTab(t);
    setPanel("list");
    setFault("");
  };
  return (
    <>
      <div className="kb-crumb">
        <Back onClick={back}>知识库目录</Back>
        {panel === "import" && (
          <>
            <ChevronRight size={13} />
            <RippleButton variant="ghost" size="sm" onClick={() => switchTab("docs")}>
              {c.name}
            </RippleButton>
          </>
        )}
      </div>
      {panel === "import" ? (
        <WorkspaceHeader title={document ? "更新文档" : "导入文档"} />
      ) : (
        <>
          <WorkspaceHeader title={c.name}>
            {(tab !== "search" || panel !== "list") && (
              <RippleButton variant="secondary" disabled={busy} onClick={() => switchTab("search")}>
                <Search size={15} />
                试搜
              </RippleButton>
            )}
            <RippleButton variant="primary" disabled={busy} onClick={() => startImport()}>
              <Upload size={15} />
              导入文档
            </RippleButton>
          </WorkspaceHeader>
          <div className="kb-access-line">
            <span>
              <MessagesSquare size={16} />
              对话使用范围
            </span>
            <ConversationScope
              library={c}
              profiles={profiles}
              manage={() => switchTab("access")}
              showManage
            />
          </div>
        </>
      )}
      {panel === "list" && tab !== "docs" && <Back onClick={() => switchTab("docs")}>文档列表</Back>}
      {panel === "import" ? (
        <KnowledgeIntake
          key={intakeKey}
          collection={c.name}
          previous={document}
          retryName={retryName}
          documents={detail?.documents ?? []}
          scope={(indexed) => (
            <ConversationScope
              library={c}
              searchable={indexed.chunks > 0}
              profiles={profiles}
              manage={() => switchTab("access")}
            />
          )}
          submit={async (payload) => {
            setBusy(true);
            try {
              return await ctx.postAdmin<ImportReceipt>(path + "/import", {
                ...payload,
                documentId: document?.id,
                retryName: retryName || undefined
              });
            } finally {
              setBusy(false);
              refresh();
            }
          }}
          open={read}
          again={() => startImport()}
          search={() => {
            setQuery("");
            setResult(undefined);
            switchTab("search");
          }}
        />
      ) : tab === "docs" ? (
        <div className="kb-doc-layout" data-reading={panel === "original"}>
          <div className="kb-doc-list" ref={listRef}>
            <div className="kb-list-title">
              <h2>{failuresOnly ? "导入失败记录" : "文档"}</h2>
              {failuresOnly && (
                <RippleButton variant="ghost" size="sm" onClick={() => setFailuresOnly(false)}>
                  查看全部文档
                </RippleButton>
              )}
            </div>
            {detail?.failures
              .filter((f) => !f.documentId)
              .map((f) => (
                <div key={f.name} className="kb-failure">
                  <strong>{f.name}</strong>
                  <p>导入失败 · {f.reason}</p>
                  <RippleButton variant="ghost" size="sm" onClick={() => startImport(undefined, f.name)}>
                    重新导入
                  </RippleButton>
                </div>
              ))}
            {!detail && !error && <small role="status">正在读取文档…</small>}
            {detail && !detail.documents.length && !detail.failures.length && (
              <div className="kb-empty">
                <FileText size={28} />
                <h2>还没有文档</h2>
                <p>导入第一份资料后，就可以在这个库里试搜。</p>
              </div>
            )}
            {detail?.documents
              .filter((d) => !failuresOnly || detail.failures.some((f) => f.documentId === d.id))
              .map((d) => {
                const failed = detail.failures.find((f) => f.documentId === d.id);
                return (
                  <WorkspaceEntryCard
                    className="kb-document" action={{label:d.name + (d.chunks ? " 可搜索" : " 暂无索引"),
                      onSelect:()=>read(d),current:document?.id === d.id}}
                    key={d.id}
                    data-selected={panel === "original" && document?.id === d.id}
                  >
                    <span className="kb-doc-name">
                      <FileText size={16} />
                      <span className="kb-doc-description">
                        <strong>{d.name}</strong>
                        <WorkspaceStatus data-tone={d.chunks ? "good" : "neutral"}>
                          {d.chunks ? "可搜索" : "暂无索引"}
                        </WorkspaceStatus>
                        {failed && (
                          <small className="kb-error">
                            最近更新失败{d.chunks ? "，仍使用上一版" : ""} · {failed.reason}
                          </small>
                        )}
                      </span>
                    </span>
                    <CompactActionMenu
                      label={d.name + " 的操作"}
                      disabled={busy}
                      actions={[
                        { label: "更新文档", onSelect: () => startImport(d) },
                        {
                          label: "重建索引",
                          onSelect: () =>
                            void run(async () => {
                              await ctx.postAdmin(path + "/documents/" + d.id + "/rebuild");
                              ctx.showToast("索引已重建");
                              refresh();
                            })
                        },
                        { label: "移除", onSelect: () => setRemove(d) }
                      ]}
                    />
                  </WorkspaceEntryCard>
                );
              })}
          </div>
          {panel === "original" && document && (
            <KnowledgeReader
              key={
                document.id +
                ":" +
                (detail?.documents.find((d) => d.id === document.id)?.revision ?? document.revision)
              }
              doc={detail?.documents.find((d) => d.id === document.id) ?? document}
              path={path}
              focus={focusedChunk}
              back={() => setPanel("list")}
            />
          )}
        </div>
      ) : tab === "search" ? (
        <>
          <form
            className="kb-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim())
                void run(async () => {
                  setResult(undefined);
                  setResult(await ctx.postAdmin<KnowledgeSearch>(path + "/search", { query }));
                });
            }}
          >
            <CompactInput
              ariaLabel="试搜当前知识库"
              value={query}
              onInput={(v) => {
                setQuery(v);
                setResult(undefined);
              }}
              placeholder="输入关键词或问题"
              disabled={busy}
            />
            <RippleButton variant="primary" type="submit" disabled={busy || !query.trim()}>
              试搜
            </RippleButton>
          </form>
          {result && (
            <>
              {result.honestForgetTriggered && (
                <p role="status">
                  {result.results.length ? "命中低于阈值，本次不会进入对话。" : "没有找到相关资料。"}
                </p>
              )}
              {result.results.map((h) => (
                <article className="kb-hit" key={h.chunkId}>
                  <strong>
                    {h.title} · {h.location}
                  </strong>
                  <p>{h.excerpt}</p>
                  <RippleButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="kb-back"
                    onClick={() => {
                      const source = detail?.documents.find((d) => d.id === h.documentId);
                      if (!source) {
                        setFault("文档已移除，请重新检索");
                        return;
                      }
                      read(source, h.chunkId);
                    }}
                  >
                    查看原文 <ChevronRight size={13} />
                  </RippleButton>
                  <CompactDisclosure summary="检索得分">
                    <small>
                      综合 {h.score.toFixed(3)}
                      {h.bm25 !== null && " · BM25 " + h.bm25.toPrecision(3)}
                      {h.denseSim !== null && " · 余弦 " + h.denseSim.toFixed(3)}
                      {h.rerankScore !== null && " · 精排 " + h.rerankScore.toFixed(3)}
                    </small>
                  </CompactDisclosure>
                </article>
              ))}
              <CompactDisclosure summary="本次检索过程">
                <p>{result.stages.join(" → ")}</p>
                {result.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </CompactDisclosure>
            </>
          )}
        </>
      ) : (
        <div className="kb-form">
          <h2>资料受众</h2>
          <CompactSelect
            ariaLabel="资料受众"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "only_owner", label: "仅本人" },
              { value: "group", label: "指定群组" },
              { value: "public_all", label: "公开" }
            ]}
          />
          {audience === "group" && (
            <WorkspaceField as="label">
              <span>群组 ID</span>
              <CompactInput
                value={group}
                placeholder="例如 maintenance-team"
                ariaLabel="群组 ID"
                ariaDescribedBy="kb-group-hint"
                error={group && !validAudience ? "群组 ID 格式无效" : undefined}
                onInput={setGroup}
              />
              <small id="kb-group-hint">
                使用平台的群组 ID，可包含英文字母、数字、点、冒号、下划线和连字符。
              </small>
            </WorkspaceField>
          )}
          <RippleButton
            disabled={busy || !validAudience}
            onClick={() =>
              void run(async () => {
                await ctx.postAdmin(path + "/audience", {
                  audience: audienceValue
                });
                ctx.showToast("受众已保存");
                refresh();
              })
            }
          >
            保存受众
          </RippleButton>
          <h2>配置档挂载</h2>
          {profiles.map((p) => (
            <JellySwitch
              key={p.id}
              label={p.name}
              disabled={busy}
              checked={p.collections.includes(c.id)}
              onChange={(mounted) => {
                void run(async () => {
                  await ctx.postAdmin(path + "/mount", { profileId: p.id, mounted });
                  refresh();
                });
              }}
            />
          ))}
          <CompactDisclosure summary="从已引用片段提炼常识卡">
            {detail?.cited.map((s, i) => (
              <p key={i}>
                {s.title} · 引用 {s.count}
                <br />
                {s.excerpt}
              </p>
            ))}
            {!detail?.cited.length ? (
              <small>尚无已引用的资料。</small>
            ) : (
              <RippleButton
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const res = await ctx.postAdmin<{ gist_cards: unknown[] }>(
                      "memory/knowledge/unmount-gist",
                      { collection_id: c.id }
                    );
                    ctx.showToast("已提炼 " + res.gist_cards.length + " 张常识卡");
                  })
                }
              >
                确认提炼
              </RippleButton>
            )}
          </CompactDisclosure>
        </div>
      )}
      {remove && (
        <WorkspaceConfirm
          title="移除文档"
          description={"将移除「" + remove.name + "」及其检索索引。"}
          busy={busy}
          onCancel={() => setRemove(undefined)}
          onConfirm={() =>
            void run(async () => {
              await ctx.deleteAdmin(path + "/documents/" + remove.id);
              setRemove(undefined);
              if (document?.id === remove.id) setPanel("list");
              refresh();
            })
          }
        />
      )}
      {busy && <small role="status">正在处理…</small>}
      <Feedback error={fault || error || ""} />
    </>
  );
}
