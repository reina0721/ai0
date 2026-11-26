import { createHash, randomUUID } from "node:crypto";
import type { AgentStepManifest, PreparedAgentRequest } from "@ai0/protocol";

export interface PromptFragmentSource {
  id: string;
  version: string;
  authority: string;
  source?: string;
  field: "system" | "observation";
  text?: string;
  disposition?: string;
  budget?: number;
}

export interface StructuredRequestTrace {
  stepId?: string;
  fragments?: readonly PromptFragmentSource[];
  outputContract?: string;
}

export const requestFingerprint = (value: unknown): string =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

interface LogicalField {
  id: string;
  content: string;
  group?: "tool" | "output";
}

export interface ModelRequestRecord {
  stepId: string;
  model: string;
  prepared?: AgentStepManifest;
  assembly: AgentStepManifest | {
    fragments: Array<Omit<PromptFragmentSource, "text"> & { fingerprint?: string }>;
    outputContract?: string;
    outputSchemaFingerprint?: string;
    fields: Array<{ id: string; fingerprint: string }>;
  };
  attempts: Array<{
    number: number;
    provider: string;
    serializedFingerprint?: string;
    fields: Array<{ pointer: string; fingerprint: string; sourceIds: string[] }>;
    modelFields?: Record<string, unknown>;
    recordedAt?: number;
  }>;
}

const modelFields = new Set(["model", "system", "messages", "prompt", "tools", "tool_choice", "response_format",
  "output_config", "thinking", "reasoning", "reasoning_effort", "temperature", "max_tokens", "max_completion_tokens"]);

function describeWire(payload: Record<string, unknown>, logical: readonly LogicalField[]) {
  const fields: ModelRequestRecord["attempts"][number]["fields"] = [];
  const selected = Object.fromEntries(Object.entries(payload).filter(([key]) => modelFields.has(key)));
  function visit(value: unknown, pointer: string) {
    if (value !== null && typeof value === "object" && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, pointer + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"));
      }
    } else {
      const sources = logical.filter(item => {
        if (typeof value !== "string" || !item.content) return false;
        if (item.group === "tool") return pointer.startsWith("/tools/") && value === item.content;
        if (item.group === "output") return pointer.startsWith("/response_format/") && value === item.content;
        if (!/^\/(?:messages\/\d+\/content(?:\/|$)|system(?:\/|$)|prompt(?:\/|$))/.test(pointer)) return false;
        return value.includes(item.content) || value.includes(JSON.stringify(item.content).slice(1, -1));
      });
      const sourceIds = sources.map(item => item.id);
      fields.push({ pointer, fingerprint: requestFingerprint(value), sourceIds });
    }
  }
  visit(selected, "");
  return { fields, selected };
}

/** Local process journal. A lease belongs to the data generation at admission. */
export class ModelRequestJournal {
  private readonly records = new Map<string, ModelRequestRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;

  constructor(private readonly options: { captureBodies?: boolean; ttlMs?: number; maxSteps?: number; now?: () => number } = {}) {
    if (!Number.isSafeInteger(options.maxSteps ?? 128) || (options.maxSteps ?? 128) < 1) throw new RangeError("Invalid maxSteps");
    if (!Number.isFinite(options.ttlMs ?? 1) || (options.ttlMs ?? 1) <= 0) throw new RangeError("Invalid trace TTL");
  }

  lease() {
    const generation = this.generation;
    const owned = new WeakSet<ModelRequestRecord>();
    return (record: ModelRequestRecord, logical: readonly LogicalField[], provider: string, send?: typeof fetch): typeof fetch => {
      const previous = this.records.get(record.stepId);
      if (previous && owned.has(previous)) {
        // The driver and transport observe the same logical step, including transport retries.
        previous.model = record.model;
        if ("step" in record.assembly && !("step" in previous.assembly)) previous.prepared = record.assembly;
        else if (!("step" in record.assembly) && "step" in previous.assembly) {
          previous.prepared = previous.assembly;
          previous.assembly = record.assembly;
        }
        else previous.assembly = record.assembly;
        record = previous;
      } else if (this.generation === generation) {
        this.remove(record.stepId);
        owned.add(record);
        this.records.set(record.stepId, record);
        while (this.records.size > (this.options.maxSteps ?? 128)) this.remove(this.records.keys().next().value!);
        const ttl = Math.min(this.options.ttlMs ?? 86_400_000, 86_400_000);
        this.timers.set(record.stepId, setTimeout(() => this.remove(record.stepId), ttl).unref());
      }
      return async (url, init) => {
        if (this.records.get(record.stepId) === record) {
          let body: unknown;
          let serializedFingerprint: string | undefined;
          try {
            const serialized = init?.body ?? (url instanceof Request ? await url.clone().text() : undefined);
            if (typeof serialized === "string") {
              serializedFingerprint = requestFingerprint(serialized);
              body = JSON.parse(serialized);
            }
          } catch { /* Preserve transport behaviour for unsupported bodies. */ }
          if (this.records.get(record.stepId) === record) {
            const { fields, selected } = describeWire(body && typeof body === "object" ? body as Record<string, unknown> : {}, logical);
            record.attempts.push({ number: record.attempts.length + 1, provider, fields, serializedFingerprint, recordedAt: this.options.now?.(),
              ...(this.options.captureBodies ? { modelFields: selected } : {}) });
          }
        }
        return (send ?? globalThis.fetch)(url, init);
      };
    };
  }

  has(stepId: string) { return this.records.has(stepId); }

  read(stepId: string) {
    const record = this.records.get(stepId);
    return record && structuredClone(record);
  }

  clear() {
    this.generation++;
    for (const stepId of this.records.keys()) this.remove(stepId);
  }

  private remove(stepId: string) {
    clearTimeout(this.timers.get(stepId));
    this.timers.delete(stepId);
    this.records.delete(stepId);
  }
}

export type ModelTraceLease = ReturnType<ModelRequestJournal["lease"]>;

export function tracePreparedRequest(lease: ModelTraceLease, request: PreparedAgentRequest, provider: string, send?: typeof fetch,
  model = request.manifest.model.id) {
  const logical: LogicalField[] = request.manifest.fragments.flatMap(fragment => {
    if (fragment.messageIndex === undefined) return [];
    const message = request.messages[fragment.messageIndex];
    return message && "content" in message ? [{ id: fragment.source + "/" + fragment.id, content: message.content }] : [];
  });
  for (const tool of request.tools) {
    logical.push({ group: "tool", id: "tool/" + tool.name, content: tool.name },
      { group: "tool", id: "tool/" + tool.name, content: tool.description });
  }
  return lease({ stepId: request.manifest.stepId, model, assembly: request.manifest, attempts: [] }, logical, provider, send);
}

export function traceStructuredRequest(lease: ModelTraceLease | undefined, provider: string, model: string,
  request: { system: string; observation: string; trace?: StructuredRequestTrace; outputSchema?: Readonly<Record<string, unknown>> },
  send?: typeof fetch) {
  if (!lease) return undefined;
  const logical = [{ id: "system", content: request.system }, { id: "observation", content: request.observation }];
  const fields = logical.map(item => ({ id: item.id, fingerprint: requestFingerprint(item.content) }));
  const fragments = (request.trace?.fragments ?? []).map(({ text, ...source }) => {
    if (text && (request[source.field].includes(text) || request[source.field].includes(JSON.stringify(text).slice(1, -1)))) {
      logical.push({ id: source.id, content: text });
    }
    return { ...source, ...(text === undefined ? {} : { fingerprint: requestFingerprint(text) }) };
  });
  return lease({ stepId: request.trace?.stepId ?? randomUUID(), model, attempts: [],
    assembly: { fields, fragments, outputContract: request.trace?.outputContract,
      outputSchemaFingerprint: request.outputSchema && requestFingerprint(request.outputSchema) } }, logical, provider, send);
}
