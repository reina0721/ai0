import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { GOLDEN_REGRESSION_SCENARIO_V1, runScenarioPlaybook } from "@ai0/kernel";
import type { AudienceScope, SensorModality, VenueType } from "@ai0/protocol";
import {
  compileStudioPromptPreview,
  readConsoleStudioConfig,
  type RelationshipArchetype
} from "@ai0/storage";

import { createDefaultDaemonRuntime, type Ai0DaemonRuntime } from "./index.js";
import { registerWebChatRunRoutes } from "./webchat-runs.js";
import {
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
    const saved = updateStudioConfig(runtime, patch);
    const snapshot = await runtime.buildConsoleLiveSnapshot("live");
    return c.json({ ok: true, config: saved, snapshot });
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
    const result = dispatchOrAdvanceCoWorkTask(runtime, {
      action: (body.action as "create" | "approve" | "complete" | "pause") ?? "create",
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
    const body = await readJsonObject(c);
    const result = ingestKnowledgeDocument(runtime, {
      collectionId: String(body.collectionId ?? "kb_custom_notes"),
      title: String(body.title ?? "notes.md"),
      content: String(body.content ?? "")
    });
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/api/studio/rag-search", async (c) => {
    const body = await readJsonObject(c);
    return c.json(
      searchKnowledgeChunks(runtime, {
        query: String(body.query ?? ""),
        collectionId:
          typeof body.collectionId === "string" && body.collectionId
            ? body.collectionId
            : undefined
      })
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

  app.post("/api/studio/webchat/clear", async (c) => {
    const body = await readJsonObject(c);
    const mode = body.mode === "sandbox" ? "sandbox" : "live";
    return c.json(runtime.clearWebChatTranscript(mode));
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
      const idx = nextProviders.findIndex((p) => p.id === targetId);
      if (idx >= 0) {
        const rawKey = body.apiKey.trim();
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

  registerWebChatRunRoutes(app, runtime);
  app.all("/api/studio/*", (c) => c.json({ error: "UNKNOWN_STUDIO_ENDPOINT" }, 404));

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
  app.post("/protocol/v0/shell/perception", async (c) => {
    const body = await readJsonObject(c);
    const text = String(body.text ?? body.summary_text ?? "").trim();
    if (!text) return c.json({ error: "EMPTY_PERCEPTION_TEXT" }, 400);
    const turn = await runtime.handleWebChatTurn({
      text,
      venue_type: (body.venue_type as VenueType | undefined) ?? "private_1on1",
      audience_scope: body.audience_scope as AudienceScope | undefined,
      modality: (body.modality as SensorModality | undefined) ?? "text",
      mode: body.mode === "sandbox" ? "sandbox" : "live"
    });
    return c.json(turn);
  });

  app.post("/protocol/v0/shell/receipt", async (c) => {
    const body = await readJsonObject(c);
    const receipt = runtime.handleWebChatInterrupt({
      intent_id: String(body.intent_id ?? "int_webchat"),
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
    seedIfEmpty: true,
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
