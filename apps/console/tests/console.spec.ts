import { expect, test } from "@playwright/test";
import { CONSOLE_ROUTES_30 } from "../src/router/routes.js";

test("all console URLs render distinct workspaces on direct load", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  for (const route of CONSOLE_ROUTES_30) {
    await page.goto(route.defaultConcretePath ?? route.path);
    await expect(page.locator("main[data-workspace-id='" + route.id + "']")).toBeVisible();
    await expect(page.locator(".ai0-main-scrollable-body").first()).toBeVisible();
  }
  expect(failures).toEqual([]);
});

test("desktop density, compact navigation, and six theme combinations", async ({ page }) => {
  for (const theme of ["sakura-pink", "astral-blue", "cyber-emerald"]) {
    for (const appearance of ["light", "dark"]) {
      await page.goto("/dashboard?theme=" + theme + "&appearance=" + appearance);
      await expect(page.locator("[data-console-root]")).toHaveAttribute("data-soul-theme", theme);
      await expect(page.locator("[data-console-root]")).toHaveAttribute("data-appearance", appearance);
    }
  }
  await expect(page.locator(".ai0-hybrid-top-bar")).toHaveCSS("height", "48px");
  await expect(page.locator("main")).toHaveCSS("border-top-left-radius", "16px");
  await expect(page.getByRole("navigation", { name: "控制台主导航" }).locator("[data-nav-group]:not([data-nav-group=plugins]) [data-nav-path]")).toHaveCount(16);

  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await expect(page.getByLabel("控制台导航", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭导航", exact: true }).click();
    await page.getByRole("button", { name: "打开或关闭运行检视" }).click();
    await expect(page.getByLabel("运行检视", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭运行检视" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const workspace = await page.locator("main").boundingBox();
    expect(workspace?.width).toBeGreaterThan(viewport.width - (viewport.width < 680 ? 20 : 75));
  }
});

test("keyboard search selects a route with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "搜索页面与扩展" });
  await expect(search).toBeFocused();
  await search.fill("世界书 (Lorebook)");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/soul\/lorebooks/);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("bootstrap retries and a refresh preserves edits behind the route guard", async ({ page }) => {
  let allowBootstrap = false;
  await page.route("**/api/studio/bootstrap?*", async (route) => {
    if (allowBootstrap) await route.continue();
    else await route.fulfill({ status: 503, json: { error: "暂时离线" } });
  });
  await page.goto("/models/providers");
  await expect(page.getByRole("alert")).toContainText("暂时离线");
  allowBootstrap = true;
  await page.getByRole("button", { name: "重新连接" }).click();
  const model = page.locator('input[data-prov-model="prov_deepseek_v3"]');
  await expect(model).toBeEnabled();
  await model.fill("playwright-draft-model");

  const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/admin/v1/snapshot?mode=live"));
  const { ownerToken } = await (await page.request.get("/api/studio/bootstrap")).json();
  expect((await page.request.post("/protocol/v0/shell/perception", { headers: { "x-ai0-owner-token": ownerToken }, data: { text: "这是一条刷新测试消息。", mode: "live" } })).ok()).toBe(true);
  await refreshed;
  await expect(model).toHaveValue("playwright-draft-model");

  await page.getByRole("button", { name: "SANDBOX", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "有未保存的更改" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑" }).click();
  await expect(model).toHaveValue("playwright-draft-model");
  await page.locator('[data-nav-path="/dashboard"]').click();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "放弃更改" }).click();
  await expect(page.locator('main[data-workspace-id="dashboard.overview"]')).toBeVisible();
});
