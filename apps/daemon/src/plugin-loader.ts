import { randomUUID } from "node:crypto";
import { ExtensionComposition } from "@ai0/sdk";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Ai0ExtensionManifestSchema,
  type Ai0ExtensionManifest,
  type ConsoleUiSlotContribution,
  type ExtensionCarrierKind,
  type ExtensionDimension,
  type PluginOrigin,
  type RuntimeConsolePage,
  type RuntimeConsoleUiSlot,
  type RuntimePluginDescriptor,
  type StateDomain
} from "@ai0/protocol";
import type { PolymorphicExtensionHost } from "@ai0/kernel";

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

export interface DiscoveredPlugin {
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
  builtinPluginsDir?: string;
  soulDir?: string;
  extraPluginDirs?: readonly string[];
}

function stripLeadingRelative(input: string): string {
  return input.replace(/^\.\/+/, "").replace(/^\/+/, "");
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

function parseManifest(raw: Record<string, unknown>, fallbackId: string): Ai0ExtensionManifest {
  const dimension =
    (raw.dimension as ExtensionDimension | undefined) ??
    (raw.extension_bus as ExtensionDimension | undefined) ??
    (raw.bus as ExtensionDimension | undefined) ??
    "ext.cognitive_organ";
  const carrier =
    (raw.carrier_kind as ExtensionCarrierKind | undefined) ??
    (raw.carrier as ExtensionCarrierKind | undefined) ??
    "native_code_plugin";
  const rawPerms = (raw.permissions && typeof raw.permissions === "object"
    ? raw.permissions
    : {}) as Record<string, unknown>;
  const readDomains = (
    Array.isArray(rawPerms.read_blackboard_domains)
      ? rawPerms.read_blackboard_domains
      : Array.isArray(rawPerms.read_domains)
        ? rawPerms.read_domains
        : ["D1_WORKING_TURN"]
  ) as StateDomain[];
  const proposeDomains = (
    Array.isArray(rawPerms.propose_mutation_domains)
      ? rawPerms.propose_mutation_domains
      : Array.isArray(rawPerms.propose_domains)
        ? rawPerms.propose_domains
        : []
  ) as StateDomain[];

  let consoleContributions = raw.console_contributions;
  if (!consoleContributions && Array.isArray(raw.contributions)) {
    const legacySlots = raw.contributions
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .filter((entry) => typeof entry.slot_id === "string")
      .map((entry) => ({
        slot_target: entry.slot_id,
        widget_type: "markdown_card_list",
        title: String(entry.title ?? raw.name ?? fallbackId)
      }));
    if (legacySlots.length > 0) {
      consoleContributions = { ui_slots: legacySlots };
    }
  }

  return Ai0ExtensionManifestSchema.parse({
    manifest_version: "1.1.0",
    extension_id: String(raw.extension_id ?? raw.id ?? fallbackId),
    display_name: String(raw.display_name ?? raw.name ?? raw.extension_id ?? raw.id ?? fallbackId),
    version: String(raw.version ?? "1.0.0"),
    author: String(raw.author ?? "ai0-community"),
    carrier_kind: carrier,
    dimension,
    ...(typeof raw.entry === "string"
      ? { entry: raw.entry }
      : typeof raw.entry_point === "string"
        ? { entry: raw.entry_point }
        : {}),
    permissions: {
      read_blackboard_domains: readDomains,
      propose_mutation_domains: proposeDomains,
      max_audience_scope:
        typeof rawPerms.max_audience_scope === "string" ? rawPerms.max_audience_scope : "only_owner",
      network_access: Boolean(rawPerms.network_access ?? rawPerms.network ?? false)
    },
    ...(consoleContributions ? { console_contributions: consoleContributions } : {})
  });
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
  private readonly discovered = new Map<string, DiscoveredPlugin>();
  private readonly roots: Array<{ dir: string; origin: PluginOrigin }>;

  private revisionValue = 0;
  private readonly scopes = new Map<PolymorphicExtensionHost, Map<string, { generation: string; dispose(): Promise<void> }>>();
  private readonly configurations = new WeakMap<PolymorphicExtensionHost, Map<string, { rev: number; config: Readonly<Record<string, unknown>> }>>();
  private readonly errors = new WeakMap<PolymorphicExtensionHost, Map<string, string>>();
  activationError(host: PolymorphicExtensionHost, id: string) { return this.errors.get(host)?.get(id); }
  generation(host: PolymorphicExtensionHost, id: string) {
    const plugin = this.getPlugin(id);
    return plugin?.enabled ? plugin.generation + "." + (this.configurations.get(host)?.get(id)?.rev ?? 0) : undefined;
  }
  configure(host: PolymorphicExtensionHost, id: string, config: Readonly<Record<string, unknown>>, expected: number) {
    const entries = this.configurations.get(host) ?? new Map();
    const current = entries.get(id)?.rev ?? 0;
    if (!this.getPlugin(id)?.enabled || current !== expected) throw new Error("Extension unavailable or revision conflict");
    this.configurations.set(host, entries);
    entries.set(id, { rev: current + 1, config });
    this.revisionValue++;
    return current + 1;
  }
  get revision() { return this.revisionValue; }

  constructor(options: PluginLoaderOptions = {}) {
    const builtinDir = resolve(options.builtinPluginsDir ?? join(REPO_ROOT, "plugins"));
    const soulPluginsDir = options.soulDir ? resolve(join(options.soulDir, "plugins")) : undefined;
    const envDirs = (process.env.AI0_PLUGINS_DIR ?? "")
      .split(delimiter)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => resolve(item));
    const localUserDir = resolve(join(REPO_ROOT, "user-plugins"));
    const extraDirs = (options.extraPluginDirs ?? []).map((item) => resolve(item));

    this.roots = [
      { dir: builtinDir, origin: "builtin" },
      ...(soulPluginsDir ? [{ dir: soulPluginsDir, origin: "soul" as const }] : []),
      { dir: localUserDir, origin: "external" },
      ...envDirs.map((dir) => ({ dir, origin: "external" as const })),
      ...extraDirs.map((dir) => ({ dir, origin: "external" as const }))
    ];

    this.reload();
  }

  reload(overrides?: ReadonlyMap<string, boolean>): void {
    const previous = new Map(this.discovered);
    this.discovered.clear();
    for (const { dir, origin } of this.roots) {
      for (const pluginDir of collectPluginCandidateDirs(dir)) {
        const manifestPath = join(pluginDir, "ai0.extension.json");
        try {
          const parsedJson = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          const fallbackId = pluginDir.split(sep).at(-1) ?? "plugin.unknown";
          const manifest = parseManifest(parsedJson, fallbackId);
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
            pages.push({ path: page.path, title: page.title, aliases: page.aliases, shell_id: page.shell_id,
              navigation: page.navigation, entry_module_url: normalizeAssetUrl(manifest.extension_id, page.entry_module),
              style_sheet_urls: page.style_sheets?.map(file => normalizeAssetUrl(manifest.extension_id, file)!) });
          }
          // Translate v1 shell-page declarations at the discovery boundary.
          for (const slot of uiSlots.filter(item => item.slot_target === "slot.shells.mounted_stage")) {
            pages.push({ path: slot.route_path ?? "/shells/stage/" + encodeURIComponent(manifest.extension_id),
              title: slot.title, shell_id: slot.shell_id ?? manifest.extension_id + ".default",
              entry_module_url: slot.entry_module_url, iframe_src_url: slot.iframe_src_url, style_sheet_urls: slot.style_sheet_urls });
          }
          const pageAssets = (manifest.console_contributions?.pages ?? []).flatMap(page => [page.entry_module, ...(page.style_sheets ?? [])]);
          if (manifest.extension_id === "ai0.console" || this.discovered.has(manifest.extension_id)) continue;
          const enabled = overrides?.get(manifest.extension_id) ?? (origin === "builtin" && parsedJson.default_enabled !== false);
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
    if (previous.size !== this.discovered.size || this.listPlugins().some(p => previous.get(p.manifest.extension_id)?.generation !== p.generation)) this.revisionValue++;
  }

  listPlugins(): DiscoveredPlugin[] {
    return [...this.discovered.values()];
  }

  getPlugin(extensionId: string): DiscoveredPlugin | undefined {
    return this.discovered.get(extensionId);
  }

  listDescriptors(enabledOverrides?: ReadonlyMap<string, boolean>): RuntimePluginDescriptor[] {
    return this.listPlugins().map((plugin) => ({
      extension_id: plugin.manifest.extension_id,
      display_name: plugin.manifest.display_name,
      version: plugin.manifest.version,
      author: plugin.manifest.author,
      carrier_kind: plugin.manifest.carrier_kind,
      dimension: plugin.manifest.dimension,
      origin: plugin.origin,
      enabled: enabledOverrides?.get(plugin.manifest.extension_id) ?? plugin.enabled,
      pages: plugin.pages,
      module_urls: plugin.moduleUrls,
      missing_assets: plugin.missingAssets,
      ui_slots: [...plugin.uiSlots]
    }));
  }

  getDescriptor(
    extensionId: string,
    enabledOverrides?: ReadonlyMap<string, boolean>
  ): RuntimePluginDescriptor | undefined {
    const plugin = this.discovered.get(extensionId);
    if (!plugin) return undefined;
    return {
      extension_id: plugin.manifest.extension_id,
      display_name: plugin.manifest.display_name,
      version: plugin.manifest.version,
      author: plugin.manifest.author,
      carrier_kind: plugin.manifest.carrier_kind,
      dimension: plugin.manifest.dimension,
      origin: plugin.origin,
      enabled: enabledOverrides?.get(plugin.manifest.extension_id) ?? plugin.enabled,
      pages: plugin.pages,
      module_urls: plugin.moduleUrls,
      missing_assets: plugin.missingAssets,
      ui_slots: [...plugin.uiSlots]
    };
  }

  readPluginAsset(extensionId: string, requestedRelativePath: string): PluginAssetPayload | undefined {
    const plugin = this.discovered.get(extensionId);
    if (!plugin) return undefined;
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

  async mountIntoHost(host: PolymorphicExtensionHost, composition: ExtensionComposition): Promise<void> {
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
      const buses = new Set<ExtensionDimension>([manifest.dimension]);
      if (plugin.pages.length || plugin.uiSlots.length) buses.add("ext.console_ui");
      const shellPage = plugin.pages.find(page => page.shell_id);

      const extensionPayload: Record<string, unknown> = {
        id: manifest.extension_id,
        displayName: manifest.display_name,
        version: manifest.version,
        origin: plugin.origin,
        source: plugin.rootDir,
        ...(shellPage?.shell_id ? { shellId: shellPage.shell_id } : {}),
        pages: plugin.pages,
      module_urls: plugin.moduleUrls,
        uiSlots: plugin.uiSlots
      };

      const generation = this.generation(host, manifest.extension_id)!;
      const settings = this.configurations.get(host)?.get(manifest.extension_id);
      const fiber = composition.mount(manifest.extension_id, async scope => {
        if (manifest.entry && ["ext.cognitive_organ", "ext.media_pipeline"].includes(manifest.dimension)) {
          const entry = this.assetPath(plugin.rootDir, manifest.entry);
          if (!entry) throw new Error("Missing entry " + manifest.entry);
          const url = pathToFileURL(entry);
          url.searchParams.set("generation", generation);
          const implementation = await import(url.href);
          Object.assign(extensionPayload, implementation.default);
          if (typeof implementation.activate === "function") await implementation.activate(scope, settings?.config ?? {});
        }
        scope.effect(() => {
          host.registerExtension({
            id: manifest.extension_id, carrier: manifest.carrier_kind, buses: [...buses],
            ...settings, readDomains: [...manifest.permissions.read_blackboard_domains],
            proposeDomains: [...manifest.permissions.propose_mutation_domains], extension: extensionPayload
          });
          return () => { host.unregisterExtension(manifest.extension_id); };
        });
      });
      scopes.set(manifest.extension_id, { generation, dispose: fiber.dispose });
      try { await fiber.ready(); }
      catch (error) { errors.set(manifest.extension_id, String(error)); }
    }
  }
}
