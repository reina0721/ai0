import { openMcpClient } from "./mcp-capabilities.js";
import { isDeepStrictEqual } from "node:util";

import type { McpServerConfig, McpToolDescriptor } from "@ai0/protocol";

export interface McpProbeResult {
  ok: boolean;
  status: "connected" | "error";
  latencyMs: number;
  tools: McpToolDescriptor[];
  detail: string;
  error?: string;
}

/** Connection evidence belongs to a specific host-tested transport configuration. */
export function sameMcpConnection(a: McpServerConfig, b: McpServerConfig) {
  const identity = ({ transport, command, args, env, url, headers }: McpServerConfig) => ({ transport, command, args, env, url, headers });
  return isDeepStrictEqual(identity(a), identity(b));
}
export function withCurrentMcpDiscovery(server: McpServerConfig, previous?: McpServerConfig): McpServerConfig {
  const evidence = previous && sameMcpConnection(server, previous) ? previous : undefined;
  return { ...server, discoveredTools: evidence?.discoveredTools ?? [], status: evidence?.status ?? "untested",
    lastProbedAt: evidence?.lastProbedAt, lastLatencyMs: evidence?.lastLatencyMs ?? 0, lastError: evidence?.lastError };
}

function inferToolRisk(name: string, description: string): McpToolDescriptor["risk"] {
  const combined = `${name} ${description}`.toLowerCase();
  if (/(exec|channel|bash|powershell|cmd|sudo|eval|delete_all|rm_rf|drop_table)/iu.test(combined)) {
    return "high_risk";
  }
  if (/(write|create|update|delete|remove|edit|patch|post|send|commit|push|upload|move|rename)/iu.test(combined)) {
    return "needs_owner_confirm";
  }
  return "read_only_safe";
}

function summarizeInputSchema(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const props = (schema as Record<string, unknown>).properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return undefined;
  const keys = Object.keys(props as Record<string, unknown>);
  return keys.length > 0 ? keys.slice(0, 6).join(", ") : undefined;
}

function parseToolsArray(rawTools: unknown): McpToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  const tools: McpToolDescriptor[] = [];
  for (const item of rawTools) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const description = typeof rec.description === "string" ? rec.description.trim() : "";
    const inputSchemaSummary = summarizeInputSchema(rec.inputSchema);
    tools.push({
      name,
      description,
      ...(rec.inputSchema !== null && typeof rec.inputSchema === "object" && !Array.isArray(rec.inputSchema) && { inputSchema: rec.inputSchema as Record<string, unknown> }),
      ...(rec.outputSchema !== null && typeof rec.outputSchema === "object" && !Array.isArray(rec.outputSchema) && { outputSchema: rec.outputSchema as Record<string, unknown> }),
      ...(inputSchemaSummary ? { inputSchemaSummary } : {}),
      risk: inferToolRisk(name, description)
    });
  }
  return tools;
}

export async function probeMcpServer(server: McpServerConfig): Promise<McpProbeResult> {
  const started = Date.now();
  const timeout = Math.max(1500, Math.min(server.timeoutMs, 30000));
  if (server.transport === "stdio" && !server.command.trim())
    return { ok: false, status: "error", tools: [], latencyMs: 0, detail: "stdio 模式必须配置可执行命令", error: "MISSING_COMMAND" };
  if (server.transport !== "stdio" && !/^https?:\/\//iu.test(server.url))
    return { ok: false, status: "error", tools: [], latencyMs: 0, detail: "HTTP 模式需要 HTTP(S) URL", error: "INVALID_URL" };
  try {
    const signal = AbortSignal.timeout(timeout);
    const { client, close } = await openMcpClient(server, signal);
    try {
      const tools: McpToolDescriptor[] = [];
      if (client.getServerCapabilities()?.tools) {
        let cursor: string | undefined;
        const previous = new Set<string | undefined>();
        do {
          if (previous.has(cursor)) throw new Error("Repeated MCP tools cursor");
          previous.add(cursor);
          const page = await client.listTools({ cursor }, { signal, timeout });
          tools.push(...parseToolsArray(page.tools));
          cursor = page.nextCursor;
        } while (cursor);
      }
      const latencyMs = Date.now() - started;
      return { ok: true, status: "connected", latencyMs, tools,
        detail: server.transport + " 探测成功 · 发现 " + tools.length + " 个工具 (" + latencyMs + "ms)" };
    } finally { await close(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: "error", latencyMs: Date.now() - started, tools: [], detail: "连接失败：" + message, error: message };
  }
}
