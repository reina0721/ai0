import { expect, test } from "@playwright/test";
import { watchBrowser } from "./browser-guard.js";

test("simulator submits the selected audience and venue to the sandbox daemon", async ({ page }) => {
  const browser = watchBrowser(page);
  await page.goto("/shells/simulator?mode=sandbox&theme=astral-blue");
  const root = page.locator("[data-console-root]");
  const main = root.locator('main[data-workspace-id="shells.simulator"]');
  const audience = main.getByRole("combobox", { name: "受众", exact: true });
  const text = main.getByRole("textbox", { name: "模拟文本" });
  const run = main.getByRole("button", { name: "运行模拟", exact: true });
  const menu = root.getByRole("listbox", { name: "受众", exact: true });
  const cases = [
    { label: "公开场合", audience_scope: "public_all", venue_type: "public_livestream" },
    { label: "仅主账户", audience_scope: "only_owner", venue_type: "private_1on1" }
  ];

  for (const { label, audience_scope, venue_type } of cases) {
    await audience.click();
    await expect(menu).toBeVisible();
    await expect(root.locator(".MuiMenu-root .MuiBackdrop-invisible")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await menu.getByRole("option", { name: label, exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(audience).toHaveText(label);

    const summary = `模拟器集成验收 · ${label}`;
    await text.fill(summary);
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/admin/v1/sandbox/inject" &&
      candidate.request().method() === "POST"
    );
    await run.click();
    const result = await response;
    expect(result.request().postDataJSON()).toMatchObject({
      shell_id: "console.simulator",
      summary_text: summary,
      modality: "text",
      audience_scope,
      venue_type
    });
    expect(result.ok()).toBe(true);
    const delivered = await result.json();
    expect(typeof delivered.expression?.fallback_text).toBe("string");
    await expect(main.getByText(delivered.expression.fallback_text, { exact: true })).toBeVisible();
  }

  expect(browser.takeErrors()).toEqual([]);
});
