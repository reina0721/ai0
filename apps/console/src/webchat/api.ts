import { EventSourceParserStream } from "eventsource-parser/stream";
import type { VerifiableTurnTrace } from "@ai0/protocol";
import type { ConsoleMode } from "../api/client.js";

const WEBCHAT_PATH = "/api/studio/webchat";

export const WEBCHAT_STAGES = ["accepted", "gate", "recall", "blackboard", "generating", "committed", "delivering"] as const;
export type WebChatStage = (typeof WEBCHAT_STAGES)[number];
export type WebChatStatus = "accepted" | "generating" | "delivering" | "completed" | "interrupted" | "cancelled" | "failed";

export interface WebChatReceipt {
  status: "completed" | "interrupted";
  spokenCharOffset: number;
}

export interface WebChatRun {
  requestId: string;
  eventId?: string;
  traceId?: string;
  targetInstance: "live" | "sandbox:console";
  status: WebChatStatus;
  text?: string;
  deliveryFinished?: boolean;
  receipt?: WebChatReceipt;
  provider?: { name: string; model: string };
}

export interface WebChatHistoryTurn {
  requestId?: string;
  eventId: string;
  traceId: string;
  userText: string;
  assistantText: string;
  timestamp: string;
  targetInstance: WebChatRun["targetInstance"];
  receipt?: WebChatReceipt;
}

export interface WebChatStageEvent {
  stage: WebChatStage;
  elapsedMs: number;
}

export type WebChatStreamChunk =
  | { type: "data-turn"; data: WebChatRun }
  | { type: "data-turn-stage"; data: WebChatStageEvent }
  | { type: "text-delta"; delta: string }
  | { type: "error"; errorText: string };

export class WebChatHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const WEBCHAT_STATUSES = new Set<WebChatStatus>([
  "accepted", "generating", "delivering", "completed", "interrupted", "cancelled", "failed"
]);

function readWebChatStream(body: ReadableStream<Uint8Array<ArrayBuffer>>): ReadableStream<WebChatStreamChunk> {
  return body.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: 256 * 1024 }))
    .pipeThrough(new TransformStream({
      transform(event, controller) {
        if (event.data === "[DONE]") return;
        const value = JSON.parse(event.data) as Record<string, unknown>;
        if (value.type === "text-delta" && typeof value.delta === "string") {
          controller.enqueue({ type: value.type, delta: value.delta });
        } else if (value.type === "data-turn" && value.data) {
          const turn = value.data as WebChatRun;
          if (typeof turn.requestId === "string" && WEBCHAT_STATUSES.has(turn.status)) {
            controller.enqueue({ type: value.type, data: turn });
          }
        } else if (value.type === "data-turn-stage" && value.data) {
          const stage = value.data as WebChatStageEvent;
          if (WEBCHAT_STAGES.includes(stage.stage) && Number.isFinite(stage.elapsedMs)) {
            controller.enqueue({ type: value.type, data: stage });
          }
        } else if (value.type === "error" && typeof value.errorText === "string") {
          controller.enqueue({ type: value.type, errorText: value.errorText });
        }
      }
    }));
}

export function createWebChatApi(ownerToken: string, mode: ConsoleMode) {
  const headers = { "x-ai0-owner-token": ownerToken };
  const query = `?mode=${mode}`;
  const runPath = (requestId: string) => `${WEBCHAT_PATH}/runs/${encodeURIComponent(requestId)}`;

  async function readJson<T>(path: string, signal: AbortSignal, payload?: object): Promise<T> {
    const response = await fetch(path, {
      signal,
      cache: "no-store",
      ...(!payload ? { headers } : {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(payload)
      })
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new WebChatHttpError(response.status, result.error ?? `HTTP ${response.status}`);
    return result;
  }

  return {
    async open(requestId: string, text: string, signal: AbortSignal) {
      const response = await fetch(`${WEBCHAT_PATH}/runs`, {
        method: "POST",
        signal,
        cache: "no-store",
        headers: { ...headers, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ requestId, mode, text })
      });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new WebChatHttpError(response.status, "WebChat stream is unavailable");
      }
      return readWebChatStream(response.body);
    },
    history(signal: AbortSignal) {
      return readJson<{ turns: WebChatHistoryTurn[] }>(`${WEBCHAT_PATH}/history${query}`, signal);
    },
    status(requestId: string, signal: AbortSignal) {
      return readJson<WebChatRun>(`${runPath(requestId)}${query}`, signal);
    },
    trace(requestId: string, signal: AbortSignal) {
      return readJson<{ trace: VerifiableTurnTrace }>(`${runPath(requestId)}/trace${query}`, signal);
    },
    stop(requestId: string, spokenCharOffset: number, signal: AbortSignal) {
      return readJson<WebChatRun>(`${runPath(requestId)}/stop`, signal, { mode, spokenCharOffset });
    },
    receipt(requestId: string, spokenCharOffset: number, signal: AbortSignal) {
      return readJson<WebChatRun>(`${runPath(requestId)}/receipt`, signal, { mode, spokenCharOffset });
    }
  };
}

export function isFinishedChatRun(status: WebChatStatus): boolean {
  return ["completed", "interrupted", "cancelled", "failed"].includes(status);
}

export function spokenCharOffset(text: string): number {
  return Array.from(text).length;
}
