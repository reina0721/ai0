import type { ConsoleNavigationItem } from "@ai0/sdk";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import type { ReactElement } from "react";

import { renderConsoleIcon } from "../tokens/index.js";
import { CONSOLE_SIDEBAR_GROUPS_16, findSidebarContext, type PrimaryDomainId } from "../../router/routes.js";
import { RippleButton } from "../primitives/index.js";

export type NavRailMode = "mini" | "expanded" | "dual";

export interface PolymorphicNavRailProps {
  mode: NavRailMode;
  activeDomain: PrimaryDomainId;
  activePath?: string;
  extensionLinks?: readonly ConsoleNavigationItem[];
  className?: string;
  onModeChange?: (mode: NavRailMode) => void;
  onNavigate?: (path: string, domain: PrimaryDomainId) => void;
  hrefFor?: (path: string) => string;
}

export function PolymorphicNavRail(props: PolymorphicNavRailProps): ReactElement {
  const mini = props.mode === "mini";
  const currentNavId = props.activePath ? findSidebarContext(props.activePath)?.item.id : undefined;
  const groups = [...CONSOLE_SIDEBAR_GROUPS_16];
  if (props.extensionLinks?.length) groups.push({ id: "plugins", title: "插件页面",
    items: props.extensionLinks.map(link => ({ ...link, domainId: "extensions", icon: "extensions", matchPaths: [] })) });
  return (
    <aside data-mode={props.mode} className={"ai0-polymorphic-nav-rail " + (props.className ?? "")}>
      <div className="ai0-nav-rail__primary">
        {props.onModeChange ? (
          <div className="ai0-nav-toggle">
            <RippleButton variant="ghost" size="sm" className="ai0-icon-button" ariaLabel={mini ? "展开导航" : "折叠导航"}
              onClick={() => props.onModeChange?.(mini ? "expanded" : "mini")}>
              {renderConsoleIcon("sidebar", 16)}
            </RippleButton>
          </div>
        ) : null}
        <nav aria-label="控制台主导航" className="ai0-grouped-navigation">
          {groups.map((group) => (
            <div key={group.id} className="ai0-nav-group" data-nav-group={group.id}>
              {!mini ? <div className="ai0-nav-group__label">{group.title}</div> : null}
              {group.items.map((item) => {
                const active = group.id === "plugins" ? item.path === props.activePath : currentNavId ? currentNavId === item.id : !props.activePath && item.domainId === props.activeDomain;
                const link = (
                  <ButtonBase
                    key={item.id}
                    component="a"
                    href={props.hrefFor?.(item.path) ?? item.path}
                    aria-label={mini ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    data-domain-id={item.domainId}
                    data-nav-path={item.path}
                    className={"ai0-nav-rail__item" + (active ? " is-active" : "")}
                    onClick={(event) => {
                      if (!props.onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      props.onNavigate(item.path, item.domainId);
                    }}
                  >
                    <span className="ai0-nav-rail__indicator" aria-hidden="true" />
                    {renderConsoleIcon(item.icon, 16)}
                    {!mini ? <span className="ai0-client-nav-label">{item.label}</span> : null}
                  </ButtonBase>
                );
                return mini ? (
                  <Tooltip key={item.id} describeChild placement="right" title={<>{item.label}</>}>
                    {link}
                  </Tooltip>
                ) : link;
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
