import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import mcpBridgePackage, { createMcpBridgeToolDefinitions } from "./index.js";

describe("builtin.mcp-bridge progressive stdio MCP client bridge", () => {
  it("stays fail-closed without configuration and connects to a real stdio MCP server end-to-end", async () => {
    expect(mcpBridgePackage.manifest.default_enabled).toBe(false);
    expect(createMcpBridgeToolDefinitions({})).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "ai0-mcp-bridge-test-"));
    try {
      const scriptPath = join(dir, "mock-mcp-server.mjs");
      writeFileSync(
        scriptPath,
        [
          'import { createInterface } from "node:readline";',
          'const send = (body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...body }) + "\\n");',
          'const tools = [{ name: "echo_upper", description: "Uppercase input text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];',
          'const resources = [{ uri: "memo://architecture", name: "Architecture Guide", description: "IoC overview" }];',
          'createInterface({ input: process.stdin }).on("line", (line) => {',
          '  if (!line.trim()) return;',
          '  const msg = JSON.parse(line);',
          '  if (msg.id === undefined) return;',
          '  let result = {};',
          '  if (msg.method === "initialize") {',
          '    result = { protocolVersion: msg.params.protocolVersion, serverInfo: { name: "demo-mcp", version: "1.0.0" }, capabilities: { tools: {}, resources: {} } };',
          '  } else if (msg.method === "tools/list") {',
          '    result = { tools };',
          '  } else if (msg.method === "resources/list") {',
          '    result = { resources };',
          '  } else if (msg.method === "tools/call" && msg.params?.name === "echo_upper") {',
          '    result = { content: [{ type: "text", text: String(msg.params.arguments?.text ?? "").toUpperCase() }] };',
          '  } else if (msg.method === "resources/read" && msg.params?.uri === "memo://architecture") {',
          '    result = { contents: [{ uri: "memo://architecture", text: "Orthogonal IoC MCP resource content" }] };',
          '  } else {',
          '    send({ id: msg.id, error: { code: -32601, message: "Method not found" } });',
          '    return;',
          '  }',
          '  send({ id: msg.id, result });',
          '});'
        ].join("\n"),
        "utf8"
      );

      const tools = createMcpBridgeToolDefinitions({
        mcp_servers_json: JSON.stringify({
          mcpServers: {
            demo: {
              command: process.execPath,
              args: [scriptPath]
            }
          }
        }),
        default_timeout_ms: 10_000
      });

      const byName = new Map(tools.map((t) => [t.name, t]));
      expect([...byName.keys()]).toEqual(["mcp.list_servers_and_tools", "mcp.call_tool", "mcp.read_resource"]);
      expect(byName.get("mcp.call_tool")?.resultTaint).toBe("untrusted_external");
      expect(byName.get("mcp.read_resource")?.resultTaint).toBe("untrusted_external");

      const signal = new AbortController().signal;
      const listed = await byName.get("mcp.list_servers_and_tools")!.execute(
        { kind: "tool", id: "m1", name: "mcp.list_servers_and_tools", input: {} },
        signal
      );
      expect(listed).toMatchObject({
        status: "verified",
        value: {
          servers: [
            {
              server: "demo",
              transport: "stdio",
              tools: [{ name: "echo_upper" }],
              resources: [{ uri: "memo://architecture" }]
            }
          ]
        }
      });

      const called = await byName.get("mcp.call_tool")!.execute(
        {
          kind: "tool",
          id: "m2",
          name: "mcp.call_tool",
          input: { server: "demo", tool: "echo_upper", arguments: { text: "hello mcp" } }
        },
        signal
      );
      expect(called).toMatchObject({
        status: "verified",
        value: {
          server: "demo",
          tool: "echo_upper",
          output: [{ type: "text", text: "HELLO MCP" }]
        }
      });

      const resource = await byName.get("mcp.read_resource")!.execute(
        {
          kind: "tool",
          id: "m3",
          name: "mcp.read_resource",
          input: { server: "demo", uri: "memo://architecture" }
        },
        signal
      );
      expect(resource).toEqual({
        status: "verified",
        value: {
          server: "demo",
          uri: "memo://architecture",
          content: "Orthogonal IoC MCP resource content"
        }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
