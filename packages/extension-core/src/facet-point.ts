import { ExtensionFacetIdSchema } from "@ai0/protocol";

export type FacetOwner = "channel" | "agent" | "perception" | "cognition" | "expression" | "console" | "extension";

export interface FacetPoint<T> {
  readonly owner: FacetOwner;
  readonly name: string;
  readonly id: string;
  readonly version: number;
  parse(raw: unknown): T;
}

export function defineFacetPoint<T>(contract: Omit<FacetPoint<T>, "id">): FacetPoint<T> {
  const id = ExtensionFacetIdSchema.parse(`${contract.owner}.${contract.name}`);
  if (!Number.isSafeInteger(contract.version) || contract.version < 1) {
    throw new TypeError("Invalid facet version");
  }
  return Object.freeze({ ...contract, id });
}
