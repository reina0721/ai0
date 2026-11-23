import { createElement, type ReactElement } from "react";

import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { Domain1DashboardPage } from "./domain1-dashboard.js";
import { Domain2ShellsPage } from "./domain2-shells.js";
import { Domain3SoulPage } from "./domain3-soul.js";
import { Domain4MemoryPage } from "./domain4-memory.js";
import { Domain5ModelsPage } from "./domain5-models.js";
import { Domain6ExtensionsPage } from "./domain6-extensions.js";
import { Domain7RuntimePage } from "./domain7-runtime.js";
import { Domain8SystemPage } from "./domain8-system.js";

export * from "./domain1-dashboard.js";
export * from "./domain2-shells.js";
export * from "./domain3-soul.js";
export * from "./domain4-memory.js";
export * from "./domain5-models.js";
export * from "./domain6-extensions.js";
export * from "./domain7-runtime.js";
export * from "./domain8-system.js";

export function renderRoutePageView(
  pathname: string,
  snapshot?: ConsoleLiveSnapshot,
  onNavigate?: (path: string, route?: ConsoleRoute) => void
): ReactElement {
  const route = resolveConsoleRoute(pathname);
  switch (route?.domainId) {
    case "shells":
      return createElement(Domain2ShellsPage, { pathname, snapshot, onNavigate });
    case "soul":
      return createElement(Domain3SoulPage, { pathname, snapshot, onNavigate });
    case "memory":
      return createElement(Domain4MemoryPage, { pathname, snapshot, onNavigate });
    case "models":
      return createElement(Domain5ModelsPage, { pathname, snapshot, onNavigate });
    case "extensions":
      return createElement(Domain6ExtensionsPage, { pathname, snapshot, onNavigate });
    case "runtime":
      return createElement(Domain7RuntimePage, { pathname, snapshot, onNavigate });
    case "system":
      return createElement(Domain8SystemPage, { pathname, snapshot, onNavigate });
    default:
      return createElement("main", { className: "ai0-main-rounded-card-outlet" }, createElement("h1", null, "页面不可用"), createElement("p", null, pathname));
    case "dashboard":
      return createElement(Domain1DashboardPage, {
        pathname: route?.pathname ?? "/dashboard",
        snapshot,
        onNavigate
      });
  }
}
