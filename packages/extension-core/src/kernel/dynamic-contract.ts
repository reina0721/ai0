export type DynamicContractKind =
  | "perception_event"
  | "cognition_protocol"
  | "agent_capability"
  | "expression_protocol";

export interface DynamicContractDescriptor<TPayload = unknown> {
  readonly kind: DynamicContractKind;
  readonly namespace: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  parse(raw: unknown): TPayload;
}

export interface DefinedDynamicContract<TPayload = unknown> extends DynamicContractDescriptor<TPayload> {
  readonly id: string;
  readonly schemaFingerprint: string;
}

export interface DynamicContractSnapshot {
  readonly id: string;
  readonly kind: DynamicContractKind;
  readonly namespace: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly schemaFingerprint: string;
  readonly originPackageId: string;
  readonly holders: readonly string[];
}

export interface DynamicContractMigration<TFrom = unknown, TTo = unknown> {
  readonly kind: DynamicContractKind;
  readonly namespace: string;
  readonly name: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(payload: TFrom): TTo;
}

export class DynamicContractConflictError extends Error {
  readonly code = "DYNAMIC_CONTRACT_CONFLICT";
  constructor(
    readonly contractId: string,
    readonly existingHolders: readonly string[]
  ) {
    super(
      `Dynamic contract schema conflict for ${contractId} (already held by ${existingHolders.join(", ")})`
    );
    this.name = "DynamicContractConflictError";
  }
}

const VALID_CONTRACT_KINDS = new Set<DynamicContractKind>([
  "perception_event",
  "cognition_protocol",
  "agent_capability",
  "expression_protocol"
]);

const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function canonicalizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeSchemaValue(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      if (record[k] !== undefined) {
        out[k] = canonicalizeSchemaValue(record[k]);
      }
    }
    return out;
  }
  return value;
}

export function computeDynamicSchemaFingerprint(jsonSchema: Readonly<Record<string, unknown>>): string {
  const canonical = JSON.stringify(canonicalizeSchemaValue(jsonSchema));
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code;
    h2 = Math.imul(h2, 0x0100019d) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}:${canonical.length}`;
}

export function formatDynamicContractId(
  kind: DynamicContractKind,
  namespace: string,
  name: string,
  version: number
): string {
  return `${kind}:${namespace}.${name}@${version}`;
}

export function defineDynamicContract<TPayload>(
  descriptor: DynamicContractDescriptor<TPayload>
): DefinedDynamicContract<TPayload> {
  if (!descriptor || !VALID_CONTRACT_KINDS.has(descriptor.kind)) {
    throw new TypeError("Invalid dynamic contract kind");
  }
  if (!NAMESPACE_PATTERN.test(descriptor.namespace)) {
    throw new TypeError(`Invalid dynamic contract namespace: ${descriptor.namespace}`);
  }
  if (!NAME_PATTERN.test(descriptor.name)) {
    throw new TypeError(`Invalid dynamic contract name: ${descriptor.name}`);
  }
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 1) {
    throw new TypeError("Dynamic contract version must be a positive integer");
  }
  if (
    !descriptor.jsonSchema ||
    typeof descriptor.jsonSchema !== "object" ||
    Array.isArray(descriptor.jsonSchema)
  ) {
    throw new TypeError("Dynamic contract requires a plain object jsonSchema");
  }
  if (typeof descriptor.parse !== "function") {
    throw new TypeError("Dynamic contract requires a parse(raw) validator function");
  }

  const id = formatDynamicContractId(
    descriptor.kind,
    descriptor.namespace,
    descriptor.name,
    descriptor.version
  );
  const clonedSchema = structuredClone(descriptor.jsonSchema);
  const schemaFingerprint = computeDynamicSchemaFingerprint(clonedSchema);

  return Object.freeze({
    kind: descriptor.kind,
    namespace: descriptor.namespace,
    name: descriptor.name,
    version: descriptor.version,
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    jsonSchema: Object.freeze(clonedSchema),
    parse: descriptor.parse.bind(descriptor),
    id,
    schemaFingerprint
  });
}
