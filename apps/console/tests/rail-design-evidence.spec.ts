import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { watchBrowser, workspaceGeometry } from "./browser-guard.js";

const phase = process.env.AI0_UI_EVIDENCE_PHASE;
const outputRoot = process.env.AI0_UI_EVIDENCE_DIR;
const fixedTime = "2026-11-23T00:00:00+08:00";
const fixtureId = "d3a66064-068d-44d7-abdf-e900c387711a";
const fixtureText = "请用两段简短中文，介绍我们如何安排一次团队复盘。";
const rootSelector = "[data-console-root]";
const rail = ".ai0-polymorphic-nav-rail:visible";
const modes = ["sakura-pink", "astral-blue", "cyber-emerald"] as const;
const appearances = ["light", "dark"] as const;

type Appearance = (typeof appearances)[number];
type Theme = (typeof modes)[number];
type Paint = Record<string, string>;
type ElementSample = { selector: string; paint: Paint; bounds: { x: number; y: number; width: number; height: number } };
type EvidenceCase = {
  id: string;
  theme: Theme;
  appearance: Appearance;
  viewport: { width: number; height: number };
  screenshot: string;
  elements: ElementSample[];
  geometry: Awaited<ReturnType<typeof workspaceGeometry>>;
  sovereignty: Record<string, string>;
  errors: string[];
};

test.use({ timezoneId: "Asia/Shanghai" });

async function seedChat(page: Page, writeFixture: boolean) {
  const bootstrap = await page.request.get("/api/studio/bootstrap?mode=live");
  expect(bootstrap.ok()).toBe(true);
  const { ownerToken } = await bootstrap.json() as { ownerToken: string };
  const headers = { "x-ai0-owner-token": ownerToken };
  const historyResponse = await page.request.get("/api/studio/webchat/history?mode=live", { headers });
  expect(historyResponse.ok()).toBe(true);
  const history = await historyResponse.json() as { turns: { requestId: string; userText: string; assistantText: string }[] };
  const existing = history.turns.find((turn) => turn.requestId === fixtureId);
  if (existing) {
    expect(existing.userText).toBe(fixtureText);
    expect(existing.assistantText.length).toBeGreaterThan(0);
    return;
  }
  expect(writeFixture, "Use the same isolated AI0_TEST_SOUL_DIR for before and after.").toBe(true);
  const streamed = await page.request.post("/api/studio/webchat/runs", {
    headers, data: { requestId: fixtureId, mode: "live", text: fixtureText }
  });
  expect(streamed.ok()).toBe(true);
  expect(await streamed.text()).toContain("data: [DONE]");
  const checked = await page.request.get(`/api/studio/webchat/runs/${fixtureId}?mode=live`, { headers });
  expect(checked.ok()).toBe(true);
  const delivery = await checked.json() as { text: string; deliveryFinished: boolean };
  expect(delivery.deliveryFinished).toBe(true);
  expect(delivery.text.length).toBeGreaterThan(0);
  const receipt = await page.request.post(`/api/studio/webchat/runs/${fixtureId}/receipt`, {
    headers, data: { mode: "live", spokenCharOffset: Array.from(delivery.text).length }
  });
  expect(receipt.ok()).toBe(true);
}

async function captureElements(root: Locator, selectors: readonly string[]): Promise<ElementSample[]> {
  return root.evaluate((element, values) => {
    return values.map((selector) => {
      const candidates = Array.from(element.querySelectorAll(selector.replace(/:visible/gu, "")));
      const sampled = candidates.find((candidate) => candidate.getClientRects().length > 0 &&
        getComputedStyle(candidate).visibility !== "hidden");
      if (!sampled) throw new Error(`Expected a visible element for ${selector}`);
      const css = getComputedStyle(sampled);
      const px = sampled.getBoundingClientRect();
      return {
        selector,
        paint: {
          backgroundColor: css.backgroundColor,
          backgroundImage: css.backgroundImage,
          color: css.color,
          borderColor: css.borderColor,
          borderWidth: css.borderWidth,
          borderRadius: css.borderRadius,
          boxShadow: css.boxShadow,
          fontSize: css.fontSize,
          fontWeight: css.fontWeight,
          padding: css.padding,
          columnGap: css.columnGap,
          rowGap: css.rowGap
        },
        bounds: { x: px.x, y: px.y, width: px.width, height: px.height }
      };
    });
  }, selectors);
}

function makeUrl(path: string, theme: Theme, appearance: Appearance, params: Record<string, string> = {}) {
  return `${path}?${new URLSearchParams({ theme, appearance, ...params })}`;
}

test("frozen production rail removal preserves console appearance and layout", async ({ page }, testInfo) => {
  test.skip(!phase && !outputRoot, "Opt-in production visual comparison");
  test.setTimeout(240_000);
  if ((phase !== "before" && phase !== "after") || !outputRoot || !isAbsolute(outputRoot) ||
      !process.env.AI0_TEST_BUILD_DIR || !process.env.AI0_TEST_SOUL_DIR) {
    throw new Error("Set AI0_UI_EVIDENCE_PHASE, absolute AI0_UI_EVIDENCE_DIR, AI0_TEST_BUILD_DIR and isolated AI0_TEST_SOUL_DIR.");
  }
  const output = join(outputRoot, phase);
  await mkdir(output, { recursive: true });
  const baselinePath = join(outputRoot, "before", "rail-design-report.json");
  const baseline = phase === "after" ?
    JSON.parse(await readFile(baselinePath, "utf8")) as { cases: EvidenceCase[] } : undefined;
  const browser = watchBrowser(page);
  await page.clock.setFixedTime(new Date(fixedTime));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedChat(page, phase === "before");
  const root = page.locator(rootSelector);
  const cases: EvidenceCase[] = [];
  const desktop = { width: 1440, height: 900 };

  async function visit(path: string, theme: Theme, appearance: Appearance, mode: "live" | "sandbox" = "live", params = {}) {
    await page.mouse.move(0, 0);
    await page.goto(makeUrl(path, theme, appearance, { mode, ...params }));
    await expect(root).toHaveAttribute("data-appearance", appearance);
    await expect(root).toHaveAttribute("data-soul-theme", theme);
    await expect(root).toHaveAttribute("data-sovereignty-mode", mode);
    await expect(root.locator(".ai0-bootstrap-progress")).toBeHidden();
  }

  async function capture(id: string, theme: Theme, appearance: Appearance, selectors: readonly string[]) {
    const screenshot = `${id}.png`;
    const elements = await captureElements(root, selectors);
    await page.screenshot({ path: join(output, screenshot), animations: "disabled", caret: "hide", scale: "css" });
    const entry: EvidenceCase = {
      id, theme, appearance, viewport: page.viewportSize()!, screenshot, elements,
      geometry: await workspaceGeometry(page),
      sovereignty: await root.evaluate((element) => {
        const css = getComputedStyle(element);
        return Object.fromEntries(["--sovereignty-live-emerald", "--sovereignty-sandbox-amber", "--sovereignty-sandbox-violet"]
          .map((token) => [token, css.getPropertyValue(token).trim().toLowerCase()]));
      }),
      errors: browser.takeErrors()
    };
    cases.push(entry);
  }

  for (const theme of modes) {
    for (const appearance of appearances) {
      const suffix = `${theme}-${appearance}`;
      await page.setViewportSize(desktop);
      await visit("/dashboard", theme, appearance);
      await expect(root.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
      await capture(`dashboard-${suffix}`, theme, appearance, [
        rail, ".ai0-nav-rail__item.is-active", ".ai0-hybrid-top-bar", "main",
        ".ai0-workspace-section", ".ai0-overview-status", ".ai0-workspace-status", '.ai0-instance-switch [data-value="live"]'
      ]);
      await root.getByRole("combobox", { name: "Soul 配色", exact: true }).click();
      await expect(root.getByRole("listbox")).toBeVisible();
      await capture(`portal-${suffix}`, theme, appearance, [
        ".MuiMenu-paper", '.MuiMenu-paper [role="option"][aria-selected="true"]'
      ]);
      await page.keyboard.press("Escape");
      await expect(root.getByRole("listbox")).toBeHidden();
      await visit("/dashboard", theme, appearance, "sandbox");
      await expect(root.locator(".ai0-sandbox-ribbon")).toBeVisible();
      await capture(`sandbox-${suffix}`, theme, appearance, [
        ".ai0-sandbox-ribbon", '.ai0-instance-switch [data-value="sandbox"]', ".ai0-overview-status"
      ]);
      await visit("/conversations", theme, appearance);
      await expect(root.locator(".ai0-workspace-table tbody tr").first()).toBeVisible();
      await capture(`conversations-${suffix}`, theme, appearance, [
        "main", ".ai0-workspace-section", ".ai0-workspace-table thead th", ".ai0-workspace-table tbody tr",
        ".ai0-workspace-table tbody .ai0-workspace-status"
      ]);
      await visit("/webchat", theme, appearance);
      await expect(root.locator(`[data-message-turn-id="${fixtureId}"][data-message-role="assistant"]`)).toHaveAttribute("data-message-status", "completed");
      await root.getByRole("textbox", { name: "输入聊天消息" }).fill("继续安排我们的团队复盘。");
      await expect(root.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
      await capture(`webchat-${suffix}`, theme, appearance, [
        "main", ".ai0-chat-header", ".ai0-chat-viewport", ".ai0-chat-message.is-user .ai0-chat-message__body",
        ".ai0-chat-message.is-assistant .ai0-chat-message__body", ".ai0-chat-composer", "[data-webchat-send]"
      ]);
    }
  }

  for (const scenario of [
    { id: "mini-desktop", width: 1440, height: 900, navMode: "mini" },
    { id: "drawer-tablet", width: 1024, height: 768, navMode: "drawer" },
    { id: "drawer-mobile", width: 390, height: 844, navMode: "drawer" }
  ]) {
    const theme = "astral-blue";
    const appearance = "dark";
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await visit("/dashboard", theme, appearance, "live", scenario.navMode === "mini" ? { rail: "mini" } : {});
    if (scenario.navMode === "drawer") {
      await root.getByRole("button", { name: "打开导航", exact: true }).click();
      await expect(root.getByLabel("控制台导航", { exact: true })).toBeVisible();
    } else {
      await expect(root.locator(rail)).toHaveAttribute("data-mode", "mini");
    }
    const scope = scenario.navMode === "drawer" ? ".ai0-mobile-nav-drawer " : "";
    await capture(scenario.id, theme, appearance, [`${scope}${rail}`, `${scope}.ai0-nav-rail__item.is-active`]);
    if (scenario.navMode === "drawer") {
      await root.getByRole("button", { name: "关闭导航", exact: true }).click();
      await expect(root.getByLabel("控制台导航", { exact: true })).toBeHidden();
    }
  }

  const mismatches: string[] = [];
  for (const current of cases) {
    mismatches.push(...current.errors.map((message) => `${current.id}: ${message}`));
    for (const [part, overflow] of Object.entries(current.geometry)) {
      if (overflow > 1) mismatches.push(`${current.id}: ${part} overflow ${overflow}px`);
    }
    if (!baseline) continue;
    const previous = baseline.cases.find((entry) => entry.id === current.id);
    if (!previous) {
      mismatches.push(`${current.id}: missing frozen reference`);
      continue;
    }
    for (const [token, value] of Object.entries(current.sovereignty)) {
      if (previous.sovereignty[token] !== value) mismatches.push(`${current.id}: ${token} changed`);
    }
    for (const item of current.elements) {
      const reference = previous.elements.find((element) => element.selector === item.selector)!;
      for (const [property, value] of Object.entries(item.paint)) {
        const expected = item.selector.endsWith(rail) && property === "backgroundImage" ? "none" : reference.paint[property];
        if (value !== expected) mismatches.push(`${current.id} ${item.selector} ${property}: ${value} instead of ${expected}`);
      }
      for (const key of ["x", "y", "width", "height"] as const) {
        if (Math.abs(item.bounds[key] - reference.bounds[key]) > 1) {
          mismatches.push(`${current.id} ${item.selector} ${key}: ${item.bounds[key]}px instead of ${reference.bounds[key]}px`);
        }
      }
    }
  }
  if (baseline && baseline.cases.length !== cases.length) mismatches.push("Reference and current case counts differ");
  const report = join(output, "rail-design-report.json");
  await writeFile(report, JSON.stringify({ phase, fixedTime, cases, mismatches }, null, 2), "utf8");
  await testInfo.attach(`rail-design-report-${phase}`, { path: report, contentType: "application/json" });
  expect(mismatches).toEqual([]);
});
