import {
  WorkspaceChoice, WorkspaceCode, WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspaceLink,
  WorkspacePage, WorkspaceRow, WorkspaceSection, WorkspaceSplit, WorkspaceStatus, WorkspaceTable,
  WorkspaceTableBody, WorkspaceTableCell, WorkspaceTableHead, WorkspaceTableRow
} from "./workspace-layout.js";
import { useState, type MouseEvent, type ReactElement } from "react";

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
import { useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceSaveButton } from "./workspace.js";

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

  const draft = useWorkspaceDraft({
    bricks: studio?.soulStudio.promptBricks ?? [],
    maxBudget: studio?.soulStudio.maxBlackboardTokens ?? snap?.maxBlackboardTokens ?? 2200
  });
  const { bricks, maxBudget } = draft.value;
  const [previewScope, setPreviewScope] = useState<"private" | "public">("private");
  const [preview, setPreview] = useState<{
    privatePreview: { promptText: string; totalTokens: number };
    publicPreview: { promptText: string; totalTokens: number };
  }>();
  const [pending, setPending] = useState(false);
  const form = useWorkspaceSave(route?.id === "dashboard.blackboard" ? route.id : undefined,
    draft.dirty, () => { draft.discard(); setPreview(undefined); },
    async () => { await ctx?.postStudio("config", { soulStudio: { maxBlackboardTokens: maxBudget, promptBricks: bricks } }); },
    "上下文黑板配置已保存", draft.accept);
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  const navClick = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (props.onNavigate || ctx) {
      event.preventDefault();
      if (props.onNavigate) props.onNavigate(path);
      else ctx?.navigateConsole(path);
    }
  };

  if (route?.id === "dashboard.blackboard") {
    const privatePreview = preview?.privatePreview ?? snap?.promptPreviewPrivate;
    const publicPreview = preview?.publicPreview ?? snap?.promptPreviewPublic;
    const usedTokens = privatePreview?.totalTokens ?? snap?.totalBlackboardTokens;
    const shownPublicTokens = publicPreview?.totalTokens;

    const updateBrick = (id: string, patch: Partial<PromptBrickView>) => {
      draft.setValue((previous) => ({
        ...previous,
        bricks: previous.bricks.map((brick) => brick.id === id ? { ...brick, ...patch } : brick)
      }));
      setPreview(undefined);
    };

    const setMaxBudget = (value: number) => {
      draft.setValue((previous) => ({ ...previous, maxBudget: value }));
      setPreview(undefined);
    };

    const handleCompilePreview = async () => {
      if (!ctx || !studio || pending) return;
      setPending(true);
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
        setPreview(preview);
        ctx.showToast("已完成私密与公开双视角编译预览");
      } catch (err) {
        ctx.showToast(`编译预览失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-prompt-bricks-page="true">
          <WorkspaceHeader title="上下文黑板">

            <WorkspaceStatus data-tone={usedTokens !== undefined && usedTokens > maxBudget ? "warn" : "info"} id="brick-budget-badge">
              {usedTokens ?? "—"} / {maxBudget} Tokens
            </WorkspaceStatus>
            {[1600, 2200, 3400].map((preset) => (
              <RippleButton
                key={preset}
                variant="secondary"
                size="sm"
                data-budget-preset={String(preset)}
                disabled={!form.canWrite}
                onClick={() => {
                  setMaxBudget(preset);
                  ctx?.showToast(`已应用预算预设：${preset} Tokens`);
                }}
              >
                {preset}
              </RippleButton>
            ))}
            <WorkspaceSaveButton form={form} />

          </WorkspaceHeader>

          <WorkspaceSplit>
            <WorkspaceSection>
              <h2>黑板模板</h2>
              <WorkspaceItem>
                <TonalSlider
                  id="brick-max-tokens-slider"
                  label="总上下文预算上限"
                  min={1000}
                  max={5000}
                  step={100}
                  value={maxBudget}
                  unit=" Tokens"
                  disabled={!form.canWrite}
                  onInput={setMaxBudget}
                />
              </WorkspaceItem>

              {bricks.map((brick) => (
                <WorkspaceItem key={brick.id} as="article" data-prompt-brick-id={brick.id}>
                  <WorkspaceRow>
                    <div className="ai0-workspace-actions">
                      <JellySwitch
                        checked={brick.enabled}
                        disabled={!form.canWrite || Boolean(brick.locked)}
                        data-brick-enabled={brick.id}
                        ariaLabel={`启用 ${brick.title}`}
                        onChange={(enabled) => updateBrick(brick.id, { enabled })}
                      />
                      <strong>{brick.title}</strong>
                      {brick.locked ? (
                        <WorkspaceStatus data-tone="warn">
                          {renderConsoleIcon("lock", 11)}
                          <span>锁定</span>
                        </WorkspaceStatus>
                      ) : null}
                      {brick.audienceMode === "private_only" ? (
                        <WorkspaceStatus data-tone="accent">
                          {renderConsoleIcon("lock", 11)}
                          <span>仅私密</span>
                        </WorkspaceStatus>
                      ) : null}
                      {brick.audienceMode === "masked_in_public" ? (
                        <WorkspaceStatus data-tone="info">
                          {renderConsoleIcon("globe", 11)}
                          <span>公开 70% 面具</span>
                        </WorkspaceStatus>
                      ) : null}
                    </div>
                    <div className="ai0-workspace-actions">
                      <CompactInput
                        type="number"
                        min={60}
                        max={1600}
                        step={20}
                        value={brick.maxTokens}
                        ariaLabel={`${brick.title} Token 预算`}
                        disabled={!form.canWrite || Boolean(brick.locked)}
                        unit="tok"
                        data-brick-max-tokens={brick.id}
                        className="ai0-workspace-count"
                        onInput={(val) =>
                          updateBrick(brick.id, { maxTokens: Math.max(60, Number(val) || brick.maxTokens) })
                        }
                      />
                    </div>
                  </WorkspaceRow>
                  <WorkspaceField>
                    <label>
                      <span>模板原文</span>
                      <span className="ai0-workspace-mono">{brick.id}</span>
                    </label>
                    <CompactInput
                      multiline={true}
                      rows={3}
                      ariaLabel={`${brick.title} 模板原文`}
                      value={brick.template}
                      disabled={!form.canWrite || Boolean(brick.locked)}
                      data-brick-template={brick.id}
                      inputClassName="ai0-workspace-editor"
                      onInput={(template) => updateBrick(brick.id, { template })}
                    />
                  </WorkspaceField>
                </WorkspaceItem>
              ))}
            </WorkspaceSection>

            <aside className="ai0-workspace-aside">
              <WorkspaceSection>
                <WorkspaceRow>
                  <h3>编译预览</h3>
                  <RippleButton
                    variant="secondary"
                    size="sm"
                    data-refresh-prompt-preview="true"
                    disabled={!studio || !ctx?.ownerToken}
                    loading={pending}
                    onClick={() => void handleCompilePreview()}
                  >
                    {renderConsoleIcon("refresh", 13)}
                    <span>重新编译</span>
                  </RippleButton>
                </WorkspaceRow>
                <div className="ai0-workspace-actions">
                  <RippleButton
                    variant={previewScope === "private" ? "primary" : "secondary"}
                    size="sm"
                    data-preview-scope="private"
                    onClick={() => setPreviewScope("private")}
                  >
                    {renderConsoleIcon("lock", 13)}
                    <span>私密 1v1 ({usedTokens ?? "—"} tok)</span>
                  </RippleButton>
                  <RippleButton
                    variant={previewScope === "public" ? "primary" : "secondary"}
                    size="sm"
                    data-preview-scope="public"
                    onClick={() => setPreviewScope("public")}
                  >
                    {renderConsoleIcon("globe", 13)}
                    <span>公开样式 ({shownPublicTokens ?? "—"} tok)</span>
                  </RippleButton>
                </div>
                {draft.dirty && !preview ? <small>当前显示最近保存的编译结果。选择「重新编译」预览草稿。</small> : null}
                <WorkspaceCode
                  id="prompt-preview-private-box"

                  hidden={previewScope !== "private"}
                  className="ai0-workspace-preview"
                >
                  {privatePreview?.promptText ??
                    snap?.compiledBlackboardPrompt ??
                    "等待编译上下文黑板..."}
                </WorkspaceCode>
                <WorkspaceCode
                  id="prompt-preview-public-box"

                  hidden={previewScope !== "public"}
                  className="ai0-workspace-preview"
                >
                  {publicPreview?.promptText ?? "等待编译公开受众上下文…"}
                </WorkspaceCode>
              </WorkspaceSection>
            </aside>
          </WorkspaceSplit>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  if (route?.id === "dashboard.conversations") {
    const conversations = snap?.conversations ?? [];
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

    return (
      <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage>
          <WorkspaceHeader title="会话记录">

            <WorkspaceLink
              href="/profiles/rules"
              onClick={navClick("/profiles/rules")}

              data-variant="secondary"
            >
              <span className="ai0-workspace-link-content">
                {renderConsoleIcon("rules", 14)}
                <span>受众策略</span>
              </span>
            </WorkspaceLink>
            <RippleButton
              variant="primary"
              data-trigger-sleep-run="true"
              disabled={!canWrite}
              loading={pending}
              onClick={() => void handleSleepRun()}
            >
              {renderConsoleIcon("evolution", 14)}
              <span>执行记忆整理</span>
            </RippleButton>

          </WorkspaceHeader>

          <WorkspaceSection>
            {!conversations.length ? <small>暂无会话记录。</small> : null}
            <><WorkspaceTable>
              <WorkspaceTableHead>
                <WorkspaceTableRow>
                  <WorkspaceTableCell component="th" scope="col">会话名称与 UMO</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">适配器</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">受众范围与隐私策略</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">绑定 Profile</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">消息数</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">最近摘要</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">操作</WorkspaceTableCell>
                </WorkspaceTableRow>
              </WorkspaceTableHead>
              <WorkspaceTableBody>
                {conversations.map((conv) => {
                  const stagePlugin = snap?.extensions.find((ext) =>
                    ext.enabled && ext.uiSlots?.some((slot) =>
                      slot.slot_target === "slot.shells.mounted_stage" &&
                      (slot.shell_id === conv.platform || conv.platform.startsWith(ext.id))
                    )
                  );
                  const stageSlot = stagePlugin?.uiSlots?.find((slot) => slot.slot_target === "slot.shells.mounted_stage");
                  const stageHref = stageSlot?.route_path ?? (stagePlugin ? `/shells/stage/${stagePlugin.id}` : undefined);
                  return (
                  <WorkspaceTableRow key={conv.umo}>
                    <WorkspaceTableCell>
                      <strong>{conv.label}</strong>
                      <div className="ai0-workspace-mono">
                        {conv.umo}
                      </div>
                    </WorkspaceTableCell>
                    <WorkspaceTableCell><WorkspaceStatus>{conv.platform}</WorkspaceStatus></WorkspaceTableCell>
                    <WorkspaceTableCell>
                      <WorkspaceStatus

                        data-tone={conv.audienceScope === "only_owner" ? "accent" : conv.audienceScope === "public_all" ? "warn" : "info"}
                      >
                        {conv.audienceScope === "only_owner"
                          ? "仅主账户私密"
                          : conv.audienceScope === "public_all"
                            ? "公开 · 70% 社交面具"
                            : "认证群组"}
                      </WorkspaceStatus>
                    </WorkspaceTableCell>
                    <WorkspaceTableCell>{conv.profileName}</WorkspaceTableCell>
                    <WorkspaceTableCell><strong>{conv.messageCount}</strong></WorkspaceTableCell>
                    <WorkspaceTableCell className="ai0-workspace-table-summary">{conv.lastSummary}</WorkspaceTableCell>
                    <WorkspaceTableCell>
                      <div className="ai0-workspace-actions">
                        {stageHref ? <WorkspaceLink
                          href={stageHref}
                          onClick={navClick(stageHref)}

                          data-size="sm"
                        >
                          <span className="ai0-workspace-link-content">打开 {stageSlot?.title ?? stagePlugin?.displayName ?? "舞台"}</span>
                        </WorkspaceLink> : null}
                        <WorkspaceLink
                          href="/profiles/rules"
                          onClick={navClick("/profiles/rules")}

                          data-size="sm"
                        >
                          <span className="ai0-workspace-link-content">规则</span>
                        </WorkspaceLink>
                      </div>
                    </WorkspaceTableCell>
                  </WorkspaceTableRow>
                  );
                })}
              </WorkspaceTableBody>
            </WorkspaceTable></>
          </WorkspaceSection>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  // Default: System Overview
  const primaryRoleLabel = ROLE_LABELS[studio?.soulStudio.primaryRole ?? "best_friend"] ?? "日常挚友";
  const workRoleLabel = ROLE_LABELS[studio?.soulStudio.workVenueRole ?? "digital_employee"] ?? "专业助理";
  const connectedPlatforms = (studio?.platforms ?? []).filter((p) => p.connected).length;
  const totalPlatforms = studio?.platforms.length;
  const pendingGrowth = (studio?.evolution.growthProposals ?? []).filter((p) => p.status === "pending");
  const activeTasks = (studio?.agency.activeTasks ?? []).filter((t) => t.status !== "completed");
  const policy = studio?.metabolicPolicy;
  const remainPct = policy ? Math.max(0, Math.round(((policy.dailyTokenBudget - policy.usedTokensToday) / Math.max(1, policy.dailyTokenBudget)) * 100)) : undefined;

  const quickApprove = async (id: string, kind: "growth" | "task") => {
    if (!ctx || !canWrite || pending) return;
    setPending(true);
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
    } finally {
      setPending(false);
    }
  };

  const primaryStagePlugin = snap?.extensions.find(
    (ext) => ext.enabled && ext.uiSlots?.some((slot) => slot.slot_target === "slot.shells.mounted_stage")
  );
  const primaryStageSlot = primaryStagePlugin?.uiSlots?.find(
    (slot) => slot.slot_target === "slot.shells.mounted_stage"
  );
  const primaryStageHref =
    primaryStageSlot?.route_path ?? (primaryStagePlugin ? `/shells/stage/${primaryStagePlugin.id}` : "/shells/topology");
  const primaryStageLabel = primaryStageSlot ? `打开 ${primaryStageSlot.title}` : "查看接入通道";

  return (
    <MainRoundedCardOutlet domainId="dashboard" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage>
        <WorkspaceHeader title="系统概览">
          <RippleButton variant="ghost" data-open-onboarding="true" onClick={() => ctx?.setOnboardingOpen(true)}>
            {renderConsoleIcon("wizard", 14)}初始化向导
          </RippleButton>
          <WorkspaceLink href="/soul/distiller" onClick={navClick("/soul/distiller")}>
            {renderConsoleIcon("upload", 14)}导入角色卡
          </WorkspaceLink>
          <WorkspaceLink data-variant="primary" href={primaryStageHref} onClick={navClick(primaryStageHref)}>
            {renderConsoleIcon("chat", 14)}{primaryStageLabel}
          </WorkspaceLink>
        </WorkspaceHeader>

        <WorkspaceSection className="ai0-overview-status" aria-label="实时运行概况">
          <WorkspaceRow>
            <div className="ai0-overview-identity">
              <span className="ai0-overview-avatar" aria-hidden="true">{snap?.personaName.slice(0, 1).toUpperCase() ?? "ai"}</span>
              <div>
                <div className="ai0-workspace-actions">
                  <h2>{snap?.personaName ?? "等待连接实例"}</h2>
                  {studio ? <WorkspaceStatus data-tone="accent">{primaryRoleLabel}</WorkspaceStatus> : null}
                  {studio?.soulStudio.autoSwitchByVenue ? <small>工作场景：{workRoleLabel}</small> : null}
                </div>
                <small>本地存档 <code>{snap?.soulId ?? "—"}</code>{snap?.pragmaStatus.journal_mode ? ` · SQLite ${snap.pragmaStatus.journal_mode.toUpperCase()}` : ""}</small>
              </div>
            </div>
            <WorkspaceStatus data-tone={snap?.targetInstance === "live" ? "live" : snap ? "sandbox" : "neutral"}>
              {snap?.targetInstance ?? "等待实例"}
            </WorkspaceStatus>
          </WorkspaceRow>
          <WorkspaceGrid columns={4} className="ai0-overview-metrics">
            <div className="ai0-workspace-metric">
              <span className="ai0-workspace-metric__label">{renderConsoleIcon("circadian", 14)}心境与节律</span>
              <strong className="ai0-workspace-metric__value">
                {snap ? `${snap.moodValence.toFixed(2)} · ${Math.round(snap.circadianEnergy * 100)}%` : "—"}
              </strong>
              <small>当前心境与节律活力</small>
            </div>
            <div className="ai0-workspace-metric">
              <span className="ai0-workspace-metric__label">{renderConsoleIcon("cpu", 14)}今日算力预算</span>
              <strong className="ai0-workspace-metric__value">{remainPct === undefined ? "—" : `${remainPct}%`}</strong>
              <small>{policy ? `已消耗 ${(policy.usedTokensToday / 1000).toFixed(1)}k / ${(policy.dailyTokenBudget / 1000).toFixed(0)}k Tokens` : "等待预算状态"}</small>
            </div>
            <div className="ai0-workspace-metric">
              <span className="ai0-workspace-metric__label">{renderConsoleIcon("shells", 14)}已连接适配器</span>
              <strong className="ai0-workspace-metric__value">
                {totalPlatforms === undefined ? "—" : `${connectedPlatforms} / ${totalPlatforms}`}
              </strong>
              <small>{(studio?.customRules ?? []).length} 条会话路由规则</small>
            </div>
            <div className="ai0-workspace-metric">
              <span className="ai0-workspace-metric__label">{renderConsoleIcon("memory", 14)}任务与长期记忆</span>
              <strong className="ai0-workspace-metric__value">{snap ? `${activeTasks.length} 项 · ${snap.memoriesCount} 条` : "—"}</strong>
              <small>墓碑保护 {snap?.redactionLedgerCount ?? 0} 条 · 日程 {(studio?.agency.scheduledPromises ?? []).length} 项</small>
            </div>
          </WorkspaceGrid>
        </WorkspaceSection>

        <WorkspaceGrid columns={2}>
          <WorkspaceSection>
            <WorkspaceRow>
              <h2>近期睡眠巩固与好奇心摘要</h2>
              <WorkspaceLink
                href="/memory/retrieval-sleep"
                onClick={navClick("/memory/retrieval-sleep")}
                className="ai0-workspace-link-quiet"
              >
                查看全部
              </WorkspaceLink>
            </WorkspaceRow>
            {!studio?.evolution.dreamJournal.length ? <small>暂无记录。</small> : null}
            {(studio?.evolution.dreamJournal ?? []).slice(0, 2).map((entry) => (
              <WorkspaceItem key={entry.id} as="article">
                <div className="ai0-workspace-row">
                  <strong>{entry.title}</strong>
                  <small>{entry.date}</small>
                </div>
                <p className="ai0-workspace-muted">{entry.content}</p>
              </WorkspaceItem>
            ))}
          </WorkspaceSection>

          <WorkspaceSection>
            <WorkspaceRow>
              <h2>待审批提案与异步任务</h2>
              <WorkspaceLink
                href="/runtime/coordinator-agency"
                onClick={navClick("/runtime/coordinator-agency")}
                className="ai0-workspace-link-quiet"
              >
                管理任务
              </WorkspaceLink>
            </WorkspaceRow>
            {!pendingGrowth.length && !activeTasks.length ? <small>暂无待办事项。</small> : null}
            {pendingGrowth.slice(0, 1).map((prop) => (
              <WorkspaceItem key={prop.id} as="article">
                <div className="ai0-workspace-row">
                  <strong>{prop.title}</strong>
                  <WorkspaceStatus data-tone="accent">待审批</WorkspaceStatus>
                </div>
                <small>{prop.sourceEventSummary}</small>
                <div className="ai0-workspace-actions">
                  <RippleButton
                    variant="primary"
                    size="sm"
                    data-quick-approve={prop.id}
                    data-quick-kind="growth"
                    disabled={!canWrite || pending}
                    onClick={() => void quickApprove(prop.id, "growth")}
                  >
                    {renderConsoleIcon("check", 13)}
                    <span>合入 {prop.targetFile}</span>
                  </RippleButton>
                  <WorkspaceLink
                    href="/memory/retrieval-sleep"
                    onClick={navClick("/memory/retrieval-sleep")}

                    data-size="sm"
                  >
                    <span className="ai0-workspace-link-content">查看 Diff</span>
                  </WorkspaceLink>
                </div>
              </WorkspaceItem>
            ))}
            {activeTasks.slice(0, 1).map((task) => (
              <WorkspaceItem key={task.id} as="article">
                <div className="ai0-workspace-row">
                  <strong>{task.title}</strong>
                  <WorkspaceStatus data-tone="warn">{task.currentStep}/{task.totalSteps}</WorkspaceStatus>
                </div>
                <small>{task.stepLabel}</small>
                <div className="ai0-workspace-actions">
                  <RippleButton
                    variant="primary"
                    size="sm"
                    data-quick-approve={task.id}
                    data-quick-kind="task"
                    disabled={!canWrite || pending || task.status !== "waiting_approval"}
                    onClick={() => void quickApprove(task.id, "task")}
                  >
                    {renderConsoleIcon("check", 13)}
                    <span>批准执行</span>
                  </RippleButton>
                </div>
              </WorkspaceItem>
            ))}
          </WorkspaceSection>
        </WorkspaceGrid>

        <WorkspaceSection>
          <WorkspaceRow>
            <h2>常用配置入口</h2>

          </WorkspaceRow>
          <WorkspaceGrid columns={4}>
            <WorkspaceChoice href="/soul/distiller" onClick={navClick("/soul/distiller")}  >
              <span className="ai0-workspace-choice-title">{renderConsoleIcon("persona", 15)}<span>角色卡片与关系契约</span></span>
              <small>导入并清洗外部角色卡，配置核心人格与跨场景关系定位</small>
            </WorkspaceChoice>
            <WorkspaceChoice href="/dashboard/blackboard" onClick={navClick("/dashboard/blackboard")}  >
              <span className="ai0-workspace-choice-title">{renderConsoleIcon("blackboard", 15)}<span>上下文黑板编排</span></span>
              <small>自定义 9 块提示词模板与配额，实时对比公私受众编译结果</small>
            </WorkspaceChoice>
            <WorkspaceChoice href="/profiles/rules" onClick={navClick("/profiles/rules")}  >
              <span className="ai0-workspace-choice-title">{renderConsoleIcon("rules", 15)}<span>场景配置与会话规则</span></span>
              <small>按会话 UMO 绑定不同模型、知识库、唤醒策略与隐私面具</small>
            </WorkspaceChoice>
            <WorkspaceChoice href="/system/instances-storage" onClick={navClick("/system/instances-storage")}  >
              <span className="ai0-workspace-choice-title">{renderConsoleIcon("export", 15)}<span>资产导出与多实例</span></span>
              <small>剥离隐私记忆与密钥，生成 SHA-256 校验的可分发角色模板</small>
            </WorkspaceChoice>
          </WorkspaceGrid>
        </WorkspaceSection>
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
