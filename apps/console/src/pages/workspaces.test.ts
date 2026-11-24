import { describe, expect, it } from "vitest";

import { renderRoutePageView } from "./index.js";
import { renderToHtml } from "../ssr-test-helper.js";

const workspaces = {
  // 1. Overview & Chat
  "/dashboard": "仪表盘",
  "/conversations": "会话管理",

  // 2. Core Configuration
  "/config/profiles": "配置文件 (Profiles)",
  "/config/routing": "会话路由规则 (UMO)",
  "/config/blackboard": "上下文黑板编排",
  "/soul/persona": "角色设定与契约",
  "/soul/distiller": "角色卡导入蒸馏",
  "/soul/lorebooks": "世界书",
  "/soul/homeostasis": "作息与情绪特征",

  // 3. General Capabilities
  "/capabilities/memory": "记忆图谱与隐私擦除",
  "/capabilities/sleep": "睡眠整理与演化",
  "/capabilities/relationship": "关系状态与里程碑",
  "/capabilities/events": "原始事件与语料",
  "/capabilities/knowledge": "知识库",
  "/capabilities/multimodal": "语音与多模态",
  "/capabilities/agents": "子代理与任务",
  "/capabilities/extensions": "已安装插件",
  "/capabilities/extensions/market": "扩展市场",
  "/capabilities/extensions/mcp": "MCP 服务",
  "/capabilities/extensions/skills": "技能 (Skills)",
  "/capabilities/extensions/automation": "指令与自动化",

  // 4. External Integrations (Pure Resource Pools)
  "/integrations/providers": "服务提供商",
  "/integrations/platforms": "消息平台与躯壳",

  // 5. Observability & System
  "/system/observability": "链路追踪与日志",
  "/system/sandbox": "沙盒实验与回归评测",
  "/system/simulator": "协议模拟器",
  "/system/settings": "灵魂实例与导出",
  "/system/security": "安全认证与外观",
  "/system/compliance": "合规护栏 (SB 243)",

  // Legacy URL compatibility redirects
  "/models/providers": "服务提供商",
  "/shells/topology": "消息平台与躯壳",
  "/profiles/rules": "会话路由规则 (UMO)",
  "/capabilities/extensions/config": "指令与自动化",
  "/capabilities/extensions/flows": "指令与自动化",
  "/capabilities/extensions/agents": "子代理与任务"
};

describe("console workspace content", () => {
  it("renders the specific heading for every orthogonal route and legacy alias", () => {
    for (const [pathname, title] of Object.entries(workspaces)) {
      const markup = renderToHtml(renderRoutePageView(pathname));
      const heading = markup.match(/<h1(?:\s[^>]*)?>(.*?)<\/h1>/u)?.[1]?.replace(/<[^>]*>/gu, "") ?? "";
      expect(heading, pathname).toContain(title);
    }
  });

  it("shows the identifier for an unregistered dynamic workspace", () => {
    const shell = renderToHtml(renderRoutePageView("/shells/stage/not-mounted"));
    const extension = renderToHtml(renderRoutePageView("/extensions/custom/unknown-plugin"));
    expect(shell).toContain("页面不可用");
    expect(shell).toContain("not-mounted");
    expect(extension).toContain("页面不可用");
    expect(extension).toContain("unknown-plugin");
  });
});
