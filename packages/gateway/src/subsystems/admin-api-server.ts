import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { VirtualClock, type IVirtualClock } from "@ai0/cognition-core";

export const ADMIN_API_PREFIX = "/api/admin/v1";

const ROUTES = [
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge\/collections$/, operation: "knowledge.library" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge\/collections\/(?<collection>[^/]+)$/, operation: "knowledge.library" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge\/collections\/(?<collection>[^/]+)\/(?<action>import|mount|search|audience)$/, operation: "knowledge.library" },
  { methods: ["GET", "DELETE"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge\/collections\/(?<collection>[^/]+)\/documents\/(?<document>[^/]+)$/, operation: "knowledge.library" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge\/collections\/(?<collection>[^/]+)\/documents\/(?<document>[^/]+)\/(?<action>rebuild)$/, operation: "knowledge.library" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/blackboard\/compile-preview$/, operation: "blackboard.compilePreview" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/channels\/topology$/, operation: "channels.topology" },
  { methods: ["GET", "PATCH", "POST"], pattern: /^\/api\/admin\/v1\/channels\/thalamic-gate$/, operation: "channels.thalamicGate" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/soul\/distill$/, operation: "soul.distill" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/soul\/lorebooks\/simulate$/, operation: "soul.lorebooks.simulate" },
  { methods: ["GET", "PATCH"], pattern: /^\/api\/admin\/v1\/soul\/homeostasis$/, operation: "soul.homeostasis" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/memory\/lineage$/, operation: "memory.lineage" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/memory\/hard-forget$/, operation: "memory.hardForget" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/memory\/topic-seal$/, operation: "memory.topicSeal" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/memory\/knowledge\/unmount-gist$/, operation: "memory.knowledge.unmountGist" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/memory\/relationship\/release-knot$/, operation: "memory.relationship.releaseKnot" },
  { methods: ["GET", "PATCH"], pattern: /^\/api\/admin\/v1\/models\/routing$/, operation: "models.routing" },
  { methods: ["GET", "POST", "PATCH"], pattern: /^\/api\/admin\/v1\/extensions$/, operation: "extensions.manage" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/extensions\/market$/, operation: "extensions.market" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/install$/, operation: "extensions.install" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/reload-all$/, operation: "extensions.reloadAll" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/bundle-export$/, operation: "extensions.bundleExport" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/extensions\/mcp$/, operation: "extensions.mcp" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/mcp\/import-json$/, operation: "extensions.mcpImportJson" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/extensions\/mcp\/(?<serverId>[^/]+)$/, operation: "extensions.mcpItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/mcp\/(?<serverId>[^/]+)\/probe$/, operation: "extensions.mcpProbe" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/extensions\/skills$/, operation: "extensions.skills" },
  { methods: ["PUT", "PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/extensions\/skills\/(?<skillId>[^/]+)$/, operation: "extensions.skillItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/(?<extensionId>[^/]+)\/hot-reload$/, operation: "extensions.hotReload" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/extensions\/(?<extensionId>[^/]+)\/reload$/, operation: "extensions.reloadOne" },
  { methods: ["GET", "PUT"], pattern: /^\/api\/admin\/v1\/extensions\/(?<extensionId>[^/]+)\/config$/, operation: "extensions.config" },
  { methods: ["DELETE"], pattern: /^\/api\/admin\/v1\/extensions\/(?<extensionId>[^/]+)$/, operation: "extensions.uninstall" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/runtime\/traces$/, operation: "runtime.traces" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/runtime\/agent$/, operation: "runtime.agent" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/runtime\/model-requests\/(?<stepId>[^/]+)$/, operation: "runtime.modelRequest" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/clock\/advance$/, operation: "clock.advance" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/sandbox\/fork$/, operation: "sandbox.fork" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/sandbox\/inject$/, operation: "sandbox.inject" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/sandbox\/scenarios\/run$/, operation: "sandbox.scenarios.run" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/system\/snapshots\/rollback$/, operation: "system.snapshots.rollback" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/system\/safety-sb243$/, operation: "system.safetySb243" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/integrations\/sources$/, operation: "integrations.sources" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/integrations\/sources\/(?<sourceId>[^/]+)$/, operation: "integrations.sourceItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/integrations\/sources\/(?<sourceId>[^/]+)\/keys$/, operation: "integrations.sourceKeys" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/integrations\/sources\/(?<sourceId>[^/]+)\/keys\/(?<keyId>[^/]+)$/, operation: "integrations.sourceKeyItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/integrations\/sources\/(?<sourceId>[^/]+)\/fetch-models$/, operation: "integrations.sourceFetchModels" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/integrations\/sources\/(?<sourceId>[^/]+)\/import-models$/, operation: "integrations.sourceImportModels" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/integrations\/models$/, operation: "integrations.models" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/integrations\/models\/(?<instanceId>[^/]+)$/, operation: "integrations.modelItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/integrations\/models\/(?<instanceId>[^/]+)\/test$/, operation: "integrations.modelTest" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/integrations\/providers$/, operation: "integrations.providers" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/integrations\/providers\/(?<providerId>[^/]+)$/, operation: "integrations.providerItem" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/integrations\/providers\/(?<providerId>[^/]+)\/ping$/, operation: "integrations.providerPing" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/integrations\/platforms$/, operation: "integrations.platforms" },
  { methods: ["PATCH", "DELETE"], pattern: /^\/api\/admin\/v1\/integrations\/platforms\/(?<platformId>[^/]+)$/, operation: "integrations.platformItem" },
  { methods: ["GET", "PUT", "PATCH"], pattern: /^\/api\/admin\/v1\/config\/profiles$/, operation: "config.profiles" },
  { methods: ["GET", "PUT", "PATCH"], pattern: /^\/api\/admin\/v1\/config\/routing-rules$/, operation: "config.routingRules" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/config\/routing-rules\/test$/, operation: "config.routingRulesTest" },
  { methods: ["GET", "PATCH"], pattern: /^\/api\/admin\/v1\/capabilities\/knowledge$/, operation: "capabilities.knowledge" },
  { methods: ["GET", "PATCH"], pattern: /^\/api\/admin\/v1\/capabilities\/multimodal$/, operation: "capabilities.multimodal" },
  { methods: ["GET", "PATCH"], pattern: /^\/api\/admin\/v1\/system\/settings$/, operation: "system.settings" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/readiness$/, operation: "system.readiness" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/host\/claim$/, operation: "host.claim" },
  { methods: ["GET", "POST"], pattern: /^\/api\/admin\/v1\/cards$/, operation: "cards.collection" },
  { methods: ["GET", "DELETE"], pattern: /^\/api\/admin\/v1\/cards\/(?<cardId>[^/]+)$/, operation: "cards.item" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/souls$/, operation: "souls.collection" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/souls\/awaken$/, operation: "souls.awaken" },
  { methods: ["POST"], pattern: /^\/api\/admin\/v1\/souls\/select$/, operation: "souls.select" },
  { methods: ["GET"], pattern: /^\/api\/admin\/v1\/souls\/(?<soulId>[^/]+)\/export-card$/, operation: "souls.exportCard" }
] as const;

export type AdminOperation = (typeof ROUTES)[number]["operation"];
export type AdminTelemetryTrack = "[EVENT]" | "[TRACE]" | "[AGENCY]" | "[SYS]";

export interface AdminRequest {
  signal?: AbortSignal;
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}
export interface AdminResponse { status: number; body: unknown }
export interface AdminRouteContext {
  operation: AdminOperation;
  target_instance: "live" | `sandbox:${string}`;
  params: Readonly<Record<string, string>>;
}
export type AdminRouteHandler = (
  request: Readonly<AdminRequest>, context: Readonly<AdminRouteContext>
) => unknown | AdminResponse | Promise<unknown | AdminResponse>;

export interface AdminTelemetryFrame {
  sequence: number;
  track: AdminTelemetryTrack;
  target_instance: "live" | `sandbox:${string}`;
  timestamp_ms: number;
  payload: unknown;
}
export interface PrivilegedAdminServerOptions {
  ownerToken: string;
  clock?: IVirtualClock;
  handlers?: Partial<Record<AdminOperation, AdminRouteHandler>>;
  fallbackHandler?: AdminRouteHandler;
  maxBodyBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAdminResponse(value: unknown): value is AdminResponse {
  return isRecord(value) && typeof value.status === "number" && "body" in value;
}

function isCoreOrganAblation(body: unknown, path: string): boolean {
  if (!isRecord(body)) return false;
  if (body.core_organ_ablation === true || body.operation === "ablate_core_organ") return true;
  if (Array.isArray(body.disabled_organs) && body.disabled_organs.length > 0) return true;
  if (isRecord(body.ablation_overrides) && Object.keys(body.ablation_overrides).length > 0) return true;
  return /\/extensions\/[^/]*organ[^/]*\/hot-reload$/i.test(path) && body.enabled === false;
}

export class PrivilegedAdminServer {
  private readonly ownerToken: string;
  private readonly clock: IVirtualClock;
  private readonly handlers: Partial<Record<AdminOperation, AdminRouteHandler>>;
  private readonly fallbackHandler?: AdminRouteHandler;
  private readonly maxBodyBytes: number;
  private readonly telemetrySubscribers = new Set<(frame: AdminTelemetryFrame) => void>();
  private telemetrySequence = 0;

  constructor(
    options: PrivilegedAdminServerOptions | string,
    handlers: Partial<Record<AdminOperation, AdminRouteHandler>> = {}
  ) {
    if (typeof options === "string") {
      this.ownerToken = options;
      this.clock = new VirtualClock({ targetInstance: "live" });
      this.handlers = { ...handlers };
      this.maxBodyBytes = 1_048_576;
    } else {
      this.ownerToken = options.ownerToken;
      this.clock = options.clock ?? new VirtualClock({ targetInstance: "live" });
      this.handlers = { ...options.handlers };
      this.fallbackHandler = options.fallbackHandler;
      this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
    }
    if (!this.ownerToken) throw new TypeError("ownerToken must not be empty.");
  }

  async handleRequest(request: AdminRequest): Promise<AdminResponse> {
    if (!this.isAuthorized(request.headers)) return { status: 401, body: { error: "UNAUTHORIZED" } };
    const method = request.method.toUpperCase();
    const path = (request.path.split("?", 1)[0] ?? request.path).replace(/\/+$/, "");
    const target = this.targetInstance(request);
    if (!target) return { status: 400, body: { error: "INVALID_TARGET_INSTANCE" } };
    if (
      target === "live" &&
      ((method === "POST" &&
        (path === `${ADMIN_API_PREFIX}/clock/advance` || path === `${ADMIN_API_PREFIX}/sandbox/inject`)) ||
        isCoreOrganAblation(request.body, path))
    ) {
      return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
    }

    const pathRoutes = ROUTES.map((route) => ({ route, match: route.pattern.exec(path) })).filter(
      (item) => item.match !== null
    );
    if (pathRoutes.length === 0) return { status: 404, body: { error: "NOT_FOUND" } };
    const selected = pathRoutes.find(({ route }) => (route.methods as readonly string[]).includes(method));
    if (!selected) {
      return {
        status: 405,
        body: { error: "METHOD_NOT_ALLOWED", allowed_methods: [...pathRoutes[0]!.route.methods] }
      };
    }

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(selected.match?.groups ?? {})) {
      if (value !== undefined) params[key] = decodeURIComponent(value);
    }
    const context: AdminRouteContext = {
      operation: selected.route.operation,
      target_instance: target,
      params
    };
    const handler = this.handlers[selected.route.operation] ?? this.fallbackHandler;
    if (!handler) {
      return {
        status: 501,
        body: { error: "ADMIN_BACKEND_NOT_CONFIGURED", operation: selected.route.operation }
      };
    }
    try {
      const result = await handler(Object.freeze({ ...request, method, path }), Object.freeze(context));
      const response = isAdminResponse(result) ? result : { status: 200, body: result };
      this.broadcastTelemetry("[SYS]", { operation: selected.route.operation, status: response.status }, target);
      return response;
    } catch (error) {
      this.broadcastTelemetry("[SYS]", { operation: selected.route.operation, error: true }, target);
      return {
        status: 500,
        body: { error: "ADMIN_HANDLER_FAILURE", message: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  subscribeTelemetry(listener: (frame: AdminTelemetryFrame) => void): () => void {
    this.telemetrySubscribers.add(listener);
    return () => {
      this.telemetrySubscribers.delete(listener);
    };
  }

  broadcastTelemetry(
    track: AdminTelemetryTrack,
    payload: unknown,
    targetInstance: "live" | `sandbox:${string}` = "live",
    timestampMs = this.clock.nowMs()
  ): AdminTelemetryFrame {
    const frame: AdminTelemetryFrame = Object.freeze({
      sequence: ++this.telemetrySequence,
      track,
      target_instance: targetInstance,
      timestamp_ms: timestampMs,
      payload
    });
    for (const subscriber of this.telemetrySubscribers) {
      try {
        subscriber(frame);
      } catch {
        /* isolate observability clients */
      }
    }
    return frame;
  }

  createHttpServer(): Server {
    return createServer((request, response) => {
      void this.serveNodeRequest(request, response);
    });
  }

  private isAuthorized(headers: AdminRequest["headers"] = {}): boolean {
    const normalized: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
    const authorization = normalized.authorization;
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const supplied = bearer ?? normalized["x-ai0-owner-token"];
    return supplied !== undefined && secureEqual(supplied, this.ownerToken);
  }

  private targetInstance(request: AdminRequest): "live" | `sandbox:${string}` | undefined {
    const bodyTarget =
      isRecord(request.body) && typeof request.body.target_instance === "string"
        ? request.body.target_instance
        : undefined;
    const target = request.query?.target_instance ?? bodyTarget ?? "live";
    return target === "live" || /^sandbox:.+$/.test(target) ? (target as "live" | `sandbox:${string}`) : undefined;
  }

  private async serveNodeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headers[key] = Array.isArray(value) ? value.join(",") : value;
      }
      const body = await this.readBody(request);
      const disconnected = new AbortController();
      response.once("close", () => disconnected.abort());
      if (response.destroyed) disconnected.abort();
      const result = await this.handleRequest({
        method: request.method ?? "GET",
        path: url.pathname,
        signal: disconnected.signal,
        headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body
      });
      response.statusCode = result.status;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(result.body ?? null));
    } catch (error) {
      response.statusCode = error instanceof SyntaxError ? 400 : 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: response.statusCode === 400 ? "INVALID_JSON_BODY" : "INTERNAL_SERVER_ERROR" }));
    }
  }

  private async readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > this.maxBodyBytes) throw new RangeError("REQUEST_BODY_TOO_LARGE");
      chunks.push(buffer);
    }
    if (chunks.length === 0) return undefined;
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text === "" ? undefined : JSON.parse(text);
  }
}
