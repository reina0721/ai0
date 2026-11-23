import type { RuntimeConsolePage } from "@ai0/protocol";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute } from "./routes.js";

export interface RegisteredPage extends RuntimeConsolePage { pluginId: string; generation?: string }
export function registeredPages(snapshot?: ConsoleLiveSnapshot): RegisteredPage[] {
  const pages = (snapshot?.extensions ?? []).filter(ext => ext.enabled).flatMap(ext =>
    (ext.pages ?? []).map(page => ({ ...page, pluginId: ext.id, generation: ext.generation })));
  return pages.filter(page => !resolveConsoleRoute(page.path) && pages.filter(other => other.path === page.path).length === 1);
}
export function resolvePluginPage(path: string, pages: RegisteredPage[]) {
  if (resolveConsoleRoute(path)) return undefined;
  const canonical = pages.find(page => page.path === path);
  if (canonical) return canonical;
  const aliases = pages.filter(page => page.aliases?.includes(path));
  return aliases.length === 1 ? aliases[0] : undefined;
}
