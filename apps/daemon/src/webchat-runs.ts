import { timingSafeEqual } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
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

type WebChatMessage = UIMessage<unknown, {
  "turn-stage": { stage: Stage; elapsedMs: number };
  turn: RunStatus;
}>;

const PREFIX = "evt_webchat_";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHELL_ID = "builtin.webchat.default";
const MAX_TEXT_LENGTH = 12_000;

function requestId(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value) ? value.toLowerCase() : undefined;
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

function isOwner(c: Context, runtime: Ai0DaemonRuntime): boolean {
  const expected = Buffer.from(runtime.ownerMasterToken);
  const provided = Buffer.from(c.req.header("x-ai0-owner-token") ?? "");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const value: unknown = await c.req.json().catch(() => undefined);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function connectionAware(response: Response, onCancel: () => void): Response {
  const reader = response.body?.getReader();
  if (!reader) return response;
  return new Response(new ReadableStream({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) controller.close();
      else controller.enqueue(chunk.value);
    },
    cancel(reason) {
      onCancel();
      return reader.cancel(reason);
    }
  }), response);
}

export function registerWebChatRunRoutes(app: Hono, runtime: Ai0DaemonRuntime): void {
  const path = "/api/studio/webchat";
  const active = new Map<string, ActiveRun>();
  const storageFor = (mode: Mode) => mode === "sandbox" ? runtime.sandboxStorage : runtime.storage;
  const key = (mode: Mode, id: string) => `${mode}:${id}`;

  const sourceEvent = (mode: Mode, id: string) => {
    const event = storageFor(mode).getEventById(PREFIX + id);
    return event?.source_shell_id === SHELL_ID && event.audience_scope === "only_owner"
      && event.redacted_at_ts_ms == null ? event : undefined;
  };

  function getTrace(mode: Mode, id: string): VerifiableTurnTrace | undefined {
    if (!sourceEvent(mode, id)) return undefined;
    const trace = storageFor(mode).getDecisionTraceByEvent(PREFIX + id);
    return trace?.target_instance === targetOf(mode) ? trace : undefined;
  }

  function getStatus(mode: Mode, id: string): RunStatus | undefined {
    const run = active.get(key(mode, id));
    if (run) return run.trace && !sourceEvent(mode, id) ? undefined : { ...run.state };
    const event = sourceEvent(mode, id);
    if (!event) return undefined;
    const base = { requestId: id, eventId: event.event_id, targetInstance: targetOf(mode) };
    const trace = getTrace(mode, id);
    if (!trace) {
      const payload = JSON.parse(event.payload_json) as { webchat_run_status?: unknown };
      return { ...base, status: payload.webchat_run_status === "cancelled" ? "cancelled" : "failed" };
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
    trace: VerifiableTurnTrace,
    mode: Mode,
    status: Receipt["status"],
    spokenCharOffset: number
  ): Receipt {
    const existing = receiptOf(trace);
    if (existing) return existing;
    if (status === "interrupted") {
      runtime.handleWebChatInterrupt({
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

  app.get(`${path}/history`, (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    if (!mode) return c.json({ error: "INVALID_MODE" }, 400);
    const turns = storageFor(mode).listWebChatDecisionTraces()
      .filter((trace) => trace.target_instance === targetOf(mode)
        && !active.has(key(mode, trace.turn_event_id.slice(PREFIX.length))))
      .reverse()
      .map((trace) => ({
        requestId: requestId(trace.turn_event_id.slice(PREFIX.length)),
        eventId: trace.turn_event_id,
        traceId: trace.trace_id,
        targetInstance: targetOf(mode),
        userText: trace.steps.step1_perception.summary_text,
        assistantText: displayedText(trace),
        timestamp: new Date(trace.virtual_ts_ms).toISOString(),
        receipt: receiptOf(trace)
      }));
    return c.json({ turns });
  });

  app.get(`${path}/runs/:id`, (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestId(c.req.param("id"));
    if (!mode || !id) return c.json({ error: "INVALID_WEBCHAT_RUN" }, 400);
    const state = getStatus(mode, id);
    return state ? c.json(state) : c.json({ error: "WEBCHAT_RUN_NOT_FOUND" }, 404);
  });

  app.get(`${path}/runs/:id/trace`, (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const mode = parseMode(c.req.query("mode"), "live");
    const id = requestId(c.req.param("id"));
    if (!mode || !id) return c.json({ error: "INVALID_WEBCHAT_RUN" }, 400);
    if (active.has(key(mode, id))) return c.json({ error: "WEBCHAT_TRACE_IN_PROGRESS" }, 409);
    const trace = getTrace(mode, id);
    return trace ? c.json({ trace }) : c.json({ error: "WEBCHAT_TRACE_NOT_FOUND" }, 404);
  });

  app.post(`${path}/runs`, async (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestId(body.requestId);
    const mode = parseMode(body.mode);
    const input = typeof body.text === "string" ? body.text.trim() : "";
    if (!id || !mode || !input || input.length > MAX_TEXT_LENGTH) {
      return c.json({ error: "INVALID_WEBCHAT_RUN" }, 400);
    }
    const eventId = PREFIX + id;
    const targetInstance = targetOf(mode);
    const runKey = key(mode, id);
    if (active.has(runKey)) return c.json({ error: "WEBCHAT_RUN_IN_PROGRESS" }, 409);
    const existingEvent = storageFor(mode).getEventById(eventId);
    if (existingEvent && sourceEvent(mode, id)?.summary_text !== input) {
      return c.json({ error: "WEBCHAT_RUN_ID_CONFLICT" }, 409);
    }
    const archived = existingEvent ? getStatus(mode, id) : undefined;
    if (archived && !archived.deliveryFinished) {
      return c.json({ error: "WEBCHAT_RUN_ALREADY_ENDED", run: archived }, 409);
    }
    if (!archived && Array.from(active.values()).some((run) => run.state.targetInstance === targetInstance)) {
      return c.json({ error: "WEBCHAT_TARGET_BUSY" }, 409);
    }

    const controller = new AbortController();
    const run: ActiveRun = {
      controller,
      sentChars: 0,
      state: { requestId: id, eventId, targetInstance, status: "accepted" }
    };
    if (!archived) active.set(runKey, run);
    const disconnect = () => controller.abort();
    const requestSignal = c.req.raw.signal;
    requestSignal.addEventListener("abort", disconnect, { once: true });
    if (requestSignal.aborted) disconnect();
    const messageId = `${eventId}:a`;
    const start = performance.now();

    const stream = createUIMessageStream<WebChatMessage>({
      onError: () => "WEBCHAT_TURN_FAILED",
      execute: async ({ writer }) => {
        const stage = (value: Stage) => {
          run.state.stage = value;
          if (value === "generating") run.state.status = "generating";
          writer.write({
            type: "data-turn-stage",
            data: { stage: value, elapsedMs: Math.round(performance.now() - start) }
          });
        };
        const state = () => {
          const { text: _text, ...metadata } = run.state;
          writer.write({ type: "data-turn", data: metadata });
        };
        try {
          writer.write({ type: "start", messageId });
          if (archived) {
            run.state = { ...archived };
          } else {
            stage("accepted");
            state();
            const turn = await runtime.handleWebChatTurn({ text: input, mode }, {
              eventId,
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
            state();
            run.state.text = "";
            writer.write({ type: "text-start", id: messageId });
            const characters = Array.from(turn.expression.fallback_text);
            for (let offset = 0; offset < characters.length; offset += 18) {
              controller.signal.throwIfAborted();
              if (!sourceEvent(mode, id)) throw new Error("WEBCHAT_RUN_REDACTED");
              const chunk = characters.slice(offset, offset + 18);
              const delta = chunk.join("");
              run.sentChars += chunk.length;
              run.state.text += delta;
              writer.write({ type: "text-delta", id: messageId, delta });
              if (run.sentChars < characters.length) await wait(12, undefined, { signal: controller.signal });
            }
            writer.write({ type: "text-end", id: messageId });
            run.state.deliveryFinished = true;
          }
          if (archived?.text) {
            writer.write({ type: "text-start", id: messageId });
            writer.write({ type: "text-delta", id: messageId, delta: archived.text });
            writer.write({ type: "text-end", id: messageId });
          }
          state();
          writer.write({ type: "finish", finishReason: "stop" });
        } catch {
          if (!run.trace) {
            const status = controller.signal.aborted ? "cancelled" : "failed";
            run.state.status = status;
            storageFor(mode).markWebChatRunEnded(eventId, status);
          } else if (!sourceEvent(mode, id)) {
            run.state.status = "failed";
          }
          state();
          if (run.state.status === "failed") writer.write({ type: "error", errorText: "WEBCHAT_TURN_FAILED" });
          writer.write({ type: "finish", finishReason: run.state.status === "failed" ? "error" : "other" });
        } finally {
          if (!archived) active.delete(runKey);
          requestSignal.removeEventListener("abort", disconnect);
        }
      }
    });
    return connectionAware(createUIMessageStreamResponse({
      stream,
      headers: { "cache-control": "no-store, no-transform", "x-accel-buffering": "no" }
    }), disconnect);
  });

  app.post(`${path}/runs/:id/stop`, async (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestId(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset ?? 0;
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_WEBCHAT_RUN" }, 400);
    const run = active.get(key(mode, id));
    const trace = getTrace(mode, id);
    if (trace && !receiptOf(trace)) {
      const available = run?.sentChars ?? Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
      const receipt = writeReceipt(trace, mode, "interrupted", Math.min(offset, available));
      if (run) {
        run.state.status = receipt.status;
        run.state.receipt = receipt;
        run.state.text = Array.from(trace.steps.step7_emitted_intent.fallback_text).slice(0, receipt.spokenCharOffset).join("");
        run.state.deliveryFinished = true;
      }
    } else if (run && !trace) {
      run.state.status = "cancelled";
      storageFor(mode).markWebChatRunEnded(run.state.eventId, "cancelled");
    }
    run?.controller.abort();
    const current = getStatus(mode, id);
    return current ? c.json(current) : c.json({ error: "WEBCHAT_RUN_NOT_FOUND" }, 404);
  });

  app.post(`${path}/runs/:id/receipt`, async (c) => {
    if (!isOwner(c, runtime)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await readBody(c);
    const id = requestId(c.req.param("id"));
    const mode = parseMode(body.mode);
    const offset = body.spokenCharOffset;
    if (!mode || !id || !validOffset(offset)) return c.json({ error: "INVALID_WEBCHAT_RECEIPT" }, 400);
    const trace = getTrace(mode, id);
    if (!trace) return c.json({ error: "WEBCHAT_TRACE_NOT_FOUND" }, 404);
    const run = active.get(key(mode, id));
    if (run && !run.state.deliveryFinished) return c.json({ error: "WEBCHAT_DELIVERY_IN_PROGRESS" }, 409);
    const existing = receiptOf(trace);
    const length = Array.from(trace.steps.step7_emitted_intent.fallback_text).length;
    if (!existing && offset !== length) return c.json({ error: "INVALID_WEBCHAT_RECEIPT_OFFSET" }, 400);
    const receipt = writeReceipt(trace, mode, "completed", offset);
    if (run) {
      run.state.status = receipt.status;
      run.state.receipt = receipt;
    }
    return c.json(getStatus(mode, id));
  });
}
