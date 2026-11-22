import { useEffect, useState, type ReactElement } from "react";

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
  const [chunkSize, setChunkSize] = useState(studio?.ragSettings.chunkSize ?? 500);
  const [chunkOverlap, setChunkOverlap] = useState(studio?.ragSettings.chunkOverlap ?? 80);
  const [topK, setTopK] = useState(studio?.ragSettings.topK ?? 4);
  const [denseWeight, setDenseWeight] = useState(studio?.ragSettings.denseWeight ?? 0.65);
  const [bm25Weight, setBm25Weight] = useState(studio?.ragSettings.bm25Weight ?? 0.35);
  const [honestThreshold, setHonestThreshold] = useState(
    studio?.ragSettings.honestForgetThreshold ?? 0.38
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RagSearchHit[] | null>(null);
  const [gistOutput, setGistOutput] = useState("");

  useEffect(() => {
    if (!studio?.ragSettings) return;
    setChunkSize(studio.ragSettings.chunkSize);
    setChunkOverlap(studio.ragSettings.chunkOverlap);
    setTopK(studio.ragSettings.topK);
    setDenseWeight(studio.ragSettings.denseWeight);
    setBm25Weight(studio.ragSettings.bm25Weight);
    setHonestThreshold(studio.ragSettings.honestForgetThreshold);
  }, [studio?.ragSettings]);

  // Sleep Consolidation & Evolution Approval
  if (route?.id === "memory.retrieval-sleep") {
    const evo = studio?.evolution;

    const handleSleepRun = async () => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/sleep-run", {});
        await ctx.refreshSnapshot();
        ctx.showToast("睡眠巩固周期已执行完毕");
      } catch (err) {
        ctx.showToast(`执行失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleProposal = async (proposalId: string, decision: "approved" | "rejected") => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/growth-proposal", { proposalId, decision });
        await ctx.refreshSnapshot();
        ctx.showToast(decision === "approved" ? "演化提案已批准并合入存档" : "已驳回演化提案");
      } catch (err) {
        ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-sleep-evolution-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>睡眠与演化</h1>
            </div>
            <div className="ai0-page-header__actions">
              <RippleButton
                variant="primary"
                data-trigger-sleep-run="true"
                onClick={() => void handleSleepRun()}
              >
                {renderConsoleIcon("play", 14)}
                <span>执行睡眠巩固</span>
              </RippleButton>
            </div>
          </header>

          <div className="ai0-grid-2">
            <section className="ai0-card is-elevated">
              <h2>待审批演化提案 (Diff)</h2>
              {(evo?.growthProposals ?? []).map((prop) => (
                <article key={prop.id} className="ai0-card" data-proposal-card={prop.id}>
                  <div className="ai0-card__head">
                    <strong>{prop.title}</strong>
                    <span className="ai0-badge" data-tone={prop.status === "approved" ? "good" : prop.status === "rejected" ? "danger" : "accent"}>
                      {prop.status === "approved" ? "已合入" : prop.status === "rejected" ? "已驳回" : "待审批"}
                    </span>
                  </div>
                  <small>目标文件：<code>{prop.targetFile}</code> · {prop.sourceEventSummary} · {prop.createdAt}</small>
                  <div className="ai0-diff-grid">
                    <div className="ai0-diff-before">
                      <strong>变更前</strong>
                      <div>{prop.beforeText}</div>
                    </div>
                    <div className="ai0-diff-after">
                      <strong>变更后</strong>
                      <div>{prop.afterText}</div>
                    </div>
                  </div>
                  {prop.status === "pending" ? (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <RippleButton
                        variant="primary"
                        size="sm"
                        data-quick-approve={prop.id}
                        data-quick-kind="growth"
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
                        onClick={() => void handleProposal(prop.id, "rejected")}
                      >
                        驳回
                      </RippleButton>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>

            <div style={{ display: "grid", gap: "14px" }}>
              <section className="ai0-card is-elevated">
                <h2>睡眠反思与阅读笔记</h2>
                <div id="dream-journal-list" style={{ display: "grid", gap: "10px" }}>
                  {(evo?.dreamJournal ?? []).map((item) => (
                    <article
                      key={item.id}
                      style={{ padding: "11px 13px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: "var(--ai0-border-subtle)", display: "grid", gap: "4px" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>{item.title}</strong>
                        <small>{item.date}</small>
                      </div>
                      <p style={{ fontSize: "12.5px", color: "var(--ai0-on-surface-muted)" }}>{item.content}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="ai0-card">
                <h2>写入防火墙与只读订阅源</h2>
                <div style={{ display: "grid", gap: "10px" }}>
                  <JellySwitch
                    checked={evo?.sleepFirewall.level0Only ?? true}
                    label="Level-0 溯源约束（仅从原始事件提炼，禁止递归摘要）"
                  />
                  <JellySwitch
                    checked={evo?.sleepFirewall.blockPlayfulBanter ?? true}
                    label="语用过滤（拦截调侃与玩笑语境进入事实记忆库）"
                  />
                </div>
                <div style={{ display: "grid", gap: "6px", marginTop: "6px" }}>
                  <small style={{ fontWeight: 600 }}>授权只读信息源（自动附加外部不可信数据标记）：</small>
                  {(evo?.curiositySources ?? []).map((src) => (
                    <div
                      key={src.id}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", background: "var(--ai0-surface-main-card)", border: "var(--ai0-border-subtle)" }}
                    >
                      <span>{src.name}</span>
                      <span className="ai0-badge" data-tone="good">{src.type}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Built-in Hybrid RAG
  if (route?.id === "memory.knowledge-rag") {
    const packs = snap?.knowledgePacks ?? [];

    const handleSaveRagSettings = async () => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/config", {
          ragSettings: {
            chunkSize,
            chunkOverlap,
            topK,
            denseWeight,
            bm25Weight,
            honestForgetThreshold: honestThreshold
          }
        });
        await ctx.refreshSnapshot();
        ctx.showToast("混合检索与切片参数已保存");
      } catch (err) {
        ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleIngestDoc = async () => {
      if (!ctx) return;
      if (!docContent.trim()) {
        ctx.showToast("请输入待索引文档内容");
        return;
      }
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
      }
    };

    const handleSearchRag = async () => {
      if (!ctx) return;
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
        ctx.showToast("卸载前摘要提炼完成");
      } catch (err) {
        ctx.showToast(`提炼失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-rag-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>知识库 (RAG)</h1>
            </div>
            <div className="ai0-page-header__actions">
              <RippleButton
                variant="primary"
                data-save-rag-settings="true"
                onClick={() => void handleSaveRagSettings()}
              >
                {renderConsoleIcon("save", 14)}
                <span>保存检索参数</span>
              </RippleButton>
            </div>
          </header>

          <div className="ai0-grid-2">
            <section className="ai0-card is-elevated">
              <h2>文档切片入库</h2>
              <div className="ai0-grid-2">
                <div className="ai0-field">
                  <label>集合 ID</label>
                  <CompactInput id="rag-collection-id" type="text" value={collectionId} onInput={setCollectionId} />
                </div>
                <div className="ai0-field">
                  <label>来源标识 / 文件名</label>
                  <CompactInput id="rag-doc-title" type="text" value={docTitle} onInput={setDocTitle} />
                </div>
              </div>
              <div className="ai0-field">
                <label>文档正文（Markdown / 纯文本 / 代码）</label>
                <CompactInput
                  id="rag-doc-content"
                  multiline={true}
                  rows={5}
                  value={docContent}
                  onInput={setDocContent}
                  placeholder="粘贴待索引的参考文档、技术规范或学习笔记..."
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <RippleButton
                  variant="primary"
                  data-ingest-rag-doc="true"
                  onClick={() => void handleIngestDoc()}
                >
                  {renderConsoleIcon("upload", 14)}
                  <span>切片并索引</span>
                </RippleButton>
              </div>
            </section>

            <section className="ai0-card is-elevated">
              <h2>切片与混合检索权重</h2>
              <div className="ai0-grid-2">
                <div className="ai0-field">
                  <label>分块大小 (chunk_size)</label>
                  <CompactInput
                    id="rag-chunk-size"
                    type="number"
                    value={chunkSize}
                    unit="chars"
                    onInput={(v) => setChunkSize(Number(v) || 500)}
                  />
                </div>
                <div className="ai0-field">
                  <label>分块重叠 (chunk_overlap)</label>
                  <CompactInput
                    id="rag-chunk-overlap"
                    type="number"
                    value={chunkOverlap}
                    unit="chars"
                    onInput={(v) => setChunkOverlap(Number(v) || 80)}
                  />
                </div>
                <div className="ai0-field">
                  <label>召回数量 (Top-K)</label>
                  <CompactInput
                    id="rag-topk"
                    type="number"
                    value={topK}
                    onInput={(v) => setTopK(Number(v) || 4)}
                  />
                </div>
                <div className="ai0-field">
                  <label>低置信度诚实兜底阈值</label>
                  <CompactInput
                    id="rag-honest-threshold"
                    type="number"
                    step={0.05}
                    value={honestThreshold}
                    onInput={(v) => setHonestThreshold(Number(v) || 0.38)}
                  />
                </div>
                <TonalSlider
                  id="rag-dense-weight"
                  label="稠密向量权重"
                  min={0}
                  max={1}
                  step={0.05}
                  value={denseWeight}
                  onInput={setDenseWeight}
                />
                <TonalSlider
                  id="rag-bm25-weight"
                  label="FTS5 BM25 权重"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bm25Weight}
                  onInput={setBm25Weight}
                />
              </div>
            </section>
          </div>

          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>在线混合召回测试与已挂载集合</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div style={{ width: "300px" }}>
                  <CompactInput
                    id="rag-search-query"
                    type="text"
                    value={searchQuery}
                    onInput={setSearchQuery}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSearchRag();
                    }}
                    placeholder="输入检索查询词..."
                  />
                </div>
                <RippleButton
                  variant="primary"
                  data-search-rag="true"
                  onClick={() => void handleSearchRag()}
                >
                  {renderConsoleIcon("search", 14)}
                  <span>执行检索</span>
                </RippleButton>
              </div>
            </div>
            <div id="rag-search-results" style={{ display: "grid", gap: "8px" }}>
              {searchResults !== null ? (
                searchResults.length > 0 ? (
                  searchResults.map((r, idx) => (
                    <div key={`${r.source_uri}-${idx}`} className="ai0-card">
                      <strong>
                        得分 {r.score} (Dense {r.denseSim} / BM25 {r.bm25}) · {r.source_uri}
                      </strong>
                      <small>{r.content_text.slice(0, 180)}</small>
                    </div>
                  ))
                ) : (
                  <small>未命中有效切片，触发低置信度诚实兜底。</small>
                )
              ) : null}
            </div>
            <div className="ai0-grid-3" data-knowledge-unmount-host="true">
              {packs.map((pack) => (
                <article key={pack.id} className="ai0-card" data-pack-id={pack.id}>
                  <div className="ai0-card__head">
                    <strong>{pack.name}</strong>
                    <span className="ai0-badge" data-tone="good">{pack.documents} 切片 · 引用 {pack.citations}</span>
                  </div>
                  <small>{pack.sampleText.slice(0, 90)}</small>
                  <RippleButton
                    variant="secondary"
                    size="sm"
                    data-unmount-gist={pack.id}
                    onClick={() => void handleUnmountGist(pack.id)}
                  >
                    卸载前提炼摘要常识卡
                  </RippleButton>
                </article>
              ))}
            </div>
            <div id="gist-extract-output" style={{ fontSize: "12.5px", color: "var(--ai0-accent)", fontWeight: 560 }}>
              {gistOutput}
            </div>
          </section>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Memory Lineage & Hard Forget
  const nodes = snap?.lineageNodes ?? [];
  const milestones = snap?.milestones ?? [];

  const handleHardForget = async (memId: string) => {
    if (!ctx) return;
    try {
      await ctx.postAdmin("/api/admin/v1/memory/hard-forget", { target_memory_ids: [memId] });
      await ctx.refreshSnapshot();
      ctx.showToast("已完成五表级联擦除并写入墓碑账本");
    } catch (err) {
      ctx.showToast(`擦除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTopicSeal = async (memId: string) => {
    if (!ctx) return;
    try {
      await ctx.postAdmin("/api/admin/v1/memory/topic-seal", {
        topic_description: "主动屏蔽话题",
        target_memory_ids: [memId]
      });
      await ctx.refreshSnapshot();
      ctx.showToast("已创建负向话题屏蔽向量");
    } catch (err) {
      ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReleaseKnot = async () => {
    if (!ctx) return;
    try {
      await ctx.postAdmin("/api/admin/v1/memory/relationship/release-knot", {});
      await ctx.refreshSnapshot();
      ctx.showToast("已重置当前未解张力状态");
    } catch (err) {
      ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="memory" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-lineage-surgery-host="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>记忆与擦除</h1>
          </div>
          <div className="ai0-page-header__actions">
            <span className="ai0-badge" data-tone="good" data-tombstone-count="true">
              {renderConsoleIcon("shield", 12)}
              <span>防复活墓碑：{snap?.redactionLedgerCount ?? 0}</span>
            </span>
            <RippleButton
              variant="secondary"
              data-release-knot="true"
              onClick={() => void handleReleaseKnot()}
            >
              重置未解张力
            </RippleButton>
          </div>
        </header>

        <section className="ai0-grid-2">
          {nodes.map((node) => (
            <article key={node.id} className="ai0-card is-elevated" data-memory-card-id={node.id}>
              <div className="ai0-card__head">
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span className="ai0-badge" data-tone={node.visibilityScope === "only_owner" ? "accent" : "good"}>
                    {node.visibilityScope === "only_owner" ? "仅主账户可见" : "公开可见"}
                  </span>
                  <span className="ai0-badge" data-tone="info">{node.memoryTier}</span>
                  {node.sealed ? <span className="ai0-badge" data-tone="warn">已封印话题</span> : null}
                </div>
                <small style={{ fontFamily: "var(--ai0-font-mono)" }}>{node.id}</small>
              </div>
              <p style={{ fontSize: "13px", lineHeight: 1.55 }}>{node.contentText}</p>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "8px", borderTop: "var(--ai0-border-subtle)" }}>
                <small>
                  血缘溯源：{node.parentIds.length ? node.parentIds.join(" → ") : "原始事件"}
                </small>
                <div style={{ display: "flex", gap: "6px" }}>
                  <RippleButton
                    variant="danger"
                    size="sm"
                    data-hard-forget-id={node.id}
                    onClick={() => void handleHardForget(node.id)}
                  >
                    {renderConsoleIcon("trash", 12)}
                    <span>彻底遗忘</span>
                  </RippleButton>
                  <RippleButton
                    variant="secondary"
                    size="sm"
                    data-topic-seal-id={node.id}
                    onClick={() => void handleTopicSeal(node.id)}
                  >
                    {renderConsoleIcon("eye-off", 12)}
                    <span>话题封印</span>
                  </RippleButton>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="ai0-card">
          <div className="ai0-card__head">
            <h2>里程碑与纪念记录</h2>
            <span className="ai0-badge" data-tone="good">正向记录 · 无缺勤惩罚机制</span>
          </div>
          <div className="ai0-grid-3">
            {milestones.map((m) => (
              <article key={m.id} className="ai0-card is-elevated">
                <div className="ai0-card__head">
                  <strong>{m.title}</strong>
                  <small>{m.moment}</small>
                </div>
                <small>{m.note}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </MainRoundedCardOutlet>
  );
}
