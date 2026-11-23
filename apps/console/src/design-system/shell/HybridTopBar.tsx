import Drawer from "@mui/material/Drawer";
import Link from "@mui/material/Link";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useReducedMotion } from "motion/react";
import { useRef, useState, type ReactElement } from "react";

import { RippleButton, SegmentedPill, CompactSelect, HoverTooltip } from "../primitives/index.js";
import { CONSOLE_SOUL_THEMES, renderConsoleIcon, type ConsoleSoulTheme } from "../tokens/index.js";

export interface PendingApprovalItem {
  id: string;
  title: string;
  summary?: string;
  kind?: "growth" | "task";
}

export interface GlobalPendingApprovalDrawerProps {
  open: boolean;
  approvals: readonly PendingApprovalItem[];
  pending?: boolean;
  readOnly?: boolean;
  onApprove?: (id: string, kind?: "growth" | "task") => void;
  onReject?: (id: string, kind?: "growth" | "task") => void;
  onClose?: () => void;
}

export function GlobalPendingApprovalDrawer(props: GlobalPendingApprovalDrawerProps): ReactElement {
  const reduced = useReducedMotion();
  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      transitionDuration={reduced ? 0 : 220}
      slotProps={{ paper: { className: "ai0-approvals-drawer", "aria-label": "待审批队列" } }}
    >
      <header className="ai0-drawer-title">
        <h2>待审批队列 ({props.approvals.length})</h2>
        <RippleButton variant="ghost" size="sm" ariaLabel="关闭待审批" onClick={props.onClose}>{renderConsoleIcon("close")}</RippleButton>
      </header>
      {props.readOnly ? <p className="ai0-approval-note">审批写入正式存档，在 LIVE 环境可以处理。</p> : null}
      {!props.approvals.length ? <p className="ai0-approval-note">暂无待处理的提案与任务。</p> : null}
      {props.approvals.map((approval) => (
        <article key={approval.id} className="ai0-approval-item" data-approval-id={approval.id} data-approval-kind={approval.kind}>
          <strong>{approval.title}</strong>
          {approval.summary ? <p>{approval.summary}</p> : null}
          <div>
            <RippleButton
              variant="primary" size="sm" disabled={props.readOnly || props.pending}
              data-quick-approve={approval.id} data-quick-kind={approval.kind ?? "growth"}
              onClick={() => props.onApprove?.(approval.id, approval.kind)}
            >批准</RippleButton>
            <RippleButton
              variant="secondary" size="sm" disabled={props.readOnly || props.pending}
              data-quick-reject={approval.id} data-quick-kind={approval.kind ?? "growth"}
              onClick={() => props.onReject?.(approval.id, approval.kind)}
            >驳回</RippleButton>
          </div>
        </article>
      ))}
    </Drawer>
  );
}

export interface HybridTopBarProps extends Omit<GlobalPendingApprovalDrawerProps, "open"> {
  activeSoulId: string;
  personaDisplay?: string;
  souls?: readonly { value: string; label: string }[];
  targetInstance: "live" | `sandbox:${string}`;
  soulTheme: ConsoleSoulTheme;
  appearance?: "light" | "dark";
  stateRev?: number;
  vitalSummary?: string;
  approvalsOpen?: boolean;
  onSoulChange?: (soulId: string) => void;
  onTargetModeChange?: (mode: "live" | "sandbox") => void;
  onSoulThemeChange?: (theme: ConsoleSoulTheme) => void;
  onToggleAppearance?: () => void;
  onOpenOnboarding?: () => void;
  onOpenNavigation?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleApprovals?: () => void;
  onNavigate?: (path: string) => void;
  hrefFor?: (path: string) => string;
}

const themes = [
  { value: "sakura-pink", label: "樱粉" },
  { value: "astral-blue", label: "星蓝" },
  { value: "cyber-emerald", label: "翠绿" }
] as const satisfies readonly { value: typeof CONSOLE_SOUL_THEMES[number]; label: string }[];

export function HybridTopBar(props: HybridTopBarProps): ReactElement {
  const targetMode = props.targetInstance === "live" ? "live" : "sandbox";
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuAnchor(null);
  const storagePath = "/system/instances-storage";
  const logoHref = props.hrefFor?.("/dashboard") ?? "/dashboard";

  return (
    <div className="ai0-hybrid-top-bar-host">
      <header className="ai0-hybrid-top-bar">
        <div className="ai0-topbar-leading">
          <RippleButton variant="ghost" size="sm" className="ai0-topbar-navigation" ariaLabel="打开导航" onClick={props.onOpenNavigation}>
            {renderConsoleIcon("sidebar", 17)}
          </RippleButton>
          <Link className="ai0-console-brand" color="inherit" underline="none" href={logoHref} onClick={(event) => {
            if (!props.onNavigate || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            props.onNavigate("/dashboard");
          }}>
            {renderConsoleIcon("logo", 18)}<span>ai0</span>
          </Link>
          {props.onSoulChange ? <div className="ai0-topbar-soul"><CompactSelect
              value={props.activeSoulId}
              options={props.souls?.length ? props.souls : [{ value: props.activeSoulId, label: props.personaDisplay ?? props.activeSoulId }]}
              ariaLabel="当前存档"
              onChange={props.onSoulChange}
          /></div> : <Tooltip describeChild title={<>{props.activeSoulId}</>} placement="bottom">
            <span className="ai0-topbar-soul" tabIndex={props.personaDisplay !== props.activeSoulId ? 0 : undefined}>
              {props.personaDisplay ?? props.activeSoulId}
            </span>
          </Tooltip>}
          {props.stateRev !== undefined ? <code className="ai0-revision" data-state-rev-badge="true">rev {props.stateRev}</code> : null}
        </div>

        <SegmentedPill
          className="ai0-instance-switch"
          value={targetMode}
          ariaLabel="实例环境"
          options={[{ value: "live", label: "LIVE" }, { value: "sandbox", label: "SANDBOX" }]}
          onChange={props.onTargetModeChange}
        />

        <div className="ai0-topbar-actions">
          {props.vitalSummary ? (
            <Tooltip describeChild title={<>心境、节律精力和代谢精力</>} placement="bottom">
              <span className="ai0-top-vital-strip" tabIndex={0}>
                <span className={"ai0-status-dot" + (targetMode === "sandbox" ? " is-sandbox" : "")} />
                {props.vitalSummary}
              </span>
            </Tooltip>
          ) : null}
          <RippleButton variant="ghost" size="sm" data-toggle-approvals="true" className="ai0-topbar-secondary" ariaLabel="查看待审批" onClick={props.onToggleApprovals}>
            {renderConsoleIcon("bell", 15)}
            <span>待审批{props.approvals.length ? " (" + props.approvals.length + ")" : ""}</span>
          </RippleButton>
          <RippleButton variant="ghost" size="sm" data-toggle-appearance="true" className="ai0-topbar-secondary ai0-icon-button" ariaLabel="切换浅色或深色外观" onClick={props.onToggleAppearance}>
            {renderConsoleIcon(props.appearance === "dark" ? "sun" : "moon", 15)}
          </RippleButton>
          <CompactSelect className="ai0-topbar-secondary" value={props.soulTheme} ariaLabel="Soul 配色" options={themes} onChange={props.onSoulThemeChange} />
          <HoverTooltip content="命令面板 · Ctrl / ⌘ + K" interactiveChild>
            <RippleButton variant="ghost" size="sm" data-open-palette="true" ariaLabel="打开命令面板" ariaHasPopup="dialog" className="ai0-command-trigger" onClick={props.onOpenCommandPalette}>
              {renderConsoleIcon("search", 16)}<kbd>⌘K</kbd>
            </RippleButton>
          </HoverTooltip>
          <RippleButton
            size="sm" variant="ghost" className="ai0-icon-button" ariaLabel="更多操作" ariaHasPopup="menu" ariaExpanded={Boolean(menuAnchor)}
            ref={menuButton}
            onClick={() => setMenuAnchor(menuButton.current)}
          >
            {renderConsoleIcon("system", 16)}
          </RippleButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu} slotProps={{ paper: { className: "ai0-topbar-menu" }, list: { "aria-label": "控制台操作" } }}>
            <MenuItem data-open-onboarding="true" onClick={() => { closeMenu(); props.onOpenOnboarding?.(); }} disabled={targetMode === "sandbox"}>{renderConsoleIcon("wizard", 15)}初始化向导</MenuItem>
            <MenuItem component="a" href={props.hrefFor?.(storagePath) ?? storagePath} onClick={(event) => {
              if (props.onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                props.onNavigate(storagePath);
              }
              closeMenu();
            }}>{renderConsoleIcon("export", 15)}导出与存储</MenuItem>
            <MenuItem onClick={() => { closeMenu(); props.onToggleApprovals?.(); }}>{renderConsoleIcon("bell", 15)}待审批 ({props.approvals.length})</MenuItem>
            <MenuItem onClick={() => { closeMenu(); props.onToggleAppearance?.(); }}>{renderConsoleIcon(props.appearance === "dark" ? "sun" : "moon", 15)}切换外观</MenuItem>
            {themes.map((theme) => (
              <MenuItem key={theme.value} selected={props.soulTheme === theme.value} onClick={() => { closeMenu(); props.onSoulThemeChange?.(theme.value); }}>
                {renderConsoleIcon(props.soulTheme === theme.value ? "check" : "sparkles", 15)}{theme.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </header>
      <GlobalPendingApprovalDrawer
        open={Boolean(props.approvalsOpen)}
        approvals={props.approvals}
        readOnly={targetMode === "sandbox" || props.readOnly}
        pending={props.pending}
        onApprove={props.onApprove}
        onReject={props.onReject}
        onClose={props.onClose}
      />
    </div>
  );
}
