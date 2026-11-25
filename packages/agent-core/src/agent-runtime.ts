import type { AgentPromptInput, AgentToolCall, AgentToolResult, AgentRound } from "@ai0/protocol";

export function projectPromptInputs(inputs: readonly AgentPromptInput[]) {
  return {
    system: inputs.filter(input => input.role === "system_invariant").map(input => input.content),
    developer: inputs.filter(input => input.role === "developer_frame").map(input => input.content),
    observations: inputs.filter(input => input.role === "untrusted_observation")
      .map(input => ({ content: input.content }))
  };
}

export type ModelEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown };
export interface AgentOptions {
  inputs: readonly AgentPromptInput[];
  model: (request: {
    prompt: ReturnType<typeof projectPromptInputs>;
    rounds: readonly AgentRound[];
    signal: AbortSignal;
  }) => AsyncIterable<ModelEvent>;
  executeTool: (call: AgentToolCall, signal: AbortSignal) => Promise<AgentToolResult>;
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  goalRequiresVerification?: boolean;
  maxSteps?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

function abortable<T>(work: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function isTransient(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error || "statusCode" in error)) return false;
  const status = "status" in error ? error.status : error.statusCode;
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500 && status < 600);
}

async function readRound(options: AgentOptions, rounds: readonly AgentRound[], prompt: ReturnType<typeof projectPromptInputs>,
  retry: { remaining: number; irreversible: boolean }) {
  const { signal } = options;
  for (;;) {
    let iterator: AsyncIterator<ModelEvent> | undefined;
    let text = "";
    const calls: AgentToolCall[] = [];
    try {
      signal.throwIfAborted();
      iterator = options.model({ prompt, rounds: structuredClone(rounds), signal })[Symbol.asyncIterator]();
      const stream = iterator;
      for (;;) {
        const event = await abortable(() => stream.next(), signal);
        signal.throwIfAborted();
        if (event.done) return { text, calls };
        if (event.value.kind === "tool") {
          calls.push(event.value);
        } else {
          text += event.value.text;
          retry.irreversible = true;
          options.onDelta?.(event.value.text);
        }
      }
    } catch (error) {
      if (iterator?.return) {
        const close = iterator.return.bind(iterator);
        void Promise.resolve().then(close).catch(() => undefined);
      }
      signal.throwIfAborted();
      if (retry.irreversible || retry.remaining === 0 || !isTransient(error)) throw error;
      retry.remaining--;
      await wait(options.retryDelayMs ?? 10, signal);
    }
  }
}

export async function runAgentTurn(options: AgentOptions) {
  const { signal, maxSteps = 30, maxRetries = 3 } = options;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("Invalid execution limits");
  }
  const prompt = projectPromptInputs(options.inputs);
  const rounds: AgentRound[] = [];
  const retry = { remaining: maxRetries, irreversible: false };
  let invoked = false;
  let verified = true;
  for (let step = 0; step < maxSteps; step++) {
    const { text, calls } = await readRound(options, rounds, prompt, retry);
    signal.throwIfAborted();
    const receipts: AgentRound["receipts"][number][] = [];
    for (const call of calls) {
      retry.irreversible = true;
      invoked = true;
      let result: AgentToolResult;
      try {
        result = await abortable(() => options.executeTool(call, signal), signal);
      } catch (error) {
        signal.throwIfAborted();
        result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
      signal.throwIfAborted();
      verified &&= result.status === "verified";
      receipts.push({ call, result });
    }
    rounds.push({ text, receipts });
    if (!calls.length) return {
      rounds,
      stopReason: "finished" as const,
      goalVerification: !invoked ? (options.goalRequiresVerification ? "unverified" as const : "not_applicable" as const) : verified ? "verified" as const : "unverified" as const
    };
  }
  return { rounds, stopReason: "step_limit" as const, goalVerification: "unverified" as const };
}

export class AgentCoreRuntime {
  runTurn(options: AgentOptions) { return runAgentTurn(options); }
}
