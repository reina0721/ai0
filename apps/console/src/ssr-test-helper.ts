import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderConsoleApp, type ConsoleAppOptions } from "./app-shell.js";

export function loadConsoleThemeCss(): string {
  return [
    "./design-system/tokens/console-theme.css",
    "./design-system/primitives/controls.css",
    "./design-system/domain-surfaces.css",
    "./console-layout.css",
    "./pages/workspaces.css"
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
}

export function renderToHtml(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function renderConsoleDocumentHtml(options: ConsoleAppOptions = {}): string {
  const markup = renderToStaticMarkup(renderConsoleApp(options));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>ai0 · Console</title><style id="ai0-console-theme-css">${loadConsoleThemeCss()}</style></head><body><div id="root">${markup}</div></body></html>`;
}
