import type { ConsoleIconName } from "../design-system/tokens/index.js";

export const PRIMARY_DOMAIN_IDS = [
  "dashboard", "shells", "soul", "memory",
  "models", "extensions", "runtime", "system"
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
 * Official 5-Group × 16-Module Navigation Architecture
 */
export const CONSOLE_SIDEBAR_GROUPS_16: readonly ConsoleSidebarNavGroup[] = Object.freeze([
  {
    id: "group_overview",
    title: "概览与交互",
    items: [
      { id: "dashboard.overview", label: "系统概览", icon: "dashboard", path: "/dashboard", domainId: "dashboard", matchPaths: ["/dashboard"] },
      { id: "shells.simulator", label: "躯壳协议模拟器", icon: "shells", path: "/shells/simulator", domainId: "shells", matchPaths: ["/shells/simulator"] },
      { id: "dashboard.conversations", label: "会话记录", icon: "sessions", path: "/conversations", domainId: "dashboard", matchPaths: ["/conversations"] }
    ]
  },
  {
    id: "group_persona",
    title: "人格与认知",
    items: [
      { id: "soul.distiller", label: "角色与契约", icon: "persona", path: "/soul/distiller", domainId: "soul", matchPaths: ["/soul/distiller", "/soul/persona"] },
      { id: "dashboard.blackboard", label: "上下文黑板", icon: "blackboard", path: "/dashboard/blackboard", domainId: "dashboard", matchPaths: ["/dashboard/blackboard"] },
      { id: "soul.homeostasis", label: "节律与世界书", icon: "circadian", path: "/soul/homeostasis", domainId: "soul", matchPaths: ["/soul/homeostasis", "/soul/lorebooks"] }
    ]
  },
  {
    id: "group_infra",
    title: "模型与通道",
    items: [
      { id: "models.providers", label: "模型与路由", icon: "models", path: "/models/providers", domainId: "models", matchPaths: ["/models/providers", "/models/routing"] },
      { id: "shells.topology", label: "接入通道", icon: "shells", path: "/shells/topology", domainId: "shells", matchPaths: ["/shells/topology", "/shells/attention-arbitration", "/shells/thalamic-gate", "/shells/media-pipeline"] },
      { id: "shells.profiles-rules", label: "受众与策略", icon: "rules", path: "/profiles/rules", domainId: "shells", matchPaths: ["/profiles/rules"] }
    ]
  },
  {
    id: "group_memory_ext",
    title: "记忆与扩展",
    items: [
      { id: "memory.lineage", label: "记忆与擦除", icon: "memory", path: "/memory/lineage", domainId: "memory", matchPaths: ["/memory/lineage", "/memory/relationship", "/memory/events-media"] },
      { id: "memory.retrieval-sleep", label: "睡眠与演化", icon: "evolution", path: "/memory/retrieval-sleep", domainId: "memory", matchPaths: ["/memory/retrieval-sleep"] },
      { id: "memory.knowledge-rag", label: "知识库 (RAG)", icon: "knowledge", path: "/memory/knowledge-rag", domainId: "memory", matchPaths: ["/memory/knowledge-rag"] },
      { id: "runtime.coordinator-agency", label: "子代理与任务", icon: "subagents", path: "/runtime/coordinator-agency", domainId: "runtime", matchPaths: ["/runtime/coordinator-agency"] },
      { id: "extensions.marketplace", label: "插件与技能", icon: "extensions", path: "/extensions/marketplace", domainId: "extensions", matchPaths: ["/extensions/marketplace", "/extensions/configurator", "/extensions/skills-mcp", "/extensions/cognitive-organs", "/extensions/flows-eca"] }
    ]
  },
  {
    id: "group_ops",
    title: "观测与系统",
    items: [
      { id: "runtime.sandbox-lab", label: "追踪与沙盒", icon: "telemetry", path: "/sandbox/lab", domainId: "runtime", matchPaths: ["/sandbox/lab", "/runtime/terminal"] },
      { id: "system.instances-storage", label: "导出与系统", icon: "system", path: "/system/instances-storage", domainId: "system", matchPaths: ["/system/instances-storage", "/system/safety-sb243", "/system/settings-security"] }
    ]
  }
]);

export const CONSOLE_PRIMARY_DOMAINS: readonly ConsolePrimaryDomain[] = Object.freeze([
  { id: "dashboard", label: "概览与黑板", icon: "dashboard", defaultPath: "/dashboard" },
  { id: "shells", label: "交互与平台", icon: "chat", defaultPath: "/shells/topology" },
  { id: "soul", label: "人格与认知", icon: "persona", defaultPath: "/soul/distiller" },
  { id: "memory", label: "记忆与知识库", icon: "memory", defaultPath: "/memory/lineage" },
  { id: "models", label: "模型与路由", icon: "models", defaultPath: "/models/providers" },
  { id: "extensions", label: "插件与技能", icon: "extensions", defaultPath: "/extensions/marketplace" },
  { id: "runtime", label: "任务与沙盒", icon: "telemetry", defaultPath: "/runtime/coordinator-agency" },
  { id: "system", label: "导出与系统", icon: "system", defaultPath: "/system/instances-storage" }
]);

export const CONSOLE_ROUTES_30: readonly ConsoleRoute[] = Object.freeze([
  { id: "dashboard.overview", domainId: "dashboard", label: "系统概览", path: "/dashboard" },
  { id: "dashboard.conversations", domainId: "dashboard", label: "会话记录", path: "/conversations" },
  { id: "dashboard.blackboard", domainId: "dashboard", label: "上下文黑板", path: "/dashboard/blackboard" },
  { id: "shells.topology", domainId: "shells", label: "接入通道", path: "/shells/topology" },
  { id: "shells.profiles-rules", domainId: "shells", label: "受众与策略", path: "/profiles/rules" },
  { id: "shells.attention", domainId: "shells", label: "注意力焦点仲裁", path: "/shells/attention-arbitration" },
  { id: "shells.thalamic-gate", domainId: "shells", label: "话轮防抖与感官门控", path: "/shells/thalamic-gate" },
  { id: "shells.media-pipeline", domainId: "shells", label: "语音与表现管线", path: "/shells/media-pipeline" },
  { id: "shells.simulator", domainId: "shells", label: "躯壳协议模拟器", path: "/shells/simulator" },
  { id: "soul.distiller", domainId: "soul", label: "角色卡片蒸馏", path: "/soul/distiller" },
  { id: "soul.persona", domainId: "soul", label: "关系契约与性格设定", path: "/soul/persona" },
  { id: "soul.homeostasis", domainId: "soul", label: "节律与情绪动力学", path: "/soul/homeostasis" },
  { id: "soul.lorebooks", domainId: "soul", label: "世界书 (Lorebook)", path: "/soul/lorebooks" },
  { id: "memory.lineage", domainId: "memory", label: "记忆图谱与隐私擦除", path: "/memory/lineage" },
  { id: "memory.retrieval-sleep", domainId: "memory", label: "睡眠巩固与演化审批", path: "/memory/retrieval-sleep" },
  { id: "memory.knowledge-rag", domainId: "memory", label: "混合知识库 (RAG)", path: "/memory/knowledge-rag" },
  { id: "memory.relationship", domainId: "memory", label: "关系状态与里程碑", path: "/memory/relationship" },
  { id: "memory.events-media", domainId: "memory", label: "原始事件与语料", path: "/memory/events-media" },
  { id: "models.providers", domainId: "models", label: "模型与多模态服务", path: "/models/providers" },
  { id: "models.routing", domainId: "models", label: "脑区路由与代谢策略", path: "/models/routing" },
  { id: "extensions.marketplace", domainId: "extensions", label: "插件与扩展管理", path: "/extensions/marketplace" },
  { id: "extensions.configurator", domainId: "extensions", label: "插件配置与指令", path: "/extensions/configurator" },
  { id: "extensions.skills-mcp", domainId: "extensions", label: "SKILL.md 与 MCP", path: "/extensions/skills-mcp" },
  { id: "extensions.cognitive-organs", domainId: "extensions", label: "认知器官模块", path: "/extensions/cognitive-organs" },
  { id: "extensions.flows-eca", domainId: "extensions", label: "自动化联动流 (ECA)", path: "/extensions/flows-eca" },
  { id: "runtime.coordinator-agency", domainId: "runtime", label: "子代理与异步任务", path: "/runtime/coordinator-agency" },
  { id: "runtime.terminal", domainId: "runtime", label: "链路追踪与日志", path: "/runtime/terminal" },
  { id: "runtime.sandbox-lab", domainId: "runtime", label: "沙盒实验与回归评测", path: "/sandbox/lab" },
  { id: "system.instances-storage", domainId: "system", label: "资产导出与多实例", path: "/system/instances-storage" },
  { id: "system.safety-sb243", domainId: "system", label: "权限矩阵与合规护栏", path: "/system/safety-sb243" },
  { id: "system.settings-security", domainId: "system", label: "安全、代理与外观", path: "/system/settings-security" }
]);

function normalizePathname(pathname: string): string {
  const raw = pathname.split(/[?#]/, 1)[0] || "/";
  const normalized = `/${raw}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized === "" || normalized === "/" ? "/dashboard" : normalized;
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
  const normalized = normalizePathname(pathname);
  for (const route of CONSOLE_ROUTES_30) {
    const params = matchPath(route.path, normalized);
    if (params) return { ...route, pathname: normalized, concretePath: normalized, params: Object.freeze(params) };
  }
  return undefined;
}

export function findSidebarContext(pathname: string): {
  groupTitle: string;
  item: ConsoleSidebarNavItem;
} | undefined {
  const normalized = normalizePathname(pathname);
  for (const group of CONSOLE_SIDEBAR_GROUPS_16) {
    for (const item of group.items) {
      if (
        item.path === normalized ||
        item.matchPaths.includes(normalized)
      ) {
        return { groupTitle: group.title, item };
      }
    }
  }
  return undefined;
}

export function getDomainSubRoutes(domainId: PrimaryDomainId): readonly ConsoleRoute[] {
  return CONSOLE_ROUTES_30.filter((route) => route.domainId === domainId);
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
