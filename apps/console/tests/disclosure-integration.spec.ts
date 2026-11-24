import type { Locator } from "@playwright/test";
import { expect, test } from "./console-preferences.js";

import { watchBrowser } from "./browser-guard.js";

async function expectDisclosure(button: Locator, region: Locator) {
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(region).toBeHidden();
  await button.focus();
  await button.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(region).toBeVisible();
  await expect(button).toBeFocused();
}

test("event payload and trace disclosures expose persisted records and track filters", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark" });
  const browser = watchBrowser(page);
  const text = "浏览器折叠验收 " + crypto.randomUUID().slice(0, 8);
  const { ownerToken } = await (await page.request.get("/api/studio/bootstrap")).json();
  const perception = await page.request.post("/protocol/v0/shell/perception", {
    headers: { "x-ai0-owner-token": ownerToken },
    data: { text, venue_type: "private_1on1", audience_scope: "only_owner" }
  });
  await expect(perception).toBeOK();
  const { trace } = await perception.json() as { trace: { trace_id: string } };

  await page.goto("/memory/events-media");
  const events = page.getByRole("table", { name: "事件记录" });
  await events.getByRole("button", { name: text, exact: true }).click();
  const payloadButton = page.getByRole("button", { name: "查看存档载荷" });
  const payload = page.getByRole("region", { name: "查看存档载荷" });
  await expectDisclosure(payloadButton, payload);
  await expect(payload.locator("pre")).toHaveText(JSON.stringify({
    venue: "private_1on1", audience: "only_owner", modality: "text"
  }));
  await payloadButton.press("Enter");
  await expect(payloadButton).toHaveAttribute("aria-expanded", "false");
  await expect(payload).toBeHidden();
  await expectConfirmation(page.getByRole("button", { name: "话题封存" }), page.getByRole("dialog", { name: "封存话题" }));
  await expect(page.locator("main details")).toHaveCount(0);

  await page.goto("/runtime/terminal?" + new URLSearchParams({ trace: trace.trace_id }));
  await expect(page.getByRole("button", { name: "门控与安全" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "门控与安全" })).toBeVisible();
  const recallButton = page.getByRole("button", { name: /记忆召回/u });
  const recall = page.getByRole("region", { name: /记忆召回/u });
  await expectDisclosure(recallButton, recall);
  await expect(recall.locator("pre")).toBeVisible();
  for (const title of ["策略与工具授权", "表达与送达"]) {
    await expectDisclosure(page.getByRole("button", { name: title }), page.getByRole("region", { name: title }));
  }
  await test.info().attach("runtime-trace-disclosure", {
    body: await page.screenshot({ animations: "disabled", caret: "hide" }), contentType: "image/png"
  });

  const group = page.getByRole("group", { name: "筛选日志轨道" });
  const log = page.getByRole("log");
  const eventRows = log.locator('[data-track="EVENT"]');
  const event = group.getByRole("button", { name: "[EVENT]", exact: true });
  const traceFilter = group.getByRole("button", { name: "[TRACE]", exact: true });
  await expect(eventRows.first()).toBeVisible();
  await expect(event).toHaveAttribute("aria-pressed", "true");
  await event.press("Space");
  await expect(event).toHaveAttribute("aria-pressed", "false");
  await expect(traceFilter).toHaveAttribute("aria-pressed", "true");
  await expect(eventRows).toHaveCount(0);
  await event.press("Space");
  await expect(eventRows.first()).toBeVisible();
  await expect(event).toBeFocused();
  expect(browser.takeErrors()).toEqual([]);
});

async function expectConfirmation(trigger: Locator, dialog: Locator) {
  await trigger.click();
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeFocused();
  await cancel.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

test("archive and relationship confirmations open, cancel, and restore focus without writes", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark" });
  const browser = watchBrowser(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/release-knot") || path.endsWith("/snapshots/rollback") ||
        (path.endsWith("/distill-apply") && request.postDataJSON().apply)) writes.push(path);
  });

  await page.goto("/memory/relationship");
  await expectConfirmation(page.getByRole("button", { name: "解除未解张力" }), page.getByRole("dialog", { name: "解除未解张力" }));

  await page.goto("/soul/distiller");
  await page.getByLabel("角色卡 JSON").fill(JSON.stringify({ name: "界面验收", description: "简短而清晰的沟通。" }));
  await page.getByRole("button", { name: "预览分馏" }).click();
  await expectConfirmation(page.getByRole("button", { name: "写入当前存档" }), page.getByRole("dialog", { name: "写入角色卡" }));

  const snapshot = "fixture-snapshot";
  await page.route("**/api/admin/v1/system/snapshots/rollback?*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { snapshot_ids: [snapshot] } }) : route.continue());
  await page.goto("/system/instances-storage");
  await page.getByRole("combobox", { name: "历史快照 ID" }).click();
  await page.getByRole("option", { name: snapshot, exact: true }).click();
  await expectConfirmation(page.getByRole("button", { name: "回滚到指定快照" }), page.getByRole("dialog", { name: "回滚正式存档" }));

  expect(writes).toEqual([]);
  expect(browser.takeErrors()).toEqual([]);
});

test("sandbox report discloses assertions from an actual regression run", async ({ page }) => {
  const browser = watchBrowser(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sandbox/lab?mode=sandbox");
  const reportReceived = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/v1/sandbox/scenarios/run");
  await page.getByRole("button", { name: "运行回归剧本" }).click();
  const response = await reportReceived;
  expect(response.ok()).toBe(true);
  const report = await response.json() as {
    runs: Array<{ run_name: string; steps: Array<{ assertions: Array<{ expression: string }> }> }>;
  };
  const run = report.runs[0]!;
  const assertion = run.steps.flatMap((step) => step.assertions)[0]!;
  const trigger = page.getByRole("button", { name: run.run_name, exact: true });
  const region = page.getByRole("region", { name: run.run_name, exact: true });
  await expectDisclosure(trigger, region);
  await expect(region.getByText(assertion.expression, { exact: false }).first()).toBeVisible();
  await expect(page.locator("main details")).toHaveCount(0);
  await test.info().attach("sandbox-report-disclosure-390", {
    body: await page.screenshot({ animations: "disabled", caret: "hide" }), contentType: "image/png"
  });
  expect(browser.takeErrors()).toEqual([]);
});

test("compact rail tooltips remain keyboard accessible and the shell brand retains its density", async ({ page, consolePreferences }) => {
  await consolePreferences.set({ appearance: "dark", navRailMode: "mini" });
  const browser = watchBrowser(page);
  await page.goto("/dashboard");
  const brand = page.getByRole("link", { name: "ai0", exact: true });
  await expect(brand).toHaveCSS("height", "32px");
  await expect(brand).toHaveCSS("font-size", "16px");
  const home = page.getByRole("navigation", { name: "控制台主导航" }).locator('[data-nav-path="/dashboard"]');
  await home.focus();
  const tooltip = page.locator("[data-console-root]").getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText((await home.getAttribute("aria-label"))!);
  await expect(home).not.toHaveAttribute("title");
  await home.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(home).toBeFocused();
  expect(browser.takeErrors()).toEqual([]);
});
