import { randomUUID } from "node:crypto";
import {
  AgentToolCallSchema,
  AgentToolResultSchema,
  type AgentModelAdapter,
  type AgentModelEvent,
  type AgentOutputProfile,
  type AgentPromptInput,
  type AgentRound,
  type AgentStepManifest,
  type AgentToolAdvertisement,
  type AgentToolCall,
  type AgentToolDefinition,
  type AgentToolResult,
  type AgentTurnReport,
  type AudienceScope,
  type PreparedAgentRequest
} from "@ai0/protocol";
import { abortable } from "./abortable.js";
import { assembleKernelStep } from "./authority-lanes.js";

export type ModelEvent = AgentModelEvent;
export type AgentDriver = (output: {
  step: number; text: string; calls: readonly AgentToolCall[]; rounds: readonly AgentRound[]; signal: AbortSignal;
}) => "finish" | "execute_tools" | "continue";
export const singleStepDriver: AgentDriver = () => "finish";
export const toolLoopDriver: AgentDriver = ({ calls }) => calls.length ? "execute_tools" : "finish";

export interface KernelSelectedModel {
  adapter: AgentModelAdapter;
  identity: { id: string; generation?: number };
  live(): boolean;
  lease?(): { signal: AbortSignal; dispose(): void };
  allowsNetwork?(): boolean;
}

export interface KernelDispatchedTool {
  definition: AgentToolDefinition;
  live(): boolean;
  lease?(): { signal: AbortSignal; dispose(): void };
}

export interface KernelStepCompilation {
  request: PreparedAgentRequest;
  bound: ReadonlyMap<string, KernelDispatchedTool>;
  canSend(): boolean;
}

export interface KernelStepCompiler {
  selectModel(direct: AgentModelAdapter | undefined): KernelSelectedModel;
  compile(options: {
    stepId: string;
    step: number;
    signal: AbortSignal;
    inputs: readonly AgentPromptInput[];
    rounds: readonly AgentRound[];
    contextBudgetChars?: number;
    profile?: AgentOutputProfile;
    modelId?: string;
    projections?: AgentStepManifest["projections"];
    model: KernelSelectedModel;
    disableTools?: boolean;
  }): Promise<KernelStepCompilation>;
}

export interface KernelAgentOptions {
  inputs: readonly AgentPromptInput[];
  projections?: AgentStepManifest["projections"];
  signal: AbortSignal;
  model?: AgentModelAdapter["model"];
  adapter?: AgentModelAdapter;
  modelId?: string;
  profile?: AgentOutputProfile;
  driver?: AgentDriver;
  tools?: readonly AgentToolAdvertisement[];
  executeTool?: (call: AgentToolCall, signal: AbortSignal) => Promise<AgentToolResult>;
  audience?: AudienceScope;
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
  stepCompiler?: KernelStepCompiler;
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

async function readRound(
  options: KernelAgentOptions,
  model: KernelSelectedModel,
  request: PreparedAgentRequest,
  retry: { remaining: number; irreversible: boolean },
  canSend: () => boolean,
  signal: AbortSignal
) {
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
          if (model.allowsNetwork && !model.allowsNetwork()) {
            throw new Error("Model adapter network access denied");
          }
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

export async function invokeBoundTool(
  call: AgentToolCall,
  definition: AgentToolDefinition,
  live: () => boolean,
  combined: AbortSignal,
  signal: AbortSignal,
  audience: AudienceScope = "only_owner"
) {
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

async function dispatchTool(
  call: AgentToolCall,
  bound: KernelDispatchedTool | undefined,
  options: KernelAgentOptions,
  hasHostCompiler: boolean
) {
  const { signal } = options;
  if (!hasHostCompiler) {
    if (!options.executeTool) return failure("Tool unavailable");
    try { return sameReceipt(AgentToolResultSchema.parse(await abortable(() => options.executeTool!(call, signal), signal))); }
    catch (error) { signal.throwIfAborted(); return failure(error); }
  }
  if (!bound) return failure("Tool was not advertised for this step");
  const lease = bound.lease?.();
  try {
    return await invokeBoundTool(
      call,
      bound.definition,
      bound.live,
      lease ? AbortSignal.any([signal, lease.signal]) : signal,
      signal,
      options.audience
    );
  } finally {
    lease?.dispose();
  }
}

export interface ApprovedActionTurn {
  /** A workflow supplies an already authorized call and captures the binding before dispatch. */
  action: { call: AgentToolCall; definition: AgentToolDefinition; live(): boolean };
  audience?: AudienceScope;
  signal: AbortSignal;
  verifyGoal?: (rounds: readonly AgentRound[], signal: AbortSignal) => boolean | Promise<boolean>;
}

export async function runKernelAgentTurn(options: KernelAgentOptions | ApprovedActionTurn): Promise<AgentRunResult> {
  if ("action" in options) {
    options.signal.throwIfAborted();
    const { call: candidate, definition, live } = options.action;
    const call = AgentToolCallSchema.parse(candidate);
    const result = await invokeBoundTool(call, definition, live, options.signal, options.signal, options.audience);
    const rounds: AgentRound[] = [{ text: "", receipts: [{ call, result: result.canonical }] }];
    const verified = options.verifyGoal && await abortable(() => options.verifyGoal!(structuredClone(rounds), options.signal), options.signal);
    return {
      rounds,
      steps: [],
      stopReason: "finished",
      goalVerification: verified ? "verified" : "unverified",
      output: result.projected
    };
  }
  const { signal, maxSteps = 30, maxRetries = 3, driver = toolLoopDriver, stepCompiler } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("Invalid execution limits");
  }
  if (options.model && options.adapter) throw new Error("Select one model adapter per run");
  const direct = options.adapter ?? (options.model && { model: options.model, capabilities: { tools: true, structuredOutput: true } });
  const model: KernelSelectedModel = stepCompiler
    ? stepCompiler.selectModel(direct)
    : (() => {
        if (!direct) throw new Error("Select an agent model adapter");
        if (options.profile?.schema && !direct.capabilities?.structuredOutput) {
          throw new Error("Adapter does not support structured output");
        }
        return { adapter: direct, identity: { id: "direct" }, live: () => true };
      })();
  const inputs = structuredClone(options.inputs);
  const runId = options.runId ?? randomUUID();
  const rounds: AgentRound[] = [];
  const projectedRounds: AgentRound[] = [];
  const steps: AgentStepManifest[] = [];
  const retry = { remaining: maxRetries, irreversible: false };
  let disableToolsForFinalConvergence = false;

  for (let step = 0; step < maxSteps; step++) {
    const compiled: KernelStepCompilation = await abortable(async () => {
      if (stepCompiler) {
        return stepCompiler.compile({
          stepId: `${runId}/${step}`,
          step,
          inputs,
          signal,
          model,
          modelId: options.modelId,
          profile: options.profile,
          rounds: projectedRounds,
          projections: options.projections,
          contextBudgetChars: options.contextBudgetChars,
          disableTools: disableToolsForFinalConvergence
        });
      }
      const request = assembleKernelStep({
        stepId: `${runId}/${step}`,
        step,
        inputs,
        signal,
        rounds: projectedRounds,
        tools: disableToolsForFinalConvergence ? [] : options.tools,
        audience: options.audience,
        contextBudgetChars: options.contextBudgetChars,
        profile: options.profile,
        modelIdentity: { ...model.identity, ...(options.modelId ? { requestedId: options.modelId } : {}) },
        projections: options.projections
      });
      return { request, bound: new Map(), canSend: () => true };
    }, signal);

    const { request, bound, canSend } = compiled;
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
      const receipt = decision === "execute_tools"
        ? await dispatchTool(call, bound.get(call.name), options, Boolean(stepCompiler))
        : failure("Tool call declined by run driver");
      signal.throwIfAborted();
      canonical.receipts.push({ call, result: receipt.canonical });
      projected.receipts.push({ call, result: receipt.projected });
    }
    rounds.push(canonical);
    projectedRounds.push(projected);
    if (decision === "finish") {
      if (options.profile) {
        try {
          const output = options.profile.parse(text);
          const goalVerification = options.verifyGoal
            ? (await abortable(() => options.verifyGoal!(structuredClone(rounds), signal), signal) ? "verified" : "unverified")
            : options.goalRequiresVerification ? "unverified" : "not_applicable";
          return { rounds, steps, stopReason: "finished", goalVerification, output };
        } catch (parseError) {
          if (options.profile.schema && request.tools.length > 0 && !disableToolsForFinalConvergence && step + 1 < maxSteps) {
            disableToolsForFinalConvergence = true;
            continue;
          }
          throw parseError;
        }
      }
      const goalVerification = options.verifyGoal
        ? (await abortable(() => options.verifyGoal!(structuredClone(rounds), signal), signal) ? "verified" : "unverified")
        : options.goalRequiresVerification ? "unverified" : "not_applicable";
      return { rounds, steps, stopReason: "finished", goalVerification };
    }
  }
  return { rounds, steps, stopReason: "step_limit", goalVerification: "unverified" };
}

export class KernelAgentRuntime {
  runTurn(options: KernelAgentOptions) { return runKernelAgentTurn(options); }
  startTurn(options: Omit<KernelAgentOptions, "signal"> & { signal?: AbortSignal }) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    return { result: this.runTurn({ ...options, signal }), cancel: (reason?: unknown) => controller.abort(reason) };
  }
}
