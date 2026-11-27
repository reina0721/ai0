import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { AgentToolDefinition, AgentValueSchema, Ai0ExtensionManifest } from "@ai0/protocol";
import { agentToolProviderFacet, consoleConfigSchemaFacet, defineExtensionPackage } from "@ai0/sdk";
import rawManifest from "../ai0.extension.json" with { type: "json" };

export type McpBridgeServerEntry =
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | {
      readonly transport: "sse" | "streamable_http";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

export interface McpBridgeConfig {
  readonly mcp_servers_json?: string;
  readonly default_timeout_ms?: number;
  readonly allow_local_http_mcp?: boolean;
}

function zodValueSchema<T>(schema: z.ZodType<T>, jsonSchema: Readonly<Record<string, unknown>>): AgentValueSchema {
  return {
    jsonSchema,
    parse: (input: unknown) => schema.parse(input)
  };
}

function resolveMcpEnvPlaceholders(rawEnv: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawEnv)) {
    const match = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/u.exec(val.trim());
    if (match) {
      const envName = match[1] ?? match[2]!;
      if (process.env[envName] !== undefined) out[key] = process.env[envName]!;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (clean === "localhost" || clean.endsWith(".localhost") || clean.endsWith(".local") || clean.endsWith(".internal")) {
    return true;
  }
  if (isIP(clean) === 4) {
    const [a, b] = clean.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (isIP(clean) === 6) {
    if (clean === "::1" || clean === "::" || clean.startsWith("fe8") || clean.startsWith("fc") || clean.startsWith("fd")) {
      return true;
    }
  }
  return false;
}

export function parseMcpServersConfig(
  rawJson: string | undefined,
  allowLocalHttp = false
): ReadonlyMap<string, McpBridgeServerEntry> {
  const map = new Map<string, McpBridgeServerEntry>();
  if (!rawJson || !rawJson.trim()) return map;
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const root =
    parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : parsed;

  for (const [name, rawSpec] of Object.entries(root)) {
    if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) continue;
    const spec = rawSpec as Record<string, unknown>;
    if (typeof spec.command === "string" && spec.command.trim()) {
      const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
      const env =
        spec.env && typeof spec.env === "object" && !Array.isArray(spec.env)
          ? Object.fromEntries(Object.entries(spec.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : {};
      map.set(name, { transport: "stdio", command: spec.command.trim(), args, env });
    } else if (typeof spec.url === "string" && spec.url.trim()) {
      const parsedUrl = new URL(spec.url.trim());
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`Unsupported MCP URL protocol for ${name}: ${parsedUrl.protocol}`);
      }
      if (!allowLocalHttp && isPrivateOrLocalHostname(parsedUrl.hostname)) {
        throw new Error(`Local/private HTTP MCP endpoint blocked unless allow_local_http_mcp=true: ${name}`);
      }
      const headers =
        spec.headers && typeof spec.headers === "object" && !Array.isArray(spec.headers)
          ? Object.fromEntries(Object.entries(spec.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : {};
      const transport = spec.transport === "sse" ? "sse" : "streamable_http";
      map.set(name, { transport, url: parsedUrl.toString(), headers });
    }
  }
  return map;
}

async function withMcpClient<T>(
  entry: McpBridgeServerEntry,
  timeoutMs: number,
  signal: AbortSignal,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  signal.throwIfAborted();
  const client = new Client({ name: "ai0-mcp-bridge", version: "1.0.0" });
  const transport =
    entry.transport === "stdio"
      ? new StdioClientTransport({
          command: entry.command,
          args: [...entry.args],
          env: { ...(process.env as Record<string, string>), ...resolveMcpEnvPlaceholders(entry.env) },
          stderr: "ignore"
        })
      : entry.transport === "sse"
        ? new SSEClientTransport(new URL(entry.url), {
            requestInit: { headers: entry.headers, redirect: "error" }
          })
        : new StreamableHTTPClientTransport(new URL(entry.url), {
            requestInit: { headers: entry.headers, redirect: "error" }
          });

  const onAbort = () => {
    void client.close().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await client.connect(transport, { signal, timeout: timeoutMs });
    signal.throwIfAborted();
    return await fn(client);
  } finally {
    signal.removeEventListener("abort", onAbort);
    await client.close().catch(() => undefined);
  }
}

const ListServersInputSchema = z.object({
  server: z.string().optional()
});

const CallMcpToolInputSchema = z.object({
  server: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).optional()
});

const ReadMcpResourceInputSchema = z.object({
  server: z.string().min(1),
  uri: z.string().min(1)
});

export function createMcpBridgeToolDefinitions(config: McpBridgeConfig = {}): AgentToolDefinition[] {
  let servers: ReadonlyMap<string, McpBridgeServerEntry>;
  try {
    servers = parseMcpServersConfig(config.mcp_servers_json, config.allow_local_http_mcp === true);
  } catch {
    return [];
  }
  if (servers.size === 0) return [];

  const timeoutMs = Math.max(1000, Math.min(120_000, Number(config.default_timeout_ms ?? 15_000)));

  return [
    {
      name: "mcp.list_servers_and_tools",
      description:
        "Probe configured MCP servers and list their available tools (with input schemas) and readable resource URIs.",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(ListServersInputSchema, {
        type: "object",
        properties: { server: { type: "string" } },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      async execute(call, signal) {
        try {
          const input = ListServersInputSchema.parse(call.input ?? {});
          const targetNames = input.server ? [input.server] : [...servers.keys()];
          const discovered: Array<Record<string, unknown>> = [];

          for (const name of targetNames) {
            const spec = servers.get(name);
            if (!spec) {
              return { status: "failed", error: `Unknown MCP server: ${name}` };
            }
            const info = await withMcpClient(spec, timeoutMs, signal, async (client) => {
              const toolsPage = await client.listTools(undefined, { signal, timeout: timeoutMs });
              let resources: Array<{ uri: string; name: string; description?: string }> = [];
              try {
                if (client.getServerCapabilities()?.resources) {
                  const resPage = await client.listResources(undefined, { signal, timeout: timeoutMs });
                  resources = resPage.resources.map((r) => ({
                    uri: r.uri,
                    name: r.name,
                    ...(r.description ? { description: r.description } : {})
                  }));
                }
              } catch {
                resources = [];
              }
              return {
                server: name,
                transport: spec.transport,
                tools: toolsPage.tools.map((t) => ({
                  name: t.name,
                  description: t.description ?? "",
                  inputSchema: t.inputSchema
                })),
                resources
              };
            });
            discovered.push(info);
          }

          return { status: "verified", value: { servers: discovered } };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "mcp.call_tool",
      description:
        "Invoke a tool on a configured MCP server. Output carries untrusted_external taint.",
      capabilityRisk: "low_read_and_scoped_write",
      resultTaint: "untrusted_external",
      inputSchema: zodValueSchema(CallMcpToolInputSchema, {
        type: "object",
        required: ["server", "tool"],
        properties: {
          server: { type: "string" },
          tool: { type: "string" },
          arguments: { type: "object" }
        },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      async execute(call, signal) {
        try {
          const input = CallMcpToolInputSchema.parse(call.input);
          const spec = servers.get(input.server);
          if (!spec) {
            return { status: "failed", error: `Unknown MCP server: ${input.server}` };
          }
          const outcome = await withMcpClient(spec, timeoutMs, signal, async (client) => {
            const response = await client.callTool(
              { name: input.tool, arguments: input.arguments ?? {} },
              undefined,
              { signal, timeout: timeoutMs }
            );
            if (response.isError) {
              throw new Error(`MCP tool ${input.server}/${input.tool} reported an error`);
            }
            return response.structuredContent ?? response.content;
          });
          return {
            status: "verified",
            value: {
              server: input.server,
              tool: input.tool,
              output: outcome
            }
          };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "mcp.read_resource",
      description:
        "Read a text resource URI from a configured MCP server. Output carries untrusted_external taint.",
      capabilityRisk: "read_only_safe",
      resultTaint: "untrusted_external",
      inputSchema: zodValueSchema(ReadMcpResourceInputSchema, {
        type: "object",
        required: ["server", "uri"],
        properties: {
          server: { type: "string" },
          uri: { type: "string" }
        },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      async execute(call, signal) {
        try {
          const input = ReadMcpResourceInputSchema.parse(call.input);
          const spec = servers.get(input.server);
          if (!spec) {
            return { status: "failed", error: `Unknown MCP server: ${input.server}` };
          }
          const text = await withMcpClient(spec, timeoutMs, signal, async (client) => {
            const res = await client.readResource({ uri: input.uri }, { signal, timeout: timeoutMs });
            const chunks = res.contents.flatMap((item) => ("text" in item && typeof item.text === "string" ? [item.text] : []));
            if (chunks.length === 0) {
              throw new Error(`No text content returned for resource ${input.uri}`);
            }
            return chunks.join("\n");
          });
          return {
            status: "verified",
            value: {
              server: input.server,
              uri: input.uri,
              content: text
            }
          };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    }
  ];
}

const typedManifest = rawManifest as unknown as Omit<Ai0ExtensionManifest, "manifest_version">;

export const mcpBridgePackage = defineExtensionPackage({
  manifest: typedManifest,
  activate(scope, rawConfig) {
    const config = (rawConfig ?? {}) as McpBridgeConfig;
    scope.contributeFacet(consoleConfigSchemaFacet, {
      fields: typedManifest.console_contributions?.config_fields ?? []
    });
    const tools = createMcpBridgeToolDefinitions(config);
    if (tools.length > 0) {
      scope.contributeFacet(agentToolProviderFacet, { tools });
    }
  }
});

export default mcpBridgePackage;
