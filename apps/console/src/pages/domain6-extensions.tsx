import type { ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { CommandsAutomationTab } from "./extensions/CommandsAutomationTab.js";
import { ExtensionMarketTab } from "./extensions/ExtensionMarketTab.js";
import { InstalledPluginsTab } from "./extensions/InstalledPluginsTab.js";
import { McpServersTab } from "./extensions/McpServersTab.js";
import { SkillsWorkbenchTab } from "./extensions/SkillsWorkbenchTab.js";

export interface Domain6ExtensionsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain6ExtensionsPage(props: Domain6ExtensionsPageProps): ReactElement {
  const ctx = useConsole();
  const snapshot = props.snapshot ?? ctx?.snapshot;
  const route = resolveConsoleRoute(props.pathname);

  let content: ReactElement;
  switch (route?.id) {
    case "capabilities.extensions.market":
      content = <ExtensionMarketTab />;
      break;
    case "capabilities.extensions.mcp":
      content = <McpServersTab snapshot={snapshot} />;
      break;
    case "capabilities.extensions.skills":
      content = <SkillsWorkbenchTab snapshot={snapshot} />;
      break;
    case "capabilities.extensions.automation":
      content = <CommandsAutomationTab snapshot={snapshot} />;
      break;
    default:
      content = <InstalledPluginsTab snapshot={snapshot} />;
  }

  return (
    <MainRoundedCardOutlet domainId="capabilities" activePath={props.pathname} onNavigate={props.onNavigate}>
      {content}
    </MainRoundedCardOutlet>
  );
}
