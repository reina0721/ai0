import { expect, test } from "@playwright/test";

test("composes external page, button and submenu through host activation and removal", async ({ page, request }) => {
  const bootstrap = await (await request.get("/api/studio/bootstrap")).json();
  const plugins = bootstrap.snapshot.studioConfig.ecosystem.plugins;
  const enabled = new Set<string>();
  async function toggle(id: string, on: boolean) {
    if (on) enabled.add(id);
    else enabled.delete(id);
    const response = await request.post("/api/studio/config", {
      headers: { "x-ai0-owner-token": bootstrap.ownerToken },
      data: { ecosystem: { plugins: plugins.map((p: { id: string; enabled: boolean }) =>
        ["community.page", "community.button", "community.item"].includes(p.id) ? { ...p, enabled: enabled.has(p.id) } : p) } }
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto("/community/conversation");
  const button = page.getByRole("button", { name: "附件操作" });
  const item = page.getByRole("button", { name: "选择附件" });
  await toggle("community.item", true);
  await toggle("community.button", true);
  await toggle("community.page", true);
  await button.click();
  await expect(item).toBeVisible();
  await toggle("community.item", false);
  await expect(item).toHaveCount(0);
  await expect(button).toBeVisible();
  await toggle("community.item", true);
  await expect(item).toBeVisible();
  await toggle("community.button", false);
  await expect(button).toHaveCount(0);
  await toggle("community.button", true);
  await button.click();
  await expect(item).toHaveCount(1);
  await toggle("community.page", false);
  await expect(button).toHaveCount(0);
  await expect(item).toHaveCount(0);
});

test("WebChat owns its navigation, page and composer extensions", async ({ page, request }) => {
  const bootstrap = await (await request.get("/api/studio/bootstrap")).json();
  const plugins = bootstrap.snapshot.studioConfig.ecosystem.plugins as { id: string; enabled: boolean }[];
  const headers = { "x-ai0-owner-token": bootstrap.ownerToken };
  async function configure(chat: boolean, tools: boolean) {
    const response = await request.post("/api/studio/config", { headers, data: { ecosystem: {
      plugins: plugins.map(p => ({ ...p, enabled: p.id === "builtin.webchat" ? chat : p.id === "community.webchat-tools" ? tools : p.enabled }))
    } } });
    expect(response.ok()).toBe(true);
  }
  try {
    await configure(true, true);
    await page.goto("/dashboard");
    const navigation = page.getByRole("navigation", { name: "控制台主导航" });
    const chat = navigation.getByRole("link", { name: "WebChat", exact: true });
    await chat.click();
    await expect(page).toHaveURL(/\/webchat$/);
    await page.getByRole("button", { name: "扩展工具" }).click();
    await expect(page.getByText("工具已打开")).toBeVisible();
    const manager = await page.context().newPage();
    await manager.goto("/capabilities/extensions");
    const webchatCard = manager.locator('[data-plugin-card="builtin.webchat"]');
    for (const facet of ["交互通道", "上行感知", "下行表达", "控制台视图"]) {
      await expect(webchatCard.getByText(facet, { exact: true })).toBeVisible();
    }
    const toggle = webchatCard.getByRole("switch");
    await toggle.click();
    await expect(chat).toHaveCount(0);
    await expect(page.getByText("工具已打开")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "页面不可用" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "追踪与沙盒调试" })).toBeVisible();
    await page.goto("/channels/stage/builtin.webchat");
    await expect(page.getByRole("heading", { name: "页面不可用" })).toBeVisible();
    await toggle.click();
    await manager.close();
    await expect(page.getByRole("button", { name: "扩展工具" })).toHaveCount(1);
    await configure(true, false);
    await expect(page.getByRole("button", { name: "扩展工具" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "输入聊天消息" })).toBeVisible();
  } finally {
    await request.post("/api/studio/config", { headers, data: { ecosystem: { plugins } } });
  }
});
