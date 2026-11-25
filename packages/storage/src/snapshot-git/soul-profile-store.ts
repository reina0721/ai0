import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  SoulProfileAndCapabilitiesConfigSchema,
  type HostInfrastructureConfig,
  type SoulProfileAndCapabilitiesConfig
} from "@ai0/protocol";
import {
  createDefaultHostInfrastructureConfig,
  readHostInfrastructureConfig,
  resolveHostInfrastructureDir
} from "./host-infrastructure-store.js";
import { resolveHostDefaultChatBinding } from "./soul-model-binding.js";

export function getSoulProfilesFilePath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "profiles.json");
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

export function createDefaultSoulProfileConfig(
  infrastructure: HostInfrastructureConfig = createDefaultHostInfrastructureConfig()
): SoulProfileAndCapabilitiesConfig {
  return SoulProfileAndCapabilitiesConfigSchema.parse({
    schemaVersion: 1,
    defaultProfileId: "default",
    profiles: [{
      id: "default",
      name: "Default",
      primaryChat: resolveHostDefaultChatBinding(infrastructure) ??
        { providerId: "unconfigured", modelId: "unconfigured" }
    }],
    routingRules: [],
    capabilities: { knowledge: {}, multimodal: {} }
  });
}

export function ensureOrthogonalStoresMigrated(
  soulDirPath: string,
  hostDirPath: string = resolveHostInfrastructureDir(soulDirPath)
): {
  infrastructure: HostInfrastructureConfig;
  soulProfiles: SoulProfileAndCapabilitiesConfig;
} {
  const infrastructure = readHostInfrastructureConfig(hostDirPath);
  const soulProfiles = existsSync(getSoulProfilesFilePath(soulDirPath))
    ? readSoulProfileConfig(soulDirPath)
    : writeSoulProfileConfig(soulDirPath, createDefaultSoulProfileConfig(infrastructure));
  return { infrastructure, soulProfiles };
}

export function readSoulProfileConfig(soulDirPath: string): SoulProfileAndCapabilitiesConfig {
  const filePath = getSoulProfilesFilePath(soulDirPath);
  if (!existsSync(filePath)) {
    const seeded = createDefaultSoulProfileConfig(
      readHostInfrastructureConfig(resolveHostInfrastructureDir(soulDirPath))
    );
    writeSoulProfileConfig(soulDirPath, seeded);
    return seeded;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return SoulProfileAndCapabilitiesConfigSchema.parse(raw);
}

export function writeSoulProfileConfig(
  soulDirPath: string,
  config: SoulProfileAndCapabilitiesConfig
): SoulProfileAndCapabilitiesConfig {
  const validated = SoulProfileAndCapabilitiesConfigSchema.parse({ ...config, schemaVersion: 1 });
  atomicWriteJson(getSoulProfilesFilePath(soulDirPath), validated);
  return validated;
}
