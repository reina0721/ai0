import { ExtensionServiceRefSchema, type AudienceScope, type ExtensionServiceRef } from "@ai0/protocol";

export interface ServiceContract<Input, Output> extends ExtensionServiceRef {
  /** Access may require a separate host grant in addition to the consumer's manifest. */
  readonly access?: "declared" | "explicit";
  parseInput(value: unknown): Input;
  parseOutput(value: unknown): Output;
}

export function defineServiceContract<I, O>(contract: ServiceContract<I, O>): ServiceContract<I, O> {
  const ref = ExtensionServiceRefSchema.parse(contract);
  if (typeof contract.parseInput !== "function" || typeof contract.parseOutput !== "function") {
    throw new TypeError("Service contracts require input and output parsers");
  }
  if (contract.access !== undefined && contract.access !== "declared" && contract.access !== "explicit") {
    throw new TypeError("Invalid service access policy");
  }
  return Object.freeze({ ...ref, access: contract.access, parseInput: contract.parseInput, parseOutput: contract.parseOutput });
}

export const defineServicePoint = defineServiceContract;

export interface ServiceCallContext {
  caller?: string;
  audience: AudienceScope;
  maxAudienceScope: AudienceScope;
}

export type ServiceOperation<I, O> = (value: I, signal: AbortSignal | undefined, context: ServiceCallContext) => O | Promise<O>;

export function intersectAudienceScopes(a: AudienceScope, b: AudienceScope): AudienceScope {
  return a === b || b === "public_all" ? a : a === "public_all" ? b : "only_owner";
}

export type ServiceStatus =
  | { status: "bound"; provider: string }
  | { status: "ambiguous"; providers: string[] }
  | { status: "missing" | "denied" | "revoked" | "cycle" };

export class ServiceBindingError extends Error {
  constructor(readonly service: ExtensionServiceRef, readonly reason: Exclude<ServiceStatus, { status: "bound" }>) {
    super(`Service ${service.owner}.${service.name}@${service.version}: ${reason.status}`);
  }
}

export interface ServiceClient<I, O> {
  status(): ServiceStatus;
  /** Capture this binding. A subsequent grant or reload cannot retarget a captured operation. */
  bind(audience?: AudienceScope): (input: I, signal?: AbortSignal) => Promise<O>;
}
