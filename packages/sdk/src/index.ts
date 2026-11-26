export * from "@ai0/extension-core";
export * from "./facets.js";
import type { ExtensionScope, ExtensionPackageDefinition } from "@ai0/extension-core";
import {
  Ai0ExtensionManifestSchema,
  SkillMarkdownFrontmatterSchema,
  type Ai0ExtensionManifest,
  type ExtensionFacetId,
  type SkillMarkdownFrontmatter,
  type ThemeColorPreset,
  type VerifiableTurnTrace
} from "@ai0/protocol";

export type Ai0StageMode = "live" | "sandbox";
export type Ai0StageAppearance = "light" | "dark";

/** Runtime state synchronized from the Console host to any mounted Web Channel stage. */
export interface Ai0ChannelStageHostState {
  readonly mode: Ai0StageMode;
  readonly targetInstance: "live" | `sandbox:${string}`;
  readonly soulId?: string;
  readonly personaName: string;
  readonly soulTheme: ThemeColorPreset;
  readonly appearance: Ai0StageAppearance;
  readonly connected: boolean;
  readonly loading: boolean;
  readonly error?: string;
  readonly protocolBasePath: string;
  readonly authToken: string;
  readonly journal?: readonly { title: string; date: string; content: string }[];
  readonly recentTraces?: readonly VerifiableTurnTrace[];
}

/** Framework-agnostic host bridge passed to mounted slot.channels.mounted_stage plugins. */
export interface Ai0ChannelStageHostBridge {
  readonly contributions?: ExtensionScope;
  readonly extensionId: string;
  readonly channelId: string;
  getState(): Ai0ChannelStageHostState;
  subscribe(listener: (state: Ai0ChannelStageHostState) => void): () => void;
  showToast(message: string): void;
  retryConnection(): void;
  fetchTurnTrace(options: {
    requestId?: string;
    traceId?: string;
    mode: Ai0StageMode;
    signal?: AbortSignal;
  }): Promise<VerifiableTurnTrace | undefined>;
}

export type ConsolePageState = Pick<Ai0ChannelStageHostState,
  "mode" | "targetInstance" | "soulId" | "personaName" | "soulTheme" | "appearance" | "journal">;

export interface ConsolePageHost {
  readonly extensionId: string;
  readonly contributions: ExtensionScope;
  readonly channel?: Ai0ChannelStageHostBridge;
  getState(): ConsolePageState;
  subscribe(listener: (state: ConsolePageState) => void): () => void;
  showToast(message: string): void;
}
export interface ConsolePageModule<TContainer = unknown> {
  mountPage(container: TContainer, host: ConsolePageHost): Ai0ChannelStageCleanup | Promise<Ai0ChannelStageCleanup>;
}
export type Ai0ChannelStageCleanup = (() => void) | { unmount(): void };

export interface Ai0ChannelStageModule<TContainer = unknown> {
  readonly extensionId?: string;
  mountChannelStage(
    container: TContainer,
    host: Ai0ChannelStageHostBridge
  ): Ai0ChannelStageCleanup | Promise<Ai0ChannelStageCleanup>;
}

/** Define a dynamically mountable Web Channel stage module exported from a plugin's dist/ui bundle. */
export function defineChannelStageModule<TContainer = unknown>(
  module: Ai0ChannelStageModule<TContainer>
): Ai0ChannelStageModule<TContainer> {
  return module;
}

type ManifestInput = Record<string, unknown>;

export interface ParsedSkillMarkdown<T = SkillMarkdownFrontmatter> {
  frontmatter: T;
  body: string;
  raw_frontmatter: string;
}

type PackageManifestInput = Omit<Ai0ExtensionManifest, "manifest_version">;
type PackageInput = Omit<ExtensionPackageDefinition, "manifest"> & {
  manifest: PackageManifestInput;
};

export function validateExtensionManifest(manifest: unknown): Ai0ExtensionManifest {
  return Ai0ExtensionManifestSchema.parse(manifest);
}

export function defineExtensionPackage(definition: PackageInput): ExtensionPackageDefinition {
  return { ...definition, manifest: validateExtensionManifest({ ...definition.manifest, manifest_version: "2.0.0" }) };
}

function definePlugin(defaultFacet: ExtensionFacetId) {
  return (definition: Omit<PackageInput, "manifest"> & {
    manifest: Omit<PackageManifestInput, "facets"> & { facets?: ExtensionFacetId[] };
  }): ExtensionPackageDefinition => defineExtensionPackage({
    ...definition,
    manifest: { ...definition.manifest, facets: [...new Set([defaultFacet, ...definition.manifest.facets ?? []])] }
  });
}

export const defineChannelPlugin = definePlugin("channel.bridge");
export const definePerceptionFilterPlugin = definePlugin("perception.filter");
export const defineCognitiveOrganPlugin = definePlugin("cognition.context_contributor");
export const defineMediaPipelinePlugin = definePlugin("expression.media_transcoder");
export const defineActionSkillPlugin = definePlugin("agent.skill_manual");

const scalar = (source: string): unknown => {
  const value = source.trim();
  if (!value) return "";
  if (value === "true" || value === "false") return value === "true";
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((item) => scalar(item))
      .filter((item) => item !== "");
  }
  return value;
};

/** Parse YAML/JSON frontmatter used by Carrier II SKILL.md manuals. */
export function parseSkillMarkdownDocument(
  source: string
): ParsedSkillMarkdown<SkillMarkdownFrontmatter> {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new SyntaxError("Skill Markdown must begin with a closed YAML frontmatter block");
  }
  const raw = match[1] ?? "";
  let frontmatterObj: ManifestInput = {};
  if (raw.trim().startsWith("{")) {
    frontmatterObj = JSON.parse(raw) as ManifestInput;
  } else {
    for (const original of raw.split("\n")) {
      const line = original.replace(/\s+#.*$/, "").trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf(":");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      frontmatterObj[key] = scalar(line.slice(separator + 1));
    }
  }
  const parsed = SkillMarkdownFrontmatterSchema.parse(frontmatterObj);
  return {
    frontmatter: parsed,
    body: match[2] ?? "",
    raw_frontmatter: raw
  };
}

export type { ParsedSkillMarkdown as SkillMarkdownDocument };
