import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_PRIMARY_DOMAINS,
  CONSOLE_ROUTES_30,
  DirtyRouteGuard,
  CONSOLE_SOUL_THEMES,
  SOUVEREIGNTY_LOCKED_COLORS,
  RippleButton,
  loadConsoleThemeCss,
  renderConsoleDocumentHtml,
  renderRoutePageView,
  renderToHtml,
  resolveConsoleRoute
} from "./index.js";

describe("ai0 compact Material console", () => {
  it("exposes the design system through its component folders without legacy Kira names", () => {
    const dsRoot = resolve(import.meta.dirname, "design-system");
    expect(existsSync(resolve(dsRoot, "index.tsx"))).toBe(false);

    for (const group of ["primitives", "shell", "domain-visualizers", "composites"]) {
      const files = readdirSync(resolve(dsRoot, group));
      expect(files).toContain("index.ts");
      expect(files.some((file) => /^Kira.*\.tsx$/iu.test(file))).toBe(false);
    }
  });

  it("verifies tonal surfaces, soul themes, locked sovereignty colors, compact controls and accessible button states", () => {
    const css = loadConsoleThemeCss();
    expect(CONSOLE_SOUL_THEMES).toEqual(["sakura-pink", "astral-blue", "cyber-emerald"]);
    expect(SOUVEREIGNTY_LOCKED_COLORS.liveEmerald).toBe("#10B981");
    expect(SOUVEREIGNTY_LOCKED_COLORS.sandboxAmber).toBe("#F59E0B");
    expect(SOUVEREIGNTY_LOCKED_COLORS.sandboxViolet).toBe("#8B5CF6");

    // 5-level tonal surfaces & compact tokens under unified --ai0-* namespace
    expect(css).toContain("--ai0-surface-frame-base");
    expect(css).toContain("--ai0-surface-main-card");
    expect(css).toContain("--ai0-surface-container-low");
    expect(css).toContain("--ai0-surface-container-high");
    expect(css).toContain("--ai0-accent-tint");
    expect(css).toContain("--ai0-ctrl-height-md: 32px");
    expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(css).not.toMatch(/--kira-|\.kira-|KIRAKIRA/i);
    expect(css).not.toMatch(/#000\b|#000000\b|#333\b|#333333\b/i);

    const busyButton = renderToHtml(createElement(RippleButton, { loading: true, ariaLabel: "保存" }));
    expect(busyButton).toContain("MuiButtonBase-root");
    expect(busyButton).toContain('aria-busy="true"');
    expect(busyButton).toContain('disabled=""');
  });

  it("renders all 5 Orthogonal Primary Planes and all canonical routes inside MainRoundedCardOutlet with InternalStickySubNav", async () => {
    expect(CONSOLE_PRIMARY_DOMAINS).toHaveLength(5);
    expect(CONSOLE_ROUTES_30.length).toBeGreaterThanOrEqual(20);

    for (const route of CONSOLE_ROUTES_30) {
      const concretePath = route.defaultConcretePath ?? route.path;
      const resolved = resolveConsoleRoute(concretePath);
      expect(resolved?.id).toBe(route.id);

      const pageHtml = renderToHtml(renderRoutePageView(concretePath));
      expect(pageHtml).toContain("ai0-main-rounded-card-outlet");
      expect(pageHtml).toContain("ai0-internal-sticky-sub-nav");
      expect(pageHtml).toContain("ai0-main-scrollable-body");
    }

    // Legacy paths resolve cleanly to canonical orthogonal routes
    expect(resolveConsoleRoute("/models/providers")?.path).toBe("/integrations/providers");
    expect(resolveConsoleRoute("/channels/topology")?.path).toBe("/integrations/platforms");
    expect(resolveConsoleRoute("/profiles/rules")?.path).toBe("/config/routing");
    expect(resolveConsoleRoute("/channels/media-pipeline")?.path).toBe("/capabilities/multimodal");

    // DirtyRouteGuard check
    const guard = new DirtyRouteGuard({ hasUnsavedChanges: true });
    expect(await guard.canTransition("/capabilities/memory")).toBe(false);
    expect(await guard.canTransition("/capabilities/memory", "discard")).toBe(true);

    // Without a plugin snapshot even old bookmarks must resolve to the unavailable page.
    const webchatDoc = renderConsoleDocumentHtml({
      pathname: "/channels/stage/builtin.webchat",
      soulTheme: "sakura-pink",
      mode: "live",
      inspectorMode: "trace"
    });
    expect(webchatDoc).toContain("页面不可用");
    expect(webchatDoc).toContain("ai0-main-rounded-card-outlet");

    const sandboxDoc = renderConsoleDocumentHtml({
      pathname: "/sandbox/lab",
      soulTheme: "astral-blue",
      mode: "sandbox",
      inspectorMode: "sandbox-diff"
    });
    expect(sandboxDoc).toContain("data-sovereignty-mode=\"sandbox\"");
    expect(sandboxDoc).toContain("data-soul-theme=\"astral-blue\"");
  });
});
