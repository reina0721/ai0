import {
  Ai0ExtensionManifestSchema,
  SkillMarkdownFrontmatterSchema,
  type Ai0ExtensionManifest,
  type ExtensionCarrierKind,
  type ExtensionDimension,
  type SkillMarkdownFrontmatter
} from "@ai0/protocol";

type ManifestInput = Record<string, unknown>;

export interface ParsedSkillMarkdown<T = SkillMarkdownFrontmatter> {
  frontmatter: T;
  body: string;
  raw_frontmatter: string;
}

const DEFAULT_PERMISSIONS = {
  read_blackboard_domains: [
    "D1_WORKING_TURN",
    "D2_HOMEOSTASIS_AFFECT",
    "D3_MEMORY_PROJECTION"
  ] as const,
  propose_mutation_domains: ["D3_MEMORY_PROJECTION"] as const,
  max_audience_scope: "only_owner" as const,
  network_access: false
};

function normalizeToAi0ExtensionManifest(
  manifest: ManifestInput,
  fallbackDimension?: ExtensionDimension
): Ai0ExtensionManifest {
  const dimension =
    (manifest.dimension as ExtensionDimension | undefined) ??
    (manifest.bus as ExtensionDimension | undefined) ??
    (manifest.extension_point as ExtensionDimension | undefined) ??
    fallbackDimension ??
    "ext.cognitive_organ";
  const carrierKind =
    (manifest.carrier_kind as ExtensionCarrierKind | undefined) ??
    (manifest.carrier as ExtensionCarrierKind | undefined) ??
    "native_code_plugin";

  return Ai0ExtensionManifestSchema.parse({
    manifest_version: "1.1.0",
    extension_id: String(manifest.extension_id ?? manifest.id ?? "plugin.unknown"),
    display_name: String(
      manifest.display_name ?? manifest.name ?? manifest.extension_id ?? manifest.id ?? "Plugin"
    ),
    version: String(manifest.version ?? "1.0.0"),
    author: String(manifest.author ?? "ai0-community"),
    carrier_kind: carrierKind,
    dimension,
    ...(typeof manifest.entry === "string" ? { entry: manifest.entry } : {}),
    permissions:
      manifest.permissions &&
      typeof manifest.permissions === "object" &&
      "read_blackboard_domains" in (manifest.permissions as object)
        ? manifest.permissions
        : DEFAULT_PERMISSIONS,
    ...(manifest.console_contributions
      ? { console_contributions: manifest.console_contributions }
      : {})
  });
}

/** Validate an extension manifest while retaining its input shape. */
export function validateExtensionManifest<T extends ManifestInput>(
  manifest: T,
  expectedDimension?: ExtensionDimension
): T {
  const declared =
    manifest.dimension ?? manifest.extension_point ?? manifest.bus ?? manifest.extension_type;
  if (expectedDimension !== undefined && declared !== undefined && declared !== expectedDimension) {
    throw new TypeError(`Expected ${expectedDimension} plugin, received ${String(declared)}`);
  }
  normalizeToAi0ExtensionManifest(manifest, expectedDimension);
  return manifest;
}

/** Define and eagerly validate a shell plugin manifest. */
export function defineShellPlugin<const T extends ManifestInput>(manifest: T): T {
  return validateExtensionManifest(manifest, "ext.shell");
}

/** Define and eagerly validate a cognitive-organ plugin manifest. */
export function defineCognitiveOrganPlugin<const T extends ManifestInput>(manifest: T): T {
  return validateExtensionManifest(manifest, "ext.cognitive_organ");
}

/** Define and eagerly validate a media-pipeline plugin manifest. */
export function defineMediaPipelinePlugin<const T extends ManifestInput>(manifest: T): T {
  return validateExtensionManifest(manifest, "ext.media_pipeline");
}

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
