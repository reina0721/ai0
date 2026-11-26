import { PluginPageHost } from "./design-system/domain-visualizers/PluginPageHost.js";
import { registeredPages, resolvePluginPage } from "./router/plugin-pages.js";
import type { ConsoleNavigationItem } from "@ai0/sdk";
import { useCallback } from "react";
import { ConsoleExtensions } from "./context/ExtensionContext.js";
import Alert from "@mui/material/Alert";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
import LinearProgress from "@mui/material/LinearProgress";
import Snackbar from "@mui/material/Snackbar";
import useMediaQuery from "@mui/material/useMediaQuery";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

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
import { consoleMaterialThemes } from "./design-system/tokens/material-theme.js";
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
  const studio = props.snapshot?.hasAwakenedSoul === false ? undefined : props.snapshot?.studioConfig;
  const infrastructure = props.snapshot?.infrastructure;
  const readiness = props.snapshot?.readiness;
  const sources = infrastructure?.providerSources.filter(source => source.enabled && source.supportedCapabilities.includes("chat")) ?? [];
  const models = infrastructure?.modelInstances.filter(model => model.enabled && model.capabilityKind === "chat") ?? [];
  const defaultModel = models.find(model => model.modelId === readiness?.checks.defaultChatModel &&
    sources.some(source => source.id === model.sourceId) && model.health.status === "ready");
  const defaultSource = sources.find(source => source.id === defaultModel?.sourceId);
  const providerOptions = sources.length ? sources.map(source => ({
    value: source.id, label: source.label, baseUrl: source.baseUrl,
    modelId: (source.id === defaultModel?.sourceId ? defaultModel : models.find(model => model.sourceId === source.id))?.modelId
  })) : [
    { value: "tpl_deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", modelId: undefined },
    { value: "tpl_anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", modelId: undefined },
    { value: "tpl_ollama_chat", label: "Ollama 本地模型", baseUrl: "http://127.0.0.1:11434/v1", modelId: undefined }
  ];
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const provider = providerOptions.find(option => option.value === (selectedProviderId ?? defaultSource?.id)) ?? providerOptions[0]!;
  const [baseUrl, setBaseUrl] = useState<string>();
  const [apiKey, setApiKey] = useState("");
  const [displayName, setDisplayName] = useState(studio?.soulStudio.displayName ?? "");
  const [personaPrompt, setPersonaPrompt] = useState(studio?.soulStudio.corePersonalityPrompt ?? "");
  const [rawCard, setRawCard] = useState("");
  const [selectedRole, setSelectedRole] = useState(studio?.soulStudio.primaryRole ?? "best_friend");
  const [saving, setSaving] = useState(false);

  const roles: ReadonlyArray<{ id: string; icon: ConsoleIconName; label: string; desc: string }> = [
    { id: "romantic_partner", icon: "heart", label: "亲密伴侣", desc: "高情感细腻度、纪念日追踪与温和边界" },
    { id: "best_friend", icon: "smile", label: "日常挚友", desc: "松弛自然的日常交流、留白节奏与低打扰频率" },
    { id: "digital_employee", icon: "briefcase", label: "专业助理", desc: "侧重知识库核验、SubAgent 协作与结构化汇报" },
    { id: "study_classmate", icon: "graduation-cap", label: "学习同伴", desc: "文献拆解、知识库归纳与学习进度协同" },
    { id: "vtuber_partner", icon: "mic", label: "互动搭档", desc: "强喜剧节奏，公开场景默认启用 70% 社交面具" }
  ];

  const handleSubmit = async (): Promise<void> => {
    if (!ctx || saving || ctx.mode !== "live") return;
    if (!displayName.trim() && !rawCard.trim()) {
      ctx.showToast("请输入角色名称或导入包含名称的角色卡");
      return;
    }
    setSaving(true);
    try {
      await ctx.postStudio("/api/studio/onboarding", {
        ...(apiKey.trim() && { providerId: provider.value, baseUrl: baseUrl ?? provider.baseUrl, modelId: provider.modelId, apiKey }),
        ...(rawCard.trim() ? { rawCard: rawCard.trim(), awakenNew: true } : {
          displayName: displayName.trim(), corePersonalityPrompt: personaPrompt
        }),
        primaryRole: selectedRole
      });
      const updated = await ctx.refreshSnapshot();
      const pages = registeredPages(updated).filter(page => page.channel_id);
      const nextPath = pages.length === 1 ? pages[0]!.path : "/integrations/platforms";
      ctx.showToast("初始化配置已保存，正在进入交互工作区");
      props.onClose();
      ctx.navigateConsole(nextPath);
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="ai0-onboarding-modal"
      open={props.open}
      onClose={() => { if (!saving) props.onClose(); }}
      aria-labelledby="ai0-onboarding-title"
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { className: "ai0-modal-card" } }}
    >
        <header className="ai0-onboarding-header">
          <h1 id="ai0-onboarding-title">初始化配置</h1>
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

        {readiness && <Alert severity={defaultSource ? "success" : "info"} role="status">
          <strong>{readiness.stage}</strong>{" · "}
          {defaultSource && defaultModel
            ? `已就绪宿主默认模型（新唤醒角色默认 Inherit 继承）：${defaultSource.label} / ${defaultModel.modelId}`
            : readiness.checks.providerReady ? "模型已配置" : "待配置对话模型"}
        </Alert>}

        <div className="ai0-onboarding-grid">
          <section className="ai0-onboarding-section">
            <h3>主力模型服务</h3>
            <div className="ai0-onboarding-field">
              <span id="onb-provider-label">服务商预设</span>
              <CompactSelect
                id="onb-provider-id"
                labelId="onb-provider-label"
                value={provider.value}
                onChange={(id) => {
                  setSelectedProviderId(id);
                  setBaseUrl(undefined);
                  setApiKey("");
                }}
                options={providerOptions}
              />
            </div>
            <div className="ai0-onboarding-field">
              <label htmlFor="onb-base-url">API Base URL</label>
              <CompactInput id="onb-base-url" type="url" value={baseUrl ?? provider.baseUrl} onInput={setBaseUrl} />
            </div>
            <div className="ai0-onboarding-field">
              <label htmlFor="onb-api-key">API Key</label>
              <CompactInput
                id="onb-api-key"
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onInput={setApiKey}
              />
              <small>密钥保存在宿主保险箱。留空可沿用宿主模型配置。</small>
            </div>
          </section>

          <section className="ai0-onboarding-section">
            <h3>角色档案</h3>
            <div className="ai0-onboarding-field">
              <label htmlFor="onb-display-name">角色名称</label>
              <CompactInput
                id="onb-display-name"
                type="text"
                placeholder="例如：Nagi / 星野"
                value={displayName}
                onInput={setDisplayName}
              />
            </div>
            <div className="ai0-onboarding-field">
              <label htmlFor="onb-persona-prompt">核心性格定义</label>
              <CompactInput
                id="onb-persona-prompt"
                multiline={true}
                rows={4}
                value={personaPrompt}
                onInput={setPersonaPrompt}
              />
            </div>
            <div className="ai0-onboarding-field">
              <label htmlFor="onb-ccv3-raw">从角色卡唤醒（可选，支持 CCv3 JSON 或 Markdown）</label>
              <CompactInput id="onb-ccv3-raw" multiline rows={3} value={rawCard} onInput={setRawCard} />
            </div>
          </section>
        </div>

        <section className="ai0-onboarding-section">
          <h3>默认关系契约</h3>
          <div className="ai0-onboarding-roles" id="onb-role-grid">
            {roles.map((item) => (
              <ButtonBase
                key={item.id}
                type="button"
                className={`ai0-role-card${item.id === selectedRole ? " is-selected" : ""}`}
                data-onb-role={item.id}
                aria-pressed={item.id === selectedRole}
                onClick={() => setSelectedRole(item.id as typeof selectedRole)}
              >
                <span className="ai0-role-card__title">
                  {renderConsoleIcon(item.icon, 15)}
                  <span>{item.label}</span>
                </span>
                <small>{item.desc}</small>
              </ButtonBase>
            ))}
          </div>
        </section>

        <footer className="ai0-onboarding-footer">
          <small>数据严格持久化于本地 .soul 目录，零云端强制绑定。</small>
          <div className="ai0-onboarding-actions">
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
              <span>保存配置并继续</span>
            </RippleButton>
          </div>
        </footer>
    </Dialog>
  );
}

function ConsoleShell(props: ConsoleAppOptions): ReactElement {
  const ctx = useConsole();
  const location = useLocation();
  const [extensionLinks, setExtensionLinks] = useState<ConsoleNavigationItem[]>([]);
  const registerNavigation = useCallback((item: ConsoleNavigationItem) => {
    setExtensionLinks(previous => [...previous, item]);
    return () => setExtensionLinks(previous => previous.filter(link => link !== item));
  }, []);

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
  const route = resolveConsoleRoute(pathname);
  const pages = registeredPages(snapshot);
  const page = resolvePluginPage(pathname, pages);
  const pageLinks = pages.filter(item => item.navigation).map(item => ({
    id: item.pluginId + item.path,
    path: item.path,
    label: item.title,
    placement: item.channel_id ? "overview_chat" as const : "capabilities_ext" as const
  }));
  const links = [
    ...pageLinks,
    ...extensionLinks
      .filter(item => (resolveConsoleRoute(item.path) || resolvePluginPage(item.path, pages)) && !pageLinks.some(link => link.path === item.path))
      .map(item => ({ ...item, placement: "capabilities_ext" as const }))
  ];
  const inspectorMode = page ? "mini" : props.inspectorMode ?? ctx?.inspectorMode ?? "mini";
  const activeDomain = route?.domainId ?? (page?.channel_id ? "overview" : "capabilities");
  const targetInstance = mode === "live" ? "live" : "sandbox:console";
  const smallNav = useMediaQuery("(max-width: 1079px)");
  const overlayInspector = useMediaQuery(inspectorMode === "sandbox-diff" ? "(max-width: 1450px)" : "(max-width: 1310px)");
  const reduced = useReducedMotion();
  const [navOpen, setNavOpen] = useState(false);
  const [guardSaving, setGuardSaving] = useState(false);
  const approving = useRef(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [compare, setCompare] = useState<{ live?: ConsoleLiveSnapshot; sandbox?: ConsoleLiveSnapshot }>({});
  const refreshSnapshot = ctx?.refreshSnapshot;

  useEffect(() => {
    if (inspectorMode !== "sandbox-diff" || !refreshSnapshot || props.snapshot) return;
    let active = true;
    void Promise.all([refreshSnapshot("live"), refreshSnapshot("sandbox")]).then(([live, sandbox]) => {
      if (active) setCompare({ live, sandbox });
    });
    return () => { active = false; };
  }, [inspectorMode, refreshSnapshot, props.snapshot]);

  const approvals = buildPendingApprovals(snapshot);
  const souls = snapshot?.availableSouls?.map((s) => ({
    value: s.active && snapshot?.soulId ? snapshot.soulId : s.id,
    label: s.name
  }));
  const vitalSummary = snapshot ? [
    `心境 ${snapshot.moodValence >= 0 ? "+" : ""}${snapshot.moodValence.toFixed(2)}`,
    `节律 ${Math.round(snapshot.circadianEnergy * 100)}%`,
    `代谢精力 ${Math.round(snapshot.metabolicEnergy * 100)}%`
  ].join(" · ") : undefined;

  const handleApproval = async (
    id: string,
    kind: "growth" | "task" | undefined,
    approve: boolean
  ): Promise<void> => {
    if (!ctx || mode !== "live" || approving.current) return;
    approving.current = true;
    setApprovalPending(true);
    try {
      if (kind === "task") {
        await ctx.postStudio("/api/studio/co-work-task", {
          action: approve ? "approve" : "pause",
          taskId: id
        });
        ctx.showToast(approve ? "任务已批准，等待执行器" : "已暂停该任务");
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
    } finally {
      approving.current = false;
      setApprovalPending(false);
    }
  };

  const inspector = <PolymorphicContextInspector
    mode={inspectorMode}
    trace={snapshot?.latestTrace}
    baselineTrace={(mode === "live" ? snapshot : compare.live)?.latestTrace}
    sandboxTrace={(mode === "sandbox" ? snapshot : compare.sandbox)?.latestTrace}
    onModeChange={ctx?.closeInspector}
  />;
  const dirty = ctx?.dirtyNavigation;

  return (
    <div
      data-console-root=""
      data-current-path={pathname}
      data-soul-theme={soulTheme}
      data-appearance={appearance}
      data-sovereignty-mode={mode}
      data-nav-rail-mode={navRailMode}
      data-inspector-mode={inspectorMode}
      data-overlay-inspector={overlayInspector}
      data-compact-navigation={smallNav}
    >
      <SovereigntyViewportFrame
        targetInstance={targetInstance}
        onNavigate={(path) => ctx?.navigateConsole(path)}
        topBar={
          <HybridTopBar
            activeSoulId={snapshot?.soulId || "unawakened"}
            personaDisplay={snapshot?.personaName || "未唤醒"}
            souls={souls}
            onSoulChange={mode === "live" && (souls?.length ?? 0) > 1 ? async nextId => {
              try {
                await ctx?.postStudio("/api/studio/souls/select", { id: nextId });
                await ctx?.refreshSnapshot();
              } catch (error) {
                ctx?.showToast(`切换存档失败：${error instanceof Error ? error.message : String(error)}`);
              }
            } : undefined}
            targetInstance={targetInstance}
            soulTheme={soulTheme}
            appearance={appearance}
            stateRev={snapshot?.stateRev}
            vitalSummary={vitalSummary}
            approvals={approvals}
            pending={approvalPending}
            approvalsOpen={ctx?.approvalsOpen ?? false}
            preferencesDisabled={ctx ? !ctx.canEditPreferences : undefined}
            onTargetModeChange={(nextMode) => ctx?.setMode(nextMode)}
            onSoulThemeChange={(nextTheme) => void ctx?.setSoulTheme(nextTheme)}
            onToggleAppearance={() => void ctx?.toggleAppearance()}
            onOpenOnboarding={() => ctx?.setOnboardingOpen(true)}
            onOpenNavigation={() => setNavOpen(true)}
            onOpenCommandPalette={() => ctx?.setPaletteOpen(true)}
            onToggleApprovals={() => ctx?.setApprovalsOpen(!(ctx?.approvalsOpen ?? false))}
            onClose={() => ctx?.setApprovalsOpen(false)}
            onApprove={(id, kind) => void handleApproval(id, kind, true)}
            onReject={(id, kind) => void handleApproval(id, kind, false)}
            onNavigate={(path) => ctx?.navigateConsole(path)}
            hrefFor={ctx?.getConsoleHref}
          />
        }
        navigationRail={
          <div data-channel-slot="navigation">
            <PolymorphicNavRail extensionLinks={links}
              mode={smallNav ? "mini" : navRailMode}
              activeDomain={activeDomain}
              activePath={pathname}
              preferencesDisabled={ctx ? !ctx.canEditPreferences : undefined}
              onModeChange={smallNav ? undefined : (nextRail) => void ctx?.setNavRailMode(nextRail)}
              onNavigate={(path) => ctx?.navigateConsole(path)}
              hrefFor={ctx?.getConsoleHref}
            />
          </div>
        }
        main={
          <div data-channel-slot="main">
            {!page && ctx?.loading ? <LinearProgress className="ai0-bootstrap-progress" aria-label="正在连接守护进程" /> : null}
            {!page && ctx?.error ? (
              <Alert severity={snapshot ? "warning" : "error"} className="ai0-connection-notice"
                action={<RippleButton size="sm" onClick={ctx.retryBootstrap}>重新连接</RippleButton>}>
                {snapshot ? "未能刷新，正在显示最近一次数据。" : "暂时无法连接守护进程。"} {ctx.error}
              </Alert>
            ) : null}
            <ConsoleExtensions key={JSON.stringify([targetInstance, snapshot?.soulId])} registerNavigation={registerNavigation} snapshot={snapshot}>
              {page ? <main className="ai0-main-rounded-card-outlet" aria-label={page.title} data-plugin-page={page.path}>
                <PluginPageHost key={page.pluginId + page.path} page={page} snapshot={snapshot} />
              </main> : !route && !snapshot && ctx?.loading ? <p role="status">正在加载控制台页面…</p>
                : renderRoutePageView(pathname, snapshot, (path) => ctx?.navigateConsole(path))}
            </ConsoleExtensions>
          </div>
        }
        contextInspector={
          <div data-channel-slot="inspector">{overlayInspector ? null : inspector}</div>
        }
        overlays={
          <div>
            <Drawer open={smallNav && navOpen} onClose={() => setNavOpen(false)} transitionDuration={reduced ? 0 : 220}
              slotProps={{ paper: { className: "ai0-mobile-nav-drawer", "aria-label": "控制台导航" } }}>
              <header className="ai0-drawer-title"><h2>工作区</h2><RippleButton size="sm" variant="ghost" ariaLabel="关闭导航" onClick={() => setNavOpen(false)}>{renderConsoleIcon("close")}</RippleButton></header>
              <PolymorphicNavRail extensionLinks={links} mode="expanded" activeDomain={activeDomain} activePath={pathname} hrefFor={ctx?.getConsoleHref}
                onNavigate={(path) => { setNavOpen(false); ctx?.navigateConsole(path); }} />
            </Drawer>
            <Drawer anchor="right" open={overlayInspector && inspectorMode !== "mini"}
              onClose={ctx?.closeInspector} transitionDuration={reduced ? 0 : 220}
              slotProps={{ paper: { className: "ai0-mobile-inspector-drawer", "aria-label": "运行检视" } }}>
              {overlayInspector ? inspector : null}
            </Drawer>
            <Dialog open={Boolean(dirty)} onClose={() => { if (!guardSaving) dirty?.stay(); }} aria-labelledby="ai0-dirty-title">
              <DialogTitle id="ai0-dirty-title">有未保存的更改</DialogTitle>
              <DialogContent>保存当前编辑内容后再切换工作区，或放弃这次更改。</DialogContent>
              <DialogActions>
                <RippleButton variant="ghost" disabled={guardSaving} onClick={dirty?.stay}>继续编辑</RippleButton>
                <RippleButton variant="danger" disabled={guardSaving} onClick={dirty?.discard}>放弃更改</RippleButton>
                <RippleButton variant="primary" loading={guardSaving} onClick={() => {
                  if (!dirty || guardSaving) return;
                  setGuardSaving(true);
                  void dirty.save().finally(() => setGuardSaving(false));
                }}>保存并离开</RippleButton>
              </DialogActions>
            </Dialog>
            <CommandPaletteModal
              extensionItems={links}
              open={ctx?.paletteOpen ?? false}
              onNavigate={(path) => ctx?.navigateConsole(path)}
              onClose={() => ctx?.setPaletteOpen(false)}
            />
            {ctx?.onboardingOpen && mode === "live" && <OnboardingWizardOverlay
              open
              snapshot={snapshot}
              onClose={() => ctx?.setOnboardingOpen(false)}
            />}
            <Snackbar open={Boolean(ctx?.toastMessage)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
              <div className="ai0-console-notification" role="status" aria-live="polite">{ctx?.toastMessage}</div>
            </Snackbar>
          </div>
        }
      />
    </div>
  );
}

export function ConsoleApp(props: ConsoleAppOptions = {}): ReactElement {
  const ctx = useConsole();
  const appearance = props.appearance ?? ctx?.appearance ?? "light";
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={consoleMaterialThemes[appearance]}>
        <MotionConfig reducedMotion="user">
          <LazyMotion features={domAnimation}><ConsoleShell {...props} /></LazyMotion>
        </MotionConfig>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export function renderConsoleApp(options: ConsoleAppOptions = {}): ReactElement {
  const initialPath = options.pathname ?? "/dashboard";
  const router = createMemoryRouter([{
    path: "*",
    element: (
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
    )
  }], { initialEntries: [initialPath] });
  return <RouterProvider router={router} />;
}
