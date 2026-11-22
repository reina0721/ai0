import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_PRIMARY_DOMAINS,
  CONSOLE_ROUTES_30,
  DirtyRouteGuard,
  CONSOLE_SOUL_THEMES,
  SOUVEREIGNTY_LOCKED_COLORS,
  computePointerRippleGeometry,
  loadConsoleThemeCss,
  renderConsoleDocumentHtml,
  renderRoutePageView,
  renderToHtml,
  resolveConsoleRoute
} from "./index.js";

describe("Milestone M6 Quality Audit: ai0 Console Design System (Refined Compact MD3), 5 Subdirectories (45 Components), and 8 Domains × 30+ Sub-Routes", () => {
  it("enforces 5 modular design-system subdirectories with 10 semantic primitives (zero legacy Kira* prefixes), 7 shell, 16 domain-visualizers, and 12 composites", () => {
    const dsRoot = resolve(import.meta.dirname, "design-system");
    expect(existsSync(resolve(dsRoot, "index.tsx"))).toBe(false);

    const primitiveFiles = readdirSync(resolve(dsRoot, "primitives")).filter((f) => f.endsWith(".tsx"));
    const shellFiles = readdirSync(resolve(dsRoot, "shell")).filter((f) => f.endsWith(".tsx"));
    const visualizerFiles = readdirSync(resolve(dsRoot, "domain-visualizers")).filter((f) => f.endsWith(".tsx"));
    const compositeFiles = readdirSync(resolve(dsRoot, "composites")).filter((f) => f.endsWith(".tsx"));

    expect(primitiveFiles).toHaveLength(10);
    expect(primitiveFiles.every((f) => !/^Kira/i.test(f))).toBe(true);
    expect(shellFiles).toHaveLength(7);
    expect(visualizerFiles).toHaveLength(16);
    expect(compositeFiles).toHaveLength(12);
    expect(primitiveFiles.length + shellFiles.length + visualizerFiles.length + compositeFiles.length).toBe(45);
  });

  it("verifies OKLCH 5-level tonal surfaces, 3 soul themes, locked sovereignty colors, unified --ai0-* namespace, zero dead #000/#333, and pointer-origin ripple physics", () => {
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

    // Pointer-origin ripple geometry calculation
    const ripple = computePointerRippleGeometry(130, 62, {
      left: 100,
      top: 50,
      width: 120,
      height: 32
    });
    expect(ripple.x).toBe(30);
    expect(ripple.y).toBe(12);
    expect(ripple.radius).toBeGreaterThan(90);
  });

  it("renders all 8 Primary Domains and all 30+ Dedicated Sub-Routes inside MainRoundedCardOutlet with InternalStickySubNav", async () => {
    expect(CONSOLE_PRIMARY_DOMAINS).toHaveLength(8);
    expect(CONSOLE_ROUTES_30.length).toBeGreaterThanOrEqual(30);

    for (const route of CONSOLE_ROUTES_30) {
      const concretePath = route.defaultConcretePath ?? route.path;
      const resolved = resolveConsoleRoute(concretePath);
      expect(resolved?.id).toBe(route.id);

      const pageHtml = renderToHtml(renderRoutePageView(concretePath));
      expect(pageHtml).toContain("ai0-main-rounded-card-outlet");
      expect(pageHtml).toContain("ai0-internal-sticky-sub-nav");
      expect(pageHtml).toContain("ai0-main-scrollable-body");
    }

    // DirtyRouteGuard check
    const guard = new DirtyRouteGuard({ hasUnsavedChanges: true });
    expect(await guard.canTransition("/memory/lineage")).toBe(false);
    expect(await guard.canTransition("/memory/lineage", "discard")).toBe(true);

    // Full document render check for WebChat stage and Sandbox lab
    const webchatDoc = renderConsoleDocumentHtml({
      pathname: "/shells/stage/builtin.webchat",
      soulTheme: "sakura-pink",
      mode: "live",
      inspectorMode: "trace"
    });
    expect(webchatDoc).toContain("builtin.webchat");
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
