import type { Locator } from "@playwright/test";

type Probe =
  | { selector: string; enabled?: boolean }
  | { role: "button" | "heading" | "table" | "link"; name: string; enabled?: boolean };

interface RouteContract {
  heading: string | RegExp;
  probe: Probe;
}

// Each route has its own browser-visible affordance or loaded record, independently of the router's shell metadata.
export const ROUTE_CONTRACTS: Record<string, RouteContract> = {
  "dashboard.overview": { heading: "系统概览", probe: { selector: '[aria-label="实时运行概况"]' } },
  "dashboard.conversations": { heading: "会话记录", probe: { selector: "[data-trigger-sleep-run]", enabled: true } },
  "dashboard.blackboard": { heading: "上下文黑板", probe: { selector: "[data-prompt-brick-id] [data-brick-template]:not(:disabled)", enabled: true } },
  "shells.topology": { heading: "接入通道", probe: { selector: "[data-platform-id] [data-plat-enabled]", enabled: true } },
  "shells.profiles-rules": { heading: "受众与策略", probe: { selector: "[data-profile-id]" } },
  "shells.attention": { heading: "注意力焦点仲裁", probe: { role: "heading", name: "共享机会池" } },
  "shells.thalamic-gate": { heading: "话轮防抖与感官门控", probe: { selector: "[data-plat-debounce]", enabled: true } },
  "shells.media-pipeline": { heading: "语音与表现管线", probe: { role: "button", name: "配置服务商", enabled: true } },
  "shells.simulator": { heading: "躯壳协议模拟器", probe: { selector: 'textarea[aria-label="模拟文本"]', enabled: true } },
  "soul.distiller": { heading: "角色卡片蒸馏", probe: { selector: "[data-distill-preview]", enabled: true } },
  "soul.persona": { heading: "关系契约与性格设定", probe: { selector: "[data-select-archetype]", enabled: true } },
  "soul.homeostasis": { heading: "节律与情绪动力学", probe: { selector: '[aria-label="24 小时作息活力曲线"]' } },
  "soul.lorebooks": { heading: "世界书", probe: { selector: "[data-lore-id]" } },
  "memory.lineage": { heading: "记忆图谱与隐私擦除", probe: { selector: 'table[aria-label="记忆节点"] tbody button', enabled: true } },
  "memory.retrieval-sleep": { heading: "睡眠与演化", probe: { selector: "[data-proposal-card]" } },
  "memory.knowledge-rag": { heading: "知识库 (RAG)", probe: { selector: "[data-pack-id]" } },
  "memory.relationship": { heading: "关系状态与里程碑", probe: { role: "button", name: "解除未解张力", enabled: true } },
  "memory.events-media": { heading: "原始事件与语料", probe: { selector: 'table[aria-label="事件记录"] tbody button', enabled: true } },
  "models.providers": { heading: "模型与多模态服务", probe: { selector: 'input[data-prov-model="prov_deepseek_v3"]', enabled: true } },
  "models.routing": { heading: "脑区路由与代谢策略", probe: { selector: '[data-route-primary="W1_fast_dialogue"]', enabled: true } },
  "extensions.marketplace": { heading: "插件与扩展管理", probe: { selector: 'input[aria-label="过滤扩展"]', enabled: true } },
  "extensions.configurator": { heading: "插件配置与指令", probe: { selector: "[data-plugin-card]" } },
  "extensions.skills-mcp": { heading: "技能与 MCP", probe: { selector: "[data-mcp-id]" } },
  "extensions.cognitive-organs": { heading: "认知器官模块", probe: { role: "button", name: "查看梦境手记", enabled: true } },
  "extensions.flows-eca": { heading: "自动化联动流", probe: { selector: "[data-flow-id]" } },
  "runtime.coordinator-agency": { heading: "子代理与任务", probe: { selector: "[data-subagent-id]" } },
  "runtime.terminal": { heading: "链路追踪与日志", probe: { selector: 'input[aria-label="搜索轨迹"]', enabled: true } },
  "runtime.sandbox-lab": { heading: "沙盒实验与回归评测", probe: { role: "button", name: "切换到沙盒", enabled: true } },
  "system.instances-storage": { heading: "导出与多实例", probe: { selector: '[data-export-pack="ai0pack"]', enabled: true } },
  "system.safety-sb243": { heading: "权限矩阵与合规护栏", probe: { role: "heading", name: "三维工具与动作授权矩阵" } },
  "system.settings-security": { heading: "安全与外观", probe: { selector: '[data-set-appearance="dark"]', enabled: true } }
};

export const ROUTE_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, appearance: "light", theme: "sakura-pink" },
  { name: "mobile", width: 390, height: 844, appearance: "dark", theme: "astral-blue" }
] as const;

export function routeProbe(main: Locator, probe: Probe): Locator {
  if ("selector" in probe) return main.locator(probe.selector).first();
  return main.getByRole(probe.role, { name: probe.name, exact: true }).first();
}
