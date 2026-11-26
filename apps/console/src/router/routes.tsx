import type { ConsoleIconName } from "../design-system/tokens/index.js";

/**
 * Five Orthogonal Architectural Planes (AstrBot-inspired × ai0 Cognitive Kernel)
 */
export const PRIMARY_DOMAIN_IDS = [
  "overview",
  "config",
  "capabilities",
  "integrations",
  "system"
] as const;

export type PrimaryDomainId = (typeof PRIMARY_DOMAIN_IDS)[number];

export interface ConsolePrimaryDomain {
  id: PrimaryDomainId;
  label: string;
  icon: ConsoleIconName;
  defaultPath: string;
}

export interface ConsoleRoute {
  id: string;
  domainId: PrimaryDomainId;
  label: string;
  path: string;
  defaultConcretePath?: string;
  keywords?: readonly string[];
}

export interface ResolvedConsoleRoute extends ConsoleRoute {
  pathname: string;
  concretePath: string;
  params: Readonly<Record<string, string>>;
}

export interface ConsoleSidebarNavItem {
  id: string;
  label: string;
  icon: ConsoleIconName;
  path: string;
  domainId: PrimaryDomainId;
  matchPaths: readonly string[];
  badge?: string;
}

export interface ConsoleSidebarNavGroup {
  id: string;
  title: string;
  items: readonly ConsoleSidebarNavItem[];
}

/**
 * Clean 5-Plane × 11-Module Sidebar Navigation Architecture
 * Dynamic Cordis channel pages (e.g. WebChat) mount automatically under "overview";
 * non-channel plugin pages mount cleanly under "capabilities".
 */
export const CONSOLE_SIDEBAR_GROUPS: readonly ConsoleSidebarNavGroup[] = Object.freeze([
  {
    id: "group_overview",
    title: "概览与对话",
    items: [
      {
        id: "overview.dashboard",
        label: "仪表盘",
        icon: "dashboard",
        path: "/dashboard",
        domainId: "overview",
        matchPaths: ["/dashboard"]
      },
      {
        id: "overview.conversations",
        label: "会话管理",
        icon: "sessions",
        path: "/conversations",
        domainId: "overview",
        matchPaths: ["/conversations"]
      }
    ]
  },
  {
    id: "group_config",
    title: "核心配置",
    items: [
      {
        id: "config.profiles",
        label: "配置文件与路由",
        icon: "rules",
        path: "/config/profiles",
        domainId: "config",
        matchPaths: ["/config/profiles", "/config/routing", "/config/blackboard"]
      },
      {
        id: "config.persona",
        label: "人格与世界书",
        icon: "persona",
        path: "/soul/persona",
        domainId: "config",
        matchPaths: ["/soul/persona", "/soul/distiller", "/soul/lorebooks", "/soul/homeostasis"]
      }
    ]
  },
  {
    id: "group_capabilities",
    title: "通用能力",
    items: [
      {
        id: "capabilities.memory",
        label: "长期记忆",
        icon: "memory",
        path: "/capabilities/memory",
        domainId: "capabilities",
        matchPaths: [
          "/capabilities/memory",
          "/capabilities/sleep",
          "/capabilities/relationship",
          "/capabilities/events"
        ]
      },
      {
        id: "capabilities.knowledge",
        label: "知识库 (RAG)",
        icon: "knowledge",
        path: "/capabilities/knowledge",
        domainId: "capabilities",
        matchPaths: ["/capabilities/knowledge"]
      },
      {
        id: "capabilities.multimodal",
        label: "语音与多模态",
        icon: "mic",
        path: "/capabilities/multimodal",
        domainId: "capabilities",
        matchPaths: ["/capabilities/multimodal"]
      },
      {
        id: "capabilities.agents",
        label: "子代理与任务",
        icon: "subagents",
        path: "/capabilities/agents",
        domainId: "capabilities",
        matchPaths: ["/capabilities/agents"]
      },
      {
        id: "capabilities.extensions",
        label: "插件与扩展",
        icon: "extensions",
        path: "/capabilities/extensions",
        domainId: "capabilities",
        matchPaths: [
          "/capabilities/extensions",
          "/capabilities/extensions/market",
          "/capabilities/extensions/mcp",
          "/capabilities/extensions/skills",
          "/capabilities/extensions/automation"
        ]
      }
    ]
  },
  {
    id: "group_integrations",
    title: "外部接入",
    items: [
      {
        id: "integrations.providers",
        label: "服务提供商",
        icon: "models",
        path: "/integrations/providers",
        domainId: "integrations",
        matchPaths: ["/integrations/providers"]
      },
      {
        id: "integrations.platforms",
        label: "消息平台与交互通道",
        icon: "channels",
        path: "/integrations/platforms",
        domainId: "integrations",
        matchPaths: ["/integrations/platforms"]
      }
    ]
  },
  {
    id: "group_system",
    title: "调试与系统",
    items: [
      {
        id: "system.observability",
        label: "追踪与沙盒调试",
        icon: "telemetry",
        path: "/system/observability",
        domainId: "system",
        matchPaths: ["/system/observability", "/system/sandbox", "/system/simulator"]
      },
      {
        id: "system.settings",
        label: "系统与实例设置",
        icon: "system",
        path: "/system/settings",
        domainId: "system",
        matchPaths: ["/system/settings", "/system/security", "/system/compliance"]
      }
    ]
  }
]);

/** Backward-compatible export alias. */
export const CONSOLE_SIDEBAR_GROUPS_16 = CONSOLE_SIDEBAR_GROUPS;

export const CONSOLE_PRIMARY_DOMAINS: readonly ConsolePrimaryDomain[] = Object.freeze([
  { id: "overview", label: "概览与对话", icon: "dashboard", defaultPath: "/dashboard" },
  { id: "config", label: "核心配置", icon: "rules", defaultPath: "/config/profiles" },
  { id: "capabilities", label: "通用能力", icon: "extensions", defaultPath: "/capabilities/memory" },
  { id: "integrations", label: "外部接入", icon: "models", defaultPath: "/integrations/providers" },
  { id: "system", label: "调试与系统", icon: "system", defaultPath: "/system/observability" }
]);

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = Object.freeze([
  // 1. Overview & Chat
  { id: "overview.dashboard", domainId: "overview", label: "仪表盘", path: "/dashboard", keywords: ["首页", "概览", "状态"] },
  { id: "overview.conversations", domainId: "overview", label: "会话管理", path: "/conversations", keywords: ["会话", "聊天记录", "UMO"] },

  // 2. Core Configuration
  { id: "config.profiles", domainId: "config", label: "配置文件 (Profiles)", path: "/config/profiles", keywords: ["配置", "模型选择", "脑区路由", "防抖", "注意力"] },
  { id: "config.routing", domainId: "config", label: "会话路由规则 (UMO)", path: "/config/routing", keywords: ["路由", "受众", "规则", "UMO", "社交面具"] },
  { id: "config.blackboard", domainId: "config", label: "上下文黑板编排", path: "/config/blackboard", keywords: ["黑板", "提示词", "Prompt", "Token"] },
  { id: "config.persona", domainId: "config", label: "角色设定与契约", path: "/soul/persona", keywords: ["人格", "性格", "人设", "关系"] },
  { id: "config.distiller", domainId: "config", label: "角色卡导入蒸馏", path: "/soul/distiller", keywords: ["导入", "SillyTavern", "蒸馏"] },
  { id: "config.lorebooks", domainId: "config", label: "世界书 (Lorebook)", path: "/soul/lorebooks", keywords: ["世界观", "词库", "Lorebook"] },
  { id: "config.homeostasis", domainId: "config", label: "作息与情绪特征", path: "/soul/homeostasis", keywords: ["生物钟", "情绪", "作息", "免打扰"] },

  // 3. General Capabilities
  { id: "capabilities.memory", domainId: "capabilities", label: "记忆图谱与擦除", path: "/capabilities/memory", keywords: ["记忆", "遗忘", "隐私擦除"] },
  { id: "capabilities.sleep", domainId: "capabilities", label: "睡眠整理与演化", path: "/capabilities/sleep", keywords: ["睡眠", "反思", "提案"] },
  { id: "capabilities.relationship", domainId: "capabilities", label: "关系与里程碑", path: "/capabilities/relationship", keywords: ["羁绊", "纪念日", "心结"] },
  { id: "capabilities.events", domainId: "capabilities", label: "原始事件日志", path: "/capabilities/events", keywords: ["事件", "语料"] },
  { id: "capabilities.knowledge", domainId: "capabilities", label: "知识库 (RAG)", path: "/capabilities/knowledge", keywords: ["知识库", "RAG", "文档", "Embedding", "Rerank"] },
  { id: "capabilities.multimodal", domainId: "capabilities", label: "语音与多模态", path: "/capabilities/multimodal", keywords: ["语音", "TTS", "STT", "声线", "关键帧"] },
  { id: "capabilities.agents", domainId: "capabilities", label: "子代理与任务", path: "/capabilities/agents", keywords: ["SubAgent", "子代理", "任务", "日程"] },
  { id: "capabilities.extensions", domainId: "capabilities", label: "已安装插件", path: "/capabilities/extensions", keywords: ["插件", "扩展", "WebChat", "配置", "热重载"] },
  { id: "capabilities.extensions.market", domainId: "capabilities", label: "扩展市场", path: "/capabilities/extensions/market", keywords: ["市场", "商店", "安装扩展", "社区"] },
  { id: "capabilities.extensions.mcp", domainId: "capabilities", label: "MCP 服务", path: "/capabilities/extensions/mcp", keywords: ["MCP", "stdio", "SSE", "工具", "JSON导入"] },
  { id: "capabilities.extensions.skills", domainId: "capabilities", label: "技能 (Skills)", path: "/capabilities/extensions/skills", keywords: ["SKILL", "Markdown", "技能", "提示词"] },
  { id: "capabilities.extensions.automation", domainId: "capabilities", label: "指令与自动化", path: "/capabilities/extensions/automation", keywords: ["指令", "斜杠命令", "器官", "ECA", "自动化"] },

  // 4. External Integrations (Pure Resource Pools)
  { id: "integrations.providers", domainId: "integrations", label: "服务提供商", path: "/integrations/providers", keywords: ["API", "Key", "DeepSeek", "OpenAI", "Ollama", "模型接入"] },
  { id: "integrations.platforms", domainId: "integrations", label: "消息平台与交互通道", path: "/integrations/platforms", keywords: ["QQ", "Telegram", "Discord", "飞书", "通道", "交互通道", "Protocol"] },

  // 5. Observability & System
  { id: "system.observability", domainId: "system", label: "决策轨迹与日志", path: "/system/observability", keywords: ["日志", "Trace", "遥测"] },
  { id: "system.sandbox", domainId: "system", label: "沙盒实验与回放", path: "/system/sandbox", keywords: ["沙盒", "时间拨快", "评测"] },
  { id: "system.simulator", domainId: "system", label: "协议模拟器", path: "/system/simulator", keywords: ["模拟", "测试", "Protocol"] },
  { id: "system.settings", domainId: "system", label: "灵魂实例与导出", path: "/system/settings", keywords: ["多实例", "快照", "回档", "导出"] },
  { id: "system.security", domainId: "system", label: "安全认证与外观", path: "/system/security", keywords: ["代理", "2FA", "主题", "深色模式"] },
  { id: "system.compliance", domainId: "system", label: "合规护栏 (SB 243)", path: "/system/compliance", keywords: ["权限", "安全", "SB243"] }
]);

/** Backward-compatible export alias. */
export const CONSOLE_ROUTES_30 = CONSOLE_ROUTES;

const LEGACY_PATH_MAP: Readonly<Record<string, string>> = Object.freeze({
  "/dashboard/blackboard": "/config/blackboard",
  "/models/providers": "/integrations/providers",
  "/models/routing": "/config/profiles",
  "/channels/topology": "/integrations/platforms",
  "/channels/attention-arbitration": "/config/profiles",
  "/channels/thalamic-gate": "/config/profiles",
  "/channels/media-pipeline": "/capabilities/multimodal",
  "/channels/simulator": "/system/simulator",
  "/profiles/rules": "/config/routing",
  "/memory/lineage": "/capabilities/memory",
  "/memory/retrieval-sleep": "/capabilities/sleep",
  "/memory/knowledge-rag": "/capabilities/knowledge",
  "/memory/relationship": "/capabilities/relationship",
  "/memory/events-media": "/capabilities/events",
  "/extensions/marketplace": "/capabilities/extensions/market",
  "/extensions/configurator": "/capabilities/extensions",
  "/extensions/skills-mcp": "/capabilities/extensions/skills",
  "/extensions/cognitive-organs": "/capabilities/extensions/automation",
  "/extensions/flows-eca": "/capabilities/extensions/automation",
  "/capabilities/extensions/config": "/capabilities/extensions/automation",
  "/capabilities/extensions/flows": "/capabilities/extensions/automation",
  "/capabilities/extensions/agents": "/capabilities/agents",
  "/runtime/coordinator-agency": "/capabilities/agents",
  "/runtime/terminal": "/system/observability",
  "/sandbox/lab": "/system/sandbox",
  "/system/instances-storage": "/system/settings",
  "/system/safety-sb243": "/system/compliance",
  "/system/settings-security": "/system/security"
});

export function canonicalizeConsolePath(pathname: string): string {
  const raw = pathname.split(/[?#]/, 1)[0] || "/";
  const normalized = `/${raw}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  const clean = normalized === "" || normalized === "/" ? "/dashboard" : normalized;
  return LEGACY_PATH_MAP[clean] ?? clean;
}

function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index]!;
    const value = actual[index]!;
    if (!segment.startsWith(":")) {
      if (segment !== value) return undefined;
      continue;
    }
    try { params[segment.slice(1)] = decodeURIComponent(value); }
    catch { params[segment.slice(1)] = value; }
  }
  return params;
}

export function resolveConsoleRoute(pathname: string): ResolvedConsoleRoute | undefined {
  const canonical = canonicalizeConsolePath(pathname);
  for (const route of CONSOLE_ROUTES) {
    const params = matchPath(route.path, canonical);
    if (params) {
      return { ...route, pathname: canonical, concretePath: canonical, params: Object.freeze(params) };
    }
  }
  return undefined;
}

export function findSidebarContext(pathname: string): {
  groupTitle: string;
  item: ConsoleSidebarNavItem;
} | undefined {
  const canonical = canonicalizeConsolePath(pathname);
  for (const group of CONSOLE_SIDEBAR_GROUPS) {
    for (const item of group.items) {
      if (item.path === canonical || item.matchPaths.includes(canonical)) {
        return { groupTitle: group.title, item };
      }
    }
  }
  return undefined;
}

export function getDomainSubRoutes(domainId: PrimaryDomainId): readonly ConsoleRoute[] {
  return CONSOLE_ROUTES.filter((route) => route.domainId === domainId);
}

export type DirtyRouteDecision = "confirm" | "discard";
export interface DirtyRouteGuardOptions {
  hasUnsavedChanges: boolean | (() => boolean);
  confirmTransition?: (nextPath: string) => boolean | Promise<boolean>;
  discardChanges?: (nextPath: string) => void | Promise<void>;
}

export class DirtyRouteGuard {
  constructor(private readonly options: DirtyRouteGuardOptions) {}

  get hasUnsavedChanges(): boolean {
    return typeof this.options.hasUnsavedChanges === "function"
      ? this.options.hasUnsavedChanges() : this.options.hasUnsavedChanges;
  }

  async canTransition(nextPath: string, decision?: DirtyRouteDecision): Promise<boolean> {
    if (!this.hasUnsavedChanges) return true;
    if (decision === "discard") {
      await this.options.discardChanges?.(nextPath);
      return true;
    }
    if (decision !== "confirm") return false;
    return this.options.confirmTransition
      ? Boolean(await this.options.confirmTransition(nextPath)) : true;
  }

  requestTransition(nextPath: string, decision?: DirtyRouteDecision): Promise<boolean> {
    return this.canTransition(nextPath, decision);
  }
}
