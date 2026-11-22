import { describe, expect, it } from "vitest";

import { renderRoutePageView } from "./index.js";
import { renderToHtml } from "../ssr-test-helper.js";

const workspaces = {
  "/dashboard": "系统概览",
  "/dashboard/blackboard": "上下文黑板",
  "/conversations": "会话记录",
  "/shells/stage/builtin.webchat": "WebChat",
  "/shells/topology": "接入通道",
  "/shells/attention-arbitration": "注意力焦点仲裁",
  "/shells/thalamic-gate": "话轮防抖与感官门控",
  "/shells/media-pipeline": "语音与表现管线",
  "/shells/simulator": "虚拟躯壳模拟器",
  "/profiles/rules": "受众与策略",
  "/soul/distiller": "角色卡片蒸馏",
  "/soul/persona": "关系契约与性格设定",
  "/soul/homeostasis": "节律与情绪动力学",
  "/soul/lorebooks": "世界书",
  "/memory/lineage": "记忆图谱与隐私擦除",
  "/memory/relationship": "关系状态与里程碑",
  "/memory/events-media": "原始事件与语料",
  "/memory/retrieval-sleep": "睡眠与演化",
  "/memory/knowledge-rag": "知识库 (RAG)",
  "/models/providers": "模型与多模态服务",
  "/models/routing": "脑区路由与代谢策略",
  "/extensions/marketplace": "插件与扩展管理",
  "/extensions/configurator": "插件配置与指令",
  "/extensions/skills-mcp": "技能与 MCP",
  "/extensions/cognitive-organs": "认知器官模块",
  "/extensions/flows-eca": "自动化联动流",
  "/extensions/custom/dream-journal": "梦境手记",
  "/runtime/coordinator-agency": "子代理与任务",
  "/runtime/terminal": "链路追踪与日志",
  "/sandbox/lab": "沙盒实验与回归评测",
  "/system/instances-storage": "导出与多实例",
  "/system/safety-sb243": "权限矩阵与合规护栏",
  "/system/settings-security": "安全与外观"
};

describe("console workspace content", () => {
  it("renders the specific heading for all 33 canonical URLs", () => {
    for (const [pathname, title] of Object.entries(workspaces)) {
      const markup = renderToHtml(renderRoutePageView(pathname));
      const heading = markup.match(/<h1(?:\s[^>]*)?>(.*?)<\/h1>/u)?.[1]?.replace(/<[^>]*>/gu, "") ?? "";
      expect(heading, pathname).toContain(title);
    }
  });

  it("shows the identifier for an unregistered dynamic workspace", () => {
    const shell = renderToHtml(renderRoutePageView("/shells/stage/not-mounted"));
    const extension = renderToHtml(renderRoutePageView("/extensions/custom/unknown-plugin"));
    expect(shell).toContain("当前实例未注册该躯壳");
    expect(shell).toContain("not-mounted");
    expect(extension).toContain("当前实例未注册此扩展");
    expect(extension).toContain("unknown-plugin");
  });
});
