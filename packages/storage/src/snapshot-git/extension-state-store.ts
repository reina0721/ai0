import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  ExtensionsStateJsonSchema,
  type ExtensionCarrierKind,
  type ExtensionFacetId,
  type ExtensionPermissions,
  type ExtensionPersistentState,
  type ExtensionsStateJson
} from "@ai0/protocol";

export function getExtensionsStateFilePath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "extensions_state.json");
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", encoding: "utf8" });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function readExtensionsState(soulDirPath: string): ExtensionsStateJson {
  const filePath = getExtensionsStateFilePath(soulDirPath);
  if (!existsSync(filePath)) {
    return { schema_version: "1.0.0", extensions: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const strict = ExtensionsStateJsonSchema.safeParse(raw);
    if (strict.success) return strict.data;
    return { schema_version: "1.0.0", extensions: {} };
  } catch {
    return { schema_version: "1.0.0", extensions: {} };
  }
}

export interface WriteExtensionRuntimeConfigMeta {
  carrier_kind?: ExtensionCarrierKind;
  facets?: ExtensionFacetId[];
  enabled?: boolean;
  permissions?: ExtensionPermissions;
}

const DEFAULT_EXTENSION_PERMISSIONS: ExtensionPermissions = {
  read_blackboard_domains: [],
  propose_mutation_domains: [],
  max_audience_scope: "only_owner",
  network_access: false
};

export function writeExtensionRuntimeConfig(
  soulDirPath: string,
  extensionId: string,
  configValues: Record<string, unknown>,
  enabledOrMeta?: boolean | WriteExtensionRuntimeConfigMeta
): ExtensionsStateJson {
  const state = readExtensionsState(soulDirPath);
  const existing = state.extensions[extensionId];
  const meta: WriteExtensionRuntimeConfigMeta =
    typeof enabledOrMeta === "boolean" ? { enabled: enabledOrMeta } : (enabledOrMeta ?? {});
  const enabled = meta.enabled ?? existing?.enabled ?? true;

  const facets = meta.facets ?? existing?.facets;
  if (!facets?.length) throw new TypeError("Extension state requires at least one facet");
  const entry: ExtensionPersistentState = {
    extension_id: extensionId,
    carrier_kind: meta.carrier_kind ?? existing?.carrier_kind ?? "native_code_plugin",
    facets,
    enabled,
    status: enabled ? "active" : "disabled",
    ...(existing?.active_profile ? { active_profile: existing.active_profile } : {}),
    config_values: { ...configValues },
    permission_overrides: meta.permissions ?? existing?.permission_overrides ?? DEFAULT_EXTENSION_PERMISSIONS,
    bound_vault_secrets: existing?.bound_vault_secrets ?? {}
  };

  const next = ExtensionsStateJsonSchema.parse({
    schema_version: "1.0.0",
    extensions: {
      ...state.extensions,
      [extensionId]: entry
    }
  });
  atomicWriteJson(getExtensionsStateFilePath(soulDirPath), next);
  return next;
}

export function deleteExtensionRuntimeState(
  soulDirPath: string,
  extensionId: string
): ExtensionsStateJson {
  const state = readExtensionsState(soulDirPath);
  if (!(extensionId in state.extensions)) return state;
  const nextExtensions = { ...state.extensions };
  delete nextExtensions[extensionId];
  const next = ExtensionsStateJsonSchema.parse({
    schema_version: "1.0.0",
    extensions: nextExtensions
  });
  atomicWriteJson(getExtensionsStateFilePath(soulDirPath), next);
  return next;
}
