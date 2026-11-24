import { spawn } from "node:child_process";

import type { McpServerConfig, McpToolDescriptor } from "@ai0/protocol";

export interface McpProbeResult {
  ok: boolean;
  status: "connected" | "error";
  latencyMs: number;
  tools: McpToolDescriptor[];
  detail: string;
  error?: string;
}

function inferToolRisk(name: string, description: string): McpToolDescriptor["risk"] {
  const combined = `${name} ${description}`.toLowerCase();
  if (/(exec|shell|bash|powershell|cmd|sudo|eval|delete_all|rm_rf|drop_table)/iu.test(combined)) {
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
      ...(inputSchemaSummary ? { inputSchemaSummary } : {}),
      risk: inferToolRisk(name, description)
    });
  }
  return tools;
}

function resolveEnvMap(rawEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    const match = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/u.exec(v.trim());
    if (match) {
      const envName = match[1] ?? match[2]!;
      if (process.env[envName] !== undefined) out[k] = process.env[envName]!;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function probeStdioServer(server: McpServerConfig): Promise<McpProbeResult> {
  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const command = server.command.trim();
  if (!command) {
    return {
      ok: false,
      status: "error",
      latencyMs: 0,
      tools: [],
      detail: "stdio 模式必须配置可执行命令 (command)",
      error: "MISSING_COMMAND"
    };
  }

  const timeoutMs = Math.max(1500, Math.min(server.timeoutMs || 10000, 30000));

  return new Promise<McpProbeResult>((resolve) => {
    let settled = false;
    let buffer = "";
    let stderrBuf = "";
    let initAcked = false;

    const child = spawn(command, server.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...resolveEnvMap(server.env) },
      windowsHide: true
    });

    const finish = (result: McpProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Ignore already exited child
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        status: "error",
        latencyMs: elapsed(),
        tools: [],
        detail: `MCP stdio 探测超时 (${timeoutMs}ms)${stderrBuf ? ` · ${stderrBuf.slice(0, 140)}` : ""}`,
        error: "TIMEOUT"
      });
    }, timeoutMs);

    child.on("error", (err) => {
      finish({
        ok: false,
        status: "error",
        latencyMs: elapsed(),
        tools: [],
        detail: `启动命令失败：${err.message}`,
        error: err.message
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 400) stderrBuf += chunk.toString("utf8");
    });

    const handleJsonMessage = (msg: Record<string, unknown>) => {
      if (msg.id === 1 && !initAcked) {
        initAcked = true;
        if (msg.error) {
          finish({
            ok: false,
            status: "error",
            latencyMs: elapsed(),
            tools: [],
            detail: `initialize 被拒绝：${JSON.stringify(msg.error)}`,
            error: "INIT_ERROR"
          });
          return;
        }
        try {
          child.stdin?.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
          );
          child.stdin?.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`
          );
        } catch (err) {
          finish({
            ok: false,
            status: "error",
            latencyMs: elapsed(),
            tools: [],
            detail: `写入 tools/list 失败：${err instanceof Error ? err.message : String(err)}`,
            error: "WRITE_ERROR"
          });
        }
        return;
      }

      if (msg.id === 2) {
        if (msg.error) {
          finish({
            ok: false,
            status: "error",
            latencyMs: elapsed(),
            tools: [],
            detail: `tools/list 返回错误：${JSON.stringify(msg.error)}`,
            error: "TOOLS_LIST_ERROR"
          });
          return;
        }
        const resultObj =
          msg.result && typeof msg.result === "object"
            ? (msg.result as Record<string, unknown>)
            : {};
        const tools = parseToolsArray(resultObj.tools);
        const ms = elapsed();
        finish({
          ok: true,
          status: "connected",
          latencyMs: ms,
          tools,
          detail: `stdio 探测成功 · 发现 ${tools.length} 个工具 (${ms}ms)`
        });
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            handleJsonMessage(parsed as Record<string, unknown>);
          }
        } catch {
          // Ignore non-JSON log lines emitted to stdout
        }
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          status: "error",
          latencyMs: elapsed(),
          tools: [],
          detail: `进程提前退出 (code ${code ?? "null"})${stderrBuf ? ` · ${stderrBuf.trim().slice(0, 140)}` : ""}`,
          error: `EXIT_${code ?? "NULL"}`
        });
      }
    });

    try {
      child.stdin?.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "ai0-daemon", version: "1.0.0" }
          }
        })}\n`
      );
    } catch (err) {
      finish({
        ok: false,
        status: "error",
        latencyMs: elapsed(),
        tools: [],
        detail: `发送 initialize 帧失败：${err instanceof Error ? err.message : String(err)}`,
        error: "INIT_WRITE_ERROR"
      });
    }
  });
}

function extractJsonRpcPayload(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  for (const line of trimmed.split(/\r?\n/u)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload.startsWith("{")) {
        try {
          return JSON.parse(payload) as Record<string, unknown>;
        } catch {
          // continue
        }
      }
    }
  }
  return undefined;
}

async function probeHttpServer(server: McpServerConfig): Promise<McpProbeResult> {
  const started = Date.now();
  const elapsed = () => Math.max(0, Date.now() - started);
  const url = server.url.trim();
  if (!url || !/^https?:\/\//iu.test(url)) {
    return {
      ok: false,
      status: "error",
      latencyMs: 0,
      tools: [],
      detail: "SSE / Streamable HTTP 模式必须提供有效的 HTTP(S) URL",
      error: "INVALID_URL"
    };
  }

  const timeoutMs = Math.max(1500, Math.min(server.timeoutMs || 12000, 30000));
  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...server.headers
  };

  try {
    const initRes = await fetch(url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "ai0-daemon", version: "1.0.0" }
        }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const sessionId = initRes.headers.get("mcp-session-id");
    const listHeaders = sessionId ? { ...baseHeaders, "mcp-session-id": sessionId } : baseHeaders;

    if (initRes.ok) {
      const listRes = await fetch(url, {
        method: "POST",
        headers: listHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (listRes.ok) {
        const parsed = extractJsonRpcPayload(await listRes.text());
        const resultObj =
          parsed?.result && typeof parsed.result === "object"
            ? (parsed.result as Record<string, unknown>)
            : {};
        const tools = parseToolsArray(resultObj.tools);
        const ms = elapsed();
        return {
          ok: true,
          status: "connected",
          latencyMs: ms,
          tools,
          detail: `${server.transport} 探测成功 · 发现 ${tools.length} 个工具 (${ms}ms)`
        };
      }
      const ms = elapsed();
      return {
        ok: true,
        status: "connected",
        latencyMs: ms,
        tools: server.discoveredTools,
        detail: `端点初始化成功 (HTTP ${initRes.status})，tools/list 返回 HTTP ${listRes.status} (${ms}ms)`
      };
    }

    // Fallback: SSE endpoints often accept GET text/event-stream
    if (server.transport === "sse") {
      const sseRes = await fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream", ...server.headers },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 4000))
      });
      const ms = elapsed();
      if (sseRes.ok) {
        await sseRes.body?.cancel().catch(() => undefined);
        return {
          ok: true,
          status: "connected",
          latencyMs: ms,
          tools: server.discoveredTools,
          detail: `SSE 端点连通 (HTTP ${sseRes.status}, ${ms}ms)`
        };
      }
      return {
        ok: false,
        status: "error",
        latencyMs: ms,
        tools: [],
        detail: `SSE 端点响应 HTTP ${sseRes.status}`,
        error: `HTTP_${sseRes.status}`
      };
    }

    const ms = elapsed();
    return {
      ok: false,
      status: "error",
      latencyMs: ms,
      tools: [],
      detail: `HTTP ${initRes.status}: ${(await initRes.text().catch(() => "")).slice(0, 140)}`,
      error: `HTTP_${initRes.status}`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: "error",
      latencyMs: elapsed(),
      tools: [],
      detail: `连接失败：${msg}`,
      error: msg
    };
  }
}

export async function probeMcpServer(server: McpServerConfig): Promise<McpProbeResult> {
  if (server.transport === "stdio") {
    return probeStdioServer(server);
  }
  return probeHttpServer(server);
}
