import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

const presets = [
  { id: "tpl_opencode_go", baseUrl: "https://opencode.ai/inference/go/openai/v1" },
  { id: "tpl_command_code", baseUrl: "https://api.commandcode.ai/provider/v1" },
  { id: "tpl_openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "tpl_moonshot", baseUrl: "https://api.moonshot.cn/v1" },
  { id: "tpl_zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4" }
];

test("discovers a hosted catalog and uses saved model parameters for probe and WebChat", async ({ page }) => {
  const modelId = "openai/browser-test-model";
  const otherModelId = "openai/browser-verification-model";
  const unselectedModelId = "openai/unused-model";
  const reply = "来自托管模型的浏览器测试回复。";
  const key = "sk-browser-test-provider";
  const sourceLabel = "Playwright OpenRouter";
  const completions: Array<{ model: string; stream?: boolean; reasoning?: { effort: string } }> = [];
  let failCatalog = true;
  let includeReasoningEfforts = false;
  let waitForCatalog: Promise<void> | undefined;
  let catalogCalls = 0;
  const upstream = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(401).end("{}");
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/models") {
      catalogCalls += 1;
      await waitForCatalog;
      if (failCatalog) {
        response.writeHead(503).end(JSON.stringify({ error: "catalog offline" }));
        return;
      }
      response.end(JSON.stringify({ data: [modelId, otherModelId, unselectedModelId].map((id) => ({
        id,
        endpoints: ["/api/v1/chat/completions"],
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: id === modelId ? ["response_format", "temperature", "reasoning"] : ["response_format"],
        context_length: includeReasoningEfforts ? 262144 : 131072,
        top_provider: { max_completion_tokens: includeReasoningEfforts ? 392000 : 384000 },
        ...(id === modelId
          ? (includeReasoningEfforts ? { reasoning: { supported_efforts: ["low", "high"] } } : {})
          : { reasoning: { supported_efforts: [] } })
      })) }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/chat/completions") {
      let body = "";
      for await (const chunk of request.setEncoding("utf8")) body += chunk;
      const completion = JSON.parse(body) as typeof completions[number];
      completions.push(completion);
      if (completion.model !== modelId) {
        response.writeHead(404).end("{}");
        return;
      }
      if (!completion.stream) {
        response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
        return;
      }
      const content = JSON.stringify({
        surface_utterance: reply,
        theatrical_subtext: "确认调用测试模型",
        masked_placeholder: "",
        chosen_strategy: "直接回答",
        interaction_frame: "serious_factual",
        vocal_emotion_tag: "neutral",
        facial_expression: "neutral",
        valence_impulse: "none",
        provider_used: "openrouter",
        model_used: modelId
      });
      const frame = (delta: object, finishReason: string | null) => `data: ${JSON.stringify({
        id: "browser-mock-completion", model: modelId, created: 1, object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason: finishReason }]
      })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`${frame({ content }, null)}${frame({}, "stop")}data: [DONE]\n\n`);
      return;
    }
    response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });

  let restoreProfiles: (() => Promise<unknown>) | undefined;
  let deleteSource: (() => Promise<unknown>) | undefined;
  try {
    const bootstrap = await page.request.get("/api/studio/bootstrap?mode=live");
    expect(bootstrap.ok()).toBe(true);
    const { ownerToken } = await bootstrap.json() as { ownerToken: string };
    const headers = { "x-ai0-owner-token": ownerToken };
    const profilesPath = "/api/admin/v1/config/profiles?target_instance=live";
    const profilesResponse = await page.request.get(profilesPath, { headers });
    expect(profilesResponse.ok()).toBe(true);
    const originalProfiles = await profilesResponse.json();

    await page.goto("/integrations/providers");
    await page.getByRole("button", { name: "新增服务来源", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增服务提供商来源" });
    const baseUrl = dialog.getByRole("textbox", { name: "新增来源 Base URL" });
    await expect(dialog.getByRole("textbox", { name: "初始模型列表" })).toHaveCount(0);
    for (const preset of presets) {
      await dialog.locator(`[data-vendor-template="${preset.id}"]`).click();
      await expect(baseUrl).toHaveValue(preset.baseUrl);
    }

    await dialog.locator('[data-vendor-template="tpl_openrouter"]').click();
    await dialog.getByRole("textbox", { name: "自定义来源名称" }).fill(sourceLabel);
    await baseUrl.fill(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}/api/v1`);
    await dialog.getByRole("textbox", { name: "初始 API Key" }).fill(key);
    const createRequest = page.waitForRequest((request) => request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/admin/v1/integrations/sources");
    const discoverRequest = page.waitForRequest((request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/fetch-models"));
    await dialog.getByRole("button", { name: "保存并获取模型" }).click();
    expect((await createRequest).postDataJSON()).not.toHaveProperty("initialModels");
    const source = page.locator("[data-source-item]", { hasText: sourceLabel });
    await expect(source).toBeVisible();
    const sourceId = await source.getAttribute("data-source-item");
    deleteSource = () => page.request.delete(`/api/admin/v1/integrations/sources/${sourceId}?target_instance=live`, { headers });
    expect(new URL((await discoverRequest).url()).pathname).toBe(`/api/admin/v1/integrations/sources/${sourceId}/fetch-models`);
    await expect(page.getByRole("heading", { name: `模型目录 · ${sourceLabel}`, exact: true })).toBeVisible();
    const catalog = page.locator(".ai0-drawer-surface");
    const retry = catalog.getByRole("button", { name: "重新拉取" });
    const add = catalog.getByRole("button", { name: "添加所选模型" });
    await expect(catalog.getByRole("status")).toContainText("HTTP 503");
    await expect(add).toBeDisabled();

    failCatalog = false;
    await retry.click();
    const remoteModel = page.locator(`[data-remote-model="${modelId}"]`);
    await expect(remoteModel).toBeVisible();
    await expect(catalog.getByText("目录来源：上游 API", { exact: true })).toBeVisible();
    await expect(page.locator("[data-model-card]", { hasText: modelId })).toHaveCount(0);
    await page.getByRole("button", { name: "关闭模型目录" }).click();

    const navigation = page.getByRole("navigation", { name: "控制台主导航" });
    await navigation.getByRole("link", { name: "配置文件与路由", exact: true }).click();
    await page.getByRole("combobox", { name: "主力对话服务提供商" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: sourceLabel, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await navigation.getByRole("link", { name: "服务提供商", exact: true }).click();
    await source.click();
    failCatalog = true;
    const staleCatalogRequest = page.waitForRequest((request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/fetch-models"));
    await page.getByRole("button", { name: "模型目录 (3)", exact: true }).click();
    await staleCatalogRequest;
    await expect(catalog.getByRole("status")).toContainText("HTTP 503");
    await expect(remoteModel).toBeVisible();
    const primaryCheck = catalog.getByRole("checkbox", { name: `选择模型 ${modelId}` });
    const secondaryCheck = catalog.getByRole("checkbox", { name: `选择模型 ${otherModelId}` });
    await primaryCheck.check();
    await secondaryCheck.check();
    await expect(catalog.getByText("已选 2 个模型", { exact: true })).toBeVisible();
    const importRequest = page.waitForRequest((request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/import-models"));
    await add.click();
    expect((await importRequest).postDataJSON()).toEqual({ modelIds: [modelId, otherModelId] });
    await expect(primaryCheck).toBeDisabled();
    await expect(secondaryCheck).toBeDisabled();
    await expect(catalog.getByRole("checkbox", { name: `选择模型 ${unselectedModelId}` })).toBeEnabled();
    await page.getByRole("button", { name: "关闭模型目录" }).click();
    await expect(page.getByRole("button", { name: /手动添加模型/u })).toHaveCount(0);
    await page.reload();
    await source.click();

    const model = page.locator("[data-model-card]", { hasText: modelId });
    const otherModel = page.locator("[data-model-card]", { hasText: otherModelId });
    await expect(otherModel).toBeVisible();
    await expect(page.locator("[data-model-card]", { hasText: unselectedModelId })).toHaveCount(0);

    const parameters = page.getByRole("dialog", { name: /^模型参数设置/u });
    const contextOverride = parameters.getByRole("spinbutton", { name: "上下文窗口覆盖" });
    const maxOutputTokens = parameters.getByRole("spinbutton", { name: "编辑 Max Tokens" });
    const effort = parameters.getByRole("combobox", { name: "推理强度" });
    const saveParameters = parameters.getByRole("button", { name: "保存模型参数" });
    await otherModel.locator("[data-edit-model]").click();
    await expect(effort).toBeDisabled();
    await expect(parameters.getByRole("spinbutton", { name: "编辑 Temperature" })).toBeDisabled();
    await expect(parameters.getByText("此模型未提供可配置的推理档位。")).toBeVisible();
    await expect(parameters.getByRole("combobox", { name: "上下文窗口模式" })).toHaveCount(0);
    await expect(parameters.getByRole("combobox", { name: "最大输出模式" })).toHaveCount(0);
    await expect(contextOverride).toHaveValue("131072");
    await expect(maxOutputTokens).toHaveValue("384000");
    await expect(saveParameters).toBeEnabled();
    const unchangedSettingsRequest = page.waitForRequest((request) => request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/api/admin/v1/integrations/models/"));
    await saveParameters.click();
    const unchangedSettings = (await unchangedSettingsRequest).postDataJSON();
    expect(unchangedSettings).toMatchObject({
      contextWindowOverride: null, useCatalogContextWindow: true, useCatalogMaxOutputTokens: true
    });
    expect(unchangedSettings).not.toHaveProperty("defaultMaxTokens");
    expect(unchangedSettings).not.toHaveProperty("defaultTemperature");
    await expect(parameters).toBeHidden();
    await otherModel.locator("[data-edit-model]").click();
    await maxOutputTokens.fill("4096");
    await saveParameters.click();
    await expect(parameters).toBeHidden();
    await otherModel.locator("[data-edit-model]").click();
    await expect(maxOutputTokens).toHaveValue("4096");
    await parameters.getByRole("button", { name: "取消" }).click();

    let releaseCatalog = () => {};
    waitForCatalog = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const modelCatalogRequest = page.waitForRequest((request) => request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/fetch-models"));
    try {
      await model.locator("[data-edit-model]").click();
      await modelCatalogRequest;
      await expect(parameters.getByRole("status")).toContainText("正在刷新模型接口数据");
      await expect(effort).toBeDisabled();
    } finally {
      releaseCatalog();
      waitForCatalog = undefined;
    }
    await expect(parameters.getByRole("status")).toContainText("HTTP 503");
    const attempts = catalogCalls;
    await parameters.getByRole("button", { name: "取消" }).click();
    await model.locator("[data-edit-model]").click();
    await expect(parameters.getByRole("button", { name: "重试刷新模型目录" })).toBeVisible();
    expect(catalogCalls).toBe(attempts);
    failCatalog = false;
    includeReasoningEfforts = true;
    await contextOverride.fill("2048");
    await parameters.getByRole("button", { name: "重试刷新模型目录" }).click();
    await expect(effort).toBeEnabled();
    await expect(parameters.getByText(/接口上下文窗口 262,144 Tokens/u)).toBeVisible();
    await expect(contextOverride).toHaveValue("2048");
    await expect(maxOutputTokens).toHaveValue("392000");
    await expect(saveParameters).toBeEnabled();
    await contextOverride.fill("511");
    await expect(saveParameters).toBeDisabled();
    await contextOverride.fill("2048");
    await maxOutputTokens.fill("512");
    await effort.click();
    await expect(page.getByRole("option")).toHaveText(["默认", "低", "高"]);
    await page.getByRole("option", { name: "高", exact: true }).click();
    const manualPatchRequest = page.waitForRequest((request) => request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/api/admin/v1/integrations/models/"));
    await saveParameters.click();
    expect((await manualPatchRequest).postDataJSON()).toMatchObject({
      contextWindowOverride: 2048, defaultMaxTokens: 512, useCatalogContextWindow: false, useCatalogMaxOutputTokens: false
    });
    await expect(parameters).toBeHidden();
    await expect(model.getByText("上下文 2,048 Tokens", { exact: true })).toBeVisible();
    await model.locator("[data-edit-model]").click();
    await expect(contextOverride).toHaveValue("2048");
    await expect(effort).toHaveText("高");
    await parameters.getByRole("button", { name: "取消" }).click();

    await model.locator("[data-test-model]").click();
    await expect(model.locator("[data-model-status]")).toHaveText(/^就绪/u);
    expect(completions.at(-1)).toMatchObject({ model: modelId, reasoning: { effort: "high" } });

    await navigation.getByRole("link", { name: "配置文件与路由", exact: true }).click();
    await page.getByRole("combobox", { name: "主力对话服务提供商" }).click();
    await page.getByRole("option", { name: sourceLabel, exact: true }).click();
    const modelChoice = page.getByRole("combobox", { name: "主力对话模型 ID" });
    await modelChoice.click();
    await page.getByRole("option", { name: modelId, exact: true }).click();
    await expect(modelChoice).toHaveText(modelId);
    restoreProfiles = () => page.request.put(profilesPath, { headers, data: originalProfiles });
    const save = page.getByRole("button", { name: "保存配置", exact: true });
    await save.click();
    await expect(save).toBeDisabled();

    await navigation.getByRole("link", { name: "WebChat", exact: true }).click();
    const live = page.locator('[data-webchat-target="live"]');
    const composer = live.getByRole("textbox", { name: "输入聊天消息" });
    await composer.fill("请用一句话说明模型接入验证是否完成。");
    await composer.press("Enter");
    await expect(live.locator('[data-message-role="assistant"]').getByText(reply, { exact: true })).toBeVisible();
    expect(completions.at(-1)).toMatchObject({ model: modelId, stream: true, reasoning: { effort: "high" } });

    const beforeTooLong = completions.length;
    await composer.fill("这是一段上下文测试。".repeat(650));
    await expect(live.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await composer.press("Enter");
    await expect(live.getByRole("status").filter({ hasText: "本轮内容超出模型上下文窗口。" })).toBeVisible();
    expect(completions).toHaveLength(beforeTooLong);

    await navigation.getByRole("link", { name: "服务提供商", exact: true }).click();
    await source.click();
    await model.locator("[data-edit-model]").click();
    await contextOverride.clear();
    await maxOutputTokens.clear();
    await effort.click();
    await page.getByRole("option", { name: "默认", exact: true }).click();
    const clearRequest = page.waitForRequest((request) => request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/api/admin/v1/integrations/models/"));
    await saveParameters.click();
    const modelPatch = (await clearRequest).postDataJSON();
    expect(modelPatch).toMatchObject({
      contextWindowOverride: null, reasoningEffort: null,
      useCatalogContextWindow: true, useCatalogMaxOutputTokens: true
    });
    expect(modelPatch).not.toHaveProperty("defaultMaxTokens");
    await expect(parameters).toBeHidden();
    await expect(model.getByText("上下文 262,144 Tokens", { exact: true })).toBeVisible();
    await model.locator("[data-edit-model]").click();
    await expect(contextOverride).toHaveValue("262144");
    await expect(maxOutputTokens).toHaveValue("392000");
    await expect(saveParameters).toBeEnabled();
    await expect(effort).toHaveText("默认");
    await parameters.getByRole("button", { name: "取消" }).click();
    const beforeDefaultProbe = completions.length;
    await model.locator("[data-test-model]").click();
    await expect.poll(() => completions.length).toBeGreaterThan(beforeDefaultProbe);
    expect(completions.at(-1)).not.toHaveProperty("reasoning");
  } finally {
    try {
      await restoreProfiles?.();
      await deleteSource?.();
    } finally {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }
});
