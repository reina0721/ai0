import { writeFile } from "node:fs/promises";
import { CONSOLE_ROUTES_30 } from "../src/router/routes.js";
import { watchBrowser, workspaceGeometry } from "./browser-guard.js";
import { expect, test } from "./console-preferences.js";
import { ROUTE_CONTRACTS, ROUTE_VIEWPORTS, routeProbe } from "./route-contracts.js";

for (const viewport of ROUTE_VIEWPORTS) {
  test(`all 33 distinct workspaces hydrate and fit on ${viewport.name}`, async ({ page, consolePreferences }, testInfo) => {
    test.setTimeout(160_000);
    const registered = CONSOLE_ROUTES_30.map((route) => route.id).sort();
    expect(registered).toHaveLength(33);
    expect(Object.keys(ROUTE_CONTRACTS).sort()).toEqual(registered);
    const browser = watchBrowser(page);
    const report: { id: string; path: string; failures: string[]; geometry?: Awaited<ReturnType<typeof workspaceGeometry>> }[] = [];
    await consolePreferences.set({ appearance: viewport.appearance, soulTheme: viewport.theme });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const route of CONSOLE_ROUTES_30) {
      const path = route.defaultConcretePath ?? route.path;
      const result: (typeof report)[number] = { id: route.id, path, failures: [] };
      report.push(result);
      await test.step(path, async () => {
        try {
          const response = await page.goto(path);
          expect(response?.ok()).toBe(true);
          const root = page.locator("[data-console-root]");
          await expect(root).toHaveAttribute("data-appearance", viewport.appearance);
          await expect(root).toHaveAttribute("data-soul-theme", viewport.theme);
          const main = root.locator(`main[data-workspace-id="${route.id}"]`);
          await expect(main).toHaveCount(1);
          const contract = ROUTE_CONTRACTS[route.id]!;
          await expect(main.getByRole("heading", { level: 1, name: contract.heading, exact: true })).toBeVisible();
          const probe = routeProbe(main, contract.probe);
          await expect(probe).toBeVisible();
          if (contract.probe.enabled) await expect(probe).toBeEnabled();
          await expect(root.locator("select:visible")).toHaveCount(0);
          await expect(main.getByText(/读取失败|暂时无法连接|加载聊天工作区/u)).toHaveCount(0);
          result.geometry = await workspaceGeometry(page);
          expect(Math.max(...Object.values(result.geometry))).toBeLessThanOrEqual(1);
        } catch (error) {
          result.failures.push(error instanceof Error ? error.message : String(error));
        }
        result.failures.push(...browser.takeErrors());
      });
    }

    const output = testInfo.outputPath("route-report.json");
    await writeFile(output, JSON.stringify({ viewport, routes: report }, null, 2), "utf8");
    await testInfo.attach(`route-report-${viewport.name}`, { path: output, contentType: "application/json" });
    expect(report.filter((route) => route.failures.length > 0)).toEqual([]);
  });
}
