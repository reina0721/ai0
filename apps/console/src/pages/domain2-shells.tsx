import type { ReactElement } from "react";

import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { ConfigProfilesPage } from "./config-profiles-page.js";
import { IntegrationsPlatformsPage } from "./integrations-platforms-page.js";

export interface Domain2ShellsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain2ShellsPage(props: Domain2ShellsPageProps): ReactElement {
  const route = resolveConsoleRoute(props.pathname);
  if (route?.id === "config.routing" || route?.id === "config.profiles") {
    return <ConfigProfilesPage {...props} />;
  }
  return <IntegrationsPlatformsPage {...props} />;
}
