import { useEffect, useState, type MouseEvent, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  TonalSlider,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, PromptBrickView } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";

export interface Domain1DashboardPageProps {
  pathname: "/dashboard" | "/dashboard/blackboard" | "/conversations" | string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
  dirtyDiffCount?: number;
  onDiscardChanges?: () => void;
  onApplyChanges?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  romantic_partner: "亲密伴侣",
  best_friend: "日常挚友",
  digital_employee: "专业助理",
  study_classmate: "学习同伴",
  vtuber_partner: "互动搭档"
};

export function Domain1DashboardPage(props: Domain1DashboardPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  const [bricks, setBricks] = useState<PromptBrickView[]>(studio?.soulStudio.promptBricks ?? []);
  const [maxBudget, setMaxBudget] = useState<number>(
    studio?.soulStudio.maxBlackboardTokens ?? snap?.maxBlackboardTokens ?? 2200
  );
  const [previewScope, setPreviewScope] = useState<"private" | "public">("private");
  const [privatePreviewText, setPrivatePreviewText] = useState<string | null>(null);
  const [publicPreviewText, setPublicPreviewText] = useState<string | null>(null);
  const [privateTokens, setPrivateTokens] = useState<number | null>(null);
  const [publicTokens, setPublicTokens] = useState<number | null>(null);

  useEffect(() => {
    if (studio?.soulStudio.promptBricks) {
      setBricks(studio.soulStudio.promptBricks);
    }
    if (studio?.soulStudio.maxBlackboardTokens !== undefined) {
      setMaxBudget(studio.soulStudio.maxBlackboardTokens);
    }
  }, [studio?.soulStudio.promptBricks, studio?.soulStudio.maxBlackboardTokens]);

  const navClick = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (props.onNavigate || ctx) {
      event.preventDefault();
      if (props.onNavigate) props.onNavigate(path);
      else ctx?.navigateConsole(path);
    }
  };

  if (route?.id === "dashboard.blackboard") {
    const privatePreview = snap?.promptPreviewPrivate;
    const publicPreview = snap?.promptPreviewPublic;
    const usedTokens = privateTokens ?? privatePreview?.totalTokens ?? snap?.totalBlackboardTokens ?? 1420;
    const shownPublicTokens = publicTokens ?? publicPreview?.totalTokens ?? 980;

    const updateBrick = (id: string, patch: Partial<PromptBrickView>) => {
      setBricks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    };

    const handleSaveBricks = async () => {
      if (!ctx || !studio) return;
      try {
        const saved = await ctx.postStudio<{
          snapshot?: ConsoleLiveSnapshot;
        }>("/api/studio/config", {
          soulStudio: { maxBlackboardTokens: maxBudget, promptBricks: bricks }
        });
        if (saved.snapshot?.promptPreviewPrivate) {
          setPrivatePreviewText(saved.snapshot.promptPreviewPrivate.promptText);
          setPrivateTokens(saved.snapshot.promptPreviewPrivate.totalTokens);
        }
        if (saved.snapshot?.promptPreviewPublic) {
          setPublicPreviewText(saved.snapshot.promptPreviewPublic.promptText);
          setPublicTokens(saved.snapshot.promptPreviewPublic.totalTokens);
        }
        await ctx.refreshSnapshot();
        ctx.showToast("上下文黑板配置已保存并生效");
      } catch (err) {
        ctx.showToast(`编译保存失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleCompilePreview = async () => {
      if (!ctx || !studio) return;
      try {
        const preview = await ctx.postStudio<{
          privatePreview: { promptText: string; totalTokens: number };
          publicPreview: { promptText: string; totalTokens: number };
        }>("/api/studio/prompt-preview", {
          config: {
            ...studio,
            soulStudio: {
              ...studio.soulStudio,
              maxBlackboardTokens: maxBudget,
              promptBricks: bricks
            }
          }
        });
        setPrivatePreviewText(preview.privatePreview.promptText);
        setPrivateTokens(preview.privatePreview.totalTokens);
        setPublicPreviewText(preview.publicPreview.promptText);
        setPublicTokens(preview.publicPreview.totalTokens);
        ctx.showToast("已完成私密与公开双视角编译预览");
      } catch (err) {
        ctx.showToast(`编译预览失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-prompt-bricks-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>上下文黑板</h1>
            </div>
            <div className="ai0-page-header__actions">
              <span className="ai0-badge" data-tone={usedTokens > maxBudget ? "warn" : "good"} id="brick-budget-badge">
                {usedTokens} / {maxBudget} Tokens
              </span>
              {[1600, 2200, 3400].map((preset) => (
                <RippleButton
                  key={preset}
                  variant="secondary"
                  size="sm"
                  data-budget-preset={String(preset)}
                  onClick={() => {
                    setMaxBudget(preset);
                    ctx?.showToast(`已应用预算预设：${preset} Tokens`);
                  }}
                >
                  {preset}
                </RippleButton>
              ))}
              <RippleButton
                variant="primary"
                data-save-prompt-bricks="true"
                onClick={() => void handleSaveBricks()}
              >
                {renderConsoleIcon("save", 14)}
                <span>保存配置</span>
              </RippleButton>
            </div>
          </header>

          <div className="ai0-split">
            <div style={{ display: "grid", gap: "12px" }}>
              <div className="ai0-card">
                <TonalSlider
                  id="brick-max-tokens-slider"
                  label="总上下文预算上限"
                  min={1000}
                  max={5000}
                  step={100}
                  value={maxBudget}
                  unit=" Tokens"
                  onInput={setMaxBudget}
                />
              </div>

              {bricks.map((brick) => (
                <article key={brick.id} className="ai0-card is-elevated" data-prompt-brick-id={brick.id}>
                  <div className="ai0-card__head">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <JellySwitch
                        checked={brick.enabled}
                        disabled={Boolean(brick.locked)}
                        data-brick-enabled={brick.id}
                        ariaLabel={`启用 ${brick.title}`}
                        onChange={(enabled) => updateBrick(brick.id, { enabled })}
                      />
                      <strong>{brick.title}</strong>
                      {brick.locked ? (
                        <span className="ai0-badge" data-tone="warn">
                          {renderConsoleIcon("lock", 11)}
                          <span>锁定</span>
                        </span>
                      ) : null}
                      {brick.audienceMode === "private_only" ? (
                        <span className="ai0-badge" data-tone="accent">
                          {renderConsoleIcon("lock", 11)}
                          <span>仅私密</span>
                        </span>
                      ) : null}
                      {brick.audienceMode === "masked_in_public" ? (
                        <span className="ai0-badge" data-tone="info">
                          {renderConsoleIcon("globe", 11)}
                          <span>公开 70% 面具</span>
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <CompactInput
                        type="number"
                        min={60}
                        max={1600}
                        step={20}
                        value={brick.maxTokens}
                        unit="tok"
                        data-brick-max-tokens={brick.id}
                        style={{ width: "104px", height: "28px" }}
                        onInput={(val) =>
                          updateBrick(brick.id, { maxTokens: Math.max(60, Number(val) || brick.maxTokens) })
                        }
                      />
                    </div>
                  </div>
                  <div className="ai0-field">
                    <label>
                      <span>模板原文</span>
                      <span style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11px" }}>{brick.id}</span>
                    </label>
                    <CompactInput
                      multiline={true}
                      rows={3}
                      value={brick.template}
                      disabled={Boolean(brick.locked)}
                      data-brick-template={brick.id}
                      style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "12px" }}
                      onInput={(template) => updateBrick(brick.id, { template })}
                    />
                  </div>
                </article>
              ))}
            </div>

            <div style={{ display: "grid", gap: "14px", position: "sticky", top: "14px" }}>
              <section className="ai0-card is-elevated">
                <div className="ai0-card__head">
                  <h3>编译预览</h3>
                  <RippleButton
                    variant="secondary"
                    size="sm"
                    data-refresh-prompt-preview="true"
                    onClick={() => void handleCompilePreview()}
                  >
                    {renderConsoleIcon("refresh", 13)}
                    <span>重新编译</span>
                  </RippleButton>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <RippleButton
                    variant={previewScope === "private" ? "primary" : "secondary"}
                    size="sm"
                    data-preview-scope="private"
                    onClick={() => setPreviewScope("private")}
                  >
                    {renderConsoleIcon("lock", 13)}
                    <span>私密 1v1 ({usedTokens} tok)</span>
                  </RippleButton>
                  <RippleButton
                    variant={previewScope === "public" ? "primary" : "secondary"}
                    size="sm"
                    data-preview-scope="public"
                    onClick={() => setPreviewScope("public")}
                  >
                    {renderConsoleIcon("globe", 13)}
                    <span>公开 70% 面具 ({shownPublicTokens} tok)</span>
                  </RippleButton>
                </div>
                <pre
                  id="prompt-preview-private-box"
                  className="ai0-code-box"
                  hidden={previewScope !== "private"}
                  style={{ maxHeight: "560px", overflowY: "auto" }}
                >
                  {privatePreviewText ??
                    privatePreview?.promptText ??
                    snap?.compiledBlackboardPrompt ??
                    "等待编译上下文黑板..."}
                </pre>
                <pre
                  id="prompt-preview-public-box"
                  className="ai0-code-box"
                  hidden={previewScope !== "public"}
                  style={{ maxHeight: "560px", overflowY: "auto" }}
                >
                  {publicPreviewText ??
                    publicPreview?.promptText ??
                    "公开受众视图：已剥离全部 only_owner 段落并启用 70% 社交面具阻尼。"}
                </pre>
              </section>
            </div>
          </div>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  if (route?.id === "dashboard.conversations") {
    const conversations = snap?.conversations ?? [];
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

    return (
      <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>会话记录</h1>
            </div>
            <div className="ai0-page-header__actions">
              <a
                href="/profiles/rules"
                onClick={navClick("/profiles/rules")}
                className="ai0-ripple-btn"
                data-variant="secondary"
              >
                <span className="ai0-ripple-btn__content">
                  {renderConsoleIcon("rules", 14)}
                  <span>受众策略</span>
                </span>
              </a>
              <RippleButton
                variant="primary"
                data-trigger-sleep-run="true"
                onClick={() => void handleSleepRun()}
              >
                {renderConsoleIcon("evolution", 14)}
                <span>执行记忆整理</span>
              </RippleButton>
            </div>
          </header>

          <section className="ai0-card is-elevated">
            <table className="ai0-table">
              <thead>
                <tr>
                  <th>会话名称与 UMO</th>
                  <th>适配器</th>
                  <th>受众范围与隐私策略</th>
                  <th>绑定 Profile</th>
                  <th>消息数</th>
                  <th>最近摘要</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conv) => (
                  <tr key={conv.umo}>
                    <td>
                      <strong>{conv.label}</strong>
                      <div style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px", color: "var(--ai0-on-surface-muted)" }}>
                        {conv.umo}
                      </div>
                    </td>
                    <td><span className="ai0-badge">{conv.platform}</span></td>
                    <td>
                      <span
                        className="ai0-badge"
                        data-tone={conv.audienceScope === "only_owner" ? "accent" : conv.audienceScope === "public_all" ? "warn" : "info"}
                      >
                        {conv.audienceScope === "only_owner"
                          ? "仅主账户私密"
                          : conv.audienceScope === "public_all"
                            ? "公开 · 70% 社交面具"
                            : "认证群组"}
                      </span>
                    </td>
                    <td>{conv.profileName}</td>
                    <td><strong>{conv.messageCount}</strong></td>
                    <td style={{ maxWidth: "260px", color: "var(--ai0-on-surface-muted)" }}>{conv.lastSummary}</td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <a
                          href="/shells/stage/builtin.webchat"
                          onClick={navClick("/shells/stage/builtin.webchat")}
                          className="ai0-ripple-btn"
                          data-size="sm"
                        >
                          <span className="ai0-ripple-btn__content">打开舞台</span>
                        </a>
                        <a
                          href="/profiles/rules"
                          onClick={navClick("/profiles/rules")}
                          className="ai0-ripple-btn"
                          data-size="sm"
                        >
                          <span className="ai0-ripple-btn__content">规则</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Default: System Overview
  const primaryRoleLabel = ROLE_LABELS[studio?.soulStudio.primaryRole ?? "best_friend"] ?? "日常挚友";
  const workRoleLabel = ROLE_LABELS[studio?.soulStudio.workVenueRole ?? "digital_employee"] ?? "专业助理";
  const connectedPlatforms = (studio?.platforms ?? []).filter((p) => p.connected).length;
  const totalPlatforms = (studio?.platforms ?? []).length || 5;
  const pendingGrowth = (studio?.evolution.growthProposals ?? []).filter((p) => p.status === "pending");
  const activeTasks = (studio?.agency.activeTasks ?? []).filter((t) => t.status !== "completed");
  const usedTokensToday = studio?.metabolicPolicy.usedTokensToday ?? 27400;
  const dailyBudget = studio?.metabolicPolicy.dailyTokenBudget ?? 300000;
  const remainPct = Math.max(0, Math.round(((dailyBudget - usedTokensToday) / dailyBudget) * 100));

  const quickApprove = async (id: string, kind: "growth" | "task") => {
    if (!ctx) return;
    try {
      if (kind === "task") {
        await ctx.postStudio("/api/studio/co-work-task", { action: "approve", taskId: id });
        ctx.showToast("任务已完成并沉淀为情景记忆");
      } else {
        await ctx.postStudio("/api/studio/growth-proposal", { proposalId: id, decision: "approved" });
        ctx.showToast("演化提案已批准并合入存档");
      }
      await ctx.refreshSnapshot();
    } catch (err) {
      ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page">
        <section
          className="ai0-card is-elevated"
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            padding: "18px 20px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "var(--ai0-accent-tint)",
                color: "var(--ai0-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "18px",
                flexShrink: 0
              }}
            >
              {(snap?.personaName ?? "K").slice(0, 1).toUpperCase()}
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h1>{snap?.personaName ?? "Mio"}</h1>
                <span className="ai0-badge" data-tone="live">运行中</span>
                <span className="ai0-badge" data-tone="accent">{primaryRoleLabel}</span>
                {studio?.soulStudio.autoSwitchByVenue ? (
                  <span className="ai0-badge" data-tone="info">工作场景：{workRoleLabel}</span>
                ) : null}
              </div>
              <small>
                本地存档 <code>{snap?.soulId ?? "default.soul"}</code> · SQLite WAL 模式 · 后台无头守护进程独立运行
              </small>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <RippleButton
              variant="secondary"
              data-open-onboarding="true"
              onClick={() => ctx?.setOnboardingOpen(true)}
            >
              {renderConsoleIcon("wizard", 14)}
              <span>初始化向导</span>
            </RippleButton>
            <a
              href="/soul/distiller"
              onClick={navClick("/soul/distiller")}
              className="ai0-ripple-btn"
              data-variant="secondary"
            >
              <span className="ai0-ripple-btn__content">
                {renderConsoleIcon("upload", 14)}
                <span>导入角色卡</span>
              </span>
            </a>
            <a
              href="/shells/stage/builtin.webchat"
              onClick={navClick("/shells/stage/builtin.webchat")}
              className="ai0-ripple-btn is-primary"
              data-variant="primary"
            >
              <span className="ai0-ripple-btn__content">
                {renderConsoleIcon("chat", 14)}
                <span>打开 WebChat</span>
              </span>
            </a>
          </div>
        </section>

        <section className="ai0-grid-4">
          <div className="ai0-stat-tile">
            <span className="ai0-stat-tile__label">
              {renderConsoleIcon("circadian", 14)}
              <span>心境与 24h 节律</span>
            </span>
            <div className="ai0-stat-tile__value" style={{ color: "var(--ai0-accent)" }}>
              +{snap ? snap.moodValence.toFixed(2) : "0.52"} · {snap ? Math.round(snap.circadianEnergy * 100) : 86}%
            </div>
            <small>二阶情绪稳态正常 · 距下个节律锚点 3h 15m</small>
          </div>
          <div className="ai0-stat-tile">
            <span className="ai0-stat-tile__label">
              {renderConsoleIcon("cpu", 14)}
              <span>今日算力预算</span>
            </span>
            <div className="ai0-stat-tile__value" style={{ color: "var(--ai0-success)" }}>
              {remainPct}%
            </div>
            <small>已消耗 {(usedTokensToday / 1000).toFixed(1)}k / {(dailyBudget / 1000).toFixed(0)}k Tokens</small>
          </div>
          <div className="ai0-stat-tile">
            <span className="ai0-stat-tile__label">
              {renderConsoleIcon("shells", 14)}
              <span>已连接适配器</span>
            </span>
            <div className="ai0-stat-tile__value">
              {connectedPlatforms} / {totalPlatforms}
            </div>
            <small>{(studio?.customRules ?? []).length} 条会话路由规则生效中</small>
          </div>
          <div className="ai0-stat-tile">
            <span className="ai0-stat-tile__label">
              {renderConsoleIcon("memory", 14)}
              <span>任务与长期记忆</span>
            </span>
            <div className="ai0-stat-tile__value">
              {activeTasks.length} 项 · {snap?.memoriesCount ?? 5} 条
            </div>
            <small>墓碑保护 {snap?.redactionLedgerCount ?? 0} 条 · 待履行日程 {(studio?.agency.scheduledPromises ?? []).length} 项</small>
          </div>
        </section>

        <div className="ai0-grid-2">
          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>近期睡眠巩固与好奇心摘要</h2>
              <a
                href="/memory/retrieval-sleep"
                onClick={navClick("/memory/retrieval-sleep")}
                style={{ fontSize: "12px", color: "var(--ai0-accent)", textDecoration: "none", fontWeight: 560 }}
              >
                查看全部
              </a>
            </div>
            {(studio?.evolution.dreamJournal ?? []).slice(0, 2).map((entry) => (
              <article
                key={entry.id}
                style={{ padding: "11px 13px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: "var(--ai0-border-subtle)", display: "grid", gap: "4px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{entry.title}</strong>
                  <small>{entry.date}</small>
                </div>
                <p style={{ fontSize: "12.5px", color: "var(--ai0-on-surface-muted)" }}>{entry.content}</p>
              </article>
            ))}
          </section>

          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>待审批提案与异步任务</h2>
              <a
                href="/runtime/coordinator-agency"
                onClick={navClick("/runtime/coordinator-agency")}
                style={{ fontSize: "12px", color: "var(--ai0-accent)", textDecoration: "none", fontWeight: 560 }}
              >
                管理任务
              </a>
            </div>
            {pendingGrowth.slice(0, 1).map((prop) => (
              <article
                key={prop.id}
                style={{ padding: "11px 13px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: "var(--ai0-border-subtle)", display: "grid", gap: "7px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{prop.title}</strong>
                  <span className="ai0-badge" data-tone="accent">待审批</span>
                </div>
                <small>{prop.sourceEventSummary}</small>
                <div style={{ display: "flex", gap: "8px" }}>
                  <RippleButton
                    variant="primary"
                    size="sm"
                    data-quick-approve={prop.id}
                    data-quick-kind="growth"
                    onClick={() => void quickApprove(prop.id, "growth")}
                  >
                    {renderConsoleIcon("check", 13)}
                    <span>合入 {prop.targetFile}</span>
                  </RippleButton>
                  <a
                    href="/memory/retrieval-sleep"
                    onClick={navClick("/memory/retrieval-sleep")}
                    className="ai0-ripple-btn"
                    data-size="sm"
                  >
                    <span className="ai0-ripple-btn__content">查看 Diff</span>
                  </a>
                </div>
              </article>
            ))}
            {activeTasks.slice(0, 1).map((task) => (
              <article
                key={task.id}
                style={{ padding: "11px 13px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: "var(--ai0-border-subtle)", display: "grid", gap: "6px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{task.title}</strong>
                  <span className="ai0-badge" data-tone="warn">{task.currentStep}/{task.totalSteps}</span>
                </div>
                <small>{task.stepLabel}</small>
                <div style={{ display: "flex", gap: "8px" }}>
                  <RippleButton
                    variant="primary"
                    size="sm"
                    data-quick-approve={task.id}
                    data-quick-kind="task"
                    onClick={() => void quickApprove(task.id, "task")}
                  >
                    {renderConsoleIcon("check", 13)}
                    <span>批准执行</span>
                  </RippleButton>
                </div>
              </article>
            ))}
          </section>
        </div>

        <section className="ai0-card">
          <div className="ai0-card__head">
            <h2>常用配置入口</h2>
            <small>所有认知参数均支持可视化编辑、实时编译预览与沙盒验证</small>
          </div>
          <div className="ai0-grid-4">
            <a href="/soul/distiller" onClick={navClick("/soul/distiller")} className="ai0-role-card" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="ai0-role-card__title">{renderConsoleIcon("persona", 15)}<span>角色卡片与关系契约</span></span>
              <small>导入并清洗外部角色卡，配置核心人格与跨场景关系定位</small>
            </a>
            <a href="/dashboard/blackboard" onClick={navClick("/dashboard/blackboard")} className="ai0-role-card" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="ai0-role-card__title">{renderConsoleIcon("blackboard", 15)}<span>上下文黑板编排</span></span>
              <small>自定义 9 块提示词模板与配额，实时对比公私受众编译结果</small>
            </a>
            <a href="/profiles/rules" onClick={navClick("/profiles/rules")} className="ai0-role-card" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="ai0-role-card__title">{renderConsoleIcon("rules", 15)}<span>场景配置与会话规则</span></span>
              <small>按会话 UMO 绑定不同模型、知识库、唤醒策略与隐私面具</small>
            </a>
            <a href="/system/instances-storage" onClick={navClick("/system/instances-storage")} className="ai0-role-card" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="ai0-role-card__title">{renderConsoleIcon("export", 15)}<span>资产导出与多实例</span></span>
              <small>剥离隐私记忆与密钥，生成 SHA-256 校验的可分发角色模板</small>
            </a>
          </div>
        </section>
      </div>
    </MainRoundedCardOutlet>
  );
}
