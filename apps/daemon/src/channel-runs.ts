import { ModelContextLimitError, ProviderNotConfiguredError, UpstreamInferenceError } from "@ai0/agent-core";
import { readSoulArchiveConfig } from "@ai0/storage";
import { timingSafeEqual } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import { CHANNEL_PROTOCOL_PATH } from "@ai0/gateway";
import type { Context, Hono } from "hono";

import type { AudienceScope, ChannelRunPresentation, ChannelRunProcess, ChannelRunStage, VerifiableTurnTrace } from "@ai0/protocol";

import { SoulNotAwakenedError, type Ai0DaemonRuntime } from "./index.js";

type Mode = "live" | "sandbox";
type Target = "live" | "sandbox:console";
type Stage = ChannelRunStage;
type Status = "accepted" | "generating" | "delivering" | "completed" | "interrupted" | "cancelled" | "failed";
type Receipt = { status: "completed" | "interrupted"; spokenCharOffset: number };

interface RunStatus extends ChannelRunPresentation {
  requestId: string;
  eventId: string;
  channelId: string;
  targetInstance: Target;
  traceId?: string;
  status: Status;
  stage?: Stage;
  text?: string;
  deliveryFinished?: boolean;
  receipt?: Receipt;
  provider?: { name: string; model: string };
}

interface ActiveRun {
  storage: Ai0DaemonRuntime["storage"];
  principalId?: string;
  audience?: AudienceScope;
  thread?: string;
  controller: AbortController;
  state: RunStatus;
  trace?: VerifiableTurnTrace;
  sentChars: number;
  startedAt: number;
}

interface AuthResult {
  readonly authorized: boolean;
  readonly isOwner: boolean;
  readonly scopedChannelId?: string;
  readonly principalId?: string;
  readonly target?: Mode;
  readonly audience?: AudienceScope;
  readonly pluginId?: string;
}

const EVENT_PREFIX = "evt_channel_";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,95}$/iu;
const MAX_TEXT_LENGTH = 12_000;

function requestIdOf(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function parseChannelId(value: unknown): string | undefined {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value) ? value : undefined;
}

function extractRequestIdFromEventId(eventId: string): string | undefined {
  if (eventId.startsWith(EVENT_PREFIX)) return requestIdOf(eventId.slice(EVENT_PREFIX.length));
  return undefined;
}

function targetOf(mode: Mode): Target {
  return mode === "sandbox" ? "sandbox:console" : "live";
}

function parseMode(value: unknown, fallback?: Mode): Mode | undefined {
  if (value === "live" || value === "sandbox") return value;
  return value === undefined ? fallback : undefined;
}

function validOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function receiptOf(trace: VerifiableTurnTrace): Receipt | undefined {
  const receipt = trace.steps.step8_delivery_receipt;
  if (receipt?.status !== "interrupted" && receipt?.status !== "completed") return undefined;
  return { status: receipt.status, spokenCharOffset: receipt.spoken_char_offset };
}

function displayedText(trace: VerifiableTurnTrace): string {
  const text = trace.steps.step7_emitted_intent.fallback_text;
  const receipt = receiptOf(trace);
  return receipt?.status === "interrupted" ? Array.from(text).slice(0, receipt.spokenCharOffset).join("") : text;
}

function secureEquals(left: string, right: string): boolean {
  const expected = Buffer.from(left);
  const provided = Buffer.from(right);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function authenticate(c: Context, runtime: Ai0DaemonRuntime): AuthResult {
  const ownerHeader = c.req.header("x-ai0-owner-token") ?? "";
  const authHeader = c.req.header("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = ownerHeader || bearer;
  if (!token) return { authorized: false, isOwner: false };
  if (secureEquals(runtime.ownerMasterToken, token)) {
    return { authorized: true, isOwner: true, principalId: "owner:local" };
  }
  try {
    const claims = runtime.channelGateway.verifyScopedCapabilityToken(token, runtime.ownerMasterToken);
    if (claims.soul_id && claims.soul_id !== readSoulArchiveConfig(runtime.soulDir).manifest.soul_id) return { authorized: false, isOwner: false };
    if (claims.plugin_id && claims.generation !== runtime.generation(claims.plugin_id, claims.target)) return { authorized: false, isOwner: false };
    return { authorized: true, isOwner: false, pluginId: claims.plugin_id, audience: claims.max_audience_privacy_ceiling, principalId: claims.principal_id, target: claims.target, scopedChannelId: claims.channel_id };
  } catch {
    return { authorized: false, isOwner: false };
  }
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const value: unknown = await c.req.json().catch(() => undefined);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function createSseResponse(
  execute: (write: (frame: Record<string, unknown>) => void) => Promise<void>,
  onCancel: () => void
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (frame: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          closed = true;
        }
      };

      void (async () => {
        try {
          await execute(write);
        } finally {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch {
              // Ignore stream already closed by client disconnect.
            }
            closed = true;
          }
        }
      })();
    },
    cancel() {
      closed = true;
      onCancel();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-ai0-protocol-stream": "v0"
    }
  });
}

export function registerChannelProtocolRunRoutes(app: Hono, runtime: Ai0DaemonRuntime): void {
  const basePath = CHANNEL_PROTOCOL_PATH;
  const runPaths = (suffix = "") => [basePath + "/runs" + suffix, "/api/channel-runs" + suffix];
  const active = new Map<string, ActiveRun>();
  const storageFor = (mode: Mode) => mode === "sandbox" ? runtime.sandboxStorage : runtime.storage;
  const runKeyOf = (channelId: string, mode: Mode, id: string) => JSON.stringify([runtime.soulDir, channelId, mode, id]);

  const resolveChannelId = (auth: AuthResult, explicit?: unknown): string => {
    if (auth.scopedChannelId) return auth.scopedChannelId;
    return parseChannelId(explicit) ?? runtime.fallbackChannelId();
  };

  const findStoredEvent = (channelId: string, mode: Mode, id: string) => {
    const storage = storageFor(mode);
    const direct = storage.getEventById(EVENT_PREFIX + id);
    return direct?.source_channel_id === channelId
      && direct.redacted_at_ts_ms == null && !JSON.parse(direct.payload_json).channel_process_redacted ? direct : undefined;
  };

  function accessible(auth: AuthResult, channelId: string, mode: Mode, id: string) {
    if (auth.isOwner) return true;
    const event = findStoredEvent(channelId, mode, id);
    if (!event) {
      const run = active.get(runKeyOf(channelId, mode, id));
      return !!run && run.principalId === auth.principalId && run.audience === auth.audience;
    }
    return event.principal_id === (auth.principalId ?? "unknown") && event.audience_scope === auth.audience;
  }

  function getTrace(channelId: string, mode: Mode, id: string): VerifiableTurnTrace | undefined {
    const event = findStoredEvent(channelId, mode, id);
    if (!event) return undefined;
    const trace = storageFor(mode).getDecisionTraceByEvent(event.event_id);
    return trace?.target_instance === targetOf(mode) ? trace : undefined;
  }

  function presentation(mode: Mode, eventId: string, trace?: VerifiableTurnTrace, activeProcess?: ChannelRunProcess) {
    const storage = storageFor(mode);
    const event = storage.getEventById(eventId);
    if (!event || event.redacted_at_ts_ms != null) return { process: undefined, sources: [] };
    const meta = JSON.parse(event.payload_json);
    if (meta.channel_process_redacted) return { process: undefined, sources: [] };
    const process = activeProcess ?? storage.getChannelRunProcess(eventId);
    const sources = runtime.knowledgeSources(mode, eventId);
    if (!trace) return { process, sources, ...(process?.error ? { error: process.error } : {}) };
    const ids: string[] = meta.used_memory_ids ?? trace.steps.step3_memory_recall.recalled_memories.map(item => item.memory_id);
    const memories = ids.length ? storage.queryMemoriesWithAudienceGuard({
      memory_ids: ids, principal_trust: event.principal_trust, audience_scope: event.audience_scope,
      current_virtual_ts: (mode === "live" ? runtime.virtualClock : runtime.sandboxClock).nowMs(),
      limit: ids.length
    }).map(memory => ({ id: memory.memory_id, text: memory.content_text })) : [];
    // Older traces prove these stages occurred, but did not record their timings.
    const stages: Stage[] = ["gate"];
    if (trace.steps.step2_gate_safety.l0_sb243_crisis_check === "PASS") stages.push("recall", "generating");
    stages.push("committed");
    return { process: { ...(process ?? { stages: stages.map(stage => ({ stage })) }), memories }, sources };
  }

  function getStatus(channelId: string, mode: Mode, id: string): RunStatus | undefined {
    const run = active.get(runKeyOf(channelId, mode, id));
    if (run) return run.trace && !findStoredEvent(channelId, mode, id) ? undefined : { ...run.state, ...presentation(mode, run.state.eventId, run.trace, run.state.process) };
    const event = findStoredEvent(channelId, mode, id);
    if (!event) return undefined;
    const base = { requestId: id, eventId: event.event_id, channelId, targetInstance: targetOf(mode) };
    const trace = getTrace(channelId, mode, id);
    if (!trace) {
      const payload = JSON.parse(event.payload_json) as {
        channel_run_status?: unknown;
      };
      const statusFlag = payload.channel_run_status;
      return { ...base, ...presentation(mode, event.event_id), status: statusFlag === "cancelled" ? "cancelled" : "failed" };
    }
    const receipt = receiptOf(trace);
    return {
      ...base,
      traceId: trace.trace_id,
      status: receipt?.status ?? "delivering",
      text: displayedText(trace),
      ...presentation(mode, event.event_id, trace),
      deliveryFinished: true,
      receipt
    };
  }

  function writeReceipt(
    channelId: string,
    trace: VerifiableTurnTrace,
    mode: Mode,
    status: Receipt["status"],
    spokenCharOffset: number
  ): Receipt {
    const existing = receiptOf(trace);
    if (existing) return existing;
    runtime.commitDelivery(mode, trace.turn_event_id, status, spokenCharOffset);
    return { status, spokenCharOffset };
  }

  app.get(`${basePath}/history`, (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (!mode) return c.json({ error: "INVALID_MODE" }, 400);
    const channelId = resolveChannelId(auth, c.req.query("channelId") ?? c.req.header("x-ai0-channel-id"));
    const storage = storageFor(mode);
    const turns = storage.listChannelRunEvents(channelId, auth.audience ?? "only_owner",
      auth.isOwner ? undefined : auth.principalId ?? "unknown", c.req.query("thread")).reverse().flatMap(event => {
      const requestId = extractRequestIdFromEventId(event.event_id);
      if (requestId && active.has(runKeyOf(channelId, mode, requestId))) return [];
      const trace = storage.getDecisionTraceByEvent(event.event_id);
      if (trace && trace.target_instance !== targetOf(mode)) return [];
      const receipt = trace && receiptOf(trace);
      const status = trace ? receipt?.status : JSON.parse(event.payload_json).channel_run_status;
      return [{
        requestId, eventId: event.event_id, channelId, traceId: trace?.trace_id, targetInstance: targetOf(mode),
        userText: trace?.steps.step1_perception.summary_text ?? event.summary_text, ...presentation(mode, event.event_id, trace),
        assistantText: trace && receipt ? displayedText(trace) : "",
        generatedText: trace?.steps.step7_emitted_intent.fallback_text,
        deliveryStatus: status ?? "unknown", status,
        timestamp: new Date(event.virtual_ts_ms).toISOString(), receipt
      }];
    });
    return c.json({ channelId, turns });
  });

  app.on("GET", runPaths("/:id"), (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestIdOf(c.req.param("id"));
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (!mode || !id) return c.json({ error: "INVALID_CHANNEL_RUN" }, 400);
    const channelId = resolveChannelId(auth, c.req.query("channelId") ?? c.req.header("x-ai0-channel-id"));
    if (!accessible(auth, channelId, mode, id)) return c.json({ error: "CHANNEL_RUN_NOT_FOUND" }, 404);
    const state = getStatus(channelId, mode, id);
    return state ? c.json(state) : c.json({ error: "CHANNEL_RUN_NOT_FOUND" }, 404);
  });

  app.on("GET", runPaths("/:id/trace"), (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized || !auth.isOwner) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestIdOf(c.req.param("id"));
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (!mode || !id) return c.json({ error: "INVALID_CHANNEL_RUN" }, 400);
    const channelId = resolveChannelId(auth, c.req.query("channelId") ?? c.req.header("x-ai0-channel-id"));
    if (active.has(runKeyOf(channelId, mode, id))) return c.json({ error: "CHANNEL_TRACE_IN_PROGRESS" }, 409);
    const trace = getTrace(channelId, mode, id);
    return trace ? c.json({ trace }) : c.json({ error: "CHANNEL_TRACE_NOT_FOUND" }, 404);
  });

  app.on("POST", runPaths(""), async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(body.requestId);
    const mode = parseMode(body.mode);
    const input = typeof body.text === "string" ? body.text.trim() : "";
    if (!id || !mode || !input || input.length > MAX_TEXT_LENGTH) {
      return c.json({ error: "INVALID_CHANNEL_RUN" }, 400);
    }
    const channelId = resolveChannelId(auth, body.channelId ?? c.req.header("x-ai0-channel-id"));
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (mode === "live" && !runtime.hasAwakenedSoul)
      return c.json({ error: "SOUL_NOT_AWAKENED", readiness: runtime.computeReadiness() }, 503);
    const eventId = EVENT_PREFIX + id;
    const targetInstance = targetOf(mode);
    const runKey = runKeyOf(channelId, mode, id);
    const thread = typeof body.thread === "string" ? body.thread : undefined;
    if (active.has(runKey)) return c.json({ error: "CHANNEL_RUN_IN_PROGRESS" }, 409);

    const storage = storageFor(mode);
    const existingEvent = storage.getEventById(eventId);
    if (existingEvent && !accessible(auth, channelId, mode, id)) return c.json({ error: "CHANNEL_RUN_ID_CONFLICT" }, 409);
    if (existingEvent && findStoredEvent(channelId, mode, id)?.summary_text !== input) {
      return c.json({ error: "CHANNEL_RUN_ID_CONFLICT" }, 409);
    }
    const archived = existingEvent ? getStatus(channelId, mode, id) : undefined;
    if (archived && !archived.deliveryFinished) {
      return c.json({ error: "CHANNEL_RUN_ALREADY_ENDED", run: archived }, 409);
    }
    if (
      !archived &&
      Array.from(active.values()).some(
        (entry) => entry.storage === storage && entry.state.channelId === channelId && entry.state.targetInstance === targetInstance &&
          entry.principalId === auth.principalId && entry.audience === auth.audience && entry.thread === thread
      )
    ) {
      return c.json({ error: "CHANNEL_TARGET_BUSY" }, 409);
    }

    const controller = new AbortController();
    const run: ActiveRun = { storage, principalId: auth.principalId, audience: auth.audience, thread,
      controller,
      sentChars: 0,
      startedAt: performance.now(),
      state: { requestId: id, eventId: existingEvent?.event_id ?? eventId, channelId, targetInstance, status: "accepted" }
    };
    if (!archived) active.set(runKey, run);

    const disconnect = () => controller.abort();
    const requestSignal = auth.pluginId ? AbortSignal.any([c.req.raw.signal, runtime.pluginSignal(auth.pluginId, mode)]) : c.req.raw.signal;
    requestSignal.addEventListener("abort", disconnect, { once: true });
    if (requestSignal.aborted) disconnect();
    const messageId = `${run.state.eventId}:a`;
    const start = run.startedAt;
    const process: ChannelRunProcess = { stages: [] };
    if (!archived) run.state.process = process;
    const saveProcess = () => {
      process.elapsedMs ??= Math.round(performance.now() - start);
      storageFor(mode).saveChannelRunProcess(run.state.eventId, process);
    };

    return createSseResponse(async (write) => {
      const stage = (value: Stage) => {
        run.state.stage = value;
        if (value === "generating") run.state.status = "generating";
        const data = { stage: value, elapsedMs: Math.round(performance.now() - start) };
        process.stages.push(data);
        write({ type: "data-turn-stage", data });
      };
      const emitState = () => {
        const { text: _text, ...metadata } = run.state;
        const visible = accessible(auth, channelId, mode, id)
          ? presentation(mode, run.state.eventId, run.trace ?? (archived ? getTrace(channelId, mode, id) : undefined), run.state.process)
          : { process: undefined, sources: [] };
        write({ type: "data-turn", data: { ...metadata, ...visible } });
      };

      try {
        write({ type: "start", messageId });
        if (archived) {
          run.state = { ...archived };
        } else {
          stage("accepted");
          emitState();
          const turn = await runtime.handleChannelTurn({ channel_id: channelId, principalId: auth.principalId, audience_scope: auth.audience,
            venue_type: auth.audience?.startsWith("group:") ? "group_chat" : auth.audience === "public_all" ? "public_livestream" : "private_1on1", thread, text: input, mode }, {
            eventId: run.state.eventId,
            signal: controller.signal,
            onStage: stage,
            onReasoning: delta => {
              controller.signal.throwIfAborted();
              if (!findStoredEvent(channelId, mode, id) || !accessible(auth, channelId, mode, id)) return;
              process.reasoning = delta === null ? undefined : (process.reasoning ?? "") + delta;
              write({ type: "data-turn-reasoning", data: { delta } });
            },
            deferDeliveryReceipt: true
          });
          run.trace = turn.trace;
          run.state.traceId = turn.trace.trace_id;
          run.state.provider = turn.provider;
          process.provider = turn.provider ?? { name: "local", model: "safety-guard" };
          process.usage = turn.usage;
          stage("committed");
          run.state.status = "delivering";
          stage("delivering");
          storageFor(mode).saveChannelRunProcess(run.state.eventId, process);
          emitState();
          run.state.text = "";
          write({ type: "text-start", id: messageId });
          const characters = Array.from(turn.expression.fallback_text);
          for (let offset = 0; offset < characters.length; offset += 18) {
            if (storageFor(mode) !== storage) throw new Error("SOUL_CHANGED");
            controller.signal.throwIfAborted();
            if (!findStoredEvent(channelId, mode, id)) throw new Error("CHANNEL_RUN_REDACTED");
            const chunk = characters.slice(offset, offset + 18);
            const delta = chunk.join("");
            run.sentChars += chunk.length;
            run.state.text += delta;
            write({ type: "text-delta", id: messageId, delta });
            if (run.sentChars < characters.length) await wait(12, undefined, { signal: controller.signal });
          }
          write({ type: "text-end", id: messageId });
          run.state.deliveryFinished = true;
          saveProcess();
        }

        if (archived?.text) {
          write({ type: "text-start", id: messageId });
          write({ type: "text-delta", id: messageId, delta: archived.text });
          write({ type: "text-end", id: messageId });
        }
        emitState();
        write({ type: "finish", finishReason: "stop" });
      } catch (error) {
        if (storageFor(mode) !== storage) {
          write({ type: "error", errorText: "SOUL_CHANGED" });
          write({ type: "finish", finishReason: "error" });
          return;
        }
        if (!controller.signal.aborted && (error instanceof ModelContextLimitError ||
            error instanceof ProviderNotConfiguredError || error instanceof SoulNotAwakenedError ||
            error instanceof UpstreamInferenceError)) process.error = error.code;
        if (!archived) saveProcess();
        if (!run.trace) {
          const status = controller.signal.aborted ? "cancelled" : "failed";
          run.state.status = status;
          storageFor(mode).markChannelRunEnded(channelId, run.state.eventId, status);
        } else if (!findStoredEvent(channelId, mode, id)) {
          run.state.status = "failed";
        }
        emitState();
        if (run.state.status === "failed") write({ type: "error", errorText: process.error ?? "CHANNEL_TURN_FAILED" });
        write({ type: "finish", finishReason: run.state.status === "failed" ? "error" : "other" });
      } finally {
        if (!archived) active.delete(runKey);
        requestSignal.removeEventListener("abort", disconnect);
      }
    }, disconnect);
  });

  app.on("POST", runPaths("/:id/stop"), async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset ?? 0;
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_CHANNEL_RUN" }, 400);
    const channelId = resolveChannelId(auth, body.channelId ?? c.req.header("x-ai0-channel-id"));
    if (!accessible(auth, channelId, mode, id)) return c.json({ error: "CHANNEL_RUN_NOT_FOUND" }, 404);
    const run = active.get(runKeyOf(channelId, mode, id));
    const trace = getTrace(channelId, mode, id);
    if (trace && !receiptOf(trace)) {
      const available = run?.sentChars ?? Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
      const receipt = writeReceipt(channelId, trace, mode, "interrupted", Math.min(offset, available));
      if (run) {
        run.state.status = receipt.status;
        run.state.receipt = receipt;
        run.state.text = Array.from(trace.steps.step7_emitted_intent.fallback_text)
          .slice(0, receipt.spokenCharOffset)
          .join("");
        run.state.deliveryFinished = true;
      }
    } else if (run && !trace) {
      run.state.status = "cancelled";
      storageFor(mode).markChannelRunEnded(channelId, run.state.eventId, "cancelled");
    }
    if (run?.state.process) run.state.process.elapsedMs ??= Math.round(performance.now() - run.startedAt);
    run?.controller.abort();
    const current = getStatus(channelId, mode, id);
    return current ? c.json(current) : c.json({ error: "CHANNEL_RUN_NOT_FOUND" }, 404);
  });

  app.on("POST", runPaths("/:id/receipt"), async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset;
    if (auth.target && auth.target !== mode) return c.json({ error: "TARGET_MISMATCH" }, 403);
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_CHANNEL_RECEIPT" }, 400);
    const channelId = resolveChannelId(auth, body.channelId ?? c.req.header("x-ai0-channel-id"));
    if (!accessible(auth, channelId, mode, id)) return c.json({ error: "CHANNEL_RUN_NOT_FOUND" }, 404);
    const trace = getTrace(channelId, mode, id);
    if (!trace) return c.json({ error: "CHANNEL_TRACE_NOT_FOUND" }, 404);
    const run = active.get(runKeyOf(channelId, mode, id));
    if (run && !run.state.deliveryFinished) return c.json({ error: "CHANNEL_DELIVERY_IN_PROGRESS" }, 409);
    const existing = receiptOf(trace);
    const length = Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
    if (!existing && offset !== length) return c.json({ error: "INVALID_CHANNEL_RECEIPT_OFFSET" }, 400);
    const receipt = writeReceipt(channelId, trace, mode, "completed", offset);
    if (run) {
      run.state.status = receipt.status;
      run.state.receipt = receipt;
    }
    return c.json(getStatus(channelId, mode, id));
  });

  app.post(`${basePath}/clear`, async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const mode = parseMode(body.mode, "live") ?? "live";
    const channelId = resolveChannelId(auth, body.channelId ?? c.req.header("x-ai0-channel-id"));
    return c.json(runtime.clearChannelTranscript(channelId, mode));
  });
}
