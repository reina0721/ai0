import { createHash, randomUUID } from "node:crypto";
import { mountCarrierProjections, passiveConsoleSlot, resolveEffectiveSkillProjections, type ConfiguredCarriers, type CarrierOrigin, type CarrierProjectors } from "./carrier-projections.js";
import type { mcpCapabilities } from "./mcp-capabilities.js";
import { subscribePerceptionSource, type AdmittedSourceObservation } from "@ai0/perception-core";
import { consoleConfigSchemaFacet, consoleSurfaceFacet, consoleUiSlotFacet, type ExtensionCoreHost, type ExtensionComposition, type ExtensionPackageDefinition } from "@ai0/sdk";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Ai0ExtensionManifestSchema,
  ExtensionMarketEntrySchema,
  type Ai0ExtensionManifest,
  type ConsoleUiSlotContribution,
  type ExtensionMarketEntry,
  type PluginConfigField,
  type PluginOrigin,
  type RuntimeConsolePage,
  type RuntimeConsoleUiSlot,
  type RuntimePluginDescriptor,
} from "@ai0/protocol";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
};

export const BUILTIN_EXTENSION_MARKET_CATALOG: readonly ExtensionMarketEntry[] = Object.freeze([
  ExtensionMarketEntrySchema.parse({
    id: "community.organ.dream-journal",
    displayName: "Dream Journal（梦境手记）",
    version: "1.0.0",
    author: "ai0-community",
    description: "在 W3 睡眠反思期间将对话余温整理为诗意梦境片段并注入意识黑板第 9 槽位。",
    facets: ["cognition.context_contributor"],
    carrierKind: "native_code_plugin",
    tags: ["sleep", "memory", "poetic"],
    permissions: {
      read_blackboard_domains: ["D1_WORKING_TURN", "D2_CONTINUOUS_STATES", "D3_MEMORY_PROJECTION"],
      propose_mutation_domains: ["D3_MEMORY_PROJECTION"],
      max_audience_scope: "only_owner",
      network_access: false
    },
    configFields: []
  }),
  ExtensionMarketEntrySchema.parse({
    id: "community.bridge.napcat-onebot",
    displayName: "NapCat OneBot v11 消息桥接",
    version: "1.2.0",
    author: "ai0-ecosystem",
    description: "零代码 Protocol v0 协议桥接扩展，快速对接 NapCat / Lagrange OneBot v11 接入 QQ 私聊与群聊。",
    facets: ["channel.bridge","perception.ingress","expression.realizer","console.config_schema"],
    carrierKind: "zero_code_protocol_bridge",
    tags: ["qq", "onebot", "im", "bridge"],
    permissions: {
      read_blackboard_domains: ["D1_WORKING_TURN"],
      propose_mutation_domains: [],
      max_audience_scope: "group:default",
      network_access: true
    },
    configFields: [
      { key: "ws_endpoint", label: "OneBot WebSocket 地址", type: "string", default: "ws://127.0.0.1:3001", hint: "反向或正向 WS 端点" },
      { key: "access_token", label: "鉴权 Token", type: "secret", default: "", hint: "对应 NapCat 配置的 access_token" },
      { key: "auto_reply_at", label: "群聊仅响应 @ 提及", type: "bool", default: true, hint: "降低群聊噪声触发" },
      { key: "rate_limit_rpm", label: "每分钟限频 (RPM)", type: "int", default: 12, min: 1, max: 60 }
    ]
  }),
  ExtensionMarketEntrySchema.parse({
    id: "community.organ.pomodoro-companion",
    displayName: "番茄钟专注陪伴器官",
    version: "1.1.0",
    author: "ai0-ecosystem",
    description: "在主人编码或学习专注周期结束时，结合 D2 疲劳度发出温和的休息提醒与小段复盘提议。",
    facets: ["cognition.context_contributor"],
    carrierKind: "declarative_soul_asset",
    tags: ["focus", "pomodoro", "care"],
    permissions: {
      read_blackboard_domains: ["D2_CONTINUOUS_STATES", "D4_COMMITMENTS_TASKS"],
      propose_mutation_domains: ["D4_COMMITMENTS_TASKS"],
      max_audience_scope: "only_owner",
      network_access: false
    },
    configFields: [
      { key: "focus_minutes", label: "专注时长（分钟）", type: "int", default: 25, min: 10, max: 90 },
      { key: "break_minutes", label: "休息时长（分钟）", type: "int", default: 5, min: 2, max: 30 },
      { key: "gentle_tone", label: "提醒语气温柔度", type: "select", default: "warm", options: [{ value: "warm", label: "温柔鼓励" }, { value: "concise", label: "简短提醒" }, { value: "playful", label: "轻快调侃" }] },
      { key: "auto_mute_during_flow", label: "深度心流期自动静音", type: "bool", default: true }
    ]
  }),
  ExtensionMarketEntrySchema.parse({
    id: "community.media.live2d-viseme-bridge",
    displayName: "Live2D 三锚点口型表情桥",
    version: "1.0.4",
    author: "ai0-media-lab",
    description: "将 W1 伴生情感标签与 TTS Viseme 流映射为 Live2D Cubism 参数与眼神先行微表情。",
    facets: ["expression.media_transcoder"],
    carrierKind: "zero_code_protocol_bridge",
    tags: ["live2d", "avatar", "viseme", "embodiment"],
    permissions: {
      read_blackboard_domains: ["D2_CONTINUOUS_STATES"],
      propose_mutation_domains: [],
      max_audience_scope: "public_all",
      network_access: false
    },
    configFields: [
      { key: "osc_port", label: "VTubeStudio / OSC 端口", type: "int", default: 8001, min: 1024, max: 65535 },
      { key: "eye_gaze_lead_ms", label: "视线先行提前量 (ms)", type: "int", default: 180, min: 0, max: 500 },
      { key: "idle_blink_enabled", label: "待机微呼吸与眨眼", type: "bool", default: true }
    ]
  }),
  ExtensionMarketEntrySchema.parse({
    id: "community.organ.ambient-weather-diary",
    displayName: "环境天气与节气感知包",
    version: "1.0.2",
    author: "ai0-community",
    description: "将所在城市天气与日出日落节律转化为低噪声情境线索，让早晚问候贴合真实季节。",
    facets: ["extension.asset_codec"],
    carrierKind: "declarative_soul_asset",
    tags: ["weather", "ambient", "ritual"],
    permissions: {
      read_blackboard_domains: ["D2_CONTINUOUS_STATES"],
      propose_mutation_domains: [],
      max_audience_scope: "only_owner",
      network_access: true
    },
    configFields: [
      { key: "city_name", label: "城市名称", type: "string", default: "Shanghai", hint: "用于查询公开天气预报" },
      { key: "refresh_interval_min", label: "刷新间隔（分钟）", type: "int", default: 60, min: 15, max: 360 },
      { key: "mention_rain_umbrella", label: "雨天主动提醒带伞", type: "bool", default: true }
    ]
  }),
  ExtensionMarketEntrySchema.parse({
    id: "community.action.web-search-bridge",
    displayName: "联网检索与摘要工具桥",
    version: "1.3.0",
    author: "ai0-ecosystem",
    description: "对接 SearXNG / Tavily / Brave 检索接口，向 W2 规划器提供标记为 untrusted_external 的只读网页摘要。",
    facets: ["agent.tool_provider"],
    carrierKind: "zero_code_protocol_bridge",
    tags: ["search", "web", "mcp", "rag"],
    permissions: {
      read_blackboard_domains: ["D1_WORKING_TURN"],
      propose_mutation_domains: [],
      max_audience_scope: "only_owner",
      network_access: true
    },
    configFields: [
      { key: "engine", label: "检索引擎", type: "select", default: "searxng", options: [{ value: "searxng", label: "SearXNG（自托管）" }, { value: "tavily", label: "Tavily API" }, { value: "brave", label: "Brave Search" }] },
      { key: "endpoint_url", label: "检索端点 URL", type: "string", default: "http://127.0.0.1:8888/search" },
      { key: "api_key", label: "API Key（可选）", type: "secret", default: "" },
      { key: "max_results", label: "最大返回条数", type: "int", default: 5, min: 1, max: 12 }
    ]
  })
]);

export interface DiscoveredPlugin {
  readonly carrier?: CarrierOrigin;
  readonly manifest: Ai0ExtensionManifest;
  readonly rootDir: string;
  readonly origin: PluginOrigin;
  readonly generation: string;
  readonly signature: string;
  readonly pages: RuntimeConsolePage[];
  readonly moduleUrls: string[];
  readonly missingAssets: string[];
  readonly uiSlots: readonly RuntimeConsoleUiSlot[];
  readonly enabled: boolean;
}

export interface PluginAssetPayload {
  readonly content: Buffer;
  readonly contentType: string;
  readonly filePath: string;
}

export interface PluginLoaderOptions {
  projectors?: CarrierProjectors;
  mcpTransport?: typeof mcpCapabilities;
  builtinPluginsDir?: string;
  soulDir?: string;
  userPluginsDir?: string;
  extraPluginDirs?: readonly string[];
}

export interface InstallExternalPluginInput {
  source: "local_path" | "manifest_bundle" | "market";
  localPath?: string;
  manifest?: Record<string, unknown>;
  marketEntryId?: string;
  registryUrl?: string;
}

function stripLeadingRelative(input: string): string {
  return input.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function sanitizePluginDirSlug(id: string): string {
  const cleaned = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 72);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("非法的扩展目录名称");
  }
  return cleaned;
}

function normalizeAssetUrl(extensionId: string, assetPath?: string): string | undefined {
  if (!assetPath) return undefined;
  const cleaned = stripLeadingRelative(assetPath);
  if (!cleaned || cleaned.includes("..")) return undefined;
  const encodedSegments = cleaned
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/plugins/${encodeURIComponent(extensionId)}/assets/${encodedSegments}`;
}

function normalizeSlot(
  extensionId: string,
  slot: ConsoleUiSlotContribution
): RuntimeConsoleUiSlot {
  const entryModuleUrl = normalizeAssetUrl(extensionId, slot.entry_module);
  const styleSheetUrls = slot.style_sheets
    ?.map((item) => normalizeAssetUrl(extensionId, item))
    .filter((item): item is string => Boolean(item));
  const iframeSrcUrl = normalizeAssetUrl(extensionId, slot.iframe_src);

  return {
    ...slot,
    ...(entryModuleUrl ? { entry_module_url: entryModuleUrl } : {}),
    ...(styleSheetUrls && styleSheetUrls.length > 0 ? { style_sheet_urls: styleSheetUrls } : {}),
    ...(iframeSrcUrl ? { iframe_src_url: iframeSrcUrl } : {})
  };
}

export function buildDefaultPluginConfig(fields?: readonly PluginConfigField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (!fields) return defaults;
  for (const field of fields) {
    if (field.default !== undefined) {
      defaults[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
    } else if (field.type === "bool") {
      defaults[field.key] = false;
    } else if (field.type === "int" || field.type === "float") {
      defaults[field.key] = field.min ?? 0;
    } else if (field.type === "list") {
      defaults[field.key] = [];
    } else {
      defaults[field.key] = "";
    }
  }
  return defaults;
}

function parseManifest(raw: unknown): Ai0ExtensionManifest {
  return Ai0ExtensionManifestSchema.parse(raw);
}

function collectPluginCandidateDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const candidate = join(root, entry.name);
    if (existsSync(join(candidate, "ai0.extension.json"))) {
      results.push(candidate);
      continue;
    }
    const nested = readdirSync(candidate, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const sub of nested) {
      if (!sub.isDirectory() || sub.name.startsWith(".") || sub.name === "node_modules") continue;
      const subDir = join(candidate, sub.name);
      if (existsSync(join(subDir, "ai0.extension.json"))) {
        results.push(subDir);
      }
    }
  }
  return results;
}

export class RuntimePluginLoader {
  private configured?: ConfiguredCarriers;
  private readonly discovered = new Map<string, DiscoveredPlugin>();
  private readonly roots: Array<{ dir: string; origin: PluginOrigin }>;
  readonly userPluginsDir: string;

  private revisionValue = 0;
  private readonly forcedReloadTokens = new Map<string, number>();
  private readonly scopes = new Map<ExtensionCoreHost, Map<string, { generation: string; dispose(): Promise<void> }>>();
  private readonly configurations = new WeakMap<ExtensionCoreHost, Map<string, { rev: number; config: Readonly<Record<string, unknown>> }>>();
  private readonly errors = new WeakMap<ExtensionCoreHost, Map<string, string>>();

  activationError(host: ExtensionCoreHost, id: string) { return host.getPackage(id)?.lastError ?? this.errors.get(host)?.get(id); }

  generation(host: ExtensionCoreHost, id: string) {
    const plugin = this.getPlugin(id);
    const forced = this.forcedReloadTokens.get(id) ?? 0;
    return plugin?.enabled
      ? `${plugin.generation}.${this.configurations.get(host)?.get(id)?.rev ?? 0}.${forced}`
      : undefined;
  }

  getPluginConfig(host: ExtensionCoreHost, id: string): { rev: number; config: Record<string, unknown> } {
    const plugin = this.getPlugin(id);
    const defaults = buildDefaultPluginConfig(plugin?.manifest.console_contributions?.config_fields);
    const entry = this.configurations.get(host)?.get(id);
    return {
      rev: entry?.rev ?? 0,
      config: { ...defaults, ...(entry?.config ?? {}) }
    };
  }

  seedPersistedConfig(host: ExtensionCoreHost, id: string, config: Readonly<Record<string, unknown>>): void {
    const entries = this.configurations.get(host) ?? new Map();
    if (!entries.has(id)) {
      entries.set(id, { rev: 0, config: { ...config } });
      this.configurations.set(host, entries);
    }
  }

  configure(host: ExtensionCoreHost, id: string, config: Readonly<Record<string, unknown>>, expected?: number) {
    const entries = this.configurations.get(host) ?? new Map();
    const current = entries.get(id)?.rev ?? 0;
    if (!this.getPlugin(id)) throw new Error("Extension unavailable");
    if (expected !== undefined && current !== expected) {
      throw new Error("Extension unavailable or revision conflict");
    }
    this.configurations.set(host, entries);
    entries.set(id, { rev: current + 1, config: { ...config } });
    this.revisionValue++;
    return current + 1;
  }

  forceReload(id?: string): void {
    if (id) {
      this.forcedReloadTokens.set(id, (this.forcedReloadTokens.get(id) ?? 0) + 1);
    } else {
      for (const plugin of this.discovered.values()) {
        const extId = plugin.manifest.extension_id;
        this.forcedReloadTokens.set(extId, (this.forcedReloadTokens.get(extId) ?? 0) + 1);
      }
    }
    this.revisionValue++;
  }

  get revision() { return this.revisionValue; }

  setSoulDirectory(soulDir: string): void {
    const dir = resolve(soulDir, "plugins");
    const root = this.roots.find(item => item.origin === "soul");
    if (root?.dir === dir) return;
    if (root) root.dir = dir;
    else this.roots.splice(1, 0, { dir, origin: "soul" });
    for (const host of this.scopes.keys()) this.configurations.delete(host);
    this.forceReload();
  }

  constructor(private readonly options: PluginLoaderOptions = {}) {
    const builtinDir = resolve(options.builtinPluginsDir ?? join(REPO_ROOT, "plugins"));
    const soulPluginsDir = options.soulDir ? resolve(join(options.soulDir, "plugins")) : undefined;
    const envDirs = (process.env.AI0_PLUGINS_DIR ?? "")
      .split(delimiter)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => resolve(item));
    this.userPluginsDir = resolve(
      options.userPluginsDir ??
        (process.env.AI0_USER_PLUGINS_DIR?.trim() || join(REPO_ROOT, "user-plugins"))
    );
    const extraDirs = (options.extraPluginDirs ?? []).map((item) => resolve(item));

    this.roots = [
      { dir: builtinDir, origin: "builtin" },
      ...(soulPluginsDir ? [{ dir: soulPluginsDir, origin: "soul" as const }] : []),
      { dir: this.userPluginsDir, origin: "external" },
      ...envDirs.map((dir) => ({ dir, origin: "external" as const })),
      ...extraDirs.map((dir) => ({ dir, origin: "external" as const }))
    ];

    this.reload();
  }

  reload(overrides?: ReadonlyMap<string, boolean>, carriers?: ConfiguredCarriers): void {
    this.configured = carriers ?? this.configured;
    const previous = new Map(this.discovered);
    this.discovered.clear();
    for (const { dir, origin } of this.roots) {
      for (const pluginDir of collectPluginCandidateDirs(dir)) {
        const manifestPath = join(pluginDir, "ai0.extension.json");
        try {
          const parsedJson = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

          const manifest = parseManifest(parsedJson);
          const missingAssets: string[] = [];
          const uiSlots = (manifest.console_contributions?.ui_slots ?? []).flatMap(slot => {
            const entry = ["contribution_module", "web_stage_module"].includes(slot.widget_type) ? slot.entry_module :
              slot.widget_type === "sandboxed_iframe_stage" ? slot.iframe_src : undefined;
            if (!entry && ["contribution_module", "web_stage_module", "sandboxed_iframe_stage"].includes(slot.widget_type)) {
              missingAssets.push(slot.slot_target + ": missing entry");
              return [];
            }
            const missing = [entry, ...(slot.style_sheets ?? [])].filter((path): path is string => !!path)
              .filter(path => !this.assetPath(pluginDir, path));
            missingAssets.push(...missing);
            return missing.length ? [] : [normalizeSlot(manifest.extension_id, slot)];
          });
          const modulePaths = manifest.console_contributions?.modules ?? [];
          const moduleUrls = new Set(uiSlots.flatMap(slot =>
            slot.widget_type === "contribution_module" && slot.entry_module_url ? [slot.entry_module_url] : []));
          for (const path of modulePaths) {
            if (this.assetPath(pluginDir, path)) moduleUrls.add(normalizeAssetUrl(manifest.extension_id, path)!);
            else missingAssets.push(path);
          }
          const pages: RuntimeConsolePage[] = [];
          for (const page of manifest.console_contributions?.pages ?? []) {
            const files = [page.entry_module, ...(page.style_sheets ?? [])];
            const missing = files.filter(file => !this.assetPath(pluginDir, file));
            if (missing.length) { missingAssets.push(...missing); continue; }
            pages.push({ path: page.path, title: page.title, aliases: page.aliases, channel_id: page.channel_id,
              navigation: page.navigation, entry_module_url: normalizeAssetUrl(manifest.extension_id, page.entry_module),
              style_sheet_urls: page.style_sheets?.map(file => normalizeAssetUrl(manifest.extension_id, file)!) });
          }
          for (const slot of uiSlots.filter(item => item.slot_target === "slot.channels.mounted_stage")) {
            pages.push({ path: slot.route_path ?? "/channels/stage/" + encodeURIComponent(manifest.extension_id),
              title: slot.title, channel_id: slot.channel_id ?? manifest.extension_id + ".default",
              entry_module_url: slot.entry_module_url, iframe_src_url: slot.iframe_src_url, style_sheet_urls: slot.style_sheet_urls });
          }
          const pageAssets = (manifest.console_contributions?.pages ?? []).flatMap(page => [page.entry_module, ...(page.style_sheets ?? [])]);
          if (manifest.extension_id === "ai0.console" || manifest.extension_id.startsWith("carrier:") || this.discovered.has(manifest.extension_id)) continue;
          const enabled = overrides?.get(manifest.extension_id) ?? (parsedJson.default_enabled !== false);
          const signature = JSON.stringify([pluginDir, parsedJson, enabled, [...pageAssets, ...modulePaths].map(file => { const path = this.assetPath(pluginDir, file); return path ? statSync(path).mtimeMs : null; }), manifest.entry && this.assetPath(pluginDir, manifest.entry) ? statSync(this.assetPath(pluginDir, manifest.entry)!).mtimeMs : null, missingAssets, uiSlots.flatMap(slot =>
            [slot.entry_module, slot.iframe_src, ...(slot.style_sheets ?? [])].filter((path): path is string => !!path)
              .map(path => statSync(this.assetPath(pluginDir, path)!).mtimeMs))]);
          const old = previous.get(manifest.extension_id);
          const generation = old?.signature === signature ? old.generation : randomUUID();
          this.discovered.set(manifest.extension_id, {
            manifest,
            rootDir: pluginDir,
            missingAssets, pages, moduleUrls: [...moduleUrls],
            origin,
            uiSlots,
            generation, signature, enabled
          });
        } catch {
          // Isolate malformed external manifests instead of crashing daemon boot.
        }
      }
    }
    const origins: CarrierOrigin[] = [
      ...this.configured?.skills.map(skill => ({ kind: "skill" as const, skill })) ?? [],
      ...this.configured?.servers.map(server => ({ kind: "mcp" as const, server })) ?? []
    ];
    for (const carrier of origins) {
      const item = carrier.kind === "skill" ? carrier.skill : carrier.server;
      const projections = carrier.kind === "skill" ? resolveEffectiveSkillProjections(carrier.skill) : (carrier.server.projections ?? []);
      if (!projections.length) continue;
      const id = "carrier:" + carrier.kind + ":" + item.id;
      const grant = this.configured?.grants?.[id];
      const declaredScope = carrier.kind === "skill" ? carrier.skill.maxAudienceScope : "public_all";
      const ceiling = grant?.max_audience_scope ?? "only_owner";
      const audience = ceiling === "public_all" || declaredScope === ceiling
        ? declaredScope : declaredScope === "public_all" ? ceiling : "only_owner";
      const manifest = Ai0ExtensionManifestSchema.parse({
        manifest_version: "2.0.0", extension_id: id, version: "1", author: item.id,
        display_name: carrier.kind === "skill" ? carrier.skill.displayName : carrier.server.name,
        carrier_kind: carrier.kind === "skill" ? "markdown_skill_manual" : "zero_code_protocol_bridge",
        facets: [...new Set(projections.map(route => route.facet))], projections: [...projections],
        permissions: { max_audience_scope: audience,
          read_blackboard_domains: grant?.read_blackboard_domains ?? [],
          propose_mutation_domains: grant?.propose_mutation_domains ?? [],
          network_access: carrier.kind === "mcp" && carrier.server.transport !== "stdio" && grant?.network_access === true }
      });
      const enabled = item.enabled && overrides?.get(id) !== false;
      const signature = createHash("sha256").update(JSON.stringify([carrier, enabled, grant])).digest("hex");
      const prior = previous.get(id);
      this.discovered.set(id, { manifest, carrier, rootDir: "", origin: carrier.kind === "skill" && carrier.skill.source === "soul_user" ? "soul" : "external",
        pages: [], moduleUrls: [], missingAssets: [], uiSlots: [], enabled, signature, generation: signature === prior?.signature ? prior.generation : randomUUID() });
    }
    if (previous.size !== this.discovered.size || this.listPlugins().some(p => previous.get(p.manifest.extension_id)?.generation !== p.generation)) this.revisionValue++;
  }

  async listMarketCatalog(customRegistryUrl?: string): Promise<ExtensionMarketEntry[]> {
    const installedMap = new Map(this.listPlugins().map((p) => [p.manifest.extension_id, p]));
    const entries: ExtensionMarketEntry[] = [...BUILTIN_EXTENSION_MARKET_CATALOG];

    if (customRegistryUrl && /^https?:\/\//iu.test(customRegistryUrl.trim())) {
      try {
        const res = await fetch(customRegistryUrl.trim(), { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const json = (await res.json()) as unknown;
          const rawList = Array.isArray(json)
            ? json
            : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).extensions)
              ? ((json as Record<string, unknown>).extensions as unknown[])
              : [];
          for (const item of rawList) {
            const parsed = ExtensionMarketEntrySchema.safeParse(item);
            if (parsed.success && !entries.some((e) => e.id === parsed.data.id)) {
              entries.push(parsed.data);
            }
          }
        }
      } catch {
        // Gracefully ignore unreachable custom registry URLs
      }
    }

    return entries.map((entry) => {
      const existing = installedMap.get(entry.id);
      return {
        ...entry,
        installed: Boolean(existing),
        builtin: existing?.origin === "builtin"
      };
    });
  }

  async installExternalPlugin(input: InstallExternalPluginInput): Promise<DiscoveredPlugin> {
    mkdirSync(this.userPluginsDir, { recursive: true });

    let installedId = "";

    if (input.source === "local_path") {
      const srcPath = resolve(input.localPath?.trim() ?? "");
      if (!srcPath || !existsSync(srcPath) || !statSync(srcPath).isDirectory()) {
        throw new Error("指定的本地插件目录不存在或不是文件夹");
      }
      const manifestFile = join(srcPath, "ai0.extension.json");
      if (!existsSync(manifestFile)) {
        throw new Error("目标目录缺少标准清单文件 ai0.extension.json");
      }
      const rawJson = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
      const manifest = parseManifest(rawJson);
      if (manifest.extension_id === "ai0.console") {
        throw new Error("禁止覆盖内置控制台标识");
      }
      const existing = this.discovered.get(manifest.extension_id);
      if (existing?.origin === "builtin") {
        throw new Error(`无法覆盖内置官方插件：${manifest.extension_id}`);
      }
      const targetDir = join(this.userPluginsDir, sanitizePluginDirSlug(manifest.extension_id));
      rmSync(targetDir, { recursive: true, force: true });
      cpSync(srcPath, targetDir, { recursive: true });
      installedId = manifest.extension_id;
    } else if (input.source === "manifest_bundle") {
      if (!input.manifest || typeof input.manifest !== "object") {
        throw new Error("请提供合法的 ai0.extension.json 清单对象");
      }
      const manifest = parseManifest(input.manifest);
      if (manifest.extension_id === "ai0.console") {
        throw new Error("禁止覆盖内置控制台标识");
      }
      const existing = this.discovered.get(manifest.extension_id);
      if (existing?.origin === "builtin") {
        throw new Error(`无法覆盖内置官方插件：${manifest.extension_id}`);
      }
      const targetDir = join(this.userPluginsDir, sanitizePluginDirSlug(manifest.extension_id));
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, "ai0.extension.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      installedId = manifest.extension_id;
    } else if (input.source === "market") {
      const entryId = input.marketEntryId?.trim();
      if (!entryId) throw new Error("缺少市场扩展 ID");
      const catalog = await this.listMarketCatalog(input.registryUrl);
      const entry = catalog.find((item) => item.id === entryId);
      if (!entry) throw new Error(`扩展市场中未找到扩展：${entryId}`);
      if (this.discovered.get(entry.id)?.origin === "builtin") {
        return this.discovered.get(entry.id)!;
      }
      const manifest: Ai0ExtensionManifest = Ai0ExtensionManifestSchema.parse({
        manifest_version: "2.0.0",
        extension_id: entry.id,
        display_name: entry.displayName,
        description: entry.description,
        version: entry.version,
        author: entry.author,
        tags: entry.tags,
        carrier_kind: entry.carrierKind,
        facets: entry.facets,
        services: entry.services,
        permissions: entry.permissions,
        ...(entry.configFields.length > 0
          ? { console_contributions: { config_fields: entry.configFields } }
          : {})
      });
      const targetDir = join(this.userPluginsDir, sanitizePluginDirSlug(manifest.extension_id));
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, "ai0.extension.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      installedId = manifest.extension_id;
    } else {
      throw new Error("不支持的扩展安装来源类型");
    }

    this.reload();
    const installed = this.discovered.get(installedId);
    if (!installed) {
      throw new Error(`扩展 ${installedId} 已写入磁盘但未被发现，请检查清单格式`);
    }
    this.revisionValue++;
    return installed;
  }

  uninstallExternalPlugin(extensionId: string): void {
    const plugin = this.discovered.get(extensionId);
    if (!plugin) {
      throw new Error(`未找到已安装的扩展：${extensionId}`);
    }
    if (plugin.carrier) throw new Error("Remove this carrier through its owning skill or MCP configuration");
    if (plugin.origin === "builtin") {
      throw new Error("BUILTIN_PLUGIN_PROTECTED: 内置官方插件不可卸载，仅支持停用");
    }
    const rel = relative(this.userPluginsDir, plugin.rootDir);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      // Also allow uninstalling soul-scoped plugins if outside builtin
      if (plugin.origin !== "soul") {
        throw new Error("安全校验拒绝删除用户插件目录之外的路径");
      }
    }
    rmSync(plugin.rootDir, { recursive: true, force: true });
    this.discovered.delete(extensionId);
    this.forcedReloadTokens.delete(extensionId);
    this.revisionValue++;
  }

  listPlugins(): DiscoveredPlugin[] {
    return [...this.discovered.values()];
  }

  getPlugin(extensionId: string): DiscoveredPlugin | undefined {
    return this.discovered.get(extensionId);
  }

  uiSlotsFor(plugin: DiscoveredPlugin, host?: ExtensionCoreHost): RuntimeConsoleUiSlot[] {
    const slots = [...plugin.uiSlots];
    if (!host || !plugin.manifest.projections?.some(route => route.facet === consoleUiSlotFacet.id)) return slots;
    for (const entry of host.listFacets(consoleUiSlotFacet)) {
      if (entry.packageId !== plugin.manifest.extension_id) continue;
      for (const item of entry.implementation.slots) {
        // Executable UI entries continue through the asset and channel manifest checks at discovery.
        let slot;
        try { slot = passiveConsoleSlot(item); } catch { continue; }
        if (!slots.some(existing => existing.slot_target === slot.slot_target && existing.title === slot.title))
          slots.push(normalizeSlot(entry.packageId, slot));
      }
    }
    return slots;
  }

  private toDescriptor(
    plugin: DiscoveredPlugin,
    enabledOverrides?: ReadonlyMap<string, boolean>,
    host?: ExtensionCoreHost
  ): RuntimePluginDescriptor {
    return {
      extension_id: plugin.manifest.extension_id,
      display_name: plugin.manifest.display_name,
      ...(plugin.manifest.description ? { description: plugin.manifest.description } : {}),
      version: plugin.manifest.version,
      author: plugin.manifest.author,
      ...(plugin.manifest.tags ? { tags: plugin.manifest.tags } : {}),
      carrier_kind: plugin.manifest.carrier_kind,
      facets: plugin.manifest.facets,
      ...(plugin.manifest.services ? { services: plugin.manifest.services } : {}),
      ...(plugin.manifest.projections ? { projections: plugin.manifest.projections } : {}),
      origin: plugin.origin,
      enabled: enabledOverrides?.get(plugin.manifest.extension_id) ?? plugin.enabled,
      permissions: plugin.manifest.permissions,
      ...(plugin.manifest.console_contributions?.config_fields
        ? { config_fields: plugin.manifest.console_contributions.config_fields }
        : {}),
      ...(plugin.manifest.console_contributions?.config_schema
        ? { config_schema: plugin.manifest.console_contributions.config_schema }
        : {}),
      pages: plugin.pages,
      module_urls: plugin.moduleUrls,
      missing_assets: plugin.missingAssets,
      ui_slots: this.uiSlotsFor(plugin, host)
    };
  }

  listDescriptors(enabledOverrides?: ReadonlyMap<string, boolean>, host?: ExtensionCoreHost): RuntimePluginDescriptor[] {
    return this.listPlugins().map((plugin) => this.toDescriptor(plugin, enabledOverrides, host));
  }

  getDescriptor(
    extensionId: string,
    enabledOverrides?: ReadonlyMap<string, boolean>,
    host?: ExtensionCoreHost
  ): RuntimePluginDescriptor | undefined {
    const plugin = this.discovered.get(extensionId);
    return plugin ? this.toDescriptor(plugin, enabledOverrides, host) : undefined;
  }

  readPluginAsset(extensionId: string, requestedRelativePath: string): PluginAssetPayload | undefined {
    const plugin = this.discovered.get(extensionId);
    if (!plugin || plugin.carrier) return undefined;
    const targetPath = this.assetPath(plugin.rootDir, requestedRelativePath);
    if (!targetPath) return undefined;
    const contentType = CONTENT_TYPES[extname(targetPath).toLowerCase()] ?? "application/octet-stream";
    return {
      content: readFileSync(targetPath),
      contentType,
      filePath: targetPath
    };
  }

  private assetPath(rootDir: string, requestedRelativePath: string): string | undefined {
    const normalized = stripLeadingRelative(requestedRelativePath).replaceAll("\\", "/");
    if (!normalized || normalized.includes("\0") || normalized.includes("..")) return undefined;

    const allowedRoot = resolve(rootDir, "dist");
    const targetPath = normalized.startsWith("dist/")
      ? resolve(rootDir, normalized)
      : resolve(allowedRoot, normalized);
    const rel = relative(allowedRoot, targetPath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
    if (!existsSync(targetPath)) return undefined;

    const physicalRoot = resolve(realpathSync(rootDir), "dist");
    const physical = relative(physicalRoot, realpathSync(targetPath));
    if (physical.startsWith("..") || isAbsolute(physical)) return undefined;
    const info = statSync(targetPath);
    if (!info.isFile()) return undefined;
    return targetPath;
  }

  async mountIntoHost(host: ExtensionCoreHost, composition: ExtensionComposition, policy: {
    allowMcp?: boolean; admitObservation?: (observation: AdmittedSourceObservation) => void;
  } = {}): Promise<void> {
    const scopes = this.scopes.get(host) ?? new Map<string, { generation: string; dispose(): Promise<void> }>();
    this.scopes.set(host, scopes);
    const errors = this.errors.get(host) ?? new Map<string, string>();
    this.errors.set(host, errors);
    const cleanup = [];
    for (const [id, scope] of scopes) {
      const next = this.getPlugin(id);
      if (next?.enabled && this.generation(host, id) === scope.generation) continue;
      errors.delete(id);
      scopes.delete(id);
      cleanup.push(scope.dispose());
    }
    if (cleanup.length) await Promise.all(cleanup);
    for (const plugin of this.discovered.values()) {
      const { manifest } = plugin;
      if (!plugin.enabled || scopes.has(manifest.extension_id)) continue;
      const generation = this.generation(host, manifest.extension_id)!;
      const settings = this.getPluginConfig(host, manifest.extension_id);
      const fiber = composition.mount(manifest.extension_id, async scope => {
        let definition: ExtensionPackageDefinition | undefined;
        if (manifest.entry) {
          const entry = this.assetPath(plugin.rootDir, manifest.entry);
          if (!entry) throw new Error("Missing entry " + manifest.entry);
          const url = pathToFileURL(entry);
          url.searchParams.set("generation", generation);
          definition = (await import(url.href)).default;
          if (!definition || definition.manifest?.extension_id !== manifest.extension_id) {
            throw new Error("Entry must export its extension package as default");
          }
        }
        scope.effect(() => {
          const subscriptions = new AbortController();
          const state = host.mountPackage({
            manifest,
            activate: (activation, config) => {
              let cleanup: void | (() => void) = undefined;
              if (definition?.activate) cleanup = definition.activate(activation, config);
              else {
                if (manifest.facets.includes("console.surface") && !manifest.projections?.some(p => p.facet === "console.surface")) {
                  activation.contributeFacet(consoleSurfaceFacet, { pages: plugin.pages });
                }
                if (manifest.facets.includes("console.ui_slot") && !manifest.projections?.some(p => p.facet === "console.ui_slot")) {
                  activation.contributeFacet(consoleUiSlotFacet, { slots: plugin.uiSlots });
                }
                if (manifest.facets.includes("console.config_schema")) {
                  activation.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
                }
              }
              if (manifest.projections?.length) {
                const issues = mountCarrierProjections(activation, manifest, plugin.carrier,
                  { ...policy, projectors: this.options.projectors, transport: this.options.mcpTransport, reportReadFailure(route, failed) {
                    const issue = route.source + " -> " + route.facet + "@" + route.version + ": resource read failed";
                    const remaining = (errors.get(manifest.extension_id) ?? "").split("\n").filter(line => line && line !== issue);
                    if (failed) remaining.push(issue);
                    if (remaining.length) errors.set(manifest.extension_id, remaining.join("\n"));
                    else errors.delete(manifest.extension_id);
                  } });
                if (issues.length) errors.set(manifest.extension_id, issues.join("\n"));
              }
              return cleanup;
            }
          }, settings.config);
          if (state.lastError) errors.set(manifest.extension_id, state.lastError);
          if (policy.admitObservation && policy.allowMcp !== false && plugin.carrier?.kind === "mcp") {
            for (const uri of new Set(plugin.carrier.server.subscribedResourceUris ?? [])) {
              const source = "resource:" + uri;
              if (!manifest.projections?.some(p => p.source === source && p.facet === "perception.source" && p.version === 1)) continue;
              void subscribePerceptionSource(host, manifest.extension_id, "only_owner", subscriptions.signal, policy.admitObservation, source)
                .catch(error => { if (!subscriptions.signal.aborted) errors.set(manifest.extension_id, "Subscription unavailable: " + String(error)); });
            }
          }
          return () => { subscriptions.abort(); host.unmountPackage(manifest.extension_id); };
        });
      });
      scopes.set(manifest.extension_id, { generation, dispose: fiber.dispose });
      try { await fiber.ready(); }
      catch (error) { errors.set(manifest.extension_id, String(error)); }
    }
  }
}
