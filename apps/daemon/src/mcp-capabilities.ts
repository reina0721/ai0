import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig, McpToolDescriptor } from "@ai0/protocol";
export function resolveMcpEnvironment(rawEnv: Record<string, string>): Record<string, string> {
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

/** Only a consumer opening a registered entry can start a connection. Installation only reads local descriptors. */
export async function openMcpClient(server: McpServerConfig, signal: AbortSignal) {
  signal.throwIfAborted();
  const client = new Client({ name: "ai0", version: "1" });
  const http = { requestInit: { headers: server.headers, redirect: "error" as const } };
  const transport = server.transport === "stdio"
    ? new StdioClientTransport({ command: server.command, args: server.args, env: resolveMcpEnvironment(server.env), stderr: "ignore" })
    : server.transport === "sse" ? new SSEClientTransport(new URL(server.url), http)
    : new StreamableHTTPClientTransport(new URL(server.url), http);
  const onAbort = () => { void client.close().catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  const close = async () => { signal.removeEventListener("abort", onAbort); await client.close(); };
  try {
    await client.connect(transport, { signal, timeout: server.timeoutMs });
    signal.throwIfAborted();
    return { client, close };
  } catch (error) { await close(); throw error; }
}

async function readText(client: Client, uri: string, signal: AbortSignal, timeout: number) {
  const { contents } = await client.readResource({ uri }, { signal, timeout });
  const matching = contents.flatMap(item => item.uri === uri && "text" in item ? [item.text] : []);
  if (!matching.length) throw new Error("No matching text resource: " + uri);
  return matching.join("\n");
}

export const mcpCapabilities = {
  async read(server: McpServerConfig, uri: string, signal: AbortSignal) {
    const { client, close } = await openMcpClient(server, signal);
    try { return await readText(client, uri, signal, server.timeoutMs); }
    finally { await close(); }
  },
  async call(server: McpServerConfig, tool: McpToolDescriptor, args: Record<string, unknown>, signal: AbortSignal) {
    const { client, close } = await openMcpClient(server, signal);
    try {
      const options = { signal, timeout: server.timeoutMs };
      let cursor: string | undefined;
      const visited = new Set<string | undefined>();
      do {
        if (visited.has(cursor)) throw new Error("Repeated MCP tools cursor");
        visited.add(cursor);
        const page = await client.listTools({ cursor }, options);
        const current = page.tools.find(item => item.name === tool.name);
        if (current) {
          if (!isDeepStrictEqual(current.inputSchema, tool.inputSchema) || !isDeepStrictEqual(current.outputSchema, tool.outputSchema))
            throw new Error("MCP tool contract changed; refresh discovery");
          const response = await client.callTool({ name: tool.name, arguments: args }, undefined, options);
          if (response.isError) return { status: "failed" as const, error: "MCP tool reported an error" };
          return { status: "unverified" as const, value: response.structuredContent ?? response.content };
        }
        cursor = page.nextCursor;
      } while (cursor);
      throw new Error("MCP tool unavailable");
    } finally { await close(); }
  },
  async subscribe(server: McpServerConfig, uri: string, emit: (text: string) => void, signal: AbortSignal) {
    const { client, close } = await openMcpClient(server, signal);
    let newest = 0;
    const update = async () => {
      const revision = ++newest;
      const data = await readText(client, uri, signal, server.timeoutMs);
      if (!signal.aborted && newest === revision) emit(data);
    };
    try {
      if (!client.getServerCapabilities()?.resources?.subscribe) throw new Error("MCP resource subscriptions unavailable");
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, async message => {
        if (message.params.uri === uri && !signal.aborted) await update();
      });
      await client.subscribeResource({ uri }, { signal, timeout: server.timeoutMs });
      await update();
      return async () => {
        ++newest;
        try { if (!signal.aborted) await client.unsubscribeResource({ uri }, { timeout: server.timeoutMs }); }
        finally { await close(); }
      };
    } catch (error) { await close(); throw error; }
  }
};
