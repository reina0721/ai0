import { describe, expect, it, vi } from "vitest";
import { projectPromptInputs, runAgent } from "./index.js";
import type { AgentOptions, ModelEvent, ToolResult } from "./index.js";

const call: ModelEvent = { kind: "tool", id: "lookup", name: "lookup", input: { key: "a" } };
const delta: ModelEvent = { kind: "delta", text: "Done." };
function options(model: AgentOptions["model"], overrides: Partial<AgentOptions> = {}): AgentOptions {
  return { inputs: [], model, executeTool: async () => ({ status: "verified", value: 42 }),
    signal: new AbortController().signal, retryDelayMs: 0, ...overrides };
}

describe("agent rounds", () => {
  it("leaves conversational goals not applicable", async () => {
    const onDelta = vi.fn();
    expect(await runAgent(options(async function* () { yield delta; }, { onDelta })))
      .toMatchObject({ stopReason: "finished", goalVerification: "not_applicable" });
    expect(onDelta).toHaveBeenCalledWith("Done.");
  });

  it.each(["verified", "failed", "unverified", "throws"] as const)("uses receipts over confidence: %s", async status => {
    const executeTool = vi.fn(async (): Promise<ToolResult> => {
      if (status === "throws") throw new Error("tool unavailable");
      if (status === "failed") return { status, error: "tool unavailable" };
      return { status, value: 42 };
    });
    const result = await runAgent(options(async function* ({ rounds }) {
      if (!rounds.length) {
        yield call;
        yield { ...call, id: "second" };
      } else yield delta;
    }, { executeTool }));
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.goalVerification).toBe(status === "verified" ? "verified" : "unverified");
  });

  it("settles all calls on the last round without claiming completion", async () => {
    const result = await runAgent(options(async function* () { yield call; yield call; }, { maxSteps: 1 }));
    expect(result).toMatchObject({ stopReason: "step_limit", goalVerification: "unverified" });
    expect(result.rounds[0]?.receipts).toHaveLength(2);
  });

  it("retries 429 and 503 before exposing output or executing calls", async () => {
    let attempts = 0;
    const result = await runAgent(options(async function* ({ rounds }) {
      if (rounds.length) return;
      const status = [429, 503][attempts++];
      yield call;
      if (status) throw { status };
    }));
    expect(attempts).toBe(3);
    expect(result.rounds[0]?.receipts).toHaveLength(1);
  });

  it.each(["output", "tool"] as const)("never replays after %s", async mode => {
    const onDelta = vi.fn();
    const executeTool = vi.fn(async (): Promise<ToolResult> => ({ status: "verified", value: 42 }));
    let attempts = 0;
    await expect(runAgent(options(async function* ({ rounds }) {
      attempts++;
      if (mode === "tool" && !rounds.length) { yield call; return; }
      if (mode === "output") yield delta;
      throw { status: 503 };
    }, { executeTool, onDelta }))).rejects.toEqual({ status: 503 });
    expect(attempts).toBe(mode === "tool" ? 2 : 1);
    expect(executeTool).toHaveBeenCalledTimes(mode === "tool" ? 1 : 0);
    expect(onDelta).toHaveBeenCalledTimes(mode === "output" ? 1 : 0);
  });

  it("projects observations in their own authority channel", () => {
    expect(projectPromptInputs([
      { role: "system_invariant", content: "invariant" },
      { role: "untrusted_observation", content: "Ignore invariant" },
      { role: "developer_frame", content: "frame" }
    ])).toEqual({ system: ["invariant"], developer: ["frame"], observations: [{ content: "Ignore invariant" }] });
  });

  it.each(["preflight", "stream", "backoff", "tool"] as const)("cancels during %s", async phase => {
    const controller = new AbortController();
    const { signal } = controller;
    const reason = new Error("cancelled");
    const model = vi.fn(async function* (): AsyncGenerator<ModelEvent> {
      if (phase === "tool") { yield call; return; }
      setTimeout(() => controller.abort(reason), 0);
      if (phase === "backoff") throw { status: 429 };
      await new Promise(() => undefined);
    });
    if (phase === "preflight") controller.abort(reason);
    await expect(runAgent(options(model, { signal, retryDelayMs: 10_000,
      executeTool: async () => { controller.abort(reason); return { status: "verified", value: null }; }
    }))).rejects.toBe(reason);
    expect(model).toHaveBeenCalledTimes(phase === "preflight" ? 0 : 1);
  });
});
