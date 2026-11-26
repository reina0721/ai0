import { randomUUID } from "node:crypto";
import { abortable } from "./abortable.js";
import {
  AgentToolCallSchema, AgentToolResultSchema, type AgentModelAdapter, type AgentModelEvent, type AudienceScope,
  type AgentOutputProfile, type AgentPromptInput, type AgentRound, type AgentStepManifest,
  type AgentToolCall, type AgentToolDefinition, type AgentToolResult, type AgentTurnReport, type PreparedAgentRequest
} from "@ai0/protocol";
import { ContextAssemblyCompiler, selectAgentModel, type AgentBindings, type BoundTool } from "./request-assembly.js";
export { ContextAssemblyCompiler, type ContextAssemblyManifest } from "./request-assembly.js";

export { projectPromptInputs } from "./request-assembly.js";
export type { AgentBindings } from "./request-assembly.js";
export type ModelEvent = AgentModelEvent;
export type AgentDriver = (output: {
  step: number; text: string; calls: readonly AgentToolCall[]; rounds: readonly AgentRound[]; signal: AbortSignal
}) => "finish" | "execute_tools" | "continue";
export const singleStepDriver: AgentDriver = () => "finish";
export const toolLoopDriver: AgentDriver = ({ calls }) => calls.length ? "execute_tools" : "finish";
export interface AgentOptions {
  inputs: readonly AgentPromptInput[];
  projections?: AgentStepManifest["projections"];
  signal: AbortSignal;
  model?: AgentModelAdapter["model"];
  adapter?: AgentModelAdapter;
  modelId?: string;
  bindings?: AgentBindings;
  profile?: AgentOutputProfile;
  driver?: AgentDriver;
  /** Legacy callback mode. Bound runs dispatch only tools advertised for the step. */
  executeTool?: (call: AgentToolCall, signal: AbortSignal) => Promise<AgentToolResult>;
  contextBudgetChars?: number;
  runId?: string;
  onStep?: (manifest: AgentStepManifest) => void;
  wrapFetch?: (request: PreparedAgentRequest, provider: string, send?: typeof fetch) => typeof fetch;
  onDelta?: (text: string) => void;
  goalRequiresVerification?: boolean;
  verifyGoal?: (rounds: readonly AgentRound[], signal: AbortSignal) => boolean | Promise<boolean>;
  maxSteps?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}
export interface AgentRunResult extends AgentTurnReport {
  steps: AgentStepManifest[];
  output?: unknown;
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function isTransient(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error || "statusCode" in error)) return false;
  const status = "status" in error ? error.status : error.statusCode;
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500 && status < 600);
}
async function readRound(options: AgentOptions, model: ReturnType<typeof selectAgentModel>, request: PreparedAgentRequest,
  retry: { remaining: number; irreversible: boolean }, canSend: () => boolean, signal: AbortSignal) {
  const requireModel = () => {
    signal.throwIfAborted();
    if (!model.live()) throw new Error("Selected model adapter is no longer available");
  };
  const requireRequest = () => {
    requireModel();
    if (!canSend()) throw new Error("Assembled request grants expired before sending");
  };
  for (;;) {
    let iterator: AsyncIterator<ModelEvent> | undefined;
    let ended = false;
    let text = "";
    const calls: AgentToolCall[] = [];
    try {
      requireRequest();
      const prepared: PreparedAgentRequest = { ...structuredClone({ ...request, signal: undefined }), signal };
      if (options.wrapFetch) prepared.wrapFetch = (provider, send) => {
        const transport = options.wrapFetch!(request, provider, send);
        return (input, init) => {
          requireRequest();
          if (options.bindings?.modelPackageId && !options.bindings.host.allowsNetworkAccess(options.bindings.modelPackageId))
            throw new Error("Model adapter network access denied");
          const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          return transport(input, { ...init, signal: upstream ? AbortSignal.any([signal, upstream]) : signal });
        };
      };
      iterator = model.adapter.model(prepared)[Symbol.asyncIterator]();
      const stream = iterator;
      let started = false;
      for (;;) {
        const event = await abortable(() => {
          if (!started) requireRequest();
          started = true;
          return stream.next();
        }, signal);
        requireModel();
        if (event.done) { ended = true; return { text, calls }; }
        const value = event.value;
        switch (value.kind) {
          case "finish": return { text, calls };
          case "cancelled": throw new DOMException(value.reason ?? "Model cancelled", "AbortError");
          case "error": throw Object.assign(new Error(value.message), { status: value.status });
          case "tool": {
            const call = AgentToolCallSchema.parse(value);
            if (calls.some(other => other.id === call.id)) throw new Error("Duplicate model tool call ID");
            calls.push(call);
            break;
          }
          case "delta":
            text += value.text;
            retry.irreversible = true;
            options.onDelta?.(value.text);
            break;
          default: throw new TypeError("Unknown model stream event");
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (retry.irreversible || retry.remaining === 0 || !isTransient(error)) throw error;
      retry.remaining--;
    } finally {
      if (!ended && iterator?.return) {
        const close = iterator.return.bind(iterator);
        void Promise.resolve().then(close).catch(() => undefined);
      }
    }
    await wait(options.retryDelayMs ?? 10, signal);
  }
}
function sameReceipt(result: AgentToolResult) { return { canonical: result, projected: result }; }
function failure(error: unknown) { return sameReceipt({ status: "failed", error: error instanceof Error ? error.message : String(error) }); }
const unknownOutcome = () => sameReceipt({ status: "unverified", value: { execution: "unknown" } });
async function dispatchTool(call: AgentToolCall, bound: BoundTool | undefined, options: AgentOptions) {
  const { bindings, signal } = options;
  if (!bindings) {
    if (!options.executeTool) return failure("Tool unavailable");
    try { return sameReceipt(AgentToolResultSchema.parse(await abortable(() => options.executeTool!(call, signal), signal))); }
    catch (error) { signal.throwIfAborted(); return failure(error); }
  }
  if (!bound) return failure("Tool was not advertised for this step");
  const lease = bindings.host.leaseFacet(bound.entry);
  try {
    return await invokeBoundTool(call, bound.definition, bound.live, AbortSignal.any([signal, lease.signal]), signal, bindings.audience);
  } finally { lease.dispose(); }
}

async function invokeBoundTool(call: AgentToolCall, definition: AgentToolDefinition, live: () => boolean,
  combined: AbortSignal, signal: AbortSignal, audience: AudienceScope = "only_owner") {
  if (!live() || call.name !== definition.name) return failure("Tool permission or generation expired");
  let started = false;
  try {
    const input = definition.inputSchema.parse(structuredClone(call.input));
    const raw = await abortable(() => {
      if (!live()) throw new Error("Tool permission or generation expired");
      started = true;
      return definition.execute({ ...call, input }, combined, { audience });
    }, combined);
    if (!live()) return unknownOutcome();
    const result = AgentToolResultSchema.parse(raw);
    if (result.status === "failed") return sameReceipt(result);
    const value = structuredClone(definition.resultSchema.parse(result.value));
    if (!live()) return unknownOutcome();
    const canonical: AgentToolResult = { status: result.status, value };
    try {
      const material = definition.project(structuredClone(value));
      if (!live()) throw new Error("Tool no longer visible");
      const projected: AgentToolResult = { status: result.status, value: JSON.parse(JSON.stringify(material)) };
      return { canonical, projected };
    } catch {
      return { canonical, projected: { status: "unverified" as const, value: { execution: "returned", projection: "unavailable" } } };
    }
  } catch (error) {
    signal.throwIfAborted();
    return started ? unknownOutcome() : failure(error);
  }
}

export interface ApprovedActionTurn {
  /** A workflow supplies an already authorized call and captures the binding before dispatch. */
  action: { call: AgentToolCall; definition: AgentToolDefinition; live(): boolean };
  audience?: AudienceScope;
  signal: AbortSignal;
  verifyGoal?: (rounds: readonly AgentRound[], signal: AbortSignal) => boolean | Promise<boolean>;
}
export async function runAgentTurn(options: AgentOptions | ApprovedActionTurn): Promise<AgentRunResult> {
  if ("action" in options) {
    options.signal.throwIfAborted();
    const { call: candidate, definition, live } = options.action;
    const call = AgentToolCallSchema.parse(candidate);
    const result = await invokeBoundTool(call, definition, live, options.signal, options.signal, options.audience);
    const rounds: AgentRound[] = [{ text: "", receipts: [{ call, result: result.canonical }] }];
    const verified = options.verifyGoal && await abortable(() => options.verifyGoal!(structuredClone(rounds), options.signal), options.signal);
    return { rounds, steps: [], stopReason: "finished", goalVerification: verified ? "verified" : "unverified",
      output: result.projected };
  }
  const { signal, maxSteps = 30, maxRetries = 3, driver = toolLoopDriver, bindings } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("Invalid execution limits");
  }
  if (options.model && options.adapter) throw new Error("Select one model adapter per run");
  if (bindings && options.executeTool) throw new Error("Explicit tool dispatch conflicts with host bindings");
  const direct = options.adapter ?? (options.model && { model: options.model, capabilities: { tools: true, structuredOutput: true } });
  const model = selectAgentModel(bindings, direct);
  const inputs = structuredClone(options.inputs);
  const runId = options.runId ?? randomUUID();
  const rounds: AgentRound[] = [];
  const projectedRounds: AgentRound[] = [];
  const steps: AgentStepManifest[] = [];
  const compiler = new ContextAssemblyCompiler();
  const retry = { remaining: maxRetries, irreversible: false };
  for (let step = 0; step < maxSteps; step++) {
    const { request, bound, canSend } = await abortable(() => compiler.compile({
      stepId: `${runId}/${step}`, step, inputs, signal, bindings, model, modelId: options.modelId, profile: options.profile,
      rounds: projectedRounds, projections: options.projections, contextBudgetChars: options.contextBudgetChars
    }), signal);
    steps.push(request.manifest);
    options.onStep?.(structuredClone(request.manifest));
    const lease = model.lease?.();
    const stepSignal = lease ? AbortSignal.any([signal, lease.signal]) : signal;
    const { text, calls } = await readRound(options, model, request, retry, canSend, stepSignal).finally(() => lease?.dispose());
    const decision = driver({ step, text, calls: structuredClone(calls), rounds: structuredClone(rounds), signal });
    signal.throwIfAborted();
    if (decision === "execute_tools" && !calls.length) throw new Error("Driver requested tools without a model tool call");
    const canonical: AgentRound = { text, receipts: [] };
    const projected: AgentRound = { text, receipts: [] };
    for (const call of calls) {
      retry.irreversible = true;
      const receipt = decision === "execute_tools" ? await dispatchTool(call, bound.get(call.name), options)
        : failure("Tool call declined by run driver");
      signal.throwIfAborted();
      canonical.receipts.push({ call, result: receipt.canonical });
      projected.receipts.push({ call, result: receipt.projected });
    }
    rounds.push(canonical);
    projectedRounds.push(projected);
    if (decision === "finish") {
      const output = options.profile && options.profile.parse(text);
      const goalVerification = options.verifyGoal
        ? (await abortable(() => options.verifyGoal!(structuredClone(rounds), signal), signal) ? "verified" : "unverified")
        : options.goalRequiresVerification ? "unverified" : "not_applicable";
      return { rounds, steps, stopReason: "finished", goalVerification, ...(options.profile && { output }) };
    }
  }
  return { rounds, steps, stopReason: "step_limit", goalVerification: "unverified" };
}
export class AgentCoreRuntime {
  runTurn(options: AgentOptions) { return runAgentTurn(options); }
  startTurn(options: Omit<AgentOptions, "signal"> & { signal?: AbortSignal }) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    return { result: this.runTurn({ ...options, signal }), cancel: (reason?: unknown) => controller.abort(reason) };
  }
}
