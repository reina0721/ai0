import { defineFacetPoint, type FacetOwner, type FacetPoint } from "./facet-point.js";

export interface HookHandler<TPayload, TResult = TPayload> {
  readonly priority?: number;
  handle(payload: TPayload, signal?: AbortSignal): TResult | Promise<TResult>;
}

export interface HookPoint<TPayload, TResult = TPayload> {
  readonly facet: FacetPoint<HookHandler<TPayload, TResult>>;
  readonly parsePayload?: (raw: unknown) => TPayload;
  readonly parseResult?: (raw: unknown) => TResult;
}

export function defineHookPoint<TPayload, TResult = TPayload>(contract: {
  owner: FacetOwner;
  name: string;
  version: number;
  parsePayload?: (raw: unknown) => TPayload;
  parseResult?: (raw: unknown) => TResult;
}): HookPoint<TPayload, TResult> {
  const facet = defineFacetPoint<HookHandler<TPayload, TResult>>({
    owner: contract.owner,
    name: contract.name,
    version: contract.version,
    parse(raw) {
      const value = raw as HookHandler<TPayload, TResult> | null;
      if (
        !value ||
        typeof value.handle !== "function" ||
        (value.priority !== undefined && !Number.isFinite(value.priority))
      ) {
        throw new TypeError(`Invalid hook handler for ${contract.owner}.${contract.name}`);
      }
      return value;
    }
  });
  return Object.freeze({
    facet,
    ...(contract.parsePayload ? { parsePayload: contract.parsePayload } : {}),
    ...(contract.parseResult ? { parseResult: contract.parseResult } : {})
  });
}
