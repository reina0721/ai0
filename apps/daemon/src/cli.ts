import { registerShellActions } from "./shell-actions.js";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { GOLDEN_REGRESSION_SCENARIO_V1, ModelContextLimitError, runScenarioPlaybook } from "@ai0/kernel";
import { AudienceScopeSchema, HandshakeManifestSchema, type AudienceScope, type SensorModality, type VenueType } from "@ai0/protocol";
import {
  compileStudioPromptPreview,
  readConsoleStudioConfig,
  readHostInfrastructureConfig,
  readSoulArchiveConfig,
  readSoulProfileConfig,
  upsertProviderInstance,
  writeExtensionRuntimeConfig,
  writeSoulProfileConfig,
  type RelationshipArchetype
} from "@ai0/storage";

import { createDefaultDaemonRuntime, type Ai0DaemonRuntime } from "./index.js";
import { registerShellProtocolRunRoutes } from "./shell-runs.js";
import {
  readConversation,
  createNewSoulInstance,
  createPrivacyScrubbedReleasePackage,
  dispatchOrAdvanceCoWorkTask,
  distillAndOptionallyApplyCard,
  ingestKnowledgeDocument,
  listAvailableSoulInstances,
  pingStudioProvider,
  reviewGrowthProposal,
  runManualSleepReflection,
  saveVaultProviderKey,
  searchKnowledgeChunks,
  updateStudioConfig
} from "./studio-service.js";

export interface DaemonHttpServerOptions {
  consoleDistDir?: string;
}

const DEFAULT_CONSOLE_DIST_DIR = fileURLToPath(
  new URL("../../console/dist/client", import.meta.url)
);

function parseMode(raw: string | undefined): "live" | "sandbox" {
  return raw === "sandbox" ? "sandbox" : "live";
}

async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parsePortArg(argv: readonly string[]): number | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } else if (arg?.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

export function createUnifiedDaemonHttpApp(
  runtime: Ai0DaemonRuntime,
  options: DaemonHttpServerOptions = {}
): Hono {
  const app = new Hono();

  app.onError((error, c) =>
    c.json(
      {
        error: "DAEMON_HTTP_ERROR",
        message: error instanceof Error ? error.message : String(error)
      },
      500
    )
  );

  // Disable caching on dynamic API / Protocol / Health routes
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) {
      c.res.headers.set("cache-control", "no-store");
    }
  });
  app.use("/protocol/*", async (c, next) => {
    await next();
    c.res.headers.set("cache-control", "no-store");
  });

  app.get("/healthz", (c) => {
    c.header("cache-control", "no-store");
    return c.json({
      ok: true,
      service: "ai0-daemon",
      soulDir: runtime.soulDir,
      stateRev: runtime.coordinator.getSnapshot().state_rev
    });
  });

  // ---------------------------------------------------------------------------
  // Studio Console Bootstrap & Configuration API (/api/studio/*)
  // ---------------------------------------------------------------------------
  app.get("/api/studio/bootstrap", async (c) => {
    const mode = parseMode(c.req.query("mode"));
    const snapshot = await runtime.buildConsoleLiveSnapshot(mode);
    return c.json({
      ok: true,
      ownerToken: runtime.ownerMasterToken,
      snapshot
    });
  });

  app.get("/api/studio/config", (c) =>
    c.json({ ok: true, config: readConsoleStudioConfig(runtime.soulDir) })
  );

  app.post("/api/studio/config", async (c) => {
    const body = await readJsonObject(c);
    const patch = (
      typeof body.patch === "object" && body.patch !== null ? body.patch : body
    ) as Record<string, unknown>;
    const settings = patch.systemSettings;
    const changesAppearance = typeof settings === "object" && settings !== null &&
      (Object.hasOwn(settings, "appearance") || Object.hasOwn(settings, "soulTheme"));
    if (("ecosystem" in patch || changesAppearance) && !isOwnerRequest(c)) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    const saved = updateStudioConfig(runtime, patch);
    const snapshot = await runtime.buildConsoleLiveSnapshot("live");
    return c.json({ ok: true, config: saved, snapshot });
  });

  app.post("/api/studio/plugin-enabled", async (c) => {
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const { id, enabled } = await readJsonObject(c);
    if (typeof id !== "string" || typeof enabled !== "boolean") return c.json({ error: "INVALID_PLUGIN_SETTING" }, 400);
    const plugin = runtime.pluginLoader.getPlugin(id);
    if (!plugin) return c.json({ error: "PLUGIN_NOT_FOUND" }, 404);
    const { plugins } = readConsoleStudioConfig(runtime.soulDir).ecosystem;
    const existing = plugins.find(item => item.id === id);
    if (existing) existing.enabled = enabled;
    else {
      const { display_name: name, version, dimension: bus, carrier_kind: carrier } = plugin.manifest;
      plugins.push({ id, name, version, bus, carrier, enabled, description: "", configFields: [] });
    }
    updateStudioConfig(runtime, { ecosystem: { plugins } });
    writeExtensionRuntimeConfig(
      runtime.soulDir,
      id,
      runtime.pluginLoader.getPluginConfig(runtime.extensionHost, id).config,
      {
        carrier_kind: plugin.manifest.carrier_kind,
        dimension: plugin.manifest.dimension,
        enabled,
        permissions: plugin.manifest.permissions
      }
    );
    await runtime.refreshCapabilities();
    return c.json({ ok: true });
  });

  app.post("/api/studio/prompt-preview", async (c) => {
    const body = await readJsonObject(c);
    const base = readConsoleStudioConfig(runtime.soulDir);
    const override = (
      typeof body.config === "object" && body.config !== null ? body.config : undefined
    ) as typeof base | undefined;
    const cfg = override ?? base;
    const privatePreview = compileStudioPromptPreview(cfg, {
      audienceScope: "only_owner",
      venueType: String(body.venueType ?? "private_1on1")
    });
    const publicPreview = compileStudioPromptPreview(cfg, {
      audienceScope: "public_all",
      venueType: "public_livestream"
    });
    return c.json({ ok: true, privatePreview, publicPreview });
  });

  app.post("/api/studio/distill-apply", async (c) => {
    const body = await readJsonObject(c);
    const card = (
      typeof body.card === "object" && body.card !== null ? body.card : body
    ) as Record<string, unknown>;
    const result = distillAndOptionallyApplyCard(runtime, {
      card,
      apply: body.apply === true,
      roleArchetype: body.roleArchetype as RelationshipArchetype | undefined
    });
    return c.json({ ok: true, ...result });
  });

  app.post("/api/studio/provider-ping", async (c) => {
    const body = await readJsonObject(c);
    const result = await pingStudioProvider(runtime, String(body.providerId ?? ""));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/studio/co-work-task", async (c) => {
    const body = await readJsonObject(c);
    const result = await dispatchOrAdvanceCoWorkTask(runtime, {
      action: (body.action as "create" | "approve" | "complete" | "execute" | "pause") ?? "create",
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      subAgentId: typeof body.subAgentId === "string" ? body.subAgentId : undefined
    });
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/studio/growth-proposal", async (c) => {
    const body = await readJsonObject(c);
    const result = reviewGrowthProposal(
      runtime,
      String(body.proposalId ?? ""),
      body.decision === "rejected" ? "rejected" : "approved"
    );
    return c.json(result);
  });

  app.post("/api/studio/sleep-run", (c) => c.json(runManualSleepReflection(runtime)));

  app.post("/api/studio/rag-ingest", async (c) => {
    if(!isOwnerRequest(c)) return c.json({error:"UNAUTHORIZED"},401);
    const body = await readJsonObject(c);
    const result = await ingestKnowledgeDocument(runtime, {
      collectionId: String(body.collectionId ?? "kb_custom_notes"),
      title: String(body.title ?? "notes.md"),
      content: String(body.content ?? "")
    }, body.mode==="sandbox" || c.req.query("mode")==="sandbox");
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/api/studio/rag-search", async (c) => {
    if(!isOwnerRequest(c)) return c.json({error:"UNAUTHORIZED"},401);
    const body = await readJsonObject(c);
    return c.json(
      await searchKnowledgeChunks(runtime, {
        query: String(body.query ?? ""),
        collectionId:
          typeof body.collectionId === "string" && body.collectionId
            ? body.collectionId
            : undefined
      }, body.mode==="sandbox" || c.req.query("mode")==="sandbox")
    );
  });

  app.post("/api/studio/publish-pack", async (c) => {
    const body = await readJsonObject(c);
    const result = createPrivacyScrubbedReleasePackage(runtime, {
      packageType: body.packageType === "ai0pack" ? "ai0pack" : "soul-template",
      includePromptBricks: body.includePromptBricks !== false,
      includeLorebooks: body.includeLorebooks !== false,
      includeSkillsAndFlows: body.includeSkillsAndFlows !== false
    });
    return c.json(result);
  });

  app.get("/api/studio/instances", (c) =>
    c.json({ ok: true, instances: listAvailableSoulInstances(runtime.soulDir) })
  );

  app.post("/api/studio/instances", async (c) => {
    const body = await readJsonObject(c);
    const result = createNewSoulInstance(runtime, {
      slug: String(body.slug ?? ""),
      displayName: String(body.displayName ?? "New Soul"),
      primaryRole: (body.primaryRole as RelationshipArchetype) ?? "best_friend",
      avatarEmoji: typeof body.avatarEmoji === "string" ? body.avatarEmoji : undefined
    });
    return c.json(result);
  });

  app.post("/api/studio/onboarding", async (c) => {
    const body = await readJsonObject(c);
    const current = readConsoleStudioConfig(runtime.soulDir);
    const nextRole = (body.primaryRole as RelationshipArchetype) ?? current.soulStudio.primaryRole;
    const nextName =
      String(body.displayName ?? current.soulStudio.displayName).trim() ||
      current.soulStudio.displayName;
    const nextProviders = [...current.providers];

    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      const targetId = String(body.providerId ?? "prov_deepseek_v3");
      const rawKey = body.apiKey.trim();
      const idx = nextProviders.findIndex((p) => p.id === targetId);
      if (idx >= 0) {
        saveVaultProviderKey(runtime.soulDir, targetId, rawKey);
        nextProviders[idx] = {
          ...nextProviders[idx]!,
          apiKeyMasked:
            rawKey.length > 8 ? `${rawKey.slice(0, 4)}••••••${rawKey.slice(-4)}` : "••••••",
          baseUrl:
            typeof body.baseUrl === "string" && body.baseUrl.trim()
              ? body.baseUrl.trim()
              : nextProviders[idx]!.baseUrl,
          modelId:
            typeof body.modelId === "string" && body.modelId.trim()
              ? body.modelId.trim()
              : nextProviders[idx]!.modelId,
          status: "ready"
        };
      }
      // Also update canonical HostInfrastructureStore & default Profile primaryChat binding
      const infra = readHostInfrastructureConfig(runtime.hostDir);
      const existingHostProv = infra.providers.find((p) => p.id === targetId);
      if (existingHostProv) {
        const chosenModel =
          typeof body.modelId === "string" && body.modelId.trim()
            ? body.modelId.trim()
            : existingHostProv.models[0]!;
        const nextModels = existingHostProv.models.includes(chosenModel)
          ? existingHostProv.models
          : [chosenModel, ...existingHostProv.models];
        upsertProviderInstance(
          runtime.hostDir,
          {
            ...existingHostProv,
            baseUrl:
              typeof body.baseUrl === "string" && body.baseUrl.trim()
                ? body.baseUrl.trim()
                : existingHostProv.baseUrl,
            models: nextModels,
            health: { ...existingHostProv.health, status: "ready" }
          },
          rawKey
        );
        const soulProfiles = readSoulProfileConfig(runtime.soulDir);
        const nextProfList = soulProfiles.profiles.map((prof) =>
          prof.id === soulProfiles.defaultProfileId
            ? { ...prof, roleArchetype: nextRole, primaryChat: { providerId: targetId, modelId: chosenModel } }
            : prof
        );
        writeSoulProfileConfig(runtime.soulDir, { ...soulProfiles, profiles: nextProfList });
      }
    }

    const saved = updateStudioConfig(runtime, {
      onboardingCompleted: true,
      providers: nextProviders,
      soulStudio: {
        displayName: nextName,
        primaryRole: nextRole,
        ...(typeof body.corePersonalityPrompt === "string" && body.corePersonalityPrompt.trim()
          ? { corePersonalityPrompt: body.corePersonalityPrompt.trim() }
          : {})
      }
    });
    return c.json({ ok: true, config: saved });
  });



  // ---------------------------------------------------------------------------
  // Dynamic Plugin Discovery, Manifest & Self-Contained Asset Hosting (/api/plugins/*)
  // ---------------------------------------------------------------------------
  const isOwnerRequest = (c: Context): boolean => {
    const expected = Buffer.from(runtime.ownerMasterToken);
    const provided = Buffer.from(c.req.header("x-ai0-owner-token") ?? "");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  };

  const enabledOverrideMap = (): Map<string, boolean> => {
    const studio = readConsoleStudioConfig(runtime.soulDir);
    return new Map(studio.ecosystem.plugins.map((entry) => [entry.id, entry.enabled]));
  };

  app.use("/api/plugins/*", async (_c, next) => { await runtime.refreshCapabilities(); await next(); });
  app.post("/api/studio/shell-grants", async c => {
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readJsonObject(c);
    const { shellId, externalUserId, principalId } = body;
    const audience = AudienceScopeSchema.safeParse(body.audience);
    if (typeof shellId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,95}$/i.test(shellId) ||
        typeof externalUserId !== "string" || !externalUserId.trim() ||
        typeof principalId !== "string" || !principalId.trim() || !audience.success ||
        (audience.data === "only_owner" && principalId !== "owner:local")) {
      return c.json({ error: "INVALID_BINDING" }, 400);
    }
    const target = body.mode === "sandbox" ? "sandbox" : "live";
    const db = (target === "live" ? runtime.storage : runtime.sandboxStorage).sqlite;
    db.prepare("INSERT OR IGNORE INTO shell_principal_bindings VALUES (?,?,?)").run(shellId, externalUserId, principalId);
    const bound = db.prepare("SELECT principal_id FROM shell_principal_bindings WHERE shell_id=? AND external_id=?").get(shellId, externalUserId);
    if (bound?.principal_id !== principalId) return c.json({ error: "BINDING_CONFLICT" }, 409);
    const token = runtime.shellGateway.issueScopedCapabilityToken({
      shell_id: shellId, principal_id: principalId, soul_id: readSoulArchiveConfig(runtime.soulDir).manifest.soul_id,
      target, max_audience_privacy_ceiling: audience.data, allowed_modalities: ["text"],
      expires_at_ts_ms: Date.now() + 3600000
    }, runtime.ownerMasterToken);
    return c.json({ token, shellId, principalId, target });
  });
  app.get("/api/studio/conversations/history", c => {
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const before = Number(c.req.query("before") ?? Number.MAX_SAFE_INTEGER);
    const conversation = c.req.query("conversation");
    if (!conversation || !Number.isSafeInteger(before)) return c.json({ error: "INVALID_CURSOR" }, 400);
    const storage = c.req.query("mode") === "sandbox" ? runtime.sandboxStorage : runtime.storage;
    return c.json({ messages: readConversation(storage, conversation, before) });
  });
  app.get("/api/plugins", (c) =>
    c.json({ ok: true, plugins: runtime.pluginLoader.listDescriptors(enabledOverrideMap()) })
  );

  app.get("/api/plugins/:extensionId/manifest", (c) => {
    const extensionId = decodeURIComponent(c.req.param("extensionId"));
    const descriptor = runtime.pluginLoader.getDescriptor(extensionId, enabledOverrideMap());
    if (!descriptor) return c.json({ error: "PLUGIN_NOT_FOUND" }, 404);
    return c.json({ ok: true, plugin: descriptor });
  });

  app.on("POST", ["/api/plugins/:extensionId/shell-token", "/api/plugins/:extensionId/stage-token"], (c) => {
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const extensionId = decodeURIComponent(c.req.param("extensionId"));
    const descriptor = runtime.pluginLoader.getDescriptor(extensionId, enabledOverrideMap());
    if (!descriptor || !descriptor.enabled) return c.json({ error: "PLUGIN_NOT_AVAILABLE" }, 404);
    const pagePath = c.req.query("page");
    const pages = descriptor.pages?.filter(page => page.shell_id && (!pagePath || page.path === pagePath)) ?? [];
    if (pages.length !== 1) return c.json({ error: "UI_ENTRY_UNAVAILABLE" }, 409);
    const shellId = pages[0]!.shell_id!;
    const target = parseMode(c.req.query("mode"));
    const host = target === "live" ? runtime.extensionHost : runtime.sandboxExtensionHost;
    if (!host.listExtensions().some(item => item.id === extensionId)) return c.json({ error: "PLUGIN_INACTIVE" }, 409);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const token = runtime.shellGateway.issueScopedCapabilityToken(
      {
        shell_id: shellId,
        principal_id: "owner:local",
        soul_id: readSoulArchiveConfig(runtime.soulDir).manifest.soul_id,
        plugin_id: extensionId,
        generation: runtime.generation(extensionId, target),
        target,
        max_audience_privacy_ceiling: runtime.pluginLoader.getPlugin(extensionId)!.manifest.permissions.max_audience_scope,
        allowed_modalities: ["text", "typing_activity", "vad_activity", "window_focus"],
        expires_at_ts_ms: expiresAt
      },
      runtime.ownerMasterToken
    );
    return c.json({ ok: true, extensionId, shellId, token, expiresAt });
  });

  app.get("/api/plugins/:extensionId/assets/*", (c) => {
    const match = /^\/api\/plugins\/([^/]+)\/assets\/(.+)$/u.exec(c.req.path);
    if (!match) return c.json({ error: "INVALID_PLUGIN_ASSET_PATH" }, 400);
    const extensionId = decodeURIComponent(match[1]!);
    const assetPath = match[2]!
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    const asset = runtime.pluginLoader.readPluginAsset(extensionId, assetPath);
    if (!asset) return c.json({ error: "PLUGIN_ASSET_NOT_FOUND" }, 404);
    return new Response(new Uint8Array(asset.content), {
      status: 200,
      headers: {
        "content-type": asset.contentType,
        "cache-control": "no-store"
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Channel B: Privileged Admin API & Four-Track Telemetry SSE (/api/admin/v1/*)
  // ---------------------------------------------------------------------------
  app.get("/api/admin/v1/snapshot", async (c) => {
    const mode = parseMode(c.req.query("mode"));
    const snapshot = await runtime.buildConsoleLiveSnapshot(mode);
    return c.json(snapshot);
  });

  app.get("/api/admin/v1/telemetry/stream", (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: JSON.stringify({ track: "[SYS]", payload: { connected: true } })
      });
      const unsubscribe = runtime.adminServer.subscribeTelemetry((frame) => {
        void stream.writeSSE({ data: JSON.stringify(frame) });
      });
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    })
  );

  app.all("/api/admin/v1/*", async (c) => {
    const method = c.req.method.toUpperCase();
    const headers: Record<string, string | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const url = new URL(c.req.url);
    const body =
      method === "GET" || method === "HEAD" ? undefined : await readJsonObject(c);
    const result = await runtime.adminServer.handleRequest({
      method,
      path: url.pathname,
      headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body
    });
    return c.json(result.body, result.status as ContentfulStatusCode);
  });

  // ---------------------------------------------------------------------------
  // Channel A: Protocol v0 Bidirectional Shell Bridge (/protocol/v0/shell/*)
  // ---------------------------------------------------------------------------
  registerShellActions(app, runtime, isOwnerRequest);
  app.post("/protocol/v0/shell/connections", async c => {
    const raw = await readJsonObject(c);
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /i, "");
    const parsed = HandshakeManifestSchema.safeParse({ ...raw, auth_token: token });
    if (!parsed.success) return c.json({ error: "INVALID_HANDSHAKE" }, 400);
    try {
      const claims = runtime.shellGateway.verifyScopedCapabilityToken(token, runtime.ownerMasterToken);
      if (claims.soul_id && claims.soul_id !== readSoulArchiveConfig(runtime.soulDir).manifest.soul_id) return c.json({ error: "SOUL_MISMATCH" }, 403);
      if (claims.plugin_id && claims.generation !== runtime.generation(claims.plugin_id, claims.target)) return c.json({ error: "PLUGIN_REMOVED" }, 403);
      return c.json(runtime.shellGateway.handleHandshake(parsed.data, runtime.ownerMasterToken));
    } catch { return c.json({ error: "HANDSHAKE_REJECTED" }, 403); }
  });
  app.on(["PATCH", "DELETE"], "/protocol/v0/shell/connections/:id", async c => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /i, "");
    const closing = c.req.method === "DELETE";
    const body = closing ? {} : await readJsonObject(c);
    const capabilities = HandshakeManifestSchema.shape.capabilities.safeParse(body.capabilities);
    if (body.capabilities && !capabilities.success) return c.json({ error: "INVALID_CAPABILITIES" }, 400);
    const ok = runtime.shellGateway.updateConnection(c.req.param("id"), token, closing, capabilities.data);
    return c.json({ ok }, ok ? 200 : 404);
  });

  registerShellProtocolRunRoutes(app, runtime);

  app.post("/protocol/v0/shell/perception", async (c) => {
    const body = await readJsonObject(c);
    const text = String(body.text ?? body.summary_text ?? "").trim();
    if (!text) return c.json({ error: "EMPTY_PERCEPTION_TEXT" }, 400);
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    try {
      const turn = await runtime.handleShellTurn({
        principalId: "owner:local",
        thread: typeof body.thread === "string" ? body.thread : undefined,
        shell_id: typeof body.shell_id === "string" ? body.shell_id : undefined,
        text,
        venue_type: (body.venue_type as VenueType | undefined) ?? "private_1on1",
        audience_scope: body.audience_scope as AudienceScope | undefined,
        modality: (body.modality as SensorModality | undefined) ?? "text",
        mode: body.mode === "sandbox" ? "sandbox" : "live"
      }, { deferDeliveryReceipt: true });
      return c.json(turn);
    } catch (error) {
      if (error instanceof ModelContextLimitError) return c.json({ error: error.code, message: error.message }, 422);
      throw error;
    }
  });

  app.post("/protocol/v0/shell/receipt", async (c) => {
    const body = await readJsonObject(c);
    if (!isOwnerRequest(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const receipt = runtime.handleShellInterrupt({
      shell_id: typeof body.shell_id === "string" ? body.shell_id : undefined,
      intent_id: String(body.intent_id ?? "int_shell"),
      spoken_char_offset: Number(body.spoken_char_offset ?? 0),
      full_text: String(body.full_text ?? ""),
      mode: body.mode === "sandbox" ? "sandbox" : "live"
    });
    return c.json(receipt);
  });

  // ---------------------------------------------------------------------------
  // Production Console SPA Static Hosting + History Fallback
  // ---------------------------------------------------------------------------
  const consoleDistDir =
    options.consoleDistDir ?? process.env.AI0_CONSOLE_DIST_DIR ?? DEFAULT_CONSOLE_DIST_DIR;
  const indexHtmlPath = join(consoleDistDir, "index.html");

  if (existsSync(consoleDistDir)) {
    app.use(
      "/assets/*",
      serveStatic({
        root: consoleDistDir
      })
    );
    app.use(
      "/*",
      serveStatic({
        root: consoleDistDir
      })
    );
  }

  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/protocol/")) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    if (existsSync(indexHtmlPath)) {
      c.header("cache-control", "no-store");
      return c.html(readFileSync(indexHtmlPath, "utf8"));
    }
    c.header("cache-control", "no-store");
    return c.html(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>ai0 Daemon</title></head><body><h1>ai0 Daemon API Running</h1><p>Console static bundle not built yet. Run <code>pnpm dev</code> (Vite HMR on port 4173) or <code>pnpm build</code>.</p></body></html>`
    );
  });

  app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));

  return app;
}

export function createUnifiedDaemonHttpServer(
  runtime: Ai0DaemonRuntime,
  options: DaemonHttpServerOptions = {}
): Server {
  const app = createUnifiedDaemonHttpApp(runtime, options);
  return createAdaptorServer({ fetch: app.fetch }) as Server;
}

async function runCli(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  if (args.has("--run-golden-scenario")) {
    const report = await runScenarioPlaybook(GOLDEN_REGRESSION_SCENARIO_V1);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  const host = process.env.AI0_HOST ?? "127.0.0.1";
  const port = parsePortArg(rawArgs) ?? Number(process.env.AI0_PORT ?? 4173);
  const soulDir = process.env.AI0_SOUL_DIR ?? "souls/default.soul";
  const ownerMasterToken = process.env.AI0_OWNER_TOKEN ?? "ai0-local-owner-dev-token";
  const llmApiKey = process.env.AI0_LLM_API_KEY?.trim() || undefined;
  const runtime = createDefaultDaemonRuntime({
    soulDir,
    ownerMasterToken,
    seedIfEmpty: process.argv.includes("--demo"),
    llmConfig: llmApiKey
      ? {
          provider:
            (process.env.AI0_LLM_PROVIDER as "openai-compatible" | "anthropic" | "ollama") ??
            "openai-compatible",
          baseUrl: process.env.AI0_LLM_BASE_URL,
          apiKey: llmApiKey,
          model: process.env.AI0_LLM_MODEL
        }
      : undefined
  });

  const server = createUnifiedDaemonHttpServer(runtime);
  server.listen(port, host, () => {
    console.log(
      [
        "============================================================",
        " ai0 — Universal Cyber-Life Cognitive Kernel (Hono Daemon)",
        ` API & Dual-Plane Gateway:     http://${host}:${port}`,
        ` Active Soul Archive:          ${runtime.soulDir}`,
        ` Channel A Protocol Bridge:    POST /protocol/v0/shell/*`,
        ` Channel B Admin API (18+):    /api/admin/v1/*`,
        "============================================================"
      ].join("\n")
    );
  });

  const shutdown = (): void => {
    server.close();
    runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
