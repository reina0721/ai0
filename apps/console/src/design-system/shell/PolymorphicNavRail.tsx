import type { ReactElement } from "react";

import { renderConsoleIcon } from "../tokens/index.js";
import {
  CONSOLE_SIDEBAR_GROUPS_16,
  type ConsoleSidebarNavItem,
  type PrimaryDomainId
} from "../../router/routes.js";

export type NavRailMode = "mini" | "expanded" | "dual";

export interface PolymorphicNavRailProps {
  mode: NavRailMode;
  activeDomain: PrimaryDomainId;
  activePath?: string;
  className?: string;
  onModeChange?: (mode: NavRailMode) => void;
  onNavigate?: (path: string, domain: PrimaryDomainId) => void;
}

const WIDTHS: Record<NavRailMode, string> = {
  mini: "58px",
  expanded: "228px",
  dual: "244px"
};

function nextMode(mode: NavRailMode): NavRailMode {
  return mode === "mini" ? "expanded" : "mini";
}

function isItemActive(
  item: ConsoleSidebarNavItem,
  activePath: string | undefined,
  activeDomain: PrimaryDomainId
): boolean {
  if (activePath) {
    if (item.path === activePath) return true;
    if (item.matchPaths.includes(activePath)) return true;
    if (item.path === "/shells/stage/builtin.webchat" && activePath.startsWith("/shells/stage/")) return true;
    if (item.path === "/extensions/marketplace" && activePath.startsWith("/extensions/custom/")) return true;
    return false;
  }
  return item.domainId === activeDomain;
}

export function PolymorphicNavRail(props: PolymorphicNavRailProps): ReactElement {
  const mini = props.mode === "mini";

  return (
    <aside
      data-mode={props.mode}
      className={`ai0-polymorphic-nav-rail${props.className ? ` ${props.className}` : ""}`}
      style={{ width: WIDTHS[props.mode] }}
    >
      <div className="ai0-nav-rail__primary">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: mini ? "center" : "flex-end",
            padding: "0 2px 2px"
          }}
        >
          <button
            type="button"
            className="ai0-polymorphic-nav-rail__toggle ai0-ripple-btn"
            data-variant="ghost"
            data-size="sm"
            aria-label={`Switch navigation mode from ${props.mode}`}
            title={mini ? "展开侧边导航栏" : "折叠侧边导航栏"}
            style={{ width: "28px", height: "26px", minHeight: "26px", padding: 0 }}
            onClick={() => props.onModeChange?.(nextMode(props.mode))}
          >
            {renderConsoleIcon("sidebar", 15)}
          </button>
        </div>

        <nav aria-label="Primary console workspaces" style={{ display: "grid", gap: "2px" }}>
          {CONSOLE_SIDEBAR_GROUPS_16.map((group) => (
            <div key={group.id} className="ai0-nav-group" data-nav-group={group.id}>
              {!mini ? <div className="ai0-nav-group__label">{group.title}</div> : null}
              {group.items.map((item) => {
                const active = isItemActive(item, props.activePath, props.activeDomain);
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                    data-domain-id={item.domainId}
                    data-nav-path={item.path}
                    className={`ai0-nav-rail__item${active ? " is-active" : ""}`}
                    style={{
                      justifyContent: mini ? "center" : "flex-start",
                      padding: mini ? "0" : "0 10px 0 12px"
                    }}
                    onClick={() => props.onNavigate?.(item.path, item.domainId)}
                  >
                    <span className="ai0-nav-rail__indicator" aria-hidden="true" />
                    {renderConsoleIcon(item.icon, 16)}
                    {!mini ? <span className="ai0-client-nav-label">{item.label}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
