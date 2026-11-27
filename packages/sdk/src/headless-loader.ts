import type { ExtensionCoreHost, ExtensionPackageDefinition, PackageConfig } from "@ai0/extension-core";
import { Ai0ExtensionManifestSchema, type AgentSkillRecord, type Ai0ExtensionManifest } from "@ai0/protocol";
import {
  mountCarrierProjections,
  resolveEffectiveSkillProjections,
  type MountCarrierProjectionsOptions
} from "./carrier-projections.js";
import { parseSkillMarkdownDocument } from "./index.js";

export interface HeadlessLoaderOptions {
  readonly pluginDirs?: readonly string[];
  readonly skillDirs?: readonly string[];
  readonly configByPackageId?: Readonly<Record<string, PackageConfig>>;
  readonly enableByDefault?: boolean;
  readonly carrierOptions?: MountCarrierProjectionsOptions;
}

export interface HeadlessLoadReport {
  readonly mountedPackageIds: readonly string[];
  readonly disabledPackageIds: readonly string[];
  readonly errors: readonly { location: string; error: string }[];
}

function getNodeBuiltins() {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  if (typeof proc?.getBuiltinModule !== "function") {
    throw new Error("discoverAndMountExtensions requires a Node.js >= 22.3 host environment");
  }
  const fs = proc.getBuiltinModule("node:fs") as typeof import("node:fs");
  const path = proc.getBuiltinModule("node:path") as typeof import("node:path");
  const url = proc.getBuiltinModule("node:url") as typeof import("node:url");
  return { fs, path, url };
}

function isPackageDefinition(candidate: unknown): candidate is ExtensionPackageDefinition {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    "manifest" in candidate &&
    typeof (candidate as ExtensionPackageDefinition).manifest === "object"
  );
}

/**
 * Headless extension and SKILL.md directory discovery & loader.
 * Scans plugin directories (`ai0.extension.json`) and skill directories (`SKILL.md`)
 * and mounts them directly onto an `ExtensionCoreHost` without requiring `apps/daemon`.
 */
export async function discoverAndMountExtensions(
  host: ExtensionCoreHost,
  options: HeadlessLoaderOptions = {}
): Promise<HeadlessLoadReport> {
  const { fs, path, url } = getNodeBuiltins();
  const collectFilesNamed = (rootDir: string, targetName: string, maxDepth = 4): string[] => {
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
    const found: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && entry.name === targetName) {
          found.push(fullPath);
        }
      }
    };
    walk(path.resolve(rootDir), 0);
    return found.sort((a, b) => a.localeCompare(b));
  };

  const mountedPackageIds: string[] = [];
  const disabledPackageIds: string[] = [];
  const errors: Array<{ location: string; error: string }> = [];

  for (const pluginDir of options.pluginDirs ?? []) {
    for (const manifestPath of collectFilesNamed(pluginDir, "ai0.extension.json")) {
      try {
        const rawJson = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
        const manifest: Ai0ExtensionManifest = Ai0ExtensionManifestSchema.parse(rawJson);
        if (host.getPackage(manifest.extension_id)) continue;

        let definition: ExtensionPackageDefinition;
        if (manifest.carrier_kind === "native_code_plugin" && manifest.entry) {
          const pluginRoot = path.dirname(manifestPath);
          const candidateDist = path.resolve(pluginRoot, manifest.entry);
          const candidateSrc = path.resolve(
            pluginRoot,
            manifest.entry.replace(/^\.?\/?dist\//u, "src/").replace(/\.js$/u, ".ts")
          );
          const entryFile = fs.existsSync(candidateDist)
            ? candidateDist
            : fs.existsSync(candidateSrc)
              ? candidateSrc
              : undefined;
          if (!entryFile) {
            throw new Error(`Plugin entry not found for ${manifest.extension_id}: ${manifest.entry}`);
          }
          const href = url.pathToFileURL(entryFile).href;
          const imported = (await import(/* @vite-ignore */ href)) as Record<string, unknown>;
          const exported =
            imported.default ??
            Object.values(imported).find((item) => isPackageDefinition(item));
          if (!isPackageDefinition(exported)) {
            throw new Error(`Module ${entryFile} did not export an ExtensionPackageDefinition`);
          }
          definition = exported;
        } else {
          definition = {
            manifest,
            activate(scope) {
              const routeErrors = mountCarrierProjections(scope, manifest, undefined, options.carrierOptions);
              if (routeErrors.length > 0) {
                throw new Error(routeErrors.join("; "));
              }
            }
          };
        }

        const initialConfig = options.configByPackageId?.[manifest.extension_id] ?? {};
        host.mountPackage(definition, initialConfig);
        const shouldEnable =
          options.enableByDefault !== undefined
            ? options.enableByDefault
            : manifest.default_enabled !== false;
        if (!shouldEnable) {
          host.setPackageEnabled(manifest.extension_id, false);
          disabledPackageIds.push(manifest.extension_id);
        } else {
          mountedPackageIds.push(manifest.extension_id);
        }
      } catch (error) {
        errors.push({
          location: manifestPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  for (const skillDir of options.skillDirs ?? []) {
    for (const skillPath of collectFilesNamed(skillDir, "SKILL.md")) {
      try {
        const rawSource = fs.readFileSync(skillPath, "utf8");
        const parsed = parseSkillMarkdownDocument(rawSource);
        const folderSlug =
          path.basename(path.dirname(skillPath))
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/gu, "-")
            .replace(/^-+|-+$/gu, "") || "skill";
        const extensionId = parsed.frontmatter.skill_id || `skill.${folderSlug}`;
        if (host.getPackage(extensionId)) continue;

        const skillRecord: AgentSkillRecord = {
          id: extensionId,
          slug: folderSlug,
          displayName: parsed.frontmatter.display_name,
          description: parsed.frontmatter.description,
          source: "soul_user",
          filePath: skillPath,
          readonly: false,
          enabled: true,
          requiredMcpTools: parsed.frontmatter.required_mcp_tools,
          requiredVaultSecrets: parsed.frontmatter.required_vault_secrets ?? [],
          capabilityRisk: parsed.frontmatter.capability_risk,
          maxAudienceScope: parsed.frontmatter.max_audience_scope,
          inCharacterDemeanor: parsed.frontmatter.in_character_demeanor,
          crystallizeAsEpisodicMemory: parsed.frontmatter.crystallize_as_episodic_memory,
          projections: parsed.frontmatter.projections,
          bodyMarkdown: parsed.body
        };
        const effectiveProjections = resolveEffectiveSkillProjections(skillRecord);
        const facets = [...new Set(effectiveProjections.map((route) => route.facet))];
        const manifest = Ai0ExtensionManifestSchema.parse({
          manifest_version: "2.0.0",
          extension_id: extensionId,
          display_name: skillRecord.displayName,
          description: skillRecord.description,
          version: "1.0.0",
          author: "local-skill",
          carrier_kind: "markdown_skill_manual",
          default_enabled: true,
          facets,
          projections: [...effectiveProjections],
          permissions: {
            read_blackboard_domains: [],
            propose_mutation_domains: skillRecord.crystallizeAsEpisodicMemory ? ["D3_MEMORY_PROJECTION"] : [],
            max_audience_scope: skillRecord.maxAudienceScope,
            network_access: false
          }
        });

        host.mountPackage(
          {
            manifest,
            activate(scope) {
              const routeErrors = mountCarrierProjections(
                scope,
                manifest,
                { kind: "skill", skill: skillRecord },
                options.carrierOptions
              );
              if (routeErrors.length > 0) {
                throw new Error(routeErrors.join("; "));
              }
            }
          },
          options.configByPackageId?.[extensionId] ?? {}
        );
        mountedPackageIds.push(extensionId);
      } catch (error) {
        errors.push({
          location: skillPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return {
    mountedPackageIds,
    disabledPackageIds,
    errors
  };
}
