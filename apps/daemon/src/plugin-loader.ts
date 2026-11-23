import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Ai0ExtensionManifestSchema,
  type Ai0ExtensionManifest,
  type ConsoleUiSlotContribution,
  type ExtensionCarrierKind,
  type ExtensionDimension,
  type PluginOrigin,
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

  reload(): void {
    this.discovered.clear();
    for (const { dir, origin } of this.roots) {
      for (const pluginDir of collectPluginCandidateDirs(dir)) {
        const manifestPath = join(pluginDir, "ai0.extension.json");
        try {
          const parsedJson = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          const fallbackId = pluginDir.split(sep).at(-1) ?? "plugin.unknown";
          const manifest = parseManifest(parsedJson, fallbackId);
          const uiSlots = (manifest.console_contributions?.ui_slots ?? []).map((slot) =>
            normalizeSlot(manifest.extension_id, slot)
          );
          this.discovered.set(manifest.extension_id, {
            manifest,
            rootDir: pluginDir,
            origin,
            uiSlots,
            enabled: parsedJson.default_enabled !== false
          });
        } catch {
          // Isolate malformed external manifests instead of crashing daemon boot.
        }
      }
    }
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
      ui_slots: [...plugin.uiSlots]
    };
  }

  findDefaultStageShellId(): string | undefined {
    for (const plugin of this.discovered.values()) {
      if (!plugin.enabled) continue;
      const stageSlot = plugin.uiSlots.find(
        (slot) => slot.slot_target === "slot.shells.mounted_stage"
      );
      if (stageSlot?.shell_id) return stageSlot.shell_id;
    }
    return undefined;
  }

  readPluginAsset(extensionId: string, requestedRelativePath: string): PluginAssetPayload | undefined {
    const plugin = this.discovered.get(extensionId);
    if (!plugin) return undefined;
    const normalized = stripLeadingRelative(requestedRelativePath).replaceAll("\\", "/");
    if (!normalized || normalized.includes("\0") || normalized.includes("..")) return undefined;

    const allowedRoot = resolve(plugin.rootDir, "dist");
    const targetPath = normalized.startsWith("dist/")
      ? resolve(plugin.rootDir, normalized)
      : resolve(allowedRoot, normalized);
    const rel = relative(allowedRoot, targetPath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
    if (!existsSync(targetPath)) return undefined;

    const info = statSync(targetPath);
    if (!info.isFile()) return undefined;
    const contentType = CONTENT_TYPES[extname(targetPath).toLowerCase()] ?? "application/octet-stream";
    return {
      content: readFileSync(targetPath),
      contentType,
      filePath: targetPath
    };
  }

  mountIntoHost(host: PolymorphicExtensionHost): void {
    for (const plugin of this.discovered.values()) {
      const { manifest } = plugin;
      const buses = new Set<ExtensionDimension>([manifest.dimension]);
      if (plugin.uiSlots.length > 0) buses.add("ext.console_ui");
      const stageSlot = plugin.uiSlots.find((slot) => slot.slot_target === "slot.shells.mounted_stage");

      const extensionPayload: Record<string, unknown> = {
        id: manifest.extension_id,
        displayName: manifest.display_name,
        version: manifest.version,
        origin: plugin.origin,
        source: plugin.rootDir,
        ...(stageSlot?.shell_id ? { shellId: stageSlot.shell_id } : {}),
        ...(stageSlot?.route_path ? { stageRoute: stageSlot.route_path } : {}),
        uiSlots: plugin.uiSlots
      };

      if (manifest.dimension === "ext.cognitive_organ") {
        extensionPayload.organId = manifest.extension_id;
        extensionPayload.defaultEnabled = plugin.enabled;
        extensionPayload.contributeToBlackboard = () => ({
          slot_id: `organ.${manifest.extension_id.replace(/[^a-z0-9_]+/gi, "_")}`,
          text: `${manifest.display_name}：已动态挂载并处于待命状态。`
        });
      }

      if (manifest.dimension === "ext.media_pipeline") {
        extensionPayload.getSupportedVocabulary = () => ({
          voice_emotion_tags: ["warm_neutral", "bright", "soft_sleepy"]
        });
      }

      host.registerExtension({
        id: manifest.extension_id,
        carrier: manifest.carrier_kind,
        buses: [...buses],
        readDomains: [...manifest.permissions.read_blackboard_domains],
        proposeDomains: [...manifest.permissions.propose_mutation_domains],
        extension: extensionPayload
      });
    }
  }
}
