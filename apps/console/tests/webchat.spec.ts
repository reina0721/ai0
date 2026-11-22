import { expect, test } from "@playwright/test";

const stagePath = "/shells/stage/builtin.webchat";
const runPath = "/api/studio/webchat/runs";

test("persists one private WebChat turn and keeps drafts isolated by target", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(stagePath);
  const live = page.locator('[data-webchat-target="live"]');
  const composer = live.getByRole("textbox", { name: "输入聊天消息" });
  const original = `你好，我是浏览器测试 ${crypto.randomUUID()}`;
  const restingBorder = await composer.evaluate((field) => getComputedStyle(field.closest("form")!).borderColor);
  await composer.fill(original);
  await expect(composer).toBeFocused();
  const focusTreatment = await composer.evaluate((field) => {
    const style = getComputedStyle(field);
    const form = getComputedStyle(field.closest("form")!);
    return { border: style.borderTopWidth, outline: style.outlineStyle, shadow: style.boxShadow, outer: form.borderColor };
  });
  expect(focusTreatment).toMatchObject({ border: "0px", outline: "none", shadow: "none" });
  expect(focusTreatment.outer).not.toBe(restingBorder);
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue(`${original}\n`);
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  await expect(composer).toHaveValue(`${original}\n`);
  await expect(live.getByRole("button", { name: "发送" })).toBeEnabled();

  const sent = page.waitForRequest((request) => new URL(request.url()).pathname === runPath && request.method() === "POST");
  const delivered = page.waitForResponse((response) => response.url().endsWith("/receipt") && response.request().method() === "POST");
  await composer.press("Enter");
  const { requestId, mode } = (await sent).postDataJSON() as { requestId: string; mode: string };
  expect(mode).toBe("live");
  const receipt = await delivered;
  expect(receipt.ok()).toBe(true);
  const assistant = live.locator(`[data-message-turn-id="${requestId}"][data-message-role="assistant"]`);
  await expect(assistant).toHaveAttribute("data-message-status", "completed");
  const detailsTrigger = assistant.getByRole("button", { name: "查看本轮详情" });
  const traceRead = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/runs/${requestId}/trace`));
  await detailsTrigger.click();
  expect((await traceRead).ok()).toBe(true);
  const inspector = page.getByRole("complementary", { name: "会话详情" });
  await expect(inspector).toHaveCount(1);
  await expect(inspector.getByRole("heading", { name: "处理阶段 累计耗时" })).toBeVisible();
  await expect(inspector.getByText(/已显示 \d+ 字/u)).toBeVisible();
  await expect(inspector.getByRole("heading", { name: /记忆来源/u })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${stagePath}$`, "u"));
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(detailsTrigger).toBeFocused();

  await page.reload();
  await expect(assistant).toHaveCount(1);
  await live.getByRole("button", { name: "搜索对话" }).click();
  await live.getByRole("textbox", { name: "搜索此会话的记录" }).fill(original);
  await expect(live.locator("[data-message-role=assistant]")).toHaveCount(1);
  await live.getByRole("button", { name: "关闭搜索" }).click();

  await live.getByRole("button", { name: "清空当前显示" }).click();
  await expect(assistant).toHaveCount(0);
  await live.getByRole("button", { name: "认识一下" }).click();
  await expect(composer).toHaveValue("介绍一下你自己。");
  await expect(composer).toBeFocused();
  await expect(live.getByRole("button", { name: "认识一下" })).toHaveCount(0);
  await page.reload();
  await expect(assistant).toHaveCount(0);
  await live.getByRole("button", { name: "恢复对话显示" }).click();
  await expect(assistant).toHaveCount(1);

  await composer.fill("正式环境草稿");
  await page.getByRole("button", { name: "SANDBOX", exact: true }).click();
  const sandbox = page.locator('[data-webchat-target="sandbox"]');
  await expect(sandbox.getByRole("textbox", { name: "输入聊天消息" })).toHaveValue("");
  await expect(sandbox.locator(`[data-message-turn-id="${requestId}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "LIVE", exact: true }).click();
  await expect(composer).toHaveValue("正式环境草稿");

  await page.setViewportSize({ width: 390, height: 844 });
  await live.getByRole("button", { name: "会话详情", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "会话详情" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "关闭会话详情" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(composer).toHaveValue("正式环境草稿");
  expect(pageErrors).toEqual([]);
});

test("records only the delivered prefix when WebChat is stopped", async ({ page }) => {
  // Hold later browser delivery frames while retaining the actual daemon connection and receipt endpoints.
  await page.addInitScript((runs) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (new URL(response.url, location.origin).pathname !== runs || !response.body || !response.ok) return response;
      let buffer = "";
      let firstDelta = false;
      let paused = false;
      const delayed = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
        async transform(chunk, controller) {
          buffer += chunk;
          for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
            const frame = buffer.slice(0, end + 2);
            buffer = buffer.slice(end + 2);
            if (firstDelta && !paused) {
              paused = true;
              await new Promise((resolve) => setTimeout(resolve, 900));
            }
            controller.enqueue(frame);
            firstDelta ||= frame.includes('"type":"text-delta"');
          }
        },
        flush(controller) { if (buffer) controller.enqueue(buffer); }
      })).pipeThrough(new TextEncoderStream()).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          for (let start = 0; start < bytes.length; start += 7) controller.enqueue(bytes.slice(start, start + 7));
        }
      }));
      return new Response(delayed, response);
    };
  }, runPath);
  await page.goto(`${stagePath}?mode=sandbox`);
  const sandbox = page.locator('[data-webchat-target="sandbox"]');
  const composer = sandbox.getByRole("textbox", { name: "输入聊天消息" });
  await composer.fill("你好，请介绍你自己和能做些什么。");
  await expect(sandbox.getByRole("button", { name: "发送" })).toBeEnabled();
  const sent = page.waitForRequest((request) => new URL(request.url()).pathname === runPath && request.method() === "POST");
  await composer.press("Enter");
  const { requestId } = (await sent).postDataJSON() as { requestId: string };
  const assistant = sandbox.locator(`[data-message-turn-id="${requestId}"][data-message-role="assistant"]`);
  await expect(assistant.locator(".ai0-chat-markdown")).toBeVisible();
  const stop = page.waitForResponse((response) => response.url().endsWith(`/runs/${requestId}/stop`));
  await sandbox.getByRole("button", { name: "停止", exact: true }).click();
  const response = await stop;
  expect(response.ok()).toBe(true);
  const body = await response.json() as { text: string; receipt: { status: string; spokenCharOffset: number } };
  expect(body.receipt.status).toBe("interrupted");
  expect(body.receipt.spokenCharOffset).toBeGreaterThan(0);
  expect(Array.from(body.text)).toHaveLength(body.receipt.spokenCharOffset);
  expect(body.text).not.toContain("\uFFFD");
  await expect(assistant).toHaveAttribute("data-message-status", "interrupted");
  await page.reload();
  await expect(assistant).toHaveAttribute("data-message-status", "interrupted");
  await expect(assistant.locator(".ai0-chat-markdown")).toContainText(body.text.trim());
});

test("confirms Markdown links and preserves table actions in themed overlays", async ({ page }, testInfo) => {
  const destination = "https://example.com/docs";
  const reply = `[服务文档](${destination})\n\n| 名称 | 数量 |\n| --- | --- |\n| 示例 | 42 |`;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.context().route(destination, (route) => route.fulfill({ body: "Documentation" }));
  await page.route("**/api/studio/webchat/history?mode=live", (route) => route.fulfill({ json: { turns: [{
    eventId: "evt-browser-markdown", traceId: "trace-browser-markdown", targetInstance: "live", userText: "示例文档",
    assistantText: reply, timestamp: "2026-11-23T10:00:00.000Z",
    receipt: { status: "completed", spokenCharOffset: Array.from(reply).length }
  }] } }));
  await page.goto(stagePath);
  const assistant = page.locator('[data-message-turn-id="evt-browser-markdown"][data-message-role="assistant"]');
  const link = assistant.getByRole("button", { name: "服务文档" });
  await link.click();
  const confirmation = page.getByRole("dialog", { name: "打开外部链接" });
  await expect(confirmation.getByText(destination, { exact: true })).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeFocused();
  await testInfo.attach("webchat-external-link-dialog", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(link).toBeFocused();
  await link.click();
  const popupOpened = page.waitForEvent("popup");
  await confirmation.getByRole("button", { name: "继续访问" }).click();
  const popup = await popupOpened;
  await popup.waitForURL(destination);
  await popup.close();

  await assistant.getByRole("button", { name: "复制表格" }).click();
  const copyMenu = page.getByRole("menu", { name: "复制格式" });
  await expect(copyMenu.getByRole("menuitem")).toHaveText(["Markdown", "CSV", "TSV"]);
  await testInfo.attach("webchat-markdown-table-menu", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
  await copyMenu.getByRole("menuitem", { name: "TSV" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("示例\t42");
  await assistant.getByRole("button", { name: "下载表格" }).click();
  const downloadStarted = page.waitForEvent("download");
  await page.getByRole("menu", { name: "下载格式" }).getByRole("menuitem", { name: "CSV" }).click();
  await expect((await downloadStarted).suggestedFilename()).toBe("table.csv");
  const fullscreen = assistant.getByRole("button", { name: "全屏查看表格" });
  await fullscreen.click();
  const tableDialog = page.getByRole("dialog", { name: "消息表格" });
  await expect(tableDialog.getByRole("cell", { name: "42" })).toBeVisible();
  await tableDialog.getByRole("button", { name: "关闭全屏表格" }).click();
  await expect(tableDialog).toHaveCount(0);
  await expect(fullscreen).toBeFocused();
});
