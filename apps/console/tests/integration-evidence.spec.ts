import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Page } from "@playwright/test";

import { CONSOLE_ROUTES_30 } from "../src/router/routes.js";
import { watchBrowser, workspaceGeometry } from "./browser-guard.js";
import { expect, test } from "./console-preferences.js";
import { ROUTE_CONTRACTS, ROUTE_VIEWPORTS, routeProbe } from "./route-contracts.js";

const phase = process.env.AI0_UI_EVIDENCE_PHASE;
const evidence = process.env.AI0_UI_EVIDENCE_DIR;
const captureTime = "2026-11-23T00:00:00+08:00";

test.use({ timezoneId: "Asia/Shanghai" });

async function screenshot(page: Page, path: string) {
  await page.screenshot({ path, animations: "disabled", caret: "hide", scale: "css" });
}

async function inspectSelectors(page: Page) {
  const root = page.locator("[data-console-root]");
  const triggers = root.locator(":is(.ai0-select__field, .MuiSelect-select):visible");
  const controls: { label: string; kind: "native" | "listbox"; disabled: boolean; opened: boolean; options?: number; issue?: string }[] = [];
  const viewport = page.viewportSize()!;
  for (let index = 0, count = await triggers.count(); index < count; index++) {
    const trigger = triggers.nth(index);
    const control: (typeof controls)[number] = await trigger.evaluate((element) => {
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/u)[0];
      const label = element.getAttribute("aria-label")
        ?? (labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : undefined)
        ?? (element instanceof HTMLSelectElement ? element.labels?.item(0)?.textContent?.trim() : undefined)
        ?? element.getAttribute("id")
        ?? "(unnamed)";
      return {
        label,
        kind: element.tagName === "SELECT" ? "native" : "listbox",
        disabled: element.matches(':disabled,[aria-disabled="true"]'),
        opened: false
      };
    });
    controls.push(control);
    if (control.kind === "native" || control.disabled) continue;
    try {
      await trigger.click({ timeout: 4000 });
      const listbox = root.getByRole("listbox");
      await expect(listbox).toBeVisible({ timeout: 4000 });
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(listbox).toHaveAttribute("id", (await trigger.getAttribute("aria-controls"))!);
      control.opened = true;
      control.options = await listbox.getByRole("option").count();
      expect(control.options).toBeGreaterThan(0);
      const bounds = (await listbox.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.keyboard.press("Escape");
      await expect(listbox).toBeHidden({ timeout: 4000 });
    } catch (error) {
      control.issue = error instanceof Error ? error.message : String(error);
      await page.keyboard.press("Escape");
    }
  }
  return controls;
}

test("capture production workspace comparisons and selector evidence", async ({ page, consolePreferences }, testInfo) => {
  test.skip(!phase && !evidence, "Visual evidence capture is opt-in");
  test.setTimeout(320_000);
  if ((phase !== "before" && phase !== "after") || !evidence || !isAbsolute(evidence) || !process.env.AI0_TEST_BUILD_DIR) {
    throw new Error("Set AI0_UI_EVIDENCE_PHASE (before or after), AI0_UI_EVIDENCE_DIR (absolute path), and AI0_TEST_BUILD_DIR.");
  }
  await page.clock.setFixedTime(new Date(captureTime));

  const out = join(evidence, phase);
  await mkdir(join(out, "desktop"), { recursive: true });
  await mkdir(join(out, "mobile"), { recursive: true });
  await mkdir(join(out, "interactions"), { recursive: true });
  const browser = watchBrowser(page);
  const report: {
    routes: {
      id: string;
      path: string;
      viewport: string;
      screenshot?: string;
      ready: boolean;
      nativeSelects?: string[];
      selectors?: Awaited<ReturnType<typeof inspectSelectors>>;
      geometry?: Awaited<ReturnType<typeof workspaceGeometry>>;
      issues: string[];
    }[];
    interactions: { id: string; kind: "native" | "listbox" | "drawer" | "focused" | "disabled" | "unavailable"; screenshot?: string; issues: string[] }[];
  } = { routes: [], interactions: [] };

  for (const viewport of ROUTE_VIEWPORTS) {
    await consolePreferences.set({ appearance: viewport.appearance, soulTheme: viewport.theme });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of CONSOLE_ROUTES_30) {
      const path = route.defaultConcretePath ?? route.path;
      const entry: (typeof report.routes)[number] = { id: route.id, path, viewport: viewport.name, ready: false, issues: [] };
      report.routes.push(entry);
      await test.step(`${viewport.name} ${path}`, async () => {
        try {
          const response = await page.goto(path);
          expect(response?.ok()).toBe(true);
          const main = page.locator(`main[data-workspace-id="${route.id}"]`);
          const contract = ROUTE_CONTRACTS[route.id]!;
          await expect(main.getByRole("heading", { level: 1, name: contract.heading, exact: true })).toBeVisible();
          const probe = routeProbe(main, contract.probe);
          await expect(probe).toBeVisible({ timeout: 4000 });
          if (contract.probe.enabled) await expect(probe).toBeEnabled({ timeout: 4000 });
          entry.ready = true;
        } catch (error) {
          entry.issues.push(error instanceof Error ? error.message : String(error));
        }
        try {
          entry.nativeSelects = await page.locator("[data-console-root] select:visible").evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("aria-label") ?? element.getAttribute("id") ?? element.getAttribute("name") ?? "(unnamed)"));
          entry.geometry = await workspaceGeometry(page);
          entry.screenshot = `${viewport.name}/${route.id}.png`;
          await screenshot(page, join(out, entry.screenshot));
          entry.selectors = await inspectSelectors(page);
        } catch (error) {
          entry.issues.push(error instanceof Error ? error.message : String(error));
        }
        entry.issues.push(...browser.takeErrors());
      });
    }
  }

  const themeCases = (["sakura-pink", "astral-blue", "cyber-emerald"] as const).flatMap((soulTheme) =>
    (["light", "dark"] as const).map((appearance) => ({
      id: soulTheme === "astral-blue" && appearance === "dark" ? "desktop-theme" : `desktop-theme-${soulTheme}-${appearance}`,
      path: "/dashboard",
      appearance,
      soulTheme,
      label: "Soul 配色",
      width: 1440,
      height: 900
    }))
  );
  for (const interaction of [
    ...themeCases,
    { id: "mobile-related-pages", path: "/soul/homeostasis", appearance: "dark", soulTheme: "astral-blue", label: "相关页面", width: 390, height: 844 },
    { id: "desktop-model-routing", path: "/models/routing", appearance: "dark", soulTheme: "astral-blue",
      field: '[data-route-primary="W1_fast_dialogue"]', width: 1440, height: 900 },
    { id: "desktop-simulator-audience", path: "/shells/simulator?mode=sandbox", appearance: "light", soulTheme: "astral-blue",
      label: "受众", width: 1440, height: 900 },
    { id: "mobile-simulator-audience", path: "/shells/simulator?mode=sandbox", appearance: "dark", soulTheme: "astral-blue",
      label: "受众", width: 390, height: 844 }
  ] as const) {
    const entry: (typeof report.interactions)[number] = { id: interaction.id, kind: "unavailable", issues: [] };
    report.interactions.push(entry);
    await test.step(interaction.id, async () => {
      try {
        await page.setViewportSize({ width: interaction.width, height: interaction.height });
        await consolePreferences.set({ appearance: interaction.appearance, soulTheme: interaction.soulTheme });
        await page.goto(interaction.path);
        const root = page.locator("[data-console-root]");
        await expect(root).toHaveAttribute("data-appearance", interaction.appearance);
        await expect(root).toHaveAttribute("data-soul-theme", interaction.soulTheme);
        const trigger = "field" in interaction && interaction.field !== undefined ? root.locator(interaction.field) :
          root.getByRole("combobox", { name: interaction.label, exact: true });
        await expect(trigger).toBeEnabled();
        await trigger.scrollIntoViewIfNeeded();
        const native = await trigger.evaluate((element) => element.tagName === "SELECT");
        if (native) {
          entry.kind = "native";
        } else {
          await trigger.click();
          const listbox = root.getByRole("listbox");
          await expect(listbox).toBeVisible();
          const matchesTheme = await listbox.evaluate((element) => {
            const surface = getComputedStyle(element.closest(".MuiMenu-paper")!);
            const probe = document.createElement("span");
            probe.hidden = true;
            probe.style.color = "var(--ai0-on-surface)";
            probe.style.backgroundColor = "var(--ai0-surface-main-card)";
            element.closest("[data-console-root]")!.append(probe);
            const expected = getComputedStyle(probe);
            const matches = surface.color === expected.color && surface.backgroundColor === expected.backgroundColor;
            probe.remove();
            return matches;
          });
          expect(matchesTheme).toBe(true);
          entry.kind = "listbox";
        }
        entry.screenshot = `interactions/${interaction.id}.png`;
        await screenshot(page, join(out, entry.screenshot));
        if (!native) await page.keyboard.press("Escape");
      } catch (error) {
        entry.issues.push(error instanceof Error ? error.message : String(error));
      }
      entry.issues.push(...browser.takeErrors());
    });
  }

  await consolePreferences.set({ appearance: "dark", soulTheme: "astral-blue", inspectorView: "trace" });
  for (const state of [
    { id: "keyboard-select-focus", mode: "focused", path: "/models/routing" },
    { id: "sandbox-disabled-select", mode: "disabled", path: "/models/routing?mode=sandbox" }
  ] as const) {
    const entry: (typeof report.interactions)[number] = { id: state.id, kind: "unavailable", issues: [] };
    report.interactions.push(entry);
    await test.step(state.id, async () => {
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(state.path);
        const root = page.locator("[data-console-root]");
        const trigger = root.locator('[data-route-primary="W1_fast_dialogue"]');
        await trigger.scrollIntoViewIfNeeded();
        if (state.mode === "focused") {
          await page.keyboard.press("Tab");
          await trigger.focus();
          await expect(trigger).toBeFocused();
        } else {
          await expect(trigger).toBeDisabled();
          await trigger.dispatchEvent("keydown", { key: "ArrowDown" });
          await expect(root.getByRole("listbox")).toHaveCount(0);
        }
        entry.kind = state.mode;
        entry.screenshot = `interactions/${state.id}.png`;
        await screenshot(page, join(out, entry.screenshot));
      } catch (error) {
        entry.issues.push(error instanceof Error ? error.message : String(error));
      }
      entry.issues.push(...browser.takeErrors());
    });
  }

  for (const drawer of [
    { id: "tablet-navigation", trigger: "打开导航", label: "控制台导航", close: "关闭导航" },
    { id: "tablet-inspector", trigger: "打开或关闭运行检视", label: "运行检视", close: "关闭运行检视" }
  ]) {
    const entry: (typeof report.interactions)[number] = { id: drawer.id, kind: "unavailable", issues: [] };
    report.interactions.push(entry);
    await test.step(drawer.id, async () => {
      try {
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.goto("/dashboard");
        const root = page.locator("[data-console-root]");
        await root.getByRole("button", { name: drawer.trigger, exact: true }).click();
        await expect(root.getByLabel(drawer.label, { exact: true })).toBeVisible();
        entry.kind = "drawer";
        entry.screenshot = `interactions/${drawer.id}.png`;
        await screenshot(page, join(out, entry.screenshot));
        await root.getByRole("button", { name: drawer.close, exact: true }).click();
        await expect(root.getByLabel(drawer.label, { exact: true })).toBeHidden();
      } catch (error) {
        entry.issues.push(error instanceof Error ? error.message : String(error));
      }
      entry.issues.push(...browser.takeErrors());
    });
  }

  const output = join(out, "route-report.json");
  await writeFile(output, JSON.stringify({ phase, captureTime, ...report }, null, 2), "utf8");
  await testInfo.attach(`route-report-${phase}`, { path: output, contentType: "application/json" });
  if (phase === "after") {
    expect(report.routes.filter(({ issues, nativeSelects, selectors, geometry, ready }) =>
      !ready || issues.length || nativeSelects?.length || !geometry || Object.values(geometry).some((overflow) => overflow > 1)
      || selectors?.some((control) => control.issue || (control.kind !== "listbox" || (!control.disabled && !control.opened))))).toEqual([]);
    expect(report.interactions.filter(({ kind, issues }) => kind === "native" || kind === "unavailable" || issues.length)).toEqual([]);
  }
});
