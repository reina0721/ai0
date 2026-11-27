import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UpstreamModelClient, type LlmProviderConfig } from "@ai0/agent-core";
import { createUniversalAgent, type ComposedAgentRuntime } from "@ai0/agent-runtime";
import type { AgentModelAdapter } from "@ai0/protocol";
import { discoverAndMountExtensions, ExtensionCoreHost } from "@ai0/sdk";
import {
  getHostInfrastructureFilePath,
  readHostInfrastructureConfig,
  resolveEffectiveSourceApiKeys,
  resolveHostDefaultChatBinding
} from "@ai0/storage";

export interface StandaloneCliArgs {
  readonly workspace: string;
  readonly prompt?: string;
  readonly allowCommand: boolean;
  readonly readOnly: boolean;
  readonly enableWeb: boolean;
  readonly sandbox: boolean;
  readonly skillsDir?: string;
  readonly preactivatedSkills: readonly string[];
  readonly mcpConfigPath?: string;
  readonly searchUrl?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly provider?: "openai-compatible" | "anthropic" | "ollama";
}

export function parseAgentCliArgs(argv: readonly string[], cwd = process.cwd()): StandaloneCliArgs {
  let workspace = cwd;
  let prompt: string | undefined;
  let allowCommand = false;
  let readOnly = false;
  let enableWeb = false;
  let sandbox = false;
  let skillsDir: string | undefined;
  const preactivatedSkills: string[] = [];
  let mcpConfigPath: string | undefined;
  let searchUrl: string | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;
  let provider: StandaloneCliArgs["provider"];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--workspace" && argv[i + 1]) {
      workspace = resolve(cwd, argv[++i]!);
    } else if (arg.startsWith("--workspace=")) {
      workspace = resolve(cwd, arg.slice("--workspace=".length));
    } else if (arg === "--prompt" && argv[i + 1]) {
      prompt = argv[++i]!;
    } else if (arg.startsWith("--prompt=")) {
      prompt = arg.slice("--prompt=".length);
    } else if (arg === "--skills-dir" && argv[i + 1]) {
      skillsDir = resolve(cwd, argv[++i]!);
    } else if (arg.startsWith("--skills-dir=")) {
      skillsDir = resolve(cwd, arg.slice("--skills-dir=".length));
    } else if (arg === "--skill" && argv[i + 1]) {
      preactivatedSkills.push(argv[++i]!.trim());
    } else if (arg.startsWith("--skill=")) {
      preactivatedSkills.push(arg.slice("--skill=".length).trim());
    } else if (arg === "--mcp-config" && argv[i + 1]) {
      mcpConfigPath = resolve(cwd, argv[++i]!);
    } else if (arg.startsWith("--mcp-config=")) {
      mcpConfigPath = resolve(cwd, arg.slice("--mcp-config=".length));
    } else if (arg === "--search-url" && argv[i + 1]) {
      searchUrl = argv[++i]!.trim();
    } else if (arg.startsWith("--search-url=")) {
      searchUrl = arg.slice("--search-url=".length).trim();
    } else if (arg === "--model" && argv[i + 1]) {
      model = argv[++i]!;
    } else if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
    } else if (arg === "--base-url" && argv[i + 1]) {
      baseUrl = argv[++i]!;
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--provider" && argv[i + 1]) {
      const val = argv[++i]!;
      if (val === "openai-compatible" || val === "anthropic" || val === "ollama") provider = val;
    } else if (arg === "--allow-command") {
      allowCommand = true;
    } else if (arg === "--read-only") {
      readOnly = true;
    } else if (arg === "--enable-web") {
      enableWeb = true;
    } else if (arg === "--sandbox") {
      sandbox = true;
    }
  }

  return {
    workspace,
    ...(prompt !== undefined ? { prompt } : {}),
    allowCommand,
    readOnly,
    enableWeb,
    sandbox,
    ...(skillsDir ? { skillsDir } : {}),
    preactivatedSkills: preactivatedSkills.filter(Boolean),
    ...(mcpConfigPath ? { mcpConfigPath } : {}),
    ...(searchUrl ? { searchUrl } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(provider ? { provider } : {})
  };
}

function createSandboxFallbackAdapter(): AgentModelAdapter {
  return {
    capabilities: { tools: true, structuredOutput: true },
    async *model({ tools, rounds, messages, prompt }) {
      const listTool = tools.find((t) => t.name === "workspace.list_directory");
      if (rounds.length === 0 && listTool) {
        yield { kind: "tool", id: "cli_sandbox_ls", name: listTool.name, input: { maxDepth: 2 } };
        yield { kind: "finish" };
        return;
      }
      const listed = rounds[0]?.receipts[0]?.result;
      let userPrompt = "";
      for (const m of messages) {
        if (m.role === "user" && "content" in m && typeof m.content === "string") {
          userPrompt = m.content;
        }
      }
      const hasManual = prompt.observations.some((obs) => obs.content.includes("SOP") || obs.content.length > 0);
      const summary =
        listed && listed.status === "verified"
          ? `[Sandbox CLI Agent] Prompt="${userPrompt}" | SkillManualBound=${String(hasManual)} | Workspace entries=${JSON.stringify(listed.value)}`
          : `[Sandbox CLI Agent] Prompt="${userPrompt}" | SkillManualBound=${String(hasManual)}`;
      yield { kind: "delta", text: summary };
      yield { kind: "finish" };
    }
  };
}

function resolveCliModelAdapter(args: StandaloneCliArgs): AgentModelAdapter {
  if (args.sandbox) {
    return createSandboxFallbackAdapter();
  }

  const envApiKey =
    process.env.AI0_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim();
  const envProvider: StandaloneCliArgs["provider"] =
    args.provider ??
    (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.AI0_API_KEY
      ? "anthropic"
      : undefined);

  if (envApiKey || args.provider === "ollama") {
    const modelId =
      args.model ??
      process.env.AI0_MODEL?.trim() ??
      (envProvider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini");
    const cfg: LlmProviderConfig = {
      provider: envProvider ?? "openai-compatible",
      ...(args.baseUrl ?? process.env.AI0_BASE_URL ? { baseUrl: args.baseUrl ?? process.env.AI0_BASE_URL } : {}),
      ...(envApiKey ? { apiKey: envApiKey } : {}),
      model: modelId
    };
    return new UpstreamModelClient(cfg).asModelAdapter(modelId);
  }

  // Strictly read-only lookup against host infrastructure (never creates or mutates souls/host/*).
  try {
    const hostDir = join(resolve(process.cwd(), "souls"), "host");
    if (existsSync(getHostInfrastructureFilePath(hostDir))) {
      const infra = readHostInfrastructureConfig(hostDir);
      const defaultBinding = resolveHostDefaultChatBinding(infra);
      if (defaultBinding) {
        const source = infra.providerSources.find((s) => s.id === defaultBinding.providerId && s.enabled);
        const keys = source ? resolveEffectiveSourceApiKeys(hostDir, source) : [];
        const modelId = args.model ?? defaultBinding.modelId;
        if (source && modelId && (keys.length > 0 || source.adapterType === "ollama")) {
          const cfg: LlmProviderConfig = {
            provider:
              source.adapterType === "anthropic"
                ? "anthropic"
                : source.adapterType === "ollama"
                  ? "ollama"
                  : "openai-compatible",
            adapterType: source.adapterType,
            sourceId: source.id,
            baseUrl: args.baseUrl ?? source.baseUrl,
            apiKey: keys[0],
            apiKeys: keys,
            keyRotationStrategy: source.keyRotationStrategy,
            customHeaders: source.customHeaders,
            timeoutMs: source.timeoutMs,
            model: modelId
          };
          return new UpstreamModelClient(cfg).asModelAdapter(modelId);
        }
      }
    }
  } catch {
    // Fall through to explicit configuration error below.
  }

  throw new Error(
    "No LLM provider configured. Set AI0_API_KEY / OPENAI_API_KEY, configure a host provider, or pass --sandbox for deterministic local verification."
  );
}

export async function createStandaloneCliAgent(
  args: StandaloneCliArgs,
  options: { adapter?: AgentModelAdapter; agentToolsDir?: string; builtinSkillsDir?: string } = {}
): Promise<{ runtime: ComposedAgentRuntime; host: ExtensionCoreHost }> {
  const host = new ExtensionCoreHost();
  const defaultAgentToolsDir =
    options.agentToolsDir ?? resolve(fileURLToPath(new URL("../../../plugins/agent-tools", import.meta.url)));
  const defaultBuiltinSkillsDir =
    options.builtinSkillsDir ?? resolve(fileURLToPath(new URL("../../../plugins/skills-and-mcp", import.meta.url)));

  const mcpServersJson = args.mcpConfigPath ? readFileSync(args.mcpConfigPath, "utf8") : "";
  const skillDirs = [defaultBuiltinSkillsDir, ...(args.skillsDir ? [args.skillsDir] : [])];

  await discoverAndMountExtensions(host, {
    pluginDirs: [defaultAgentToolsDir],
    skillDirs,
    configByPackageId: {
      "builtin.workspace-tools": {
        workspace_root: args.workspace,
        enable_write_edit: !args.readOnly,
        enable_command_execution: args.allowCommand
      },
      ...(args.searchUrl
        ? {
            "builtin.web-tools": {
              search_provider: "searxng",
              search_endpoint_url: args.searchUrl
            }
          }
        : {}),
      ...(mcpServersJson
        ? {
            "builtin.mcp-bridge": {
              mcp_servers_json: mcpServersJson
            }
          }
        : {})
    }
  });

  if (host.getPackage("builtin.workspace-tools")) {
    host.setPackageEnabled("builtin.workspace-tools", true);
  }
  if ((args.enableWeb || Boolean(args.searchUrl)) && host.getPackage("builtin.web-tools")) {
    host.setPackageEnabled("builtin.web-tools", true);
  }
  if (mcpServersJson && host.getPackage("builtin.mcp-bridge")) {
    host.setPackageEnabled("builtin.mcp-bridge", true);
  }

  const adapter = options.adapter ?? resolveCliModelAdapter(args);
  const runtime = createUniversalAgent({
    host,
    adapter,
    toolRoutingMode: "direct_inline",
    enableIntrinsicTools: true,
    highRiskOwnerApproved: args.allowCommand,
    bypassPerception: true,
    bypassExpression: true
  });

  for (const skillId of args.preactivatedSkills) {
    runtime.activateSkill(skillId);
  }

  return { runtime, host };
}

export async function runAgentCli(
  argv: readonly string[],
  io: { writeOut(text: string): void; writeErr(text: string): void } = {
    writeOut: (t) => process.stdout.write(t),
    writeErr: (t) => process.stderr.write(t)
  }
): Promise<number> {
  const args = parseAgentCliArgs(argv);
  const { runtime } = await createStandaloneCliAgent(args);

  let activeTurnAbort: AbortController | null = null;
  const onSigint = () => {
    if (activeTurnAbort && !activeTurnAbort.signal.aborted) {
      activeTurnAbort.abort(new DOMException("Interrupted by Ctrl+C", "AbortError"));
      io.writeErr("\n[Cancelled active turn]\n");
    } else {
      runtime.stop();
      process.exit(130);
    }
  };

  if (args.prompt !== undefined) {
    activeTurnAbort = new AbortController();
    process.once("SIGINT", onSigint);
    try {
      const report = await runtime.ingest({ text: args.prompt }, activeTurnAbort.signal);
      const reply = report.cycles.at(-1)?.delivery.text ?? "";
      io.writeOut(`${reply}\n`);
      return 0;
    } finally {
      process.removeListener("SIGINT", onSigint);
      runtime.stop();
    }
  }

  process.on("SIGINT", onSigint);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  io.writeOut(`ai0 standalone agent ready (workspace: ${args.workspace}). Type 'exit' to quit.\n`);
  try {
    while (true) {
      const line = (await rl.question("agent> ")).trim();
      if (!line) continue;
      if (line === "exit" || line === "quit") break;
      activeTurnAbort = new AbortController();
      try {
        const report = await runtime.ingest({ text: line }, activeTurnAbort.signal);
        const reply = report.cycles.at(-1)?.delivery.text ?? "";
        io.writeOut(`${reply}\n`);
      } catch (error) {
        if (activeTurnAbort.signal.aborted) continue;
        io.writeErr(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        activeTurnAbort = null;
      }
    }
    return 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
    runtime.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAgentCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
