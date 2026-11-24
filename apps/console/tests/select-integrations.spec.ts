import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./console-preferences.js";

import { watchBrowser } from "./browser-guard.js";

async function expectListbox(root: Locator, trigger: Locator, page: Page) {
  await expect(trigger).toHaveAttribute("role", "combobox");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const listbox = root.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveAttribute("id", (await trigger.getAttribute("aria-controls"))!);
  await expect(listbox.getByRole("option", { selected: true })).toHaveCount(1);
  await expect(root.locator("select:visible")).toHaveCount(0);

  const colors = await listbox.evaluate((element) => {
    const paper = element.closest(".MuiMenu-paper, .MuiPopover-paper")!;
    const scope = element.closest("[data-console-root]")!;
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.color = "var(--ai0-on-surface)";
    probe.style.backgroundColor = "var(--ai0-surface-main-card)";
    scope.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(paper);
    const result = { expected: [expected.color, expected.backgroundColor], actual: [actual.color, actual.backgroundColor] };
    probe.remove();
    return result;
  });
  expect(colors.actual).toEqual(colors.expected);
  const bounds = await listbox.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  return listbox;
}

test("dark shell select opens a themed listbox, takes keyboard selection, and restores focus", async ({ page, consolePreferences }) => {
  const browser = watchBrowser(page);
  await consolePreferences.set({ appearance: "dark", soulTheme: "astral-blue" });
  await page.goto("/dashboard");
  const root = page.locator("[data-console-root]");
  await expect(root.getByRole("combobox", { name: "Soul 配色", exact: true })).toBeVisible();
  const trigger = root.locator('[role="combobox"][aria-label="Soul 配色"]');
  await trigger.focus();
  await trigger.press("Space");
  const listbox = await expectListbox(root, trigger, page);
  const current = listbox.getByRole("option", { name: "星蓝", exact: true });
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: "翠绿", exact: true })).toBeFocused();
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" &&
    new URL(response.url()).pathname === "/api/admin/v1/system/settings");
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("翠绿");
  await expect(root).toHaveAttribute("data-soul-theme", "cyber-emerald");
  expect((await saved).ok()).toBe(true);
  expect(browser.takeErrors()).toEqual([]);
});

test.describe("touch Select and responsive portal", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("related-page selector uses an on-screen listbox and navigates by tapping an option", async ({ page, consolePreferences }) => {
    const browser = watchBrowser(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await consolePreferences.set({ appearance: "dark", soulTheme: "astral-blue" });
    await page.goto("/soul/homeostasis");
    const root = page.locator("[data-console-root]");
    await expect(root.getByRole("combobox", { name: "相关页面", exact: true })).toBeVisible();
    const trigger = root.locator('[role="combobox"][aria-label="相关页面"]');
    await trigger.tap();
    const listbox = await expectListbox(root, trigger, page);
    await listbox.getByRole("option", { name: /世界书/u }).tap();
    await expect(page).toHaveURL(/\/soul\/lorebooks$/u);
    await expect(root.getByRole("heading", { level: 1, name: "世界书", exact: true })).toBeVisible();
    await expect(listbox).toBeHidden();
    expect(browser.takeErrors()).toEqual([]);
  });
});

test("a nested configuration selector changes its field and Escape dismisses just the top layer", async ({ page, consolePreferences }) => {
  const browser = watchBrowser(page);
  await consolePreferences.set({ appearance: "dark", soulTheme: "cyber-emerald" });
  await page.goto("/dashboard");
  const root = page.locator("[data-console-root]");
  const start = root.locator('main [data-open-onboarding="true"]');
  await start.click();
  const onboarding = root.getByRole("dialog", { name: "初始化配置", exact: true });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByRole("combobox", { name: /^服务商预设/u })).toBeVisible();
  const provider = root.locator("#onb-provider-id");
  await provider.press("Space");
  const listbox = await expectListbox(root, provider, page);
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(onboarding).toBeVisible();
  await expect(provider).toBeFocused();

  await provider.click();
  await listbox.getByRole("option", { name: /Ollama 本地模型/u }).click();
  await expect(onboarding.getByRole("textbox", { name: "API Base URL" })).toHaveValue(/127\.0\.0\.1:11434/u);
  await expect(provider).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(onboarding).toBeHidden();
  await expect(start).toBeFocused();
  expect(browser.takeErrors()).toEqual([]);
});

test("runtime configuration selector retains its stable marker and disables saved configuration in sandbox", async ({ page, consolePreferences }) => {
  const browser = watchBrowser(page);
  await consolePreferences.set({ appearance: "dark" });
  await page.goto("/models/routing?mode=sandbox");
  const root = page.locator("[data-console-root]");
  const primary = root.locator('[data-route-primary="W1_fast_dialogue"]');
  await expect(primary).toHaveAttribute("role", "combobox");
  await expect(primary).toBeDisabled();
  await primary.dispatchEvent("keydown", { key: "ArrowDown" });
  await expect(root.getByRole("listbox")).toHaveCount(0);
  expect(browser.takeErrors()).toEqual([]);
});

test("snapshot selection enables only the confirmation and browser downloads remain native", async ({ page, consolePreferences }) => {
  const browser = watchBrowser(page);
  const snapshotId = "snapshot-ui-fixture";
  let snapshots: string[] = [];
  let rollbackRequested = false;
  await page.route("**/api/admin/v1/system/snapshots/rollback?*", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: { snapshot_ids: snapshots } });
    else {
      rollbackRequested = true;
      await route.abort();
    }
  });

  await consolePreferences.set({ appearance: "dark" });
  await page.goto("/system/instances-storage");
  const root = page.locator("[data-console-root]");
  const snapshot = root.locator('[role="combobox"][aria-labelledby~="rollback-snapshot-label"]');
  const rollback = root.getByRole("button", { name: "回滚到指定快照", exact: true });
  await expect(snapshot).toBeDisabled();
  await expect(rollback).toBeDisabled();

  snapshots = [snapshotId];
  await page.reload();
  await expect(snapshot).toBeEnabled();
  await snapshot.click();
  const listbox = await expectListbox(root, snapshot, page);
  await expect(listbox.getByRole("option", { name: "选择快照", exact: true })).toHaveAttribute("aria-selected", "true");
  await listbox.getByRole("option", { name: snapshotId, exact: true }).click();
  await expect(snapshot).toHaveText(snapshotId);
  await rollback.click();
  const confirmation = root.getByRole("dialog", { name: "回滚正式存档", exact: true });
  await expect(confirmation).toContainText(snapshotId);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(rollbackRequested).toBe(false);

  const received = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/studio/publish-pack");
  const downloaded = page.waitForEvent("download");
  await root.locator('[data-export-pack="ai0pack"]').click();
  const [response, download] = await Promise.all([received, downloaded]);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { filename: string; scrubbed_payload: object };
  expect(download.suggestedFilename()).toBe(payload.filename);
  expect(JSON.parse(await readFile(await download.path(), "utf8"))).toEqual(payload.scrubbed_payload);
  expect(browser.takeErrors()).toEqual([]);
});
