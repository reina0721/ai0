import { expect, test } from "@playwright/test";

test("verifies AstrBot-grade Extension Center (Installed Plugins + Schema Drawer + Market + MCP + Disk Skills + Automation)", async ({ page }) => {
  const screenshotDir = process.env.AI0_WALKTHROUGH_SCREENSHOT_DIR;
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setViewportSize({ width: 1400, height: 880 });
  await page.goto("/capabilities/extensions");

  // 1. Installed Plugins Tab: 5 pure AstrBot-style tabs, bordered cards, compact non-stretched footer buttons
  await expect(page.getByRole("heading", { name: "已安装插件", exact: true })).toBeVisible();
  await expect(page.locator(".ai0-workspace-tab", { hasText: "已安装插件" })).toBeVisible();
  await expect(page.locator(".ai0-workspace-tab", { hasText: "扩展市场" })).toBeVisible();
  await expect(page.locator(".ai0-workspace-tab", { hasText: "MCP 服务" })).toBeVisible();
  await expect(page.locator(".ai0-workspace-tab", { hasText: "技能 (Skills)" })).toBeVisible();
  await expect(page.locator(".ai0-workspace-tab", { hasText: "指令与自动化" })).toBeVisible();

  const dreamCard = page.locator('[data-plugin-card="community.organ.dream-journal"]');
  await expect(dreamCard).toBeVisible();

  // Verify "打开 梦境手记" button is compact (NOT stretched to full card width!)
  const cardBox = await dreamCard.boundingBox();
  const openBtnBox = await dreamCard.getByRole("button", { name: /打开 梦境手记/ }).boundingBox();
  expect(cardBox && openBtnBox && openBtnBox.width < cardBox.width * 0.6).toBe(true);

  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/extensions-installed.png`, animations: "disabled" });
  }

  // Open Dynamic Schema Config Drawer on Dream Journal, switch Form <-> JSON, and Save + Hot-Reload
  await dreamCard.locator('[data-plugin-configure="community.organ.dream-journal"]').click();
  const cfgDrawer = page.locator('[data-plugin-config-drawer="community.organ.dream-journal"]');
  await expect(cfgDrawer).toBeVisible();
  await expect(cfgDrawer.getByText("梦境文风")).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/extensions-config-drawer.png`, animations: "disabled" });
  }
  await cfgDrawer.locator('[data-config-mode-json="true"]').click();
  await expect(cfgDrawer.getByRole("textbox", { name: "插件配置 JSON" })).toBeVisible();
  await cfgDrawer.locator('[data-config-mode-form="true"]').click();
  await cfgDrawer.locator('[data-save-plugin-config="true"]').click();
  await expect(cfgDrawer).toHaveCount(0);

  // Open Details & Permissions Drawer
  await dreamCard.locator('[data-plugin-details="community.organ.dream-journal"]').click();
  const detailsDrawer = page.locator('[data-plugin-details-drawer="community.organ.dream-journal"]');
  await expect(detailsDrawer).toBeVisible();
  await expect(detailsDrawer.getByText("D3_MEMORY_PROJECTION").first()).toBeVisible();
  await detailsDrawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(detailsDrawer).toHaveCount(0);

  // 2. Extension Market Tab: install a community extension, then cleanly uninstall it on Installed Plugins tab
  await page.locator(".ai0-workspace-tab", { hasText: "扩展市场" }).click();
  await expect(page).toHaveURL(/\/capabilities\/extensions\/market$/);
  const pomodoroMarketCard = page.locator('[data-market-card="community.organ.pomodoro-companion"]');
  await expect(pomodoroMarketCard).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/extensions-market.png`, animations: "disabled" });
  }
  await pomodoroMarketCard.locator('[data-market-install="community.organ.pomodoro-companion"]').click();
  await expect(pomodoroMarketCard.getByText("已安装", { exact: true })).toBeVisible();

  await page.locator(".ai0-workspace-tab", { hasText: "已安装插件" }).click();
  const pomodoroInstalled = page.locator('[data-plugin-card="community.organ.pomodoro-companion"]');
  await expect(pomodoroInstalled).toBeVisible();
  await pomodoroInstalled.locator('[data-plugin-uninstall="community.organ.pomodoro-companion"]').click();
  await page.locator('[data-confirm-uninstall-plugin="true"]').click();
  await expect(pomodoroInstalled).toHaveCount(0);

  // 3. Dedicated MCP Servers Tab: JSON Paste Import + Delete Cleanup
  await page.locator(".ai0-workspace-tab", { hasText: "MCP 服务" }).click();
  await expect(page).toHaveURL(/\/capabilities\/extensions\/mcp$/);
  await expect(page.getByRole("heading", { name: "MCP 服务", exact: true })).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/extensions-mcp.png`, animations: "disabled" });
  }
  await page.locator('[data-open-mcp-import="true"]').click();
  const importDialog = page.getByRole("dialog");
  await importDialog.getByRole("textbox", { name: "MCP JSON 配置" }).fill(
    JSON.stringify({ mcpServers: { pw_temp_mcp: { transport: "streamable_http", url: "http://127.0.0.1:9999/mcp" } } })
  );
  await importDialog.locator('[data-confirm-import-mcp="true"]').click();
  const tempMcpCard = page.locator('[data-mcp-card="mcp_pw_temp_mcp"]');
  await expect(tempMcpCard).toBeVisible();
  await tempMcpCard.locator('[data-delete-mcp="mcp_pw_temp_mcp"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "确认" }).click();
  await expect(tempMcpCard).toHaveCount(0);

  // 4. Dedicated Disk-Backed Skills Tab: shows real plugin-bundled SKILL.md + create & delete user SKILL.md
  await page.locator(".ai0-workspace-tab", { hasText: "技能 (Skills)" }).click();
  await expect(page).toHaveURL(/\/capabilities\/extensions\/skills$/);
  await expect(page.getByRole("heading", { name: "技能 (Skills)", exact: true })).toBeVisible();
  await expect(page.locator('[data-skill-card="community.skill.daily-github-companion-review"]')).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/extensions-skills.png`, animations: "disabled" });
  }

  await page.locator('[data-create-skill-btn="true"]').click();
  await page.getByRole("textbox", { name: "技能显示名称" }).fill("Playwright 晚安仪式");
  await page.getByRole("textbox", { name: "技能目录标识" }).fill("pw-goodnight");
  await page.locator('[data-confirm-save-skill="true"]').click();
  const tempSkillCard = page.locator('[data-skill-card="soul.skill.pw-goodnight"]');
  await expect(tempSkillCard).toBeVisible();
  await tempSkillCard.locator('[data-delete-skill="soul.skill.pw-goodnight"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "确认" }).click();
  await expect(tempSkillCard).toHaveCount(0);

  // 5. Commands & Automation Tab
  await page.locator(".ai0-workspace-tab", { hasText: "指令与自动化" }).click();
  await expect(page).toHaveURL(/\/capabilities\/extensions\/automation$/);
  await expect(page.getByRole("heading", { name: "指令与自动化", exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
