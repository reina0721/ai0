import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

export type ConsoleMode = "live" | "sandbox";

export interface ConsoleBootstrapPayload {
  ok: boolean;
  ownerToken: string;
  snapshot: ConsoleLiveSnapshot;
}

export async function fetchBootstrap(mode: ConsoleMode, signal?: AbortSignal): Promise<ConsoleBootstrapPayload> {
  const res = await fetch(`/api/studio/bootstrap?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store",
    signal
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ConsoleBootstrapPayload> & {
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.snapshot || !data.ownerToken) {
    throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);
  }
  return {
    ok: true,
    ownerToken: data.ownerToken ?? "",
    snapshot: data.snapshot
  };
}

export async function fetchSnapshot(mode: ConsoleMode): Promise<ConsoleLiveSnapshot> {
  return getJson(`/api/admin/v1/snapshot?mode=${encodeURIComponent(mode)}`);
}

async function requestJson<T>(url: string, init: RequestInit, ownerToken: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (ownerToken) {
    headers.set("x-ai0-owner-token", ownerToken);
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    throw new Error(data?.error ?? data?.message ?? `HTTP_${res.status}`);
  }
  if (data === null) throw new Error("服务端未返回有效 JSON");
  return data;
}

export function getJson<T>(url: string, ownerToken = "", signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, { signal }, ownerToken);
}

export function postJson<T = Record<string, unknown>>(
  url: string,
  payload: Record<string, unknown> = {},
  ownerToken = ""
): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, ownerToken);
}

export function subscribeTelemetryStream(onFrame: (frame: unknown) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource("/api/admin/v1/telemetry/stream");
  source.onmessage = (event) => {
    try {
      onFrame(JSON.parse(event.data));
    } catch {
      // Ignore malformed telemetry chunks
    }
  };
  return () => {
    source.close();
  };
}
