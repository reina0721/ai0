import { expect, test } from "@playwright/test";

test("verifies five-plane navigation and orthogonal Providers, Platforms, and Profiles UI", async ({ page }) => {
  const screenshotDir = process.env.AI0_WALKTHROUGH_SCREENSHOT_DIR;
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // 1. Dashboard & Clean 5-Group Sidebar (with WebChat dynamically mounted in Group 1)
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "控制台主导航" });
  await expect(nav.getByText("概览与对话", { exact: true })).toBeVisible();
  await expect(nav.getByText("核心配置", { exact: true })).toBeVisible();
  await expect(nav.getByText("通用能力", { exact: true })).toBeVisible();
  await expect(nav.getByText("外部接入", { exact: true })).toBeVisible();
  await expect(nav.getByText("调试与系统", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "WebChat", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "子代理与任务", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "插件与扩展", exact: true })).toBeVisible();

  // 2. Two-Tier Providers Workbench (/integrations/providers) — Pure Provider Pool, zero hardcoded business roles
  await nav.getByRole("link", { name: "服务提供商", exact: true }).click();
  await expect(page).toHaveURL(/\/integrations\/providers$/);
  await expect(page.getByRole("heading", { name: "服务提供商", exact: true })).toBeVisible();
  await expect(page.locator("[data-providers-page]")).not.toContainText("DeepSeek Flash · 主力对话");
  await expect(page.locator("[data-providers-page]")).not.toContainText("BGE-Reranker-v2-M3 · 知识库精排");
  if (screenshotDir) {
    await page.setViewportSize({ width: 1400, height: 880 });
    await page.screenshot({ path: `${screenshotDir}/providers-reborn.png`, animations: "disabled" });
  }

  await page.route("**/integrations/sources/*/fetch-models?*", (route) => route.fulfill({ json: {
    ok: true,
    models: [],
    detail: "目录暂无可用模型",
    catalogSource: "upstream",
    lastFetchedAt: new Date().toISOString()
  } }));
  await page.locator('[data-add-provider="true"]').click();
  const addDialog = page.getByRole("dialog", { name: "新增服务提供商来源" });
  await expect(addDialog).toBeVisible();
  await addDialog.locator('[data-vendor-template="tpl_siliconflow"]').click();
  await addDialog.getByRole("textbox", { name: "自定义来源名称" }).fill("Playwright 临时硅基节点");
  await addDialog.getByRole("textbox", { name: "新增来源 Base URL" }).fill("http://127.0.0.1:1/v1");
  await addDialog.locator('[data-confirm-add-provider="true"]').click();
  await expect(page.getByText("目录暂无可用模型", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭模型目录" }).click();

  const tempSourceItem = page.locator("[data-source-item]", { hasText: "Playwright 临时硅基节点" });
  await expect(tempSourceItem).toBeVisible();
  await tempSourceItem.click();

  // Add an $ENV_VAR key to the multi-key rotation pool
  await page.getByRole("textbox", { name: "新增 API Key 或环境变量" }).fill("$PLAYWRIGHT_TEST_SF_KEY");
  await page.locator('[data-add-source-key="true"]').click();
  await expect(page.locator("[data-key-pool]", { hasText: "$PLAYWRIGHT_TEST_SF_KEY" })).toBeVisible();

  // Delete the temporary source cleanly
  await page.locator("[data-delete-source]").click();
  await page.getByRole("dialog").getByRole("button", { name: "确认" }).click();
  await expect(tempSourceItem).toHaveCount(0);

  // 3. Reborn Fig 2: 消息平台与交互通道 (/integrations/platforms) — Pure Platform Pool, zero WebChat banner / gate tabs
  await nav.getByRole("link", { name: "消息平台与交互通道", exact: true }).click();
  await expect(page).toHaveURL(/\/integrations\/platforms$/);
  await expect(page.getByRole("heading", { name: "消息平台与交互通道", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开 WebChat" })).toHaveCount(0);
  await expect(page.locator(".ai0-workspace-tab", { hasText: "注意力焦点仲裁" })).toHaveCount(0);
  await expect(page.locator(".ai0-workspace-tab", { hasText: "话轮防抖与感官门控" })).toHaveCount(0);
  await expect(page.locator(".ai0-workspace-tab", { hasText: "语音与表现管线" })).toHaveCount(0);
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/platforms-reborn.png`, animations: "disabled" });
  }

  // 4. AstrBot-style Config Profiles & UMO Routing (/config/profiles -> /config/routing)
  await nav.getByRole("link", { name: "配置文件与路由", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/profiles$/);
  await expect(page.getByRole("heading", { name: "配置文件 (Profiles)" })).toBeVisible();
  await expect(page.getByText("2. 对话节奏、防抖与注意力门控")).toBeVisible();
  if (screenshotDir) {
    await page.screenshot({ path: `${screenshotDir}/profiles-reborn.png`, animations: "disabled" });
  }

  await page.locator(".ai0-workspace-tab", { hasText: "会话路由规则 (UMO)" }).click();
  await expect(page).toHaveURL(/\/config\/routing$/);
  await page.locator('[data-test-umo-route="true"]').click();
  await expect(page.locator('[data-umo-test-result="true"]')).toBeVisible();

  // 5. Independent General Capabilities: 语音与多模态 & 知识库 (RAG)
  await nav.getByRole("link", { name: "语音与多模态", exact: true }).click();
  await expect(page).toHaveURL(/\/capabilities\/multimodal$/);
  await expect(page.getByRole("heading", { name: "语音与多模态" })).toBeVisible();

  await nav.getByRole("link", { name: "知识库 (RAG)", exact: true }).click();
  await expect(page).toHaveURL(/\/capabilities\/knowledge$/);
  await expect(page.getByRole("heading", {name:"知识库", exact:true})).toBeVisible();
  await page.getByRole("button", {name:"检索设置"}).click();
  await expect(page.getByRole("heading", {name:"检索模型",exact:true})).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("recovers the profiles view when the daemon starts after Vite", async ({ page }) => {
  let daemonReady = false;
  await page.route("**/api/studio/bootstrap?*", async route => {
    if (daemonReady) return route.continue();
    return route.fulfill({ status: 502, body: "Bad Gateway" });
  });
  await page.goto("/config/profiles?mode=live");
  await expect(page.getByText(/暂时无法连接守护进程/)).toBeVisible();
  daemonReady = true;
  await expect(page.getByText(/暂时无法连接守护进程/)).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole("button", { name: "新建配置文件" })).toBeEnabled();
});
