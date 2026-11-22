import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

export type ConsoleMode = "live" | "sandbox";

export interface ConsoleBootstrapPayload {
  ok: boolean;
  ownerToken: string;
  snapshot: ConsoleLiveSnapshot;
}

export async function fetchBootstrap(mode: ConsoleMode): Promise<ConsoleBootstrapPayload> {
  const res = await fetch(`/api/studio/bootstrap?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store"
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ConsoleBootstrapPayload> & {
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.snapshot) {
    throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);
  }
  return {
    ok: true,
    ownerToken: data.ownerToken ?? "",
    snapshot: data.snapshot
  };
}

export async function fetchSnapshot(mode: ConsoleMode): Promise<ConsoleLiveSnapshot> {
  const res = await fetch(`/api/admin/v1/snapshot?mode=${encodeURIComponent(mode)}`, {
    cache: "no-store"
  });
  const data = (await res.json().catch(() => ({}))) as ConsoleLiveSnapshot & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);
  }
  return data;
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  payload: Record<string, unknown> = {},
  ownerToken = ""
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (ownerToken) {
    headers["x-ai0-owner-token"] = ownerToken;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? data.message ?? `HTTP_${res.status}`);
  }
  return data;
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
