import { expect, test } from "./console-preferences.js";

test("imports a source, inspects its location, searches it and mounts it from the directory", async ({
  page, consolePreferences
}, testInfo) => {
  await consolePreferences.set({ appearance: "light", soulTheme: "astral-blue" });
  await page.goto("/capabilities/knowledge");
  const library = page.locator("[data-rag-page]");
  await expect(library.getByRole("heading", { name: "知识库", exact: true })).toBeVisible();
  await expect(library.getByText("Embedding 服务提供商")).toHaveCount(0);
  await library.getByRole("button", { name: "新建知识库" }).click();
  await library.getByLabel("库名").fill("望远镜维护手册");
  await library.getByRole("button", { name: "创建知识库" }).click();
  await library.getByRole("button", { name: "导入文档" }).click();
  await page.screenshot({ path: testInfo.outputPath("import.png") });
  await library.locator('input[type="file"]').setInputFiles({
    name: "光轴.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 光轴校准\n主镜校准标记为浮鲸九号。")
  });
  await library.getByRole("button", { name: "导入并索引" }).click();
  const receipt = library.getByRole("region", { name: "导入结果" });
  await expect(receipt).toContainText("已可搜索");
  await expect(receipt).toContainText("光轴.md");
  await expect(receipt).toContainText("未挂载");
  await page.screenshot({ path: testInfo.outputPath("receipt.png") });
  await receipt.getByRole("button", { name: "试搜这份资料" }).click();
  await library.getByRole("textbox", { name: "试搜当前知识库" }).fill("主镜校准标记");
  await library.locator("form").getByRole("button", { name: "试搜" }).click();
  await expect(library.locator(".kb-hit")).toContainText("浮鲸九号");
  await library.getByRole("button", { name: "查看原文" }).click();
  await expect(library.locator(".kb-original mark:focus")).toContainText("浮鲸九号");
  await expect(library.locator(".kb-location")).toContainText("光轴校准 · 第 1–2 行");
  await expect(library.locator(".kb-document[data-selected=true]")).toContainText("光轴.md");
  await page.screenshot({ path: testInfo.outputPath("reader.png") });
  await library.getByRole("button", { name: "知识库目录" }).click();
  const row = library
    .locator("[data-pack-id]")
    .filter({ has: page.getByRole("link", { name: "望远镜维护手册" }) });
  await expect(row).toContainText("1 篇可搜");
  await expect(row).toContainText("未挂载");
  const libraryLink = row.getByRole("link", { name: "望远镜维护手册" });
  await expect(row).toHaveClass(/MuiCard-root/);
  await page.mouse.move(0, 0);
  await row.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined));
  const originalColor = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  await libraryLink.hover();
  await expect(libraryLink).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(row).not.toHaveCSS("background-color", originalColor);
  await row.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined));
  const hoverColor = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  const bounds = await row.boundingBox();
  const blank = { x: Math.round(bounds!.width * 0.68), y: 9 };
  await row.hover({ position: blank });
  await expect(row).toHaveCSS("background-color", hoverColor);
  await page.mouse.down();
  const ripple = libraryLink.locator(".MuiTouchRipple-rippleVisible");
  await expect(ripple).toHaveCount(1);
  const center = await ripple.evaluate(el => parseFloat(el.style.left) + parseFloat(el.style.width) / 2);
  expect(Math.abs(center - blank.x)).toBeLessThan(3);
  await page.screenshot({path:testInfo.outputPath("card-pressed.png")});
  await page.mouse.up();
  await expect(library.getByRole("heading", { name: "望远镜维护手册" })).toBeVisible();
  await page.reload();
  await expect(library.getByRole("heading", { name: "望远镜维护手册" })).toBeVisible();
  await page.goBack();
  await library.getByRole("button", { name: "新建知识库" }).focus();
  await page.keyboard.press("Tab");
  await expect(libraryLink).toBeFocused();
  await expect(row).toHaveCSS("outline-style", "solid");
  await row.getByRole("button", { name: "选择配置档" }).click();
  await library.getByRole("switch").first().click();
  await expect(library.getByRole("switch").first()).toBeChecked();
  await library.getByRole("button", { name: "知识库目录" }).click();
  await expect(row).toContainText("仅本人");
  await expect(row).not.toContainText("未挂载");
  await page.reload();
  await expect(library.getByRole("link", { name: /望远镜维护手册/ })).toBeVisible();
  const desktop = testInfo.outputPath("directory-desktop.png");
  await page.screenshot({ path: desktop });
  await testInfo.attach("知识库目录 · 桌面", { path: desktop, contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await consolePreferences.set({ appearance: "dark" });
  await page.goto("/capabilities/knowledge");
  await expect(page.locator("[data-console-root]")).toHaveAttribute("data-appearance", "dark");
  await expect(library.getByRole("link", { name: /望远镜维护手册/ })).toBeVisible();
  const mobileBounds = await library.boundingBox();
  expect(mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const mobile = testInfo.outputPath("directory-mobile.png");
  await page.screenshot({ path: mobile });
  await testInfo.attach("知识库目录 · 窄屏", { path: mobile, contentType: "image/png" });
  await expect(row.getByText("可搜索", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "望远镜维护手册" }).press("Enter");
  const openDoc = library.getByRole("button", { name: /光轴.md 可搜索/ });
  await openDoc.press("Enter");
  await expect(library.locator(".kb-original h2")).toBeFocused();
  await expect(openDoc).toBeHidden();
  await library.getByRole("button", { name: "返回文档列表" }).press("Enter");
  await expect(openDoc).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/webchat");
  const chat = page.locator('[data-webchat-target="live"]');
  const composer = chat.getByRole("textbox", { name: "输入聊天消息" });
  await composer.fill("主镜校准标记");
  await composer.press("Enter");
  const answer = chat.locator('[data-message-role="assistant"]').last();
  await expect(answer).toHaveAttribute("data-message-status", "completed");
  await answer.locator("summary").filter({ hasText: "光轴.md" }).click();
  await expect(answer.getByRole("blockquote")).toContainText("浮鲸九号");
  await page.reload();
  await expect(chat.locator("summary").filter({ hasText: "光轴.md" }).last()).toBeVisible();
});

test("shows mounted empty libraries, group scope, duplicate imports and failed replacements", async ({
  page, consolePreferences
}, testInfo) => {
  await consolePreferences.set({ soulTheme: "astral-blue" });
  await page.goto("/capabilities/knowledge");
  const library = page.locator("[data-rag-page]");
  const button = (name: string) => library.getByRole("button", { name, exact: true });
  await button("新建知识库").click();
  await library.getByLabel("库名").fill("维修规程");
  await button("创建知识库").click();
  await button("选择配置档").click();
  await library.getByRole("combobox", { name: "资料受众" }).click();
  await page.getByRole("option", { name: "指定群组" }).click();
  await library.getByLabel("群组 ID").fill("维修班");
  await expect(button("保存受众")).toBeDisabled();
  await library.getByLabel("群组 ID").fill("maintenance-team");
  await button("保存受众").click();
  const profiles = library.getByRole("switch");
  await profiles.nth(0).click();
  await expect(profiles.nth(0)).toBeChecked();
  await profiles.nth(1).click();
  await expect(profiles.nth(1)).toBeChecked();
  await button("知识库目录").click();
  const row = library
    .locator("[data-pack-id]")
    .filter({ has: page.getByRole("link", { name: "维修规程", exact: true }) });
  await expect(row).toContainText("暂无资料");
  await expect(row).toContainText("有可搜索资料后可用");
  await expect(row).toContainText("群组 maintenance-team");
  await row.getByRole("button", { name: "另 1 个" }).press("Enter");
  await expect(row.getByRole("listitem")).toHaveCount(1);
  await row.getByRole("button", { name: "导入文档" }).click();
  await button("粘贴文本").press("Enter");
  const content = "校准完成后，用青竹标记登记。";
  await library.getByLabel("文档名称").fill("登记.txt");
  await library.getByLabel("原文", { exact: true }).fill(content);
  await library.getByLabel("原文", { exact: true }).press("Tab");
  await expect(button("导入并索引")).toBeFocused();
  await page.keyboard.press("Enter");
  const receipt = library.getByRole("region", { name: "导入结果" });
  await expect(receipt).toContainText("已可搜索");
  await expect(receipt).toContainText("群组 maintenance-team");
  await button("继续导入").click();
  const upload = async (name: string, data: string) => {
    await library
      .locator('input[type="file"]')
      .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(data) });
    await button("导入并索引").click();
  };
  await upload("同内容.txt", content);
  await expect(receipt).toContainText("内容已存在");
  await expect(receipt).toContainText("登记.txt");
  await receipt.getByRole("button", { name: "查看原文" }).click();
  const doc = library.locator(".kb-document").filter({ hasText: "登记.txt" });
  const menuTrigger = doc.getByRole("button", { name: "登记.txt 的操作" });
  await menuTrigger.press("Enter");
  await expect(page.getByRole("menuitem", { name: "更新文档" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuTrigger).toBeFocused();
  await menuTrigger.press("Enter");
  await page.getByRole("menuitem", { name: "更新文档" }).press("Enter");
  await upload("替换为空.txt", "   ");
  await expect(library.getByRole("alert")).toContainText("文档没有可索引文字");
  await button("查看仍可搜索的上一版").click();
  await expect(library.locator(".kb-original pre").first()).toHaveText(content);
  await expect(doc).toContainText("最近更新失败，仍使用上一版");
  await button("导入文档").click();
  await upload("空文件.txt", "   ");
  await expect(library.getByRole("alert")).toContainText("空文件.txt");
  await button("知识库目录").click();
  await expect(row).toContainText("1 篇可搜");
  await row.getByRole("button", { name: "2 次导入失败 · 查看原因" }).click();
  await expect(doc).toContainText("仍使用上一版");
  await button("重新导入").click();
  await upload("空文件.txt", "已经补全正文。");
  await expect(receipt).toContainText("已可搜索");
  await button("知识库目录").click();
  await expect(row).toContainText("2 篇可搜");
  await expect(row).toContainText("1 次导入失败");
  await page.screenshot({ path: testInfo.outputPath("directory-states.png") });
});
