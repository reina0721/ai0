import { describe, expect, it } from "vitest";
import utilityToolsPackage, { createUtilityToolDefinitions, evaluateSafeMathExpression } from "./index.js";

describe("builtin.utility-tools zero-side-effect reasoning helpers", () => {
  it("evaluates safe math expressions without eval and rejects invalid/unsafe syntax", () => {
    expect(utilityToolsPackage.manifest.default_enabled).toBe(true);
    expect(evaluateSafeMathExpression("2 + 3 * 4 ** 2")).toBe(50);
    expect(evaluateSafeMathExpression("round(sqrt(81) + max(2, 7, 4))")).toBe(16);
    expect(evaluateSafeMathExpression("log(1000) + cos(0)")).toBeCloseTo(4, 10);
    expect(() => evaluateSafeMathExpression("10 / 0")).toThrow(/zero/u);
    expect(() => evaluateSafeMathExpression("process.exit(1)")).toThrow();
  });

  it("executes util.datetime, util.calculate, and util.json_query deterministically", () => {
    const byName = new Map(createUtilityToolDefinitions().map((t) => [t.name, t]));
    const signal = new AbortController().signal;

    const dt = byName.get("util.datetime")!.execute(
      {
        kind: "tool",
        id: "d1",
        name: "util.datetime",
        input: {
          isoTimestamp: "2026-11-26T00:00:00.000Z",
          timeZone: "Asia/Shanghai",
          compareToIso: "2026-11-27T02:30:00.000Z"
        }
      },
      signal
    );
    expect(dt).toMatchObject({
      status: "verified",
      value: {
        unixMs: Date.parse("2026-11-26T00:00:00.000Z"),
        weekday: "Thursday",
        diffHuman: "1d 2h 30m"
      }
    });

    const calc = byName.get("util.calculate")!.execute(
      { kind: "tool", id: "c1", name: "util.calculate", input: { expression: "(19.99 * 3) * 1.08", precision: 2 } },
      signal
    );
    expect(calc).toEqual({
      status: "verified",
      value: { expression: "(19.99 * 3) * 1.08", result: 64.77, formatted: "64.77" }
    });

    const jq = byName.get("util.json_query")!.execute(
      {
        kind: "tool",
        id: "j1",
        name: "util.json_query",
        input: {
          jsonText: JSON.stringify({ packages: [{ name: "@ai0/agent-runtime", ready: true }] }),
          queryPath: "packages[0].name"
        }
      },
      signal
    );
    expect(jq).toEqual({
      status: "verified",
      value: {
        valid: true,
        rootType: "object",
        topKeys: ["packages"],
        found: true,
        result: "@ai0/agent-runtime"
      }
    });
  });
});
