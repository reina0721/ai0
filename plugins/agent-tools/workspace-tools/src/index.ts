import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentToolDefinition, AgentValueSchema, Ai0ExtensionManifest } from "@ai0/protocol";
import {
  agentToolProviderFacet,
  consoleConfigSchemaFacet,
  defineExtensionPackage,
  perceptionSourceFacet
} from "@ai0/sdk";
import rawManifest from "../ai0.extension.json" with { type: "json" };
import {
  resolveConfiguredWorkspaceRoot,
  resolveSandboxedWorkspacePath,
  WorkspaceSandboxError
} from "./sandbox-path.js";

export { resolveConfiguredWorkspaceRoot, resolveSandboxedWorkspacePath, WorkspaceSandboxError };

export interface WorkspaceToolsConfig {
  readonly workspace_root?: string;
  readonly max_read_bytes?: number;
  readonly enable_write_edit?: boolean;
  readonly enable_command_execution?: boolean;
  readonly command_timeout_ms?: number;
  readonly watch_workspace_changes?: boolean;
}

const IGNORED_SEARCH_DIRS = new Set([".git", "node_modules", "dist", ".turbo", ".vite", "coverage"]);
const SENSITIVE_ENV_KEY = /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|VAULT|CREDENTIAL)/iu;

function zodValueSchema<T>(schema: z.ZodType<T>, jsonSchema: Readonly<Record<string, unknown>>): AgentValueSchema {
  return {
    jsonSchema,
    parse: (input: unknown) => schema.parse(input)
  };
}

const sha256Hex = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");

function atomicWriteUtf8(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, targetPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

const ReadFileInputSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional()
});
const ReadFileResultSchema = z.object({
  path: z.string(),
  totalLines: z.number().int().nonnegative(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  truncated: z.boolean(),
  sha256: z.string(),
  content: z.string()
});

const SearchFilesInputSchema = z.object({
  path: z.string().optional(),
  filePattern: z.string().optional(),
  contentQuery: z.string().optional(),
  maxResults: z.number().int().min(1).max(200).optional()
});
const SearchFilesResultSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive().optional(),
      preview: z.string().optional()
    })
  ),
  truncated: z.boolean()
});

const WriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});
const WriteFileResultSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().int().nonnegative(),
  sha256: z.string()
});

const EditFileInputSchema = z.object({
  path: z.string().min(1),
  target: z.string().min(1),
  replacement: z.string()
});
const EditFileResultSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  bytesWritten: z.number().int().nonnegative()
});

const RunCommandInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).optional()
});
const RunCommandResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  durationMs: z.number().nonnegative()
});

function sanitizeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !SENSITIVE_ENV_KEY.test(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

function terminateChildTree(pid: number | undefined, killChild: () => void): Promise<void> {
  if (process.platform === "win32" && pid !== undefined) {
    return new Promise((resolveDone) => {
      try {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
        killer.on("close", () => {
          try { killChild(); } catch { /* ignore */ }
          resolveDone();
        });
        killer.on("error", () => {
          try { killChild(); } catch { /* ignore */ }
          resolveDone();
        });
      } catch {
        try { killChild(); } catch { /* ignore */ }
        resolveDone();
      }
    });
  }
  try {
    killChild();
  } catch {
    // Ignore already exited child
  }
  return Promise.resolve();
}

export function createWorkspaceToolDefinitions(config: WorkspaceToolsConfig): AgentToolDefinition[] {
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config.workspace_root);
  if (!workspaceRoot) return [];

  const maxReadBytes = Math.max(1024, Math.min(1_048_576, Number(config.max_read_bytes ?? 65_536)));
  const enableWriteEdit = config.enable_write_edit !== false;
  const enableCommand = config.enable_command_execution === true;
  const defaultTimeoutMs = Math.max(500, Math.min(300_000, Number(config.command_timeout_ms ?? 15_000)));

  const tools: AgentToolDefinition[] = [
    {
      name: "workspace.read_file",
      description: "Read UTF-8 text from a file within the configured workspace with optional 1-based line range.",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(ReadFileInputSchema, {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 }
        },
        additionalProperties: false
      }),
      resultSchema: zodValueSchema(ReadFileResultSchema, {
        type: "object",
        required: ["path", "totalLines", "startLine", "endLine", "truncated", "sha256", "content"],
        properties: {
          path: { type: "string" },
          totalLines: { type: "integer" },
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          truncated: { type: "boolean" },
          sha256: { type: "string" },
          content: { type: "string" }
        }
      }),
      execute(call) {
        try {
          const input = ReadFileInputSchema.parse(call.input);
          const { absolutePath, relativePosixPath } = resolveSandboxedWorkspacePath(workspaceRoot, input.path);
          if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
            return { status: "failed", error: `File not found: ${relativePosixPath}` };
          }
          const buffer = readFileSync(absolutePath);
          const digest = sha256Hex(buffer);
          const rawText = buffer.toString("utf8");
          const allLines = rawText.split(/\r?\n/u);
          const start = Math.min(allLines.length, Math.max(1, input.startLine ?? 1));
          const end = Math.min(allLines.length, Math.max(start, input.endLine ?? allLines.length));
          const numbered = allLines
            .slice(start - 1, end)
            .map((line, idx) => `${start + idx}: ${line}`)
            .join("\n");
          const truncated = Buffer.byteLength(numbered, "utf8") > maxReadBytes;
          const content = truncated ? Buffer.from(numbered, "utf8").subarray(0, maxReadBytes).toString("utf8") : numbered;
          return {
            status: "verified",
            value: {
              path: relativePosixPath,
              totalLines: allLines.length,
              startLine: allLines.length === 0 ? 0 : start,
              endLine: allLines.length === 0 ? 0 : end,
              truncated,
              sha256: digest,
              content
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "workspace.search_files",
      description: "Search file names and optional text/regex matches inside the configured workspace.",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(SearchFilesInputSchema, {
        type: "object",
        properties: {
          path: { type: "string" },
          filePattern: { type: "string" },
          contentQuery: { type: "string" },
          maxResults: { type: "integer", minimum: 1, maximum: 200 }
        },
        additionalProperties: false
      }),
      resultSchema: zodValueSchema(SearchFilesResultSchema, {
        type: "object",
        required: ["matches", "truncated"],
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              required: ["path"],
              properties: {
                path: { type: "string" },
                line: { type: "integer" },
                preview: { type: "string" }
              }
            }
          },
          truncated: { type: "boolean" }
        }
      }),
      execute(call) {
        try {
          const input = SearchFilesInputSchema.parse(call.input ?? {});
          const startTarget = resolveSandboxedWorkspacePath(workspaceRoot, input.path ?? ".", true);
          const maxResults = input.maxResults ?? 50;
          const nameFilter = input.filePattern ? new RegExp(input.filePattern, "iu") : undefined;
          const contentFilter = input.contentQuery ? new RegExp(input.contentQuery, "u") : undefined;
          const matches: Array<{ path: string; line?: number; preview?: string }> = [];
          let truncated = false;

          const walk = (dir: string) => {
            if (truncated) return;
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              if (truncated) return;
              if (IGNORED_SEARCH_DIRS.has(entry.name)) continue;
              const full = join(dir, entry.name);
              let resolved;
              try {
                resolved = resolveSandboxedWorkspacePath(workspaceRoot, full, entry.isDirectory());
              } catch {
                continue;
              }
              if (entry.isDirectory()) {
                walk(resolved.absolutePath);
                continue;
              }
              if (!entry.isFile()) continue;
              if (nameFilter && !nameFilter.test(resolved.relativePosixPath)) continue;
              if (!contentFilter) {
                matches.push({ path: resolved.relativePosixPath });
                if (matches.length >= maxResults) truncated = true;
                continue;
              }
              const stat = statSync(resolved.absolutePath);
              if (stat.size > maxReadBytes * 4) continue;
              const lines = readFileSync(resolved.absolutePath, "utf8").split(/\r?\n/u);
              for (let i = 0; i < lines.length; i += 1) {
                if (contentFilter.test(lines[i]!)) {
                  matches.push({
                    path: resolved.relativePosixPath,
                    line: i + 1,
                    preview: lines[i]!.slice(0, 200)
                  });
                  if (matches.length >= maxResults) {
                    truncated = true;
                    break;
                  }
                }
              }
            }
          };

          if (existsSync(startTarget.absolutePath)) {
            if (statSync(startTarget.absolutePath).isDirectory()) {
              walk(startTarget.absolutePath);
            } else if (contentFilter) {
              const lines = readFileSync(startTarget.absolutePath, "utf8").split(/\r?\n/u);
              lines.forEach((line, idx) => {
                if (!truncated && contentFilter.test(line)) {
                  matches.push({ path: startTarget.relativePosixPath, line: idx + 1, preview: line.slice(0, 200) });
                  if (matches.length >= maxResults) truncated = true;
                }
              });
            } else {
              matches.push({ path: startTarget.relativePosixPath });
            }
          }
          return { status: "verified", value: { matches, truncated } };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    }
  ];

  if (enableWriteEdit) {
    tools.push(
      {
        name: "workspace.write_file",
        description: "Atomically create or overwrite a UTF-8 file inside the configured workspace.",
        capabilityRisk: "low_read_and_scoped_write",
        inputSchema: zodValueSchema(WriteFileInputSchema, {
          type: "object",
          required: ["path", "content"],
          properties: { path: { type: "string" }, content: { type: "string" } },
          additionalProperties: false
        }),
        resultSchema: zodValueSchema(WriteFileResultSchema, {
          type: "object",
          required: ["path", "bytesWritten", "sha256"],
          properties: {
            path: { type: "string" },
            bytesWritten: { type: "integer" },
            sha256: { type: "string" }
          }
        }),
        execute(call) {
          try {
            const input = WriteFileInputSchema.parse(call.input);
            const { absolutePath, relativePosixPath } = resolveSandboxedWorkspacePath(workspaceRoot, input.path);
            atomicWriteUtf8(absolutePath, input.content);
            const verifyBuf = readFileSync(absolutePath);
            const expectedSha = sha256Hex(input.content);
            const actualSha = sha256Hex(verifyBuf);
            if (actualSha !== expectedSha) {
              return { status: "failed", error: "Post-write integrity verification mismatch" };
            }
            return {
              status: "verified",
              value: { path: relativePosixPath, bytesWritten: verifyBuf.byteLength, sha256: actualSha }
            };
          } catch (error) {
            return { status: "failed", error: error instanceof Error ? error.message : String(error) };
          }
        },
        project: (value) => value
      },
      {
        name: "workspace.edit_file",
        description: "Replace a single exact target text block in an existing workspace file without clobbering unrelated lines.",
        capabilityRisk: "low_read_and_scoped_write",
        inputSchema: zodValueSchema(EditFileInputSchema, {
          type: "object",
          required: ["path", "target", "replacement"],
          properties: {
            path: { type: "string" },
            target: { type: "string" },
            replacement: { type: "string" }
          },
          additionalProperties: false
        }),
        resultSchema: zodValueSchema(EditFileResultSchema, {
          type: "object",
          required: ["path", "sha256", "bytesWritten"],
          properties: {
            path: { type: "string" },
            sha256: { type: "string" },
            bytesWritten: { type: "integer" }
          }
        }),
        execute(call) {
          try {
            const input = EditFileInputSchema.parse(call.input);
            const { absolutePath, relativePosixPath } = resolveSandboxedWorkspacePath(workspaceRoot, input.path);
            if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
              return { status: "failed", error: `File not found: ${relativePosixPath}` };
            }
            const original = readFileSync(absolutePath, "utf8");
            const firstIdx = original.indexOf(input.target);
            if (firstIdx === -1) {
              return { status: "failed", error: `Target snippet not found in ${relativePosixPath}` };
            }
            if (original.indexOf(input.target, firstIdx + input.target.length) !== -1) {
              return { status: "failed", error: `Target snippet appears multiple times in ${relativePosixPath}; include more context` };
            }
            const updated = original.slice(0, firstIdx) + input.replacement + original.slice(firstIdx + input.target.length);
            atomicWriteUtf8(absolutePath, updated);
            const verifyBuf = readFileSync(absolutePath);
            const actualSha = sha256Hex(verifyBuf);
            if (actualSha !== sha256Hex(updated)) {
              return { status: "failed", error: "Post-edit integrity verification mismatch" };
            }
            return {
              status: "verified",
              value: { path: relativePosixPath, sha256: actualSha, bytesWritten: verifyBuf.byteLength }
            };
          } catch (error) {
            return { status: "failed", error: error instanceof Error ? error.message : String(error) };
          }
        },
        project: (value) => value
      }
    );
  }

  if (enableCommand) {
    tools.push({
      name: "workspace.run_command",
      description: "Execute a shell command inside the configured workspace with scrubbed environment, timeout, and cancellation.",
      capabilityRisk: "high_side_effect_privileged",
      inputSchema: zodValueSchema(RunCommandInputSchema, {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "integer", minimum: 100, maximum: 300000 }
        },
        additionalProperties: false
      }),
      resultSchema: zodValueSchema(RunCommandResultSchema, {
        type: "object",
        required: ["exitCode", "stdout", "stderr", "timedOut", "durationMs"],
        properties: {
          exitCode: { type: ["integer", "null"] },
          stdout: { type: "string" },
          stderr: { type: "string" },
          timedOut: { type: "boolean" },
          durationMs: { type: "number" }
        }
      }),
      execute(call, signal) {
        return new Promise((resolvePromise, rejectPromise) => {
          let cwdPath = workspaceRoot;
          let parsedInput: z.infer<typeof RunCommandInputSchema>;
          try {
            parsedInput = RunCommandInputSchema.parse(call.input);
            if (parsedInput.cwd) {
              cwdPath = resolveSandboxedWorkspacePath(workspaceRoot, parsedInput.cwd, true).absolutePath;
            }
          } catch (error) {
            resolvePromise({ status: "failed", error: error instanceof Error ? error.message : String(error) });
            return;
          }
          if (signal.aborted) {
            rejectPromise(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }

          const startedAt = Date.now();
          const timeoutMs = Math.min(defaultTimeoutMs, parsedInput.timeoutMs ?? defaultTimeoutMs);
          const maxCapture = 32_768;
          let stdout = "";
          let stderr = "";
          let timedOut = false;
          let settled = false;

          const child = spawn(parsedInput.command, {
            cwd: cwdPath,
            shell: true,
            windowsHide: true,
            env: sanitizeEnvironment(process.env)
          });

          let aborted = false;
          let killDone: Promise<void> = Promise.resolve();
          const finishAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void killDone.finally(() => {
              rejectPromise(signal.reason ?? new DOMException("Command aborted", "AbortError"));
            });
          };

          const onAbort = () => {
            if (settled || aborted) return;
            aborted = true;
            clearTimeout(timer);
            killDone = terminateChildTree(child.pid, () => child.kill("SIGTERM"));
            void killDone.then(() => setTimeout(finishAbort, 50).unref());
          };
          signal.addEventListener("abort", onAbort, { once: true });

          const timer = setTimeout(() => {
            timedOut = true;
            killDone = terminateChildTree(child.pid, () => child.kill("SIGTERM"));
          }, timeoutMs);

          child.stdout?.on("data", (chunk: Buffer) => {
            if (stdout.length < maxCapture) {
              stdout += chunk.toString("utf8").slice(0, maxCapture - stdout.length);
            }
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            if (stderr.length < maxCapture) {
              stderr += chunk.toString("utf8").slice(0, maxCapture - stderr.length);
            }
          });

          child.on("error", (err) => {
            if (aborted) {
              finishAbort();
              return;
            }
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            resolvePromise({ status: "failed", error: err.message });
          });

          child.on("close", (code) => {
            if (aborted) {
              finishAbort();
              return;
            }
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            const durationMs = Math.max(0, Date.now() - startedAt);
            if (timedOut) {
              resolvePromise({ status: "failed", error: `Command timed out after ${timeoutMs}ms` });
              return;
            }
            if (code !== 0) {
              resolvePromise({
                status: "failed",
                error: (stderr.trim() || stdout.trim() || `Command exited with code ${String(code)}`).slice(0, 500)
              });
              return;
            }
            resolvePromise({
              status: "verified",
              value: { exitCode: code, stdout, stderr, timedOut: false, durationMs }
            });
          });
        });
      },
      project: (value) => value
    });
  }

  return tools;
}

const typedManifest = rawManifest as unknown as Omit<Ai0ExtensionManifest, "manifest_version">;

export const workspaceToolsPackage = defineExtensionPackage({
  manifest: typedManifest,
  activate(scope, rawConfig) {
    const config = (rawConfig ?? {}) as WorkspaceToolsConfig;
    scope.contributeFacet(consoleConfigSchemaFacet, {
      fields: typedManifest.console_contributions?.config_fields ?? []
    });

    const tools = createWorkspaceToolDefinitions(config);
    if (tools.length > 0) {
      scope.contributeFacet(agentToolProviderFacet, { tools });
    }

    const workspaceRoot = resolveConfiguredWorkspaceRoot(config.workspace_root);
    if (workspaceRoot && config.watch_workspace_changes === true) {
      scope.contributeFacet(perceptionSourceFacet, {
        sourceKey: "workspace.fs_watch",
        async subscribe(emit, signal) {
          const pending = new Set<string>();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const flush = () => {
            timer = undefined;
            if (!pending.size || signal.aborted) return;
            const summary = [...pending].sort().slice(0, 20).join(", ");
            pending.clear();
            emit(`[workspace.fs_watch] files changed: ${summary}`);
          };
          const watcher = watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
            if (!filename || signal.aborted) return;
            const normalized = filename.split("\\").join("/");
            if (
              normalized.endsWith(".tmp") ||
              normalized.split("/").some((part) => IGNORED_SEARCH_DIRS.has(part))
            ) {
              return;
            }
            try {
              const safe = resolveSandboxedWorkspacePath(workspaceRoot, normalized);
              pending.add(safe.relativePosixPath);
              if (!timer) timer = setTimeout(flush, 120);
            } catch {
              // Ignore sensitive or escaped paths
            }
          });
          const close = () => {
            if (timer) clearTimeout(timer);
            pending.clear();
            watcher.close();
          };
          signal.addEventListener("abort", close, { once: true });
          return close;
        }
      });
    }
  }
});

export default workspaceToolsPackage;
