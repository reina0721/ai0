import type { Page, Response } from "@playwright/test";
import { expect, test, type ConsolePreferences } from "./console-preferences.js";

const settingsPath = "/api/admin/v1/system/settings";
const rootSelector = "[data-console-root]";
const initialPreferences: ConsolePreferences = {
  appearance: "light",
  soulTheme: "sakura-pink",
  navRailMode: "expanded",
  inspectorView: "trace"
};

function isSettingsWrite(response: Response) {
  return response.request().method() === "PATCH" && new URL(response.url()).pathname === settingsPath;
}

async function selectPreference(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

test("shared controls persist without presentation parameters and remain read-only in sandbox", async ({
  browser, page, consolePreferences
}) => {
  await consolePreferences.set(initialPreferences);
  await page.goto("/system/security");
  const root = page.locator(rootSelector);
  const firstWrite = page.waitForResponse(isSettingsWrite);
  await page.locator('[data-set-appearance="dark"]').click();
  expect((await firstWrite).ok()).toBe(true);
  await selectPreference(page, "主题色", "星蓝");
  await selectPreference(page, "导航栏布局", "加宽");
  const finalWrite = page.waitForResponse((response) => isSettingsWrite(response) &&
    response.request().postDataJSON().inspectorView === "sandbox-diff");
  await selectPreference(page, "运行检视类型", "沙盒 A/B 对照");
  expect((await finalWrite).ok()).toBe(true);
  expect(await consolePreferences.read()).toEqual({
    appearance: "dark", soulTheme: "astral-blue", navRailMode: "dual", inspectorView: "sandbox-diff"
  });
  await expect(page).toHaveURL(/\/system\/security$/u);

  await page.reload();
  await expect(root).toHaveAttribute("data-appearance", "dark");
  await expect(root).toHaveAttribute("data-soul-theme", "astral-blue");
  await expect(root).toHaveAttribute("data-nav-rail-mode", "dual");
  await expect(root).toHaveAttribute("data-inspector-mode", "mini");

  const session = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const sandbox = await session.newPage();
    await sandbox.addInitScript(() => localStorage.setItem("ai0_appearance", "light"));
    await sandbox.goto("/system/security?mode=sandbox&trace=example&conversation=recent&theme=sakura-pink" +
      "&soulTheme=cerasus-pink&appearance=light&rail=mini&navRailMode=expanded&inspector=trace&inspectorMode=trace#details");
    await expect(sandbox).toHaveURL(/\/system\/security\?mode=sandbox&trace=example&conversation=recent#details$/u);
    const sandboxRoot = sandbox.locator(rootSelector);
    await expect(sandboxRoot).toHaveAttribute("data-sovereignty-mode", "sandbox");
    await expect(sandboxRoot).toHaveAttribute("data-appearance", "dark");
    await expect(sandboxRoot).toHaveAttribute("data-soul-theme", "astral-blue");
    await expect(sandboxRoot).toHaveAttribute("data-nav-rail-mode", "dual");
    await expect(sandbox.locator('[data-set-appearance="light"]')).toBeDisabled();
    for (const name of ["主题色", "导航栏布局", "运行检视类型", "Soul 配色"]) {
      await expect(sandbox.getByRole("combobox", { name, exact: true })).toBeDisabled();
    }
    await expect(sandbox.getByRole("button", { name: "切换浅色或深色外观" })).toBeDisabled();
    await expect(sandbox.getByRole("button", { name: "折叠导航" })).toBeDisabled();

    await sandbox.setViewportSize({ width: 390, height: 844 });
    const inspector = sandbox.getByLabel("运行检视", { exact: true });
    const inspectorButton = sandbox.getByRole("button", { name: "打开或关闭运行检视" });
    await expect(inspector).toBeHidden();
    await inspectorButton.click();
    await expect(inspector.getByRole("heading", { name: "沙盒 A/B 对照" })).toBeVisible();
    await sandbox.reload();
    await expect(inspector).toBeHidden();
    await expect(inspectorButton).toHaveAttribute("data-open-inspector", "sandbox-diff");
    await inspectorButton.click();
    await expect(inspector.getByRole("heading", { name: "沙盒 A/B 对照" })).toBeVisible();
    await inspector.getByRole("button", { name: "关闭运行检视" }).click();
    await expect(inspector).toBeHidden();
    await expect(sandbox).toHaveURL(/\/system\/security\?mode=sandbox&trace=example&conversation=recent#details$/u);

    const externalChange = page.waitForResponse(isSettingsWrite);
    await page.locator('[data-set-appearance="light"]').click();
    expect((await externalChange).ok()).toBe(true);
    await expect(sandboxRoot).toHaveAttribute("data-appearance", "light", { timeout: 12_000 });
  } finally {
    await session.close();
  }
});

test("rapid changes save in order and a failed change rolls back only its own field", async ({ page, consolePreferences }) => {
  await consolePreferences.set(initialPreferences);
  const writes: Partial<ConsolePreferences>[] = [];
  let releaseFirst = () => {};
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route((url) => url.pathname === settingsPath, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes.push(route.request().postDataJSON());
    if (writes.length !== 1) return route.continue();
    await firstMayFinish;
    await route.fulfill({ status: 503, json: { error: "PREFERENCES_UNAVAILABLE" } });
  });

  const root = page.locator(rootSelector);
  const appearance = page.getByRole("button", { name: "切换浅色或深色外观" });
  await page.goto("/dashboard");
  try {
    await appearance.click();
    await expect(root).toHaveAttribute("data-appearance", "dark");
    await expect.poll(() => writes).toEqual([{ appearance: "dark" }]);
    await page.getByRole("button", { name: "折叠导航" }).click();
    await expect(root).toHaveAttribute("data-nav-rail-mode", "mini");
    expect(writes).toEqual([{ appearance: "dark" }]);
  } finally {
    releaseFirst();
  }

  await expect(page.locator(".ai0-console-notification")).toContainText("保存控制台偏好失败");
  await expect(root).toHaveAttribute("data-appearance", "light");
  await expect(root).toHaveAttribute("data-nav-rail-mode", "mini");
  await expect.poll(() => consolePreferences.read()).toEqual({ ...initialPreferences, navRailMode: "mini" });
  expect(writes).toEqual([{ appearance: "dark" }, { navRailMode: "mini" }]);
  await expect(page).toHaveURL(/\/dashboard$/u);
});
