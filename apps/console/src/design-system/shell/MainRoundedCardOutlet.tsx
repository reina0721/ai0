import type { ReactElement, ReactNode } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import { RippleButton, SegmentedPill } from "../primitives/index.js";
import { renderConsoleIcon } from "../tokens/index.js";
import {
  findSidebarContext,
  getDomainSubRoutes,
  resolveConsoleRoute,
  type ConsoleRoute,
  type PrimaryDomainId
} from "../../router/routes.js";

export interface InternalStickySubNavProps {
  domainId: PrimaryDomainId;
  activePath: string;
  onNavigate?: (path: string, route: ConsoleRoute) => void;
  onToggleInspector?: () => void;
}

export function InternalStickySubNav(props: InternalStickySubNavProps): ReactElement {
  const ctx = useConsole();
  const sidebarCtx = findSidebarContext(props.activePath);
  const activeRoute = resolveConsoleRoute(props.activePath);
  const allDomainRoutes = getDomainSubRoutes(props.domainId);
  const ownedSubRoutes =
    sidebarCtx && sidebarCtx.item.matchPaths.length > 1
      ? allDomainRoutes.filter((r) => sidebarCtx.item.matchPaths.includes(r.defaultConcretePath ?? r.path))
      : [];
  const showSubTabs = ownedSubRoutes.length > 1 && props.domainId === "system";

  return (
    <nav
      aria-label={`${props.domainId} context bar`}
      className="ai0-internal-sticky-sub-nav"
    >
      <div className="ai0-breadcrumb">
        {sidebarCtx ? renderConsoleIcon(sidebarCtx.item.icon, 14) : null}
        <span>{sidebarCtx?.groupTitle ?? "控制台"}</span>
        <span className="ai0-breadcrumb__sep">/</span>
        <span className="ai0-breadcrumb__current">
          {activeRoute?.label ?? sidebarCtx?.item.label ?? "系统概览"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {showSubTabs ? (
          <SegmentedPill
            value={activeRoute?.id ?? ownedSubRoutes[0]!.id}
            options={ownedSubRoutes.map((r) => ({ value: r.id, label: r.label }))}
            ariaLabel={`${props.domainId} sub-views`}
            onChange={(routeId: string) => {
              const target = ownedSubRoutes.find(({ id }) => id === routeId);
              if (!target) return;
              const nextPath = target.defaultConcretePath ?? target.path;
              if (props.onNavigate) props.onNavigate(nextPath, target);
              else ctx?.navigateConsole(nextPath);
            }}
          />
        ) : null}

        <RippleButton
          variant="ghost"
          size="sm"
          data-open-inspector="trace"
          title="展开或收起右侧思维链路与潜台词抽屉"
          onClick={() => {
            if (props.onToggleInspector) props.onToggleInspector();
            else ctx?.toggleInspector();
          }}
        >
          {renderConsoleIcon("inspector", 14)}
          <span>思维链路抽屉</span>
        </RippleButton>
      </div>
    </nav>
  );
}

export interface MainScrollableBodyProps {
  children?: ReactNode;
  className?: string;
}

export function MainScrollableBody(props: MainScrollableBodyProps): ReactElement {
  return (
    <section
      className={`ai0-main-scrollable-body${props.className ? ` ${props.className}` : ""}`}
      style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}
    >
      {props.children}
    </section>
  );
}

export interface MainRoundedCardOutletProps extends InternalStickySubNavProps {
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function MainRoundedCardOutlet(props: MainRoundedCardOutletProps): ReactElement {
  return (
    <main
      className={`ai0-main-rounded-card-outlet${props.className ? ` ${props.className}` : ""}`}
      data-domain-id={props.domainId}
    >
      <InternalStickySubNav
        domainId={props.domainId}
        activePath={props.activePath}
        onNavigate={props.onNavigate}
        onToggleInspector={props.onToggleInspector}
      />
      <MainScrollableBody>{props.children}</MainScrollableBody>
      {props.footer ? (
        <footer
          className="ai0-main-rounded-card-outlet__footer"
          style={{ flexShrink: 0, borderTop: "var(--ai0-border-subtle)" }}
        >
          {props.footer}
        </footer>
      ) : null}
    </main>
  );
}
