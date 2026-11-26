import { createElement, type ReactElement } from "react";

import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { CapabilitiesMultimodalPage } from "./capabilities-multimodal-page.js";
import { ConfigProfilesPage } from "./config-profiles-page.js";
import { Domain1DashboardPage } from "./domain1-dashboard.js";
import { Domain3SoulPage } from "./domain3-soul.js";
import { Domain4MemoryPage } from "./domain4-memory.js";
import { Domain6ExtensionsPage } from "./domain6-extensions.js";
import { Domain7RuntimePage } from "./domain7-runtime.js";
import { Domain8SystemPage } from "./domain8-system.js";
import { IntegrationsPlatformsPage } from "./integrations-platforms-page.js";
import { IntegrationsProvidersPage } from "./integrations-providers-page.js";

export * from "./capabilities-multimodal-page.js";
export * from "./config-profiles-page.js";
export * from "./domain1-dashboard.js";
export * from "./domain2-channels.js";
export * from "./domain3-soul.js";
export * from "./domain4-memory.js";
export * from "./domain5-models.js";
export * from "./domain6-extensions.js";
export * from "./domain7-runtime.js";
export * from "./domain8-system.js";
export * from "./integrations-platforms-page.js";
export * from "./integrations-providers-page.js";

export function renderRoutePageView(
  pathname: string,
  snapshot?: ConsoleLiveSnapshot,
  onNavigate?: (path: string, route?: ConsoleRoute) => void
): ReactElement {
  const route = resolveConsoleRoute(pathname);
  if (!route) {
    return createElement(
      "main",
      { className: "ai0-main-rounded-card-outlet" },
      createElement("h1", null, "页面不可用"),
      createElement("p", null, pathname)
    );
  }

  switch (route.id) {
    // 1. Overview & Chat
    case "overview.dashboard":
    case "overview.conversations":
      return createElement(Domain1DashboardPage, { pathname: route.pathname, snapshot, onNavigate });

    // 2. Core Configuration
    case "config.profiles":
    case "config.routing":
      return createElement(ConfigProfilesPage, { pathname: route.pathname, snapshot, onNavigate });
    case "config.blackboard":
      return createElement(Domain1DashboardPage, { pathname: route.pathname, snapshot, onNavigate });
    case "config.persona":
    case "config.distiller":
    case "config.lorebooks":
    case "config.homeostasis":
      return createElement(Domain3SoulPage, { pathname: route.pathname, snapshot, onNavigate });

    // 3. General Capabilities
    case "capabilities.memory":
    case "capabilities.sleep":
    case "capabilities.relationship":
    case "capabilities.events":
    case "capabilities.knowledge":
      return createElement(Domain4MemoryPage, { pathname: route.pathname, snapshot, onNavigate });
    case "capabilities.multimodal":
      return createElement(CapabilitiesMultimodalPage, { pathname: route.pathname, snapshot, onNavigate });
    case "capabilities.extensions":
    case "capabilities.extensions.market":
    case "capabilities.extensions.mcp":
    case "capabilities.extensions.skills":
    case "capabilities.extensions.automation":
      return createElement(Domain6ExtensionsPage, { pathname: route.pathname, snapshot, onNavigate });
    case "capabilities.agents":
      return createElement(Domain7RuntimePage, { pathname: route.pathname, snapshot, onNavigate });

    // 4. External Integrations (Pure Resource Pools)
    case "integrations.providers":
      return createElement(IntegrationsProvidersPage, { pathname: route.pathname, snapshot, onNavigate });
    case "integrations.platforms":
      return createElement(IntegrationsPlatformsPage, { pathname: route.pathname, snapshot, onNavigate });

    // 5. Observability & System
    case "system.observability":
    case "system.sandbox":
    case "system.simulator":
      return createElement(Domain7RuntimePage, { pathname: route.pathname, snapshot, onNavigate });
    case "system.settings":
    case "system.security":
    case "system.compliance":
      return createElement(Domain8SystemPage, { pathname: route.pathname, snapshot, onNavigate });

    default:
      return createElement(
        "main",
        { className: "ai0-main-rounded-card-outlet" },
        createElement("h1", null, "页面不可用"),
        createElement("p", null, pathname)
      );
  }
}
