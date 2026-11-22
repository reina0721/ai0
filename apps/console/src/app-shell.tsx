import { useEffect, useState, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router";

import { ConsoleProvider, useConsole } from "./context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect
} from "./design-system/primitives/index.js";
import {
  CommandPaletteModal,
  HybridTopBar,
  PolymorphicContextInspector,
  PolymorphicNavRail,
  SovereigntyViewportFrame,
  type ContextInspectorMode,
  type NavRailMode,
  type PendingApprovalItem
} from "./design-system/shell/index.js";
import {
  renderConsoleIcon,
  type ConsoleIconName,
  type ConsoleSoulTheme
} from "./design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "./live-snapshot.js";
import { renderRoutePageView } from "./pages/index.js";
import { resolveConsoleRoute } from "./router/routes.js";

export interface ConsoleAppOptions {
  pathname?: string;
  soulTheme?: ConsoleSoulTheme;
  appearance?: "light" | "dark";
  mode?: "live" | "sandbox";
  navRailMode?: NavRailMode;
  inspectorMode?: ContextInspectorMode;
  snapshot?: ConsoleLiveSnapshot;
  ownerToken?: string;
}

function buildPendingApprovals(snapshot?: ConsoleLiveSnapshot): PendingApprovalItem[] {
  const studio = snapshot?.studioConfig;
  if (!studio) return [];
  const items: PendingApprovalItem[] = [];
  for (const prop of studio.evolution.growthProposals) {
    if (prop.status === "pending") {
      items.push({
        id: prop.id,
        title: prop.title,
        summary: `目标档案 ${prop.targetFile} · ${prop.sourceEventSummary}`,
        kind: "growth"
      });
    }
  }
  for (const task of studio.agency.activeTasks) {
    if (task.status === "waiting_approval") {
      items.push({
        id: task.id,
        title: `异步任务授权：${task.title}`,
        summary: task.stepLabel,
        kind: "task"
      });
    }
  }
  return items;
}

function OnboardingWizardOverlay(props: {
  open: boolean;
  snapshot?: ConsoleLiveSnapshot;
  onClose: () => void;
}): ReactElement {
  const ctx = useConsole();
  const studio = props.snapshot?.studioConfig;
  const [providerId, setProviderId] = useState("prov_deepseek_v3");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [displayName, setDisplayName] = useState(studio?.soulStudio.displayName ?? "Mio");
  const [personaPrompt, setPersonaPrompt] = useState(
    studio?.soulStudio.corePersonalityPrompt ??
      "你是运行在本地存档中的独立数字生命，真诚克制，兼顾日常交流与高效协作。"
  );
  const [selectedRole, setSelectedRole] = useState(studio?.soulStudio.primaryRole ?? "best_friend");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (studio?.soulStudio) {
      setDisplayName(studio.soulStudio.displayName);
      setPersonaPrompt(studio.soulStudio.corePersonalityPrompt);
      setSelectedRole(studio.soulStudio.primaryRole);
    }
  }, [
    studio?.soulStudio.displayName,
    studio?.soulStudio.corePersonalityPrompt,
    studio?.soulStudio.primaryRole
  ]);

  const roles: ReadonlyArray<{ id: string; icon: ConsoleIconName; label: string; desc: string }> = [
    { id: "romantic_partner", icon: "heart", label: "亲密伴侣", desc: "高情感细腻度、纪念日追踪与温和边界" },
    { id: "best_friend", icon: "smile", label: "日常挚友", desc: "松弛自然的日常交流、留白节奏与低打扰频率" },
    { id: "digital_employee", icon: "briefcase", label: "专业助理", desc: "侧重知识库核验、SubAgent 协作与结构化汇报" },
    { id: "study_classmate", icon: "graduation-cap", label: "学习同伴", desc: "文献拆解、知识库归纳与学习进度协同" },
    { id: "vtuber_partner", icon: "mic", label: "互动搭档", desc: "强喜剧节奏，公开场景默认启用 70% 社交面具" }
  ];

  const handleSubmit = async (): Promise<void> => {
    if (!ctx) return;
    setSaving(true);
    try {
      await ctx.postStudio("/api/studio/onboarding", {
        providerId,
        baseUrl,
        apiKey,
        displayName,
        corePersonalityPrompt: personaPrompt,
        primaryRole: selectedRole
      });
      await ctx.refreshSnapshot();
      ctx.showToast("初始化配置已保存，正在进入对话舞台");
      props.onClose();
      ctx.navigateConsole("/shells/stage/builtin.webchat");
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="ai0-modal-backdrop"
      id="ai0-onboarding-modal"
      hidden={!props.open}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="ai0-modal-card" role="dialog" aria-modal="true" aria-label="初始化配置向导">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>初始化配置</h1>
          <RippleButton
            variant="ghost"
            size="sm"
            data-close-onboarding="true"
            ariaLabel="Close wizard"
            style={{ width: "28px", padding: 0 }}
            onClick={props.onClose}
          >
            {renderConsoleIcon("close", 15)}
          </RippleButton>
        </header>

        <div className="ai0-grid-2">
          <section className="ai0-card">
            <h3>1. 配置主力模型服务</h3>
            <div className="ai0-field">
              <label>服务商预设</label>
              <CompactSelect
                id="onb-provider-id"
                value={providerId}
                onChange={setProviderId}
                options={[
                  { value: "prov_deepseek_v3", label: "DeepSeek V3 (主力对话)" },
                  { value: "prov_claude_sonnet", label: "Claude 3.7 Sonnet (推理与规划)" },
                  { value: "prov_ollama_local", label: "Ollama 本地模型 (离线运行)" }
                ]}
              />
            </div>
            <div className="ai0-field">
              <label>API Base URL</label>
              <CompactInput id="onb-base-url" type="url" value={baseUrl} onInput={setBaseUrl} />
            </div>
            <div className="ai0-field">
              <label>API Key（存入本地密钥保险箱，留空将使用本地离线引擎）</label>
              <CompactInput
                id="onb-api-key"
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onInput={setApiKey}
              />
            </div>
          </section>

          <section className="ai0-card">
            <h3>2. 设定基础角色档案</h3>
            <div className="ai0-field">
              <label>角色名称</label>
              <CompactInput
                id="onb-display-name"
                type="text"
                value={displayName}
                onInput={setDisplayName}
              />
            </div>
            <div className="ai0-field">
              <label>核心性格定义（稍后支持在角色卡片页导入蒸馏包覆盖）</label>
              <CompactInput
                id="onb-persona-prompt"
                multiline={true}
                rows={4}
                value={personaPrompt}
                onInput={setPersonaPrompt}
              />
            </div>
          </section>
        </div>

        <section className="ai0-card">
          <h3>3. 选择默认关系契约模板（自动联动主动频率与交互姿态）</h3>
          <div className="ai0-grid-3" id="onb-role-grid">
            {roles.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ai0-role-card${item.id === selectedRole ? " is-selected" : ""}`}
                data-onb-role={item.id}
                onClick={() => setSelectedRole(item.id as typeof selectedRole)}
              >
                <span className="ai0-role-card__title">
                  {renderConsoleIcon(item.icon, 15)}
                  <span>{item.label}</span>
                </span>
                <small>{item.desc}</small>
              </button>
            ))}
          </div>
        </section>

        <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
          <small>数据严格持久化于本地 .soul 目录，零云端强制绑定。</small>
          <div style={{ display: "flex", gap: "8px" }}>
            <RippleButton variant="secondary" data-close-onboarding="true" onClick={props.onClose}>
              取消
            </RippleButton>
            <RippleButton
              variant="primary"
              data-submit-onboarding="true"
              loading={saving}
              onClick={() => void handleSubmit()}
            >
              {renderConsoleIcon("check", 14)}
              <span>完成配置并进入对话舞台</span>
            </RippleButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function ConsoleApp(props: ConsoleAppOptions = {}): ReactElement {
  const ctx = useConsole();
  const location = useLocation();

  const pathname =
    props.pathname ?? (location.pathname === "/" ? "/dashboard" : location.pathname);
  const snapshot = props.snapshot ?? ctx?.snapshot;
  const studio = snapshot?.studioConfig;
  const soulTheme =
    props.soulTheme ?? ctx?.soulTheme ?? studio?.systemSettings.soulTheme ?? "sakura-pink";
  const appearance =
    props.appearance ?? ctx?.appearance ?? studio?.systemSettings.appearance ?? "light";
  const mode = props.mode ?? ctx?.mode ?? "live";
  const navRailMode = props.navRailMode ?? ctx?.navRailMode ?? "expanded";
  const inspectorMode = props.inspectorMode ?? ctx?.inspectorMode ?? "mini";
  const activeDomain = resolveConsoleRoute(pathname)?.domainId ?? "dashboard";
  const targetInstance = mode === "live" ? "live" : "sandbox:console";
  const approvals = buildPendingApprovals(snapshot);
  const souls = snapshot?.availableSouls?.map((s) => ({
    value: s.id,
    label: s.name
  }));
  const moodStr = snapshot
    ? `${snapshot.moodValence >= 0 ? "+" : ""}${snapshot.moodValence.toFixed(2)}`
    : "+0.48";
  const bioPct = snapshot ? Math.round(snapshot.circadianEnergy * 100) : 86;
  const metaPct = snapshot ? Math.round(snapshot.metabolicEnergy * 100) : 91;

  const handleApproval = async (
    id: string,
    kind: "growth" | "task" | undefined,
    approve: boolean
  ): Promise<void> => {
    if (!ctx) return;
    try {
      if (kind === "task") {
        await ctx.postStudio("/api/studio/co-work-task", {
          action: approve ? "approve" : "pause",
          taskId: id
        });
        ctx.showToast(approve ? "任务已完成并沉淀为情景记忆" : "已暂停该任务");
      } else {
        await ctx.postStudio("/api/studio/growth-proposal", {
          proposalId: id,
          decision: approve ? "approved" : "rejected"
        });
        ctx.showToast(approve ? "演化提案已批准并合入存档" : "已驳回演化提案");
      }
      await ctx.refreshSnapshot();
    } catch (err) {
      ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      data-console-root=""
      data-current-path={pathname}
      data-soul-theme={soulTheme}
      data-appearance={appearance}
      data-sovereignty-mode={mode}
      data-nav-rail-mode={navRailMode}
      data-inspector-mode={inspectorMode}
    >
      <SovereigntyViewportFrame
        targetInstance={targetInstance}
        onNavigate={(path) => ctx?.navigateConsole(path)}
        topBar={
          <HybridTopBar
            activeSoulId={snapshot?.soulId ?? "default.soul"}
            personaDisplay={snapshot?.personaName ?? "Mio"}
            souls={souls}
            targetInstance={targetInstance}
            soulTheme={soulTheme}
            appearance={appearance}
            stateRev={snapshot?.stateRev}
            vitalSummary={`心境 ${moodStr} · 节律 ${bioPct}% · 预算 ${metaPct}%`}
            approvals={approvals}
            approvalsOpen={ctx?.approvalsOpen ?? false}
            onTargetModeChange={(nextMode) => ctx?.setMode(nextMode)}
            onSoulThemeChange={(nextTheme) => void ctx?.setSoulTheme(nextTheme)}
            onToggleAppearance={() => void ctx?.toggleAppearance()}
            onOpenOnboarding={() => ctx?.setOnboardingOpen(true)}
            onOpenCommandPalette={() => ctx?.setPaletteOpen(true)}
            onToggleApprovals={() => ctx?.setApprovalsOpen(!(ctx?.approvalsOpen ?? false))}
            onClose={() => ctx?.setApprovalsOpen(false)}
            onApprove={(id, kind) => void handleApproval(id, kind, true)}
            onReject={(id, kind) => void handleApproval(id, kind, false)}
            onNavigate={(path) => ctx?.navigateConsole(path)}
          />
        }
        navigationRail={
          <div data-shell-slot="navigation">
            <PolymorphicNavRail
              mode={navRailMode}
              activeDomain={activeDomain}
              activePath={pathname}
              onModeChange={(nextRail) => ctx?.setNavRailMode(nextRail)}
              onNavigate={(path) => ctx?.navigateConsole(path)}
            />
          </div>
        }
        main={
          <div data-shell-slot="main">
            {renderRoutePageView(pathname, snapshot, (path) => ctx?.navigateConsole(path))}
          </div>
        }
        contextInspector={
          <div data-shell-slot="inspector">
            <PolymorphicContextInspector
              mode={inspectorMode}
              trace={snapshot?.latestTrace}
              baselineTrace={snapshot?.latestTrace}
              sandboxTrace={snapshot?.recentTraces[1] ?? snapshot?.latestTrace}
              onModeChange={(nextInspector) => ctx?.setInspectorMode(nextInspector)}
            />
          </div>
        }
        overlays={
          <div>
            <CommandPaletteModal
              open={ctx?.paletteOpen ?? false}
              onNavigate={(path) => ctx?.navigateConsole(path)}
              onClose={() => ctx?.setPaletteOpen(false)}
            />
            <OnboardingWizardOverlay
              open={ctx?.onboardingOpen ?? false}
              snapshot={snapshot}
              onClose={() => ctx?.setOnboardingOpen(false)}
            />
            <div
              id="ai0-toast"
              className={`ai0-toast${ctx?.toastMessage ? " is-visible" : ""}`}
              role="status"
              aria-live="polite"
            >
              {ctx?.toastMessage ?? ""}
            </div>
          </div>
        }
      />
    </div>
  );
}

export function renderConsoleApp(options: ConsoleAppOptions = {}): ReactElement {
  const initialPath = options.pathname ?? "/dashboard";
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <ConsoleProvider
        initialSnapshot={options.snapshot}
        initialOwnerToken={options.ownerToken}
        initialMode={options.mode}
        initialTheme={options.soulTheme}
        initialAppearance={options.appearance}
        initialNavRailMode={options.navRailMode}
        initialInspectorMode={options.inspectorMode}
        disableAutoFetch={true}
      >
        <ConsoleApp {...options} />
      </ConsoleProvider>
    </MemoryRouter>
  );
}
