import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDefaultConsoleStudioConfig,
  writeConsoleStudioConfig
} from "./console-studio-config.js";
import {
  addSourceApiKey,
  deleteModelInstance,
  deleteProviderInstance,
  findProviderReferences,
  importMcpServersFromJson,
  readHostInfrastructureConfig,
  readHostVaultKey,
  removeSourceApiKey,
  resolveEffectiveSourceApiKeys,
  resolveHostInfrastructureDir,
  saveHostVaultKey,
  upsertModelInstance,
  upsertPlatformChannelInstance,
  upsertProviderInstance,
  upsertProviderSource
} from "./host-infrastructure-store.js";
import {
  deleteUserAgentSkill,
  importUserSkillMarkdown,
  listAgentSkills,
  saveUserAgentSkill,
  setAgentSkillEnabled
} from "./soul-skills-store.js";
import {
  deleteExtensionRuntimeState,
  readExtensionsState,
  writeExtensionRuntimeConfig
} from "./extension-state-store.js";
import {
  ensureOrthogonalStoresMigrated,
  readSoulProfileConfig
} from "./soul-profile-store.js";

describe("orthogonal host infrastructure & soul profile stores", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("migrates legacy console_studio.json cleanly and strips role suffixes from providers", () => {
    const root = mkdtempSync(join(tmpdir(), "ai0-ortho-mig-"));
    dirs.push(root);
    const soulDir = join(root, "mio.soul");
    const hostDir = resolveHostInfrastructureDir(soulDir);

    const legacy = createDefaultConsoleStudioConfig("Mio");
    legacy.systemSettings.appearance = "dark";
    legacy.systemSettings.soulTheme = "astral-blue";
    writeConsoleStudioConfig(soulDir, legacy);

    const { infrastructure, soulProfiles } = ensureOrthogonalStoresMigrated(soulDir, hostDir);
    expect(infrastructure.systemSettings).toMatchObject({
      appearance: "dark",
      soulTheme: "astral-blue",
      navRailMode: "expanded",
      inspectorView: "trace"
    });

    const deepseek = infrastructure.providers.find((p) => p.id === "prov_deepseek_v3");
    expect(deepseek).toBeDefined();
    expect(deepseek?.label).toBe("DeepSeek Flash");
    expect(deepseek?.label).not.toContain("主力对话");
    expect(deepseek?.capabilityKind).toBe("chat");
    expect(deepseek?.models).toContain("deepseek-flash");

    const rerank = infrastructure.providers.find((p) => p.id === "prov_bge_rerank");
    expect(rerank?.capabilityKind).toBe("rerank");
    expect(rerank?.label).not.toContain("知识库精排");

    expect(soulProfiles.profiles.length).toBeGreaterThanOrEqual(3);
    expect(soulProfiles.capabilities.knowledge.embeddingBinding?.providerId).toBe("prov_bge_embed");
    expect(soulProfiles.capabilities.multimodal.ttsBinding?.providerId).toBe("prov_fish_tts");

    const refs = findProviderReferences("prov_deepseek_v3", soulProfiles);
    expect(refs.some((r) => r.scope === "profile_primary")).toBe(true);
  });

  it("supports dynamic provider & platform CRUD with isolated host vault secrets", () => {
    const root = mkdtempSync(join(tmpdir(), "ai0-ortho-crud-"));
    dirs.push(root);
    const soulDir = join(root, "alpha.soul");
    const hostDir = resolveHostInfrastructureDir(soulDir);

    ensureOrthogonalStoresMigrated(soulDir, hostDir);

    const updated = upsertProviderInstance(
      hostDir,
      {
        id: "prov_custom_openai",
        label: "我的中转站",
        vendor: "OpenAI Compatible",
        capabilityKind: "chat",
        adapterType: "openai_compatible",
        baseUrl: "https://relay.example.com/v1",
        apiKeyMasked: "",
        models: ["gpt-4.1", "gpt-4.1-mini"],
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        enabled: true,
        health: { status: "untested", latencyMs: 0 }
      },
      "sk-test-secret-1234567890"
    );

    const created = updated.providers.find((p) => p.id === "prov_custom_openai");
    expect(created?.label).toBe("我的中转站");
    expect(created?.apiKeyMasked).toContain("••••••");
    expect(readHostVaultKey(hostDir, "prov_custom_openai")).toBe("sk-test-secret-1234567890");

    saveHostVaultKey(hostDir, "prov_custom_openai", "sk-rotated-999999999");
    expect(readHostVaultKey(hostDir, "prov_custom_openai")).toBe("sk-rotated-999999999");

    // Verify platform CRUD
    const withPlatform = upsertPlatformChannelInstance(hostDir, {
      id: "qq.napcat.main",
      label: "QQ 群聊桥接",
      adapterKind: "qq_onebot",
      endpoint: "ws://127.0.0.1:3001",
      authMode: "scoped_token",
      defaultAudienceCeiling: "group:default",
      enabled: true,
      notes: "NapCat OneBot v11"
    });
    expect(withPlatform.platforms.some((p) => p.id === "qq.napcat.main")).toBe(true);

    // Delete unreferenced provider cleanly removes vault secret too
    const soulCfg = readSoulProfileConfig(soulDir);
    expect(findProviderReferences("prov_custom_openai", soulCfg)).toHaveLength(0);
    deleteProviderInstance(hostDir, "prov_custom_openai");
    expect(readHostInfrastructureConfig(hostDir).providers.some((p) => p.id === "prov_custom_openai")).toBe(false);
    expect(readHostVaultKey(hostDir, "prov_custom_openai")).toBeUndefined();
  });

  it("supports v2 ProviderSource multi-key rotation, $ENV_VAR resolution, ModelInstances, and MCP JSON import", () => {
    const root = mkdtempSync(join(tmpdir(), "ai0-ortho-v2-"));
    dirs.push(root);
    const hostDir = join(root, "host");

    const seeded = readHostInfrastructureConfig(hostDir);
    expect(seeded.schemaVersion).toBe(2);
    expect(seeded.providerSources.length).toBeGreaterThanOrEqual(6);
    expect(seeded.modelInstances.length).toBeGreaterThanOrEqual(8);

    // Add a multi-capability source (SiliconFlow serving both chat & embedding)
    upsertProviderSource(hostDir, {
      id: "src_sf",
      label: "SiliconFlow 硅基流动",
      vendor: "SiliconFlow",
      adapterType: "openai_compatible",
      supportedCapabilities: ["chat", "embedding"],
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKeys: [],
      keyRotationStrategy: "round_robin",
      proxyUrl: "",
      timeoutMs: 45000,
      customHeaders: {},
      discoveredModels: [],
      enabled: true
    });

    const { keyEntry: k1 } = addSourceApiKey(hostDir, "src_sf", "sk-sf-real-secret-11111111", "主 Key");
    const { keyEntry: k2 } = addSourceApiKey(hostDir, "src_sf", "$TEST_AI0_SF_KEY", "CI 环境变量");
    expect(k1.kind).toBe("vault_secret");
    expect(k2.kind).toBe("env_var");
    expect(k2.envVarName).toBe("TEST_AI0_SF_KEY");

    const afterKeys = readHostInfrastructureConfig(hostDir);
    const sf = afterKeys.providerSources.find((s) => s.id === "src_sf")!;
    const resolvedKeys = resolveEffectiveSourceApiKeys(hostDir, sf, {
      TEST_AI0_SF_KEY: "sk-env-resolved-22222222"
    });
    expect(resolvedKeys).toEqual(["sk-sf-real-secret-11111111", "sk-env-resolved-22222222"]);

    upsertModelInstance(hostDir, {
      id: "mdl_sf_qwen",
      sourceId: "src_sf",
      displayName: "Qwen2.5 72B",
      modelId: "Qwen/Qwen2.5-72B-Instruct",
      capabilityKind: "chat",
      enabled: true,
      capabilities: { vision: false, tools: true, reasoning: false, streaming: true },
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      customParams: {},
      health: { status: "untested", latencyMs: 0 }
    });
    expect(readHostInfrastructureConfig(hostDir).modelInstances.some((m) => m.id === "mdl_sf_qwen")).toBe(true);

    removeSourceApiKey(hostDir, "src_sf", k1.id);
    deleteModelInstance(hostDir, "mdl_sf_qwen");
    expect(readHostInfrastructureConfig(hostDir).modelInstances.some((m) => m.id === "mdl_sf_qwen")).toBe(false);

    // Import Claude Desktop / AstrBot mcpServers JSON
    const { imported } = importMcpServersFromJson(hostDir, {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "$GITHUB_TOKEN" }
        },
        weather: {
          url: "http://127.0.0.1:8787/mcp",
          transport: "streamable_http",
          headers: { "x-api-key": "test" }
        }
      }
    });
    expect(imported).toHaveLength(2);
    expect(imported.find((s) => s.name === "github")?.transport).toBe("stdio");
    expect(imported.find((s) => s.name === "weather")?.transport).toBe("streamable_http");
  });

  it("reads bundled SKILL.md, manages user .soul/skills CRUD, and persists extension runtime state", () => {
    const root = mkdtempSync(join(tmpdir(), "ai0-skills-ext-"));
    dirs.push(root);
    const soulDir = join(root, "mio.soul");
    const bundledDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../plugins/skills-and-mcp"
    );

    const created = saveUserAgentSkill(soulDir, {
      slug: "late-night-tea",
      displayName: "深夜热茶提醒",
      description: "深夜提醒休息喝水",
      requiredMcpTools: ["local.timer"],
      inCharacterDemeanor: "轻声、温柔",
      bodyMarkdown: "# Late Night Tea\n\nRemind softly."
    });
    expect(created.source).toBe("soul_user");
    expect(created.readonly).toBe(false);

    const imported = importUserSkillMarkdown(
      soulDir,
      `---\nskill_id: "soul.skill.imported-note"\ndisplay_name: "导入速记"\ndescription: "快速整理碎片想法"\nrequired_mcp_tools: ["notes.append"]\n---\n\n# Note Body\n`
    );
    expect(imported.displayName).toBe("导入速记");

    setAgentSkillEnabled(soulDir, created.id, false);
    const listed = listAgentSkills(soulDir, bundledDir);
    expect(listed.find((s) => s.id === created.id)?.enabled).toBe(false);
    expect(listed.some((s) => s.source === "plugin_bundled" && s.readonly)).toBe(true);

    // Cannot delete plugin_bundled skill
    const bundled = listed.find((s) => s.source === "plugin_bundled")!;
    expect(() => deleteUserAgentSkill(soulDir, bundled.id, bundledDir)).toThrow();

    // Can delete user skill
    deleteUserAgentSkill(soulDir, created.id, bundledDir);
    expect(listAgentSkills(soulDir, bundledDir).some((s) => s.id === created.id)).toBe(false);

    // Extension state persistence
    writeExtensionRuntimeConfig(soulDir, "community.organ.dream-journal", { poetic_style: "starlight", max_fragments: 4 }, true);
    const extState = readExtensionsState(soulDir);
    expect(extState.extensions["community.organ.dream-journal"]?.config_values.poetic_style).toBe("starlight");
    deleteExtensionRuntimeState(soulDir, "community.organ.dream-journal");
    expect(readExtensionsState(soulDir).extensions["community.organ.dream-journal"]).toBeUndefined();
  });
});
