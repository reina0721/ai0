import { z } from "zod";
import type { AgentToolDefinition, AgentValueSchema, Ai0ExtensionManifest } from "@ai0/protocol";
import { agentToolProviderFacet, defineExtensionPackage } from "@ai0/sdk";
import rawManifest from "../ai0.extension.json" with { type: "json" };
import { evaluateSafeMathExpression } from "./math-eval.js";

export { evaluateSafeMathExpression };

function zodValueSchema<T>(schema: z.ZodType<T>, jsonSchema: Readonly<Record<string, unknown>>): AgentValueSchema {
  return {
    jsonSchema,
    parse: (input: unknown) => schema.parse(input)
  };
}

const DatetimeInputSchema = z.object({
  isoTimestamp: z.string().optional(),
  timeZone: z.string().optional(),
  compareToIso: z.string().optional()
});

const CalculateInputSchema = z.object({
  expression: z.string().min(1),
  precision: z.number().int().min(0).max(15).optional()
});

const JsonQueryInputSchema = z.object({
  jsonText: z.string().min(1),
  queryPath: z.string().optional()
});

function formatDurationHuman(diffMs: number): string {
  const sign = diffMs < 0 ? "-" : "";
  let rem = Math.abs(Math.trunc(diffMs));
  const days = Math.floor(rem / 86_400_000);
  rem %= 86_400_000;
  const hours = Math.floor(rem / 3_600_000);
  rem %= 3_600_000;
  const minutes = Math.floor(rem / 60_000);
  rem %= 60_000;
  const seconds = Math.floor(rem / 1_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return `${sign}${parts.join(" ")}`;
}

export function queryJsonByPath(root: unknown, rawPath?: string): { found: boolean; value: unknown } {
  if (!rawPath || !rawPath.trim() || rawPath.trim() === "." || rawPath.trim() === "$") {
    return { found: true, value: root };
  }
  const cleaned = rawPath.trim().replace(/^\$\.?/u, "").replace(/^\./u, "");
  const segments: Array<string | number> = [];
  const tokenRegex = /([^.[\]]+)|\[(\d+|"[^"]+"|'[^']+')\]/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(cleaned)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1]);
    } else if (match[2] !== undefined) {
      const inner = match[2];
      if (/^\d+$/u.test(inner)) {
        segments.push(Number(inner));
      } else {
        segments.push(inner.slice(1, -1));
      }
    }
  }

  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (typeof seg === "number") {
      if (!Array.isArray(current) || seg < 0 || seg >= current.length) return { found: false, value: undefined };
      current = current[seg];
    } else {
      if (typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, seg)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return { found: true, value: current };
}

export function createUtilityToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: "util.datetime",
      description:
        "Format an ISO-8601 timestamp (or current time) in any IANA timezone and optionally compute exact duration difference.",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(DatetimeInputSchema, {
        type: "object",
        properties: {
          isoTimestamp: { type: "string" },
          timeZone: { type: "string" },
          compareToIso: { type: "string" }
        },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      execute(call) {
        try {
          const input = DatetimeInputSchema.parse(call.input ?? {});
          const baseDate = input.isoTimestamp ? new Date(input.isoTimestamp) : new Date();
          if (Number.isNaN(baseDate.getTime())) {
            return { status: "failed", error: `Invalid isoTimestamp: ${String(input.isoTimestamp)}` };
          }
          const tz = input.timeZone ?? "UTC";
          const formattedLocal = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          }).format(baseDate);
          const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(baseDate);

          let diffFields: { diffMs?: number; diffHuman?: string } = {};
          if (input.compareToIso) {
            const targetDate = new Date(input.compareToIso);
            if (Number.isNaN(targetDate.getTime())) {
              return { status: "failed", error: `Invalid compareToIso: ${input.compareToIso}` };
            }
            const diffMs = targetDate.getTime() - baseDate.getTime();
            diffFields = { diffMs, diffHuman: formatDurationHuman(diffMs) };
          }

          return {
            status: "verified",
            value: {
              isoUtc: baseDate.toISOString(),
              unixMs: baseDate.getTime(),
              timeZone: tz,
              formattedLocal,
              weekday,
              ...diffFields
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "util.calculate",
      description:
        "Deterministically evaluate arithmetic and scientific math expressions without eval (supports + - * / % **, abs/sqrt/round/min/max/log/sin/cos, PI, E).",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(CalculateInputSchema, {
        type: "object",
        required: ["expression"],
        properties: {
          expression: { type: "string" },
          precision: { type: "integer", minimum: 0, maximum: 15 }
        },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      execute(call) {
        try {
          const input = CalculateInputSchema.parse(call.input);
          const rawResult = evaluateSafeMathExpression(input.expression);
          const result =
            input.precision !== undefined ? Number(rawResult.toFixed(input.precision)) : rawResult;
          return {
            status: "verified",
            value: {
              expression: input.expression,
              result,
              formatted: input.precision !== undefined ? rawResult.toFixed(input.precision) : String(rawResult)
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "util.json_query",
      description:
        "Validate JSON text, inspect its root type/keys/length, and extract nested fields by dot/index path (e.g. 'items[0].title').",
      capabilityRisk: "read_only_safe",
      inputSchema: zodValueSchema(JsonQueryInputSchema, {
        type: "object",
        required: ["jsonText"],
        properties: {
          jsonText: { type: "string" },
          queryPath: { type: "string" }
        },
        additionalProperties: false
      }),
      resultSchema: {
        jsonSchema: { type: "object" },
        parse: (v) => v as Record<string, unknown>
      },
      execute(call) {
        try {
          const input = JsonQueryInputSchema.parse(call.input);
          const parsed = JSON.parse(input.jsonText) as unknown;
          const rootType =
            parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
          const topKeys =
            parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
              ? Object.keys(parsed as Record<string, unknown>).slice(0, 100)
              : undefined;
          const length = Array.isArray(parsed) ? parsed.length : undefined;
          const queried = queryJsonByPath(parsed, input.queryPath);

          return {
            status: "verified",
            value: {
              valid: true,
              rootType,
              ...(topKeys ? { topKeys } : {}),
              ...(length !== undefined ? { length } : {}),
              found: queried.found,
              result: queried.value ?? null
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    }
  ];
}

const typedManifest = rawManifest as unknown as Omit<Ai0ExtensionManifest, "manifest_version">;

export const utilityToolsPackage = defineExtensionPackage({
  manifest: typedManifest,
  activate(scope) {
    scope.contributeFacet(agentToolProviderFacet, {
      tools: createUtilityToolDefinitions()
    });
  }
});

export default utilityToolsPackage;
