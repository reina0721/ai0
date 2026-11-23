import { timingSafeEqual } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import type { Context, Hono } from "hono";

import type { VerifiableTurnTrace } from "@ai0/protocol";

import type { Ai0DaemonRuntime } from "./index.js";

type Mode = "live" | "sandbox";
type Target = "live" | "sandbox:console";
type Stage = "accepted" | "gate" | "recall" | "blackboard" | "generating" | "committed" | "delivering";
type Status = "accepted" | "generating" | "delivering" | "completed" | "interrupted" | "cancelled" | "failed";
type Receipt = { status: "completed" | "interrupted"; spokenCharOffset: number };

interface RunStatus {
  requestId: string;
  eventId: string;
  shellId: string;
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
  controller: AbortController;
  state: RunStatus;
  trace?: VerifiableTurnTrace;
  sentChars: number;
}

interface AuthResult {
  readonly authorized: boolean;
  readonly isOwner: boolean;
  readonly scopedShellId?: string;
}

const EVENT_PREFIX = "evt_shell_";
const LEGACY_PREFIX = "evt_webchat_";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHELL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,95}$/iu;
const MAX_TEXT_LENGTH = 12_000;

function requestIdOf(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function parseShellId(value: unknown): string | undefined {
  return typeof value === "string" && SHELL_ID_PATTERN.test(value) ? value : undefined;
}

function extractRequestIdFromEventId(eventId: string): string | undefined {
  if (eventId.startsWith(EVENT_PREFIX)) return requestIdOf(eventId.slice(EVENT_PREFIX.length));
  if (eventId.startsWith(LEGACY_PREFIX)) return requestIdOf(eventId.slice(LEGACY_PREFIX.length));
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
    return { authorized: true, isOwner: true };
  }
  try {
    const claims = runtime.shellGateway.verifyScopedCapabilityToken(token, runtime.ownerMasterToken);
    return { authorized: true, isOwner: false, scopedShellId: claims.shell_id };
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

export function registerShellProtocolRunRoutes(app: Hono, runtime: Ai0DaemonRuntime): void {
  const basePath = "/protocol/v0/shell";
  const active = new Map<string, ActiveRun>();
  const storageFor = (mode: Mode) => mode === "sandbox" ? runtime.sandboxStorage : runtime.storage;
  const runKeyOf = (shellId: string, mode: Mode, id: string) => `${shellId}:${mode}:${id}`;

  const resolveShellId = (auth: AuthResult, explicit?: unknown): string => {
    if (auth.scopedShellId) return auth.scopedShellId;
    return parseShellId(explicit) ?? runtime.defaultStageShellId();
  };

  const findStoredEvent = (shellId: string, mode: Mode, id: string) => {
    const storage = storageFor(mode);
    const direct = storage.getEventById(EVENT_PREFIX + id) ?? storage.getEventById(LEGACY_PREFIX + id);
    return direct?.source_shell_id === shellId && direct.audience_scope === "only_owner"
      && direct.redacted_at_ts_ms == null ? direct : undefined;
  };

  function getTrace(shellId: string, mode: Mode, id: string): VerifiableTurnTrace | undefined {
    const event = findStoredEvent(shellId, mode, id);
    if (!event) return undefined;
    const trace = storageFor(mode).getDecisionTraceByEvent(event.event_id);
    return trace?.target_instance === targetOf(mode) ? trace : undefined;
  }

  function getStatus(shellId: string, mode: Mode, id: string): RunStatus | undefined {
    const run = active.get(runKeyOf(shellId, mode, id));
    if (run) return run.trace && !findStoredEvent(shellId, mode, id) ? undefined : { ...run.state };
    const event = findStoredEvent(shellId, mode, id);
    if (!event) return undefined;
    const base = { requestId: id, eventId: event.event_id, shellId, targetInstance: targetOf(mode) };
    const trace = getTrace(shellId, mode, id);
    if (!trace) {
      const payload = JSON.parse(event.payload_json) as {
        shell_run_status?: unknown;
        webchat_run_status?: unknown;
      };
      const statusFlag = payload.shell_run_status ?? payload.webchat_run_status;
      return { ...base, status: statusFlag === "cancelled" ? "cancelled" : "failed" };
    }
    const receipt = receiptOf(trace);
    return {
      ...base,
      traceId: trace.trace_id,
      status: receipt?.status ?? "delivering",
      text: displayedText(trace),
      deliveryFinished: true,
      receipt
    };
  }

  function writeReceipt(
    shellId: string,
    trace: VerifiableTurnTrace,
    mode: Mode,
    status: Receipt["status"],
    spokenCharOffset: number
  ): Receipt {
    const existing = receiptOf(trace);
    if (existing) return existing;
    if (status === "interrupted") {
      runtime.handleShellInterrupt({
        shell_id: shellId,
        intent_id: trace.steps.step7_emitted_intent.intent_id,
        full_text: trace.steps.step7_emitted_intent.fallback_text,
        spoken_char_offset: spokenCharOffset,
        mode
      }, trace.turn_event_id);
    } else {
      storageFor(mode).updateTurnTraceDeliveryReceipt(trace.turn_event_id, {
        status,
        spoken_char_offset: spokenCharOffset,
        degraded_extensions: []
      });
    }
    return { status, spokenCharOffset };
  }

  app.get(`${basePath}/history`, (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    if (!mode) return c.json({ error: "INVALID_MODE" }, 400);
    const shellId = resolveShellId(auth, c.req.query("shellId") ?? c.req.header("x-ai0-shell-id"));
    const turns = storageFor(mode).listShellDecisionTraces(shellId)
      .filter((trace) => {
        const reqId = extractRequestIdFromEventId(trace.turn_event_id);
        return trace.target_instance === targetOf(mode)
          && (!reqId || !active.has(runKeyOf(shellId, mode, reqId)));
      })
      .reverse()
      .map((trace) => ({
        requestId: extractRequestIdFromEventId(trace.turn_event_id),
        eventId: trace.turn_event_id,
        shellId,
        traceId: trace.trace_id,
        targetInstance: targetOf(mode),
        userText: trace.steps.step1_perception.summary_text,
        assistantText: displayedText(trace),
        timestamp: new Date(trace.virtual_ts_ms).toISOString(),
        receipt: receiptOf(trace)
      }));
    return c.json({ shellId, turns });
  });

  app.get(`${basePath}/runs/:id`, (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestIdOf(c.req.param("id"));
    if (!mode || !id) return c.json({ error: "INVALID_SHELL_RUN" }, 400);
    const shellId = resolveShellId(auth, c.req.query("shellId") ?? c.req.header("x-ai0-shell-id"));
    const state = getStatus(shellId, mode, id);
    return state ? c.json(state) : c.json({ error: "SHELL_RUN_NOT_FOUND" }, 404);
  });

  app.get(`${basePath}/runs/:id/trace`, (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized || !auth.isOwner) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestIdOf(c.req.param("id"));
    if (!mode || !id) return c.json({ error: "INVALID_SHELL_RUN" }, 400);
    const shellId = resolveShellId(auth, c.req.query("shellId") ?? c.req.header("x-ai0-shell-id"));
    if (active.has(runKeyOf(shellId, mode, id))) return c.json({ error: "SHELL_TRACE_IN_PROGRESS" }, 409);
    const trace = getTrace(shellId, mode, id);
    return trace ? c.json({ trace }) : c.json({ error: "SHELL_TRACE_NOT_FOUND" }, 404);
  });

  app.post(`${basePath}/runs`, async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(body.requestId);
    const mode = parseMode(body.mode);
    const input = typeof body.text === "string" ? body.text.trim() : "";
    if (!id || !mode || !input || input.length > MAX_TEXT_LENGTH) {
      return c.json({ error: "INVALID_SHELL_RUN" }, 400);
    }
    const shellId = resolveShellId(auth, body.shellId ?? c.req.header("x-ai0-shell-id"));
    const eventId = EVENT_PREFIX + id;
    const targetInstance = targetOf(mode);
    const runKey = runKeyOf(shellId, mode, id);
    if (active.has(runKey)) return c.json({ error: "SHELL_RUN_IN_PROGRESS" }, 409);

    const existingEvent =
      storageFor(mode).getEventById(eventId) ?? storageFor(mode).getEventById(LEGACY_PREFIX + id);
    if (existingEvent && findStoredEvent(shellId, mode, id)?.summary_text !== input) {
      return c.json({ error: "SHELL_RUN_ID_CONFLICT" }, 409);
    }
    const archived = existingEvent ? getStatus(shellId, mode, id) : undefined;
    if (archived && !archived.deliveryFinished) {
      return c.json({ error: "SHELL_RUN_ALREADY_ENDED", run: archived }, 409);
    }
    if (
      !archived &&
      Array.from(active.values()).some(
        (entry) => entry.state.shellId === shellId && entry.state.targetInstance === targetInstance
      )
    ) {
      return c.json({ error: "SHELL_TARGET_BUSY" }, 409);
    }

    const controller = new AbortController();
    const run: ActiveRun = {
      controller,
      sentChars: 0,
      state: { requestId: id, eventId: existingEvent?.event_id ?? eventId, shellId, targetInstance, status: "accepted" }
    };
    if (!archived) active.set(runKey, run);

    const disconnect = () => controller.abort();
    const requestSignal = c.req.raw.signal;
    requestSignal.addEventListener("abort", disconnect, { once: true });
    if (requestSignal.aborted) disconnect();
    const messageId = `${run.state.eventId}:a`;
    const start = performance.now();

    return createSseResponse(async (write) => {
      const stage = (value: Stage) => {
        run.state.stage = value;
        if (value === "generating") run.state.status = "generating";
        write({
          type: "data-turn-stage",
          data: { stage: value, elapsedMs: Math.round(performance.now() - start) }
        });
      };
      const emitState = () => {
        const { text: _text, ...metadata } = run.state;
        write({ type: "data-turn", data: metadata });
      };

      try {
        write({ type: "start", messageId });
        if (archived) {
          run.state = { ...archived };
        } else {
          stage("accepted");
          emitState();
          const turn = await runtime.handleShellTurn({ shell_id: shellId, text: input, mode }, {
            eventId: run.state.eventId,
            signal: controller.signal,
            onStage: stage,
            deferDeliveryReceipt: true
          });
          run.trace = turn.trace;
          run.state.traceId = turn.trace.trace_id;
          run.state.provider = turn.provider;
          stage("committed");
          run.state.status = "delivering";
          stage("delivering");
          emitState();
          run.state.text = "";
          write({ type: "text-start", id: messageId });
          const characters = Array.from(turn.expression.fallback_text);
          for (let offset = 0; offset < characters.length; offset += 18) {
            controller.signal.throwIfAborted();
            if (!findStoredEvent(shellId, mode, id)) throw new Error("SHELL_RUN_REDACTED");
            const chunk = characters.slice(offset, offset + 18);
            const delta = chunk.join("");
            run.sentChars += chunk.length;
            run.state.text += delta;
            write({ type: "text-delta", id: messageId, delta });
            if (run.sentChars < characters.length) await wait(12, undefined, { signal: controller.signal });
          }
          write({ type: "text-end", id: messageId });
          run.state.deliveryFinished = true;
        }

        if (archived?.text) {
          write({ type: "text-start", id: messageId });
          write({ type: "text-delta", id: messageId, delta: archived.text });
          write({ type: "text-end", id: messageId });
        }
        emitState();
        write({ type: "finish", finishReason: "stop" });
      } catch {
        if (!run.trace) {
          const status = controller.signal.aborted ? "cancelled" : "failed";
          run.state.status = status;
          storageFor(mode).markShellRunEnded(shellId, run.state.eventId, status);
        } else if (!findStoredEvent(shellId, mode, id)) {
          run.state.status = "failed";
        }
        emitState();
        if (run.state.status === "failed") write({ type: "error", errorText: "SHELL_TURN_FAILED" });
        write({ type: "finish", finishReason: run.state.status === "failed" ? "error" : "other" });
      } finally {
        if (!archived) active.delete(runKey);
        requestSignal.removeEventListener("abort", disconnect);
      }
    }, disconnect);
  });

  app.post(`${basePath}/runs/:id/stop`, async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset ?? 0;
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_SHELL_RUN" }, 400);
    const shellId = resolveShellId(auth, body.shellId ?? c.req.header("x-ai0-shell-id"));
    const run = active.get(runKeyOf(shellId, mode, id));
    const trace = getTrace(shellId, mode, id);
    if (trace && !receiptOf(trace)) {
      const available = run?.sentChars ?? Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
      const receipt = writeReceipt(shellId, trace, mode, "interrupted", Math.min(offset, available));
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
      storageFor(mode).markShellRunEnded(shellId, run.state.eventId, "cancelled");
    }
    run?.controller.abort();
    const current = getStatus(shellId, mode, id);
    return current ? c.json(current) : c.json({ error: "SHELL_RUN_NOT_FOUND" }, 404);
  });

  app.post(`${basePath}/runs/:id/receipt`, async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestIdOf(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset;
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_SHELL_RECEIPT" }, 400);
    const shellId = resolveShellId(auth, body.shellId ?? c.req.header("x-ai0-shell-id"));
    const trace = getTrace(shellId, mode, id);
    if (!trace) return c.json({ error: "SHELL_TRACE_NOT_FOUND" }, 404);
    const run = active.get(runKeyOf(shellId, mode, id));
    if (run && !run.state.deliveryFinished) return c.json({ error: "SHELL_DELIVERY_IN_PROGRESS" }, 409);
    const existing = receiptOf(trace);
    const length = Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
    if (!existing && offset !== length) return c.json({ error: "INVALID_SHELL_RECEIPT_OFFSET" }, 400);
    const receipt = writeReceipt(shellId, trace, mode, "completed", offset);
    if (run) {
      run.state.status = receipt.status;
      run.state.receipt = receipt;
    }
    return c.json(getStatus(shellId, mode, id));
  });

  app.post(`${basePath}/clear`, async (c) => {
    const auth = authenticate(c, runtime);
    if (!auth.authorized) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const mode = parseMode(body.mode, "live") ?? "live";
    const shellId = resolveShellId(auth, body.shellId ?? c.req.header("x-ai0-shell-id"));
    return c.json(runtime.clearShellTranscript(shellId, mode));
  });
}
