import { expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent-runtime.js";
import type { AgentToolDefinition } from "@ai0/protocol";

it("executes an authorized program call through canonical and model projections and rechecks the live binding", async () => {
  const signal = new AbortController().signal;
  let valid = true;
  const check = (value: unknown) => { if (value !== 7) throw new Error("Invalid input"); return value; };
  const execute = vi.fn<AgentToolDefinition["execute"]>(() => ({ status: "verified", value: { public: 7, private: "receipt" } }));
  const definition: AgentToolDefinition = { name: "example", description: "Demo",
    inputSchema: { jsonSchema: { const: 7 }, parse: check },
    resultSchema: { jsonSchema: { type: "object" }, parse: value => value },
    execute, project: value => (value as { public: number }).public };
  const action = { definition, live: () => valid, call: { kind: "tool" as const, name: "example", id: "1", input: 7 } };
  const result = await runAgentTurn({ action, signal, verifyGoal: rounds =>
    rounds[0]?.receipts[0]?.result.status === "verified" });
  expect(result.steps).toEqual([]);
  expect(result.output).toEqual({ status: "verified", value: 7 });
  expect(result.rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: { public: 7, private: "receipt" } });
  expect(result.goalVerification).toBe("verified");
  valid = false;
  const revoked = await runAgentTurn({ action, signal });
  expect(revoked.rounds[0]?.receipts[0]?.result).toMatchObject({ status: "failed" });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(revoked.goalVerification).toBe("unverified");
});
