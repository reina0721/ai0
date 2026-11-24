import type { ReactElement } from "react";

import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { ConfigProfilesPage } from "./config-profiles-page.js";
import { IntegrationsProvidersPage } from "./integrations-providers-page.js";

export interface Domain5ModelsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain5ModelsPage(props: Domain5ModelsPageProps): ReactElement {
  const route = resolveConsoleRoute(props.pathname);
  if (route?.id === "config.profiles") {
    return <ConfigProfilesPage {...props} />;
  }
  return <IntegrationsProvidersPage {...props} />;
}
