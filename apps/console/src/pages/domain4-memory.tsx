import {
  WorkspaceDiff, WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow,
  WorkspaceSection, WorkspaceStatus
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  TonalSlider,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { MemoryRecordWorkspace, RelationshipWorkspace } from "./memory-record-workspace.js";
import { useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceSaveButton } from "./workspace.js";

export interface Domain4MemoryPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

interface RagSearchHit {
  score: number;
  denseSim: number;
  bm25: number;
  source_uri: string;
  content_text: string;
}

export function Domain4MemoryPage(props: Domain4MemoryPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  // RAG state
  const [collectionId, setCollectionId] = useState("kb_project_architecture");
  const [docTitle, setDocTitle] = useState("architecture_notes.md");
  const [docContent, setDocContent] = useState("");
  const rag = useWorkspaceDraft(studio?.ragSettings ?? {
    chunkSize: 500, chunkOverlap: 80, topK: 4, denseWeight: 0.65, bm25Weight: 0.35, honestForgetThreshold: 0.38
  });
  const { chunkSize, chunkOverlap, topK, denseWeight, bm25Weight, honestForgetThreshold: honestThreshold } = rag.value;
  const setRag = (key: keyof typeof rag.value, value: number) => rag.setValue((previous) => ({ ...previous, [key]: value }));
  const form = useWorkspaceSave(route?.id === "memory.knowledge-rag" ? route.id : undefined, rag.dirty, rag.discard,
    async () => {
      if (chunkOverlap >= chunkSize) throw new Error("切片重叠长度必须小于切片大小。");
      await ctx?.postStudio("config", { ragSettings: rag.value });
    }, "混合检索与切片参数已保存", rag.accept);
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");
  const [pending, setPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RagSearchHit[] | null>(null);
  const [gistOutput, setGistOutput] = useState("");

  // Sleep Consolidation & Evolution Approval
  if (route?.id === "memory.retrieval-sleep") {
    const evo = studio?.evolution;

    const handleSleepRun = async () => {
      if (!ctx || !canWrite || pending) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/sleep-run", {});
        await ctx.refreshSnapshot();
        ctx.showToast("睡眠巩固周期已执行完毕");
      } catch (err) {
        ctx.showToast(`执行失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    const handleProposal = async (proposalId: string, decision: "approved" | "rejected") => {
      if (!ctx || !canWrite || pending) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/growth-proposal", { proposalId, decision });
        await ctx.refreshSnapshot();
        ctx.showToast(decision === "approved" ? "演化提案已批准并合入存档" : "已驳回演化提案");
      } catch (err) {
        ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-sleep-evolution-page="true">
          <WorkspaceHeader title="睡眠与演化">

            <RippleButton
              variant="primary"
              data-trigger-sleep-run="true"
              disabled={!canWrite || pending}
              onClick={() => void handleSleepRun()}
            >
              {renderConsoleIcon("play", 14)}
              <span>执行睡眠巩固</span>
            </RippleButton>

          </WorkspaceHeader>

          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>待审批演化提案 (Diff)</h2>
              {(evo?.growthProposals ?? []).map((prop) => (
                <WorkspaceItem key={prop.id} as="article" data-proposal-card={prop.id}>
                  <WorkspaceRow>
                    <strong>{prop.title}</strong>
                    <WorkspaceStatus data-tone={prop.status === "approved" ? "good" : prop.status === "rejected" ? "danger" : "accent"}>
                      {prop.status === "approved" ? "已合入" : prop.status === "rejected" ? "已驳回" : "待审批"}
                    </WorkspaceStatus>
                  </WorkspaceRow>
                  <small>目标文件：<code>{prop.targetFile}</code> · {prop.sourceEventSummary} · {prop.createdAt}</small>
                  <WorkspaceGrid columns={2}>
                    <WorkspaceDiff side="before">
                      <strong>变更前</strong>
                      <div>{prop.beforeText}</div>
                    </WorkspaceDiff>
                    <WorkspaceDiff side="after">
                      <strong>变更后</strong>
                      <div>{prop.afterText}</div>
                    </WorkspaceDiff>
                  </WorkspaceGrid>
                  {prop.status === "pending" ? (
                    <div className="ai0-workspace-actions">
                      <RippleButton
                        variant="primary"
                        size="sm"
                        data-quick-approve={prop.id}
                        data-quick-kind="growth"
                        disabled={!canWrite || pending}
                        onClick={() => void handleProposal(prop.id, "approved")}
                      >
                        {renderConsoleIcon("check", 13)}
                        <span>批准合入 {prop.targetFile}</span>
                      </RippleButton>
                      <RippleButton
                        variant="secondary"
                        size="sm"
                        data-quick-reject={prop.id}
                        data-quick-kind="growth"
                        disabled={!canWrite || pending}
                        onClick={() => void handleProposal(prop.id, "rejected")}
                      >
                        驳回
                      </RippleButton>
                    </div>
                  ) : null}
                </WorkspaceItem>
              ))}
            </WorkspaceSection>

            <div className="ai0-workspace-stack">
              <WorkspaceSection>
                <h2>睡眠反思与阅读笔记</h2>
                <div id="dream-journal-list" className="ai0-workspace-stack">
                  {(evo?.dreamJournal ?? []).map((item) => (
                    <WorkspaceItem
                      key={item.id}
                      as="article"
                    >
                      <div className="ai0-workspace-row">
                        <strong>{item.title}</strong>
                        <small>{item.date}</small>
                      </div>
                      <p className="ai0-workspace-muted">{item.content}</p>
                    </WorkspaceItem>
                  ))}
                </div>
              </WorkspaceSection>

              <WorkspaceSection>
                <h2>写入防火墙与只读订阅源</h2>
                <div className="ai0-workspace-stack">
                  <JellySwitch
                    checked={evo?.sleepFirewall.level0Only ?? true}
                    label="Level-0 溯源约束（仅从原始事件提炼，禁止递归摘要）"
                  />
                  <JellySwitch
                    checked={evo?.sleepFirewall.blockPlayfulBanter ?? true}
                    label="语用过滤（拦截调侃与玩笑语境进入事实记忆库）"
                  />
                </div>
                <div className="ai0-workspace-stack">
                  <strong>授权只读信息源</strong>
                  {(evo?.curiositySources ?? []).map((src) => (
                    <WorkspaceRow key={src.id} className="ai0-workspace-divided">
                      <span>{src.name}</span>
                      <WorkspaceStatus data-tone="good">{src.type}</WorkspaceStatus>
                    </WorkspaceRow>
                  ))}
                </div>
              </WorkspaceSection>
            </div>
          </WorkspaceGrid>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  // Built-in Hybrid RAG
  if (route?.id === "memory.knowledge-rag") {
    const packs = snap?.knowledgePacks ?? [];

    const handleIngestDoc = async () => {
      if (!ctx || !canWrite || pending) return;
      if (!docContent.trim()) {
        ctx.showToast("请输入待索引文档内容");
        return;
      }
      setPending(true);
      try {
        const res = await ctx.postStudio<{ chunksCreated: number }>("/api/studio/rag-ingest", {
          collectionId: collectionId.trim() || "kb_project_architecture",
          title: docTitle.trim() || "notes.md",
          content: docContent
        });
        setDocContent("");
        await ctx.refreshSnapshot();
        ctx.showToast(`已完成索引，生成 ${res.chunksCreated} 个切片`);
      } catch (err) {
        ctx.showToast(`入库失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    const handleSearchRag = async () => {
      if (!ctx || !canWrite) return;
      try {
        const res = await ctx.postStudio<{ results: RagSearchHit[] }>("/api/studio/rag-search", {
          query: searchQuery
        });
        setSearchResults(res.results);
      } catch (err) {
        ctx.showToast(`检索失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleUnmountGist = async (packId: string) => {
      if (!ctx) return;
      try {
        const res = await ctx.postAdmin<{ gist_cards?: unknown[] }>(
          "/api/admin/v1/memory/knowledge/unmount-gist",
          { collection_id: packId }
        );
        const count = res.gist_cards?.length ?? 0;
        setGistOutput(`已为 ${packId} 提炼 ${count} 张摘要常识卡并写入长期记忆索引。`);
        ctx.showToast("摘要提炼完成");
      } catch (err) {
        ctx.showToast(`提炼失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-rag-page="true">
          <WorkspaceHeader title="知识库 (RAG)">

            <WorkspaceSaveButton form={form} />

          </WorkspaceHeader>

          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>文档切片入库</h2>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>集合 ID</label>
                  <CompactInput id="rag-collection-id" type="text" value={collectionId} onInput={setCollectionId} />
                </WorkspaceField>
                <WorkspaceField>
                  <label>来源标识 / 文件名</label>
                  <CompactInput id="rag-doc-title" type="text" value={docTitle} onInput={setDocTitle} />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceField>
                <label>文档正文（Markdown / 纯文本 / 代码）</label>
                <CompactInput
                  id="rag-doc-content"
                  multiline={true}
                  rows={5}
                  value={docContent}
                  onInput={setDocContent}
                  placeholder="粘贴待索引的参考文档、技术规范或学习笔记..."
                />
              </WorkspaceField>
              <div className="ai0-workspace-actions">
                <RippleButton
                  variant="primary"
                  data-ingest-rag-doc="true"
                  disabled={!canWrite || !docContent.trim()}
                  loading={pending}
                  onClick={() => void handleIngestDoc()}
                >
                  {renderConsoleIcon("upload", 14)}
                  <span>切片并索引</span>
                </RippleButton>
              </div>
            </WorkspaceSection>

            <WorkspaceSection>
              <h2>切片与混合检索权重</h2>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>分块大小 (chunk_size)</label>
                  <CompactInput
                    id="rag-chunk-size"
                    type="number"
                    value={chunkSize}
                    unit="chars"
                    onInput={(v) => setRag("chunkSize", Number(v) || 500)}
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>分块重叠 (chunk_overlap)</label>
                  <CompactInput
                    id="rag-chunk-overlap"
                    type="number"
                    value={chunkOverlap}
                    unit="chars"
                    onInput={(v) => setRag("chunkOverlap", Number(v) || 80)}
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>召回数量 (Top-K)</label>
                  <CompactInput
                    id="rag-topk"
                    type="number"
                    value={topK}
                    onInput={(v) => setRag("topK", Number(v) || 4)}
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>低置信度诚实兜底阈值</label>
                  <CompactInput
                    id="rag-honest-threshold"
                    type="number"
                    step={0.05}
                    value={honestThreshold}
                    onInput={(v) => setRag("honestForgetThreshold", Number(v) || 0.38)}
                  />
                </WorkspaceField>
                <TonalSlider
                  id="rag-dense-weight"
                  label="稠密向量权重"
                  min={0}
                  max={1}
                  step={0.05}
                  value={denseWeight}
                  onInput={(value) => setRag("denseWeight", value)}
                />
                <TonalSlider
                  id="rag-bm25-weight"
                  label="FTS5 BM25 权重"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bm25Weight}
                  onInput={(value) => setRag("bm25Weight", value)}
                />
              </WorkspaceGrid>
            </WorkspaceSection>
          </WorkspaceGrid>

          <WorkspaceSection>
            <WorkspaceRow>
              <h2>在线混合召回测试与已挂载集合</h2>
              <div className="ai0-workspace-actions">
                <div className="ai0-workspace-flex-field">
                  <CompactInput
                    id="rag-search-query"
                    type="text"
                    ariaLabel="知识库检索查询"
                    value={searchQuery}
                    onInput={setSearchQuery}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleSearchRag();
                    }}
                    placeholder="输入检索查询词..."
                  />
                </div>
                <RippleButton
                  variant="primary"
                  data-search-rag="true"
                  disabled={!canWrite || !searchQuery.trim()}
                  onClick={() => void handleSearchRag()}
                >
                  {renderConsoleIcon("search", 14)}
                  <span>执行检索</span>
                </RippleButton>
              </div>
            </WorkspaceRow>
            <div id="rag-search-results" className="ai0-workspace-stack">
              {searchResults !== null ? (
                searchResults.length > 0 ? (
                  searchResults.map((r, idx) => (
                    <WorkspaceItem key={`${r.source_uri}-${idx}`}>
                      <strong>
                        得分 {r.score} (Dense {r.denseSim} / BM25 {r.bm25}) · {r.source_uri}
                      </strong>
                      <small>{r.content_text.slice(0, 180)}</small>
                    </WorkspaceItem>
                  ))
                ) : (
                  <small>未命中有效切片，触发低置信度诚实兜底。</small>
                )
              ) : null}
            </div>
            <WorkspaceGrid columns={3} data-knowledge-unmount-host="true">
              {packs.map((pack) => (
                <WorkspaceItem key={pack.id} as="article" data-pack-id={pack.id}>
                  <WorkspaceRow>
                    <strong>{pack.name}</strong>
                    <WorkspaceStatus data-tone="good">{pack.documents} 切片 · 引用 {pack.citations}</WorkspaceStatus>
                  </WorkspaceRow>
                  <small>{pack.sampleText.slice(0, 90)}</small>
                  <RippleButton
                    variant="secondary"
                    size="sm"
                    data-unmount-gist={pack.id}
                    onClick={() => void handleUnmountGist(pack.id)}
                  >
                    提炼摘要常识卡
                  </RippleButton>
                </WorkspaceItem>
              ))}
            </WorkspaceGrid>
            <div id="gist-extract-output" className="ai0-workspace-accent" role="status">
              {gistOutput}
            </div>
          </WorkspaceSection>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  return (
    <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
      {route?.id === "memory.relationship" ? <RelationshipWorkspace key={ctx?.targetInstance} snapshot={snap} /> : (
        <MemoryRecordWorkspace key={`${ctx?.targetInstance}:${route?.id}`} eventsOnly={route?.id === "memory.events-media"} />
      )}
    </MainRoundedCardOutlet>
  );
}
