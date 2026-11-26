import type { Locator } from "@playwright/test";
import { expect, test } from "./console-preferences.js";

async function themeColor(root: Locator, variable: string): Promise<string> {
  return root.evaluate((element, token) => {
    const probe = document.createElement("span");
    probe.hidden = true;
    probe.style.color = `var(${token})`;
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}

async function attachView(name: string, view: Locator): Promise<void> {
  const body = await view.screenshot({ animations: "disabled", caret: "hide" });
  await test.info().attach(name, { body, contentType: "image/png" });
}

test("console styles stay within the workspace and dark Material overlays retain its tokens", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark", soulTheme: "astral-blue" });
  await page.goto("/dashboard");
  const root = page.locator("[data-console-root]");
  await expect(root).toHaveAttribute("data-appearance", "dark");
  await expect(root).toHaveAttribute("data-soul-theme", "astral-blue");
  const mainSurface = await themeColor(root, "--ai0-surface-main-card");
  const tooltipSurface = await themeColor(root, "--ai0-surface-container-high");
  const ink = await themeColor(root, "--ai0-on-surface");

  const { external, unstyled } = await page.evaluate(() => {
    const clearFrame = document.createElement("iframe");
    clearFrame.setAttribute("aria-hidden", "true");
    clearFrame.style.cssText = "position:absolute;left:-10000px;visibility:hidden";
    document.body.append(clearFrame);

    function sample(owner: Document) {
      const host = owner.createElement("section");
      host.style.font = "16px serif";
      host.innerHTML = "<button>Test</button><input type='text'><select><option>Test</option></select><textarea></textarea><p>Test</p>";
      owner.body.append(host);
      const read = (selector: string, properties: string[]) => {
        const computed = owner.defaultView!.getComputedStyle(host.querySelector(selector)!);
        return properties.map((property) => computed.getPropertyValue(property));
      };
      const result = {
        button: read("button", ["appearance", "display", "border-top-style", "padding-inline-start"]),
        input: read("input", ["appearance", "min-height", "border-top-style"]),
        select: read("select", ["appearance", "min-height", "border-top-style"]),
        textarea: read("textarea", ["appearance", "min-height", "border-top-style"]),
        paragraph: read("p", ["margin-block-start", "margin-block-end"])
      };
      host.remove();
      return result;
    }

    const outsideConsole = sample(document);
    const browserDefaults = sample(clearFrame.contentDocument!);
    clearFrame.remove();
    return { external: outsideConsole, unstyled: browserDefaults };
  });
  expect(external).toEqual(unstyled);

  const more = page.getByRole("button", { name: "更多操作", exact: true });
  await more.focus();
  await more.press("Enter");
  const menu = root.getByRole("menu", { name: "控制台操作" });
  const menuSurface = root.locator(".MuiMenu-paper");
  await expect(menu).toBeVisible();
  await expect(menuSurface).toHaveCSS("background-color", mainSurface);
  await expect(menuSurface).toHaveCSS("color", ink);
  await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(1);
  await attachView("dark-menu", menuSurface);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  const commands = page.getByRole("button", { name: "打开命令面板", exact: true });
  await commands.hover();
  const tooltip = root.getByRole("tooltip").locator(".MuiTooltip-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveCSS("background-color", tooltipSurface);
  await expect(tooltip).toHaveCSS("color", ink);

  await commands.focus();
  await commands.press("Enter");
  const palette = root.getByRole("dialog", { name: /快速跳转/u });
  await expect(palette).toBeVisible();
  await expect(palette).toHaveCSS("background-color", mainSurface);
  await expect(palette).toHaveCSS("color", ink);
  await expect(root.locator(".MuiDialog-root .MuiBackdrop-root")).toHaveCSS("background-color", await themeColor(root, "--ai0-overlay"));
  await expect(palette.getByRole("combobox", { name: "搜索页面与扩展" })).toBeFocused();
  await attachView("dark-command-palette", palette);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(commands).toBeFocused();
});

test("provider controls and memory rows stay compact and closing the confirmation preserves data", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark" });
  await page.goto("/models/providers");
  const model = page.locator('input[data-prov-model="prov_deepseek_v3"]');
  await expect(model).toBeEnabled();
  const field = page.locator(".ai0-compact-input").filter({ has: model });
  await expect(field).toHaveCSS("height", "32px");
  await model.focus();
  await expect(model).toBeFocused();

  let eraseRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/memory/hard-forget")) eraseRequests++;
  });
  await page.goto("/memory/lineage");
  const root = page.locator("[data-console-root]");
  await expect(root).toHaveAttribute("data-appearance", "dark");
  const table = page.getByRole("table", { name: "记忆节点" });
  const firstRecord = table.getByRole("row").nth(1);
  await expect(firstRecord).toBeVisible();
  const rowHeight = (await firstRecord.boundingBox())!.height;
  expect(rowHeight).toBeGreaterThanOrEqual(28);
  expect(rowHeight).toBeLessThanOrEqual(42);
  await firstRecord.getByRole("button").click();
  const erase = page.getByRole("button", { name: "彻底遗忘", exact: true });
  await erase.click();
  const confirm = root.getByRole("dialog", { name: "彻底遗忘记录" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveCSS("background-color", await themeColor(root, "--ai0-surface-main-card"));
  await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await attachView("dark-memory-confirmation", confirm);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(erase).toBeFocused();
  await expect(firstRecord).toBeVisible();
  expect(eraseRequests).toBe(0);
});

test("a narrow reduced-motion console keeps focus and the WebChat composer usable after a failed send", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/protocol/v0/channel/history?*", (route) => route.fulfill({ json: { turns: [] } }));
  await page.route((url) => url.pathname === "/api/channel-runs", (route) =>
    route.fulfill({ status: 502, json: { error: "UPSTREAM_CONNECT_FAILED" } }));
  await page.route((url) => /^\/protocol\/v0\/channel\/runs\/[^/]+$/u.test(url.pathname), (route) =>
    route.fulfill({ status: 404, json: { error: "CHANNEL_RUN_NOT_FOUND" } }));
  await page.goto("/webchat");

  const root = page.locator("[data-console-root]");
  const commands = page.getByRole("button", { name: "打开命令面板", exact: true });
  await page.keyboard.press("Tab");
  await commands.focus();
  await expect(commands).toHaveCSS("outline-style", "solid");
  await expect(commands).toHaveCSS("outline-width", "2px");
  const durations = await commands.evaluate((element) => getComputedStyle(element).transitionDuration
    .split(",").map((duration) => parseFloat(duration) * (duration.trim().endsWith("ms") ? 1 : 1000)));
  expect(Math.max(...durations)).toBeLessThanOrEqual(1);
  await expect(commands.locator(".MuiTouchRipple-root")).not.toBeVisible();

  const thread = root.locator('[data-webchat-target="live"]');
  const composer = thread.getByRole("textbox", { name: "输入聊天消息" });
  const prompt = "介绍一下你自己。";
  await thread.getByRole("button", { name: "认识一下", exact: true }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(prompt);
  await expect(thread.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await composer.press("Enter");
  const restore = thread.getByRole("button", { name: "取回原文", exact: true });
  await expect(restore).toBeVisible();
  await expect(thread).not.toContainText(/UPSTREAM_CONNECT_FAILED|HTTP 502/u);
  await restore.click();
  await expect(composer).toHaveValue(prompt);
  await expect(composer).toBeFocused();
  const channelBounds = await root.evaluate((element) => {
    const topBar = element.querySelector(".ai0-hybrid-top-bar")!;
    const main = element.querySelector("main")!;
    return { topBar: topBar.scrollWidth - topBar.clientWidth, main: main.scrollWidth - main.clientWidth };
  });
  expect(channelBounds.topBar).toBeLessThanOrEqual(1);
  expect(channelBounds.main).toBeLessThanOrEqual(1);
  await attachView("mobile-webchat-recovered-draft", root);
});

test("bootstrap failure leaves suggestion drafts available with one focus surface", async ({ page }) => {
  await page.route("**/api/studio/bootstrap?*", (route) => route.fulfill({ status: 502, json: { error: "HTTP_502" } }));
  await page.goto("/webchat");
  const thread = page.locator('[data-webchat-target="live"]');
  await expect(thread).toContainText("暂时无法连接");
  await expect(thread.getByRole("button", { name: "重新连接" })).toBeVisible();
  const suggestion = thread.getByRole("button", { name: "认识一下", exact: true });
  const composer = thread.getByRole("textbox", { name: "输入聊天消息" });
  await suggestion.click();
  await expect(suggestion).toHaveCount(0);
  await expect(composer).toHaveValue("介绍一下你自己。");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveCSS("outline-style", "none");
  await expect(composer).toHaveCSS("box-shadow", "none");
  await expect(thread.locator(".ai0-chat-composer")).toHaveCSS("border-top-width", "1px");
  await expect(thread.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await attachView("offline-webchat-focused-draft", thread);
});
