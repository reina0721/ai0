import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentToolProviderFacet, ExtensionCoreHost, perceptionSourceFacet } from "@ai0/sdk";
import workspaceToolsPackage, { createWorkspaceToolDefinitions } from "./index.js";

describe("builtin.workspace-tools polymorphic workspace plugin", () => {
  it("stays fail-closed when workspace_root is unset and blocks path traversal and sensitive files", () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(workspaceToolsPackage);
    expect(host.listFacets(agentToolProviderFacet)).toHaveLength(0);
    expect(host.listFacets(perceptionSourceFacet)).toHaveLength(0);

    const dir = mkdtempSync(join(tmpdir(), "ai0-ws-sandbox-"));
    try {
      writeFileSync(join(dir, ".env"), "OPENAI_API_KEY=secret");
      mkdirSync(join(dir, "souls", "host", "vault"), { recursive: true });
      writeFileSync(join(dir, "souls", "host", "vault", "keys.json"), "{}");

      const tools = createWorkspaceToolDefinitions({ workspace_root: dir, enable_write_edit: true });
      const readTool = tools.find((t) => t.name === "workspace.read_file")!;
      const writeTool = tools.find((t) => t.name === "workspace.write_file")!;

      expect(
        readTool.execute({ kind: "tool", id: "1", name: readTool.name, input: { path: "../outside.txt" } }, new AbortController().signal)
      ).toMatchObject({ status: "failed", error: expect.stringContaining("escapes workspace root") });

      expect(
        readTool.execute({ kind: "tool", id: "2", name: readTool.name, input: { path: ".env" } }, new AbortController().signal)
      ).toMatchObject({ status: "failed", error: expect.stringContaining("sensitive path") });

      expect(
        writeTool.execute(
          { kind: "tool", id: "3", name: writeTool.name, input: { path: "souls/host/vault/pwn.json", content: "{}" } },
          new AbortController().signal
        )
      ).toMatchObject({ status: "failed", error: expect.stringContaining("sensitive path") });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes verified read, search, write, surgical edit, scrubbed run_command, and cancellation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai0-ws-ops-"));
    const prevSecret = process.env.AI0_TEST_SECRET_API_KEY;
    process.env.AI0_TEST_SECRET_API_KEY = "super_secret_do_not_leak";
    try {
      const tools = createWorkspaceToolDefinitions({
        workspace_root: dir,
        enable_write_edit: true,
        enable_command_execution: true,
        command_timeout_ms: 10_000
      });
      const byName = new Map(tools.map((t) => [t.name, t]));
      const signal = new AbortController().signal;

      const written = await byName.get("workspace.write_file")!.execute(
        {
          kind: "tool",
          id: "w1",
          name: "workspace.write_file",
          input: { path: "src/hello.ts", content: "export const greeting = 'hello';\nexport const version = 1;\n" }
        },
        signal
      );
      expect(written).toMatchObject({ status: "verified", value: { path: "src/hello.ts" } });

      const edited = await byName.get("workspace.edit_file")!.execute(
        {
          kind: "tool",
          id: "e1",
          name: "workspace.edit_file",
          input: {
            path: "src/hello.ts",
            target: "export const version = 1;",
            replacement: "export const version = 2;"
          }
        },
        signal
      );
      expect(edited.status).toBe("verified");

      const readBack = await byName.get("workspace.read_file")!.execute(
        { kind: "tool", id: "r1", name: "workspace.read_file", input: { path: "src/hello.ts", startLine: 1, endLine: 2 } },
        signal
      );
      expect(readBack).toMatchObject({
        status: "verified",
        value: { content: "1: export const greeting = 'hello';\n2: export const version = 2;" }
      });

      const searched = await byName.get("workspace.search_files")!.execute(
        { kind: "tool", id: "s1", name: "workspace.search_files", input: { contentQuery: "version = 2" } },
        signal
      );
      expect(searched).toMatchObject({
        status: "verified",
        value: { matches: [{ path: "src/hello.ts", line: 2 }] }
      });

      // Verify run_command scrubs sensitive API_KEY env vars
      const cmdRes = await byName.get("workspace.run_command")!.execute(
        {
          kind: "tool",
          id: "c1",
          name: "workspace.run_command",
          input: { command: 'node -e "process.stdout.write(String(process.env.AI0_TEST_SECRET_API_KEY ?? \'SCRUBBED\'))"' }
        },
        signal
      );
      expect(cmdRes).toMatchObject({
        status: "verified",
        value: { exitCode: 0, stdout: "SCRUBBED" }
      });

      // Verify AbortSignal kills a sleeping subprocess promptly
      const abortController = new AbortController();
      setTimeout(() => abortController.abort(new DOMException("User barge-in stop", "AbortError")), 150);
      await expect(
        byName.get("workspace.run_command")!.execute(
          {
            kind: "tool",
            id: "c2",
            name: "workspace.run_command",
            input: { command: 'node -e "setTimeout(() => {}, 30000)"' }
          },
          abortController.signal
        )
      ).rejects.toThrow();
    } finally {
      if (prevSecret === undefined) delete process.env.AI0_TEST_SECRET_API_KEY;
      else process.env.AI0_TEST_SECRET_API_KEY = prevSecret;
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
