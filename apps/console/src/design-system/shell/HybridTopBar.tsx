import type { ReactElement } from "react";

import { RippleButton, SegmentedPill, CompactSelect } from "../primitives/index.js";
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
  onApprove?: (id: string, kind?: "growth" | "task") => void;
  onReject?: (id: string, kind?: "growth" | "task") => void;
  onClose?: () => void;
}

export function GlobalPendingApprovalDrawer(
  props: GlobalPendingApprovalDrawerProps
): ReactElement {
  return (
    <aside
      hidden={!props.open}
      aria-label="Pending approvals"
      className="ai0-global-pending-approval-drawer"
      style={{
        position: "absolute",
        zIndex: 40,
        top: "50px",
        right: "14px",
        width: "380px",
        maxHeight: "min(540px, 76vh)",
        overflowY: "auto",
        padding: "14px 16px",
        border: "var(--ai0-border-subtle)",
        borderRadius: "14px",
        background: "var(--ai0-surface-main-card)",
        boxShadow: "var(--ai0-shadow-float)"
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          {renderConsoleIcon("bell", 15)}
          <span>待审批队列 ({props.approvals.length})</span>
        </strong>
        <RippleButton
          variant="ghost"
          size="sm"
          className="ai0-inspector-close-btn"
          ariaLabel="Close approvals"
          style={{ width: "26px", padding: 0 }}
          onClick={props.onClose}
        >
          {renderConsoleIcon("close", 14)}
        </RippleButton>
      </header>
      {props.approvals.length === 0 ? (
        <p style={{ fontSize: "12px", color: "var(--ai0-on-surface-muted)" }}>
          当前无待处理的演化提案或工具授权请求。
        </p>
      ) : null}
      {props.approvals.map((approval) => (
        <article
          key={approval.id}
          data-approval-id={approval.id}
          data-approval-kind={approval.kind ?? "growth"}
          style={{ padding: "10px 0", borderTop: "var(--ai0-border-subtle)", display: "grid", gap: "6px" }}
        >
          <strong style={{ fontSize: "12.5px" }}>{approval.title}</strong>
          {approval.summary ? (
            <p style={{ fontSize: "12px", color: "var(--ai0-on-surface-muted)" }}>{approval.summary}</p>
          ) : null}
          <div style={{ display: "flex", gap: "6px" }}>
            <RippleButton
              variant="primary"
              size="sm"
              data-quick-approve={approval.id}
              data-quick-kind={approval.kind ?? "growth"}
              onClick={() => props.onApprove?.(approval.id, approval.kind)}
            >
              {renderConsoleIcon("check", 13)}
              <span>批准</span>
            </RippleButton>
            <RippleButton
              variant="secondary"
              size="sm"
              data-quick-reject={approval.id}
              data-quick-kind={approval.kind ?? "growth"}
              onClick={() => props.onReject?.(approval.id, approval.kind)}
            >
              驳回
            </RippleButton>
          </div>
        </article>
      ))}
    </aside>
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
  onOpenCommandPalette?: () => void;
  onToggleApprovals?: () => void;
  onNavigate?: (path: string) => void;
}

const THEME_LABELS: Record<ConsoleSoulTheme, string> = {
  "sakura-pink": "樱粉",
  "astral-blue": "星蓝",
  "cyber-emerald": "翠绿"
};

export function HybridTopBar(props: HybridTopBarProps): ReactElement {
  const targetMode = props.targetInstance === "live" ? "live" : "sandbox";
  const soulOptions = props.souls?.length
    ? props.souls
    : [{ value: props.activeSoulId, label: props.personaDisplay ?? "Mio" }];

  return (
    <div className="ai0-hybrid-top-bar-host" style={{ position: "relative" }}>
      <header className="ai0-hybrid-top-bar">
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
          <a
            href="/dashboard"
            onClick={(e) => {
              if (props.onNavigate) {
                e.preventDefault();
                props.onNavigate("/dashboard");
              }
            }}
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              fontSize: "15px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--ai0-on-surface)",
              padding: "0 4px",
              whiteSpace: "nowrap",
              flexShrink: 0
            }}
          >
            <span style={{ color: "var(--ai0-accent)", display: "inline-flex" }}>
              {renderConsoleIcon("logo", 17)}
            </span>
            <span>ai0</span>
          </a>

          <span style={{ width: "1px", height: "16px", background: "var(--ai0-surface-container-high)", flexShrink: 0 }} />

          <CompactSelect
            value={props.activeSoulId}
            options={soulOptions}
            ariaLabel="Active soul"
            style={{ height: "28px", minHeight: "28px" }}
            onChange={props.onSoulChange}
          />

          <RippleButton
            variant="ghost"
            size="sm"
            data-open-onboarding="true"
            title="打开初始化配置向导"
            onClick={props.onOpenOnboarding}
          >
            {renderConsoleIcon("wizard", 14)}
            <span>初始化向导</span>
          </RippleButton>

          {props.stateRev !== undefined ? (
            <span
              className="ai0-badge"
              data-state-rev-badge="true"
              style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11px", flexShrink: 0 }}
            >
              rev #{props.stateRev}
            </span>
          ) : null}
        </div>

        <SegmentedPill
          value={targetMode}
          ariaLabel="Target instance"
          options={[
            { value: "live", label: "正式环境" },
            { value: "sandbox", label: "沙盒环境" }
          ]}
          onChange={props.onTargetModeChange}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {props.vitalSummary ? (
            <span
              className="ai0-top-vital-strip"
              title="心境指数 · 24h 节律精力 · 算力预算剩余"
            >
              <span className={`ai0-status-dot${targetMode === "sandbox" ? " is-sandbox" : ""}`} />
              <span>{props.vitalSummary}</span>
            </span>
          ) : null}

          <RippleButton
            variant="ghost"
            size="sm"
            data-toggle-approvals="true"
            title="查看待审批提案与任务授权"
            onClick={props.onToggleApprovals}
          >
            {renderConsoleIcon("bell", 15)}
            <span>待审批{props.approvals.length > 0 ? ` (${props.approvals.length})` : ""}</span>
          </RippleButton>

          <a
            href="/system/instances-storage"
            onClick={(e) => {
              if (props.onNavigate) {
                e.preventDefault();
                props.onNavigate("/system/instances-storage");
              }
            }}
            className="ai0-ripple-btn"
            data-variant="tonal"
            data-size="sm"
            style={{ textDecoration: "none" }}
          >
            <span className="ai0-ripple-btn__content">
              {renderConsoleIcon("export", 14)}
              <span>导出</span>
            </span>
          </a>

          <RippleButton
            variant="ghost"
            size="sm"
            data-toggle-appearance="true"
            ariaLabel="Toggle light or dark appearance"
            title="切换浅色 / 深色外观"
            style={{ width: "28px", padding: 0 }}
            onClick={props.onToggleAppearance}
          >
            {renderConsoleIcon("sun", 15, "ai0-icon-sun")}
            {renderConsoleIcon("moon", 15, "ai0-icon-moon")}
          </RippleButton>

          <CompactSelect
            value={props.soulTheme}
            ariaLabel="Soul theme"
            style={{ height: "28px", minHeight: "28px" }}
            options={CONSOLE_SOUL_THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme] }))}
            onChange={(value: string) => props.onSoulThemeChange?.(value as ConsoleSoulTheme)}
          />

          <RippleButton
            variant="ghost"
            size="sm"
            data-open-palette="true"
            ariaLabel="Open command palette"
            title="快捷命令面板 (Ctrl/Cmd + K)"
            style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px", padding: "0 8px" }}
            onClick={props.onOpenCommandPalette}
          >
            {renderConsoleIcon("search", 13)}
            <span>⌘K</span>
          </RippleButton>
        </div>
      </header>
      <GlobalPendingApprovalDrawer
        open={Boolean(props.approvalsOpen)}
        approvals={props.approvals}
        onApprove={props.onApprove}
        onReject={props.onReject}
        onClose={props.onClose}
      />
    </div>
  );
}
