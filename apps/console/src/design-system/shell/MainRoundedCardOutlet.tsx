import ButtonBase from "@mui/material/ButtonBase";
import { useAnimate, useReducedMotion } from "motion/react";
import { useEffect, type MouseEvent, type ReactElement, type ReactNode } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import { CompactSelect, HoverTooltip, RippleButton } from "../primitives/index.js";
import { renderConsoleIcon } from "../tokens/index.js";
import { CONSOLE_ROUTES_30, findSidebarContext, resolveConsoleRoute, type ConsoleRoute, type PrimaryDomainId } from "../../router/routes.js";

export interface InternalStickySubNavProps {
  domainId: PrimaryDomainId;
  activePath: string;
  onNavigate?: (path: string, route: ConsoleRoute) => void;
  onToggleInspector?: () => void;
}

export function InternalStickySubNav(props: InternalStickySubNavProps): ReactElement {
  const ctx = useConsole();
  const group = findSidebarContext(props.activePath);
  const active = resolveConsoleRoute(props.activePath);
  const dedicatedChat = active?.id === "shells.stage" && active.params.shellPluginId === "builtin.webchat";
  const siblings = group ? CONSOLE_ROUTES_30.filter((route) =>
    findSidebarContext(route.defaultConcretePath ?? route.path)?.item.id === group.item.id
  ) : [];
  const navigate = (route: ConsoleRoute) => {
    const url = route.defaultConcretePath ?? route.path;
    if (props.onNavigate) props.onNavigate(url, route);
    else ctx?.navigateConsole(url);
  };

  return (
    <nav aria-label="当前工作区" className="ai0-internal-sticky-sub-nav" data-chat-navigation={dedicatedChat || undefined}>
      <div className="ai0-workspace-heading">
        <div className="ai0-breadcrumb">
          {group ? renderConsoleIcon(group.item.icon, 14) : null}
          <span>{group?.groupTitle ?? "控制台"}</span>
          {siblings.length <= 1 ? <>
            <span className="ai0-breadcrumb__sep" aria-hidden="true">/</span>
            <span className="ai0-breadcrumb__current">{active?.label ?? "系统概览"}</span>
          </> : null}
        </div>
        {siblings.length > 1 ? (
          <>
            <div className="ai0-workspace-tabs" aria-label="相关页面">
              {siblings.map((route) => {
                const url = route.defaultConcretePath ?? route.path;
                return (
                  <ButtonBase
                    key={route.id}
                    component="a"
                    href={ctx?.getConsoleHref(url) ?? url}
                    aria-current={route.id === active?.id ? "page" : undefined}
                    className="ai0-workspace-tab"
                    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                      if ((!props.onNavigate && !ctx) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      navigate(route);
                    }}
                  >
                    {route.label}
                  </ButtonBase>
                );
              })}
            </div>
            <CompactSelect
              className="ai0-workspace-select"
              ariaLabel="相关页面"
              value={active?.id ?? siblings[0]!.id}
              options={siblings.map((route) => ({ value: route.id, label: route.label }))}
              onChange={(id) => {
                const route = siblings.find((item) => item.id === id);
                if (route) navigate(route);
              }}
            />
          </>
        ) : null}
      </div>
      {!dedicatedChat ? <HoverTooltip content="运行检视" interactiveChild>
        <RippleButton variant="ghost" size="sm" className="ai0-workspace-inspector-button"
          data-open-inspector="trace" ariaLabel="打开或关闭运行检视"
          onClick={props.onToggleInspector ?? ctx?.toggleInspector}>
          {renderConsoleIcon("inspector", 15)}
          <span>运行检视</span>
        </RippleButton>
      </HoverTooltip> : null}
    </nav>
  );
}

export interface MainScrollableBodyProps {
  children?: ReactNode;
  className?: string;
  pathname?: string;
}

export function MainScrollableBody({ children, className, pathname }: MainScrollableBodyProps): ReactElement {
  const [scope, animate] = useAnimate<HTMLElement>();
  const reduced = useReducedMotion();

  useEffect(() => {
    const viewport = scope.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    if (reduced || !pathname) return;
    const animation = animate(viewport, { opacity: [0.78, 1], y: [3, 0] }, { duration: 0.18 });
    return () => { animation.stop(); };
  }, [animate, pathname, reduced, scope]);

  return (
    <section ref={scope} className={"ai0-main-scrollable-body " + (className ?? "")}>
      {children}
    </section>
  );
}

export interface MainRoundedCardOutletProps extends InternalStickySubNavProps {
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function MainRoundedCardOutlet(props: MainRoundedCardOutletProps): ReactElement {
  const route = resolveConsoleRoute(props.activePath);
  return (
    <main
      className={"ai0-main-rounded-card-outlet " + (props.className ?? "")}
      data-domain-id={props.domainId}
      data-workspace-id={route?.id}
    >
      <InternalStickySubNav {...props} />
      <MainScrollableBody pathname={props.activePath}>{props.children}</MainScrollableBody>
      {props.footer ? <footer className="ai0-main-rounded-card-outlet__footer">{props.footer}</footer> : null}
    </main>
  );
}
