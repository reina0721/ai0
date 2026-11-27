import type { AudienceScope, StateDomain } from "@ai0/protocol";
import {
  formatDynamicContractId,
  type DynamicContractKind,
  type DynamicContractSnapshot
} from "../kernel/dynamic-contract.js";
import type { FacetPoint } from "../kernel/facet-point.js";
import type { HookPoint } from "../kernel/hook-point.js";
import type { ServiceContract } from "../kernel/service-contract.js";
import {
  sortFacetsByPriority,
  type ExtensionHostView,
  type ExtensionPackageState,
  type FacetRegistration
} from "./extension-host.js";

export interface ScopedExtensionPolicy {
  readonly scopeId?: string;
  readonly allowedPackages?: ReadonlySet<string> | readonly string[];
  readonly deniedPackages?: ReadonlySet<string> | readonly string[];
  readonly allowedFacets?: ReadonlySet<string> | readonly string[];
  readonly audienceCeiling?: AudienceScope;
  readonly allowNetwork?: boolean;
}

export function audienceAllowedByCeiling(audience: AudienceScope, ceiling: AudienceScope | undefined): boolean {
  if (ceiling === undefined || ceiling === "public_all") return true;
  if (audience === "only_owner") return true;
  return audience === ceiling;
}

export function attenuateAudienceCeiling(
  parentCeiling: AudienceScope | undefined,
  childCeiling: AudienceScope | undefined
): AudienceScope | undefined {
  if (parentCeiling === undefined) return childCeiling;
  if (childCeiling === undefined) return parentCeiling;
  if (parentCeiling === "public_all") return childCeiling;
  if (childCeiling === "public_all") return parentCeiling;
  if (parentCeiling === childCeiling) return parentCeiling;
  return "only_owner";
}

function toReadonlySet(items: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (items === undefined) return undefined;
  return items instanceof Set ? new Set(items) : new Set(items);
}

function intersectSets(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const intersection = new Set<string>();
  for (const item of left) {
    if (right.has(item)) intersection.add(item);
  }
  return intersection;
}

function unionSets(left: ReadonlySet<string>, right: ReadonlySet<string> | undefined): ReadonlySet<string> {
  if (!right || right.size === 0) return left;
  const combined = new Set(left);
  for (const item of right) combined.add(item);
  return combined;
}

/**
 * Hierarchical IoC scope view over an ExtensionHostView with strict monotonic attenuation.
 * Child views derived from a ScopedExtensionView can only narrow packages, facets, audience
 * ceilings, and network permissions — never widen them.
 */
export class ScopedExtensionView implements ExtensionHostView {
  readonly scopeId: string;
  private readonly allowedPackages: ReadonlySet<string> | undefined;
  private readonly deniedPackages: ReadonlySet<string>;
  private readonly allowedFacets: ReadonlySet<string> | undefined;
  private readonly audienceCeiling: AudienceScope | undefined;
  private readonly allowNetwork: boolean | undefined;

  constructor(
    private readonly parent: ExtensionHostView,
    policy: ScopedExtensionPolicy,
    inherited?: {
      allowedPackages?: ReadonlySet<string>;
      deniedPackages?: ReadonlySet<string>;
      allowedFacets?: ReadonlySet<string>;
      audienceCeiling?: AudienceScope;
      allowNetwork?: boolean;
    }
  ) {
    this.scopeId = policy.scopeId ?? "scoped";
    this.allowedPackages = intersectSets(inherited?.allowedPackages, toReadonlySet(policy.allowedPackages));
    this.deniedPackages = unionSets(inherited?.deniedPackages ?? new Set<string>(), toReadonlySet(policy.deniedPackages));
    this.allowedFacets = intersectSets(inherited?.allowedFacets, toReadonlySet(policy.allowedFacets));
    this.audienceCeiling = attenuateAudienceCeiling(inherited?.audienceCeiling, policy.audienceCeiling);
    this.allowNetwork =
      inherited?.allowNetwork === false || policy.allowNetwork === false
        ? false
        : (policy.allowNetwork ?? inherited?.allowNetwork);
  }

  private permitsPackage(packageId: string): boolean {
    if (this.deniedPackages.has(packageId)) return false;
    if (this.allowedPackages !== undefined && !this.allowedPackages.has(packageId)) return false;
    if (this.allowNetwork === false && this.parent.allowsNetworkAccess(packageId)) return false;
    return true;
  }

  private permitsFacet(facetId: string): boolean {
    return this.allowedFacets === undefined || this.allowedFacets.has(facetId);
  }

  listPackages(): ExtensionPackageState[] {
    return this.parent.listPackages().filter((pkg) => this.permitsPackage(pkg.manifest.extension_id));
  }

  getPackage(id: string): ExtensionPackageState | undefined {
    return this.permitsPackage(id) ? this.parent.getPackage(id) : undefined;
  }

  listFacets<T>(point: FacetPoint<T>): readonly FacetRegistration<T>[] {
    if (!this.permitsFacet(point.id)) return [];
    return this.parent
      .listFacets(point)
      .filter(
        (entry) =>
          this.permitsPackage(entry.packageId) &&
          this.allowsAudienceScope(entry.packageId, "only_owner", point.id)
      );
  }

  invokeFacet<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R): R | undefined {
    if (!this.permitsPackage(entry.packageId) || !this.permitsFacet(entry.facetId)) return undefined;
    return this.parent.invokeFacet(entry, invoke);
  }

  async invokeFacetAsync<T, R>(
    entry: FacetRegistration<T>,
    invoke: (implementation: T) => R | Promise<R>
  ): Promise<R | undefined> {
    if (!this.permitsPackage(entry.packageId) || !this.permitsFacet(entry.facetId)) return undefined;
    return this.parent.invokeFacetAsync(entry, invoke);
  }

  leaseFacet<T>(entry: FacetRegistration<T>): { signal: AbortSignal; dispose(): void } {
    if (!this.permitsPackage(entry.packageId) || !this.permitsFacet(entry.facetId)) {
      const aborted = new AbortController();
      aborted.abort(new Error(`Extension registration denied in scope ${this.scopeId}: ${entry.packageId}`));
      return { signal: aborted.signal, dispose() {} };
    }
    return this.parent.leaseFacet(entry);
  }

  bindService<I, O>(
    contract: ServiceContract<I, O>,
    providerPackageId: string,
    audience: AudienceScope = "only_owner"
  ): (input: I, signal?: AbortSignal) => Promise<O> {
    if (!this.permitsPackage(providerPackageId) || !audienceAllowedByCeiling(audience, this.audienceCeiling)) {
      throw new Error(`Service provider ${providerPackageId} is outside scope ${this.scopeId}`);
    }
    return this.parent.bindService(contract, providerPackageId, audience);
  }

  listDynamicContracts(kind?: DynamicContractKind): readonly DynamicContractSnapshot[] {
    const snapshots: DynamicContractSnapshot[] = [];
    for (const item of this.parent.listDynamicContracts(kind)) {
      const visibleHolders = item.holders.filter((pkgId) => this.permitsPackage(pkgId));
      if (visibleHolders.length === 0) continue;
      snapshots.push({
        ...structuredClone(item),
        originPackageId: this.permitsPackage(item.originPackageId) ? item.originPackageId : visibleHolders[0]!,
        holders: visibleHolders
      });
    }
    return snapshots;
  }

  getDynamicContract(
    kind: DynamicContractKind,
    namespace: string,
    name: string,
    version: number
  ): DynamicContractSnapshot | undefined {
    const id = formatDynamicContractId(kind, namespace, name, version);
    return this.listDynamicContracts(kind).find((c) => c.id === id);
  }

  validateDynamicContractPayload<T = unknown>(
    kind: DynamicContractKind,
    namespace: string,
    name: string,
    version: number,
    payload: unknown
  ): T {
    const visible = this.getDynamicContract(kind, namespace, name, version);
    if (!visible) {
      throw new Error(
        `Dynamic contract ${formatDynamicContractId(kind, namespace, name, version)} is unavailable in scope ${this.scopeId}`
      );
    }
    return this.parent.validateDynamicContractPayload<T>(kind, namespace, name, version, payload);
  }

  coerceDynamicContractPayload<T = unknown>(
    kind: DynamicContractKind,
    namespace: string,
    name: string,
    fromVersion: number,
    targetVersion: number,
    payload: unknown
  ): T {
    const visibleTarget = this.getDynamicContract(kind, namespace, name, targetVersion);
    if (!visibleTarget) {
      throw new Error(
        `Dynamic contract ${formatDynamicContractId(kind, namespace, name, targetVersion)} is unavailable in scope ${this.scopeId}`
      );
    }
    return this.parent.coerceDynamicContractPayload<T>(kind, namespace, name, fromVersion, targetVersion, payload);
  }

  allowsReadDomain(id: string, domain: StateDomain): boolean {
    return this.permitsPackage(id) && this.parent.allowsReadDomain(id, domain);
  }

  allowsProposeDomain(id: string, domain: StateDomain): boolean {
    return this.permitsPackage(id) && this.parent.allowsProposeDomain(id, domain);
  }

  allowsAudienceScope(id: string, audience: AudienceScope, facet?: string): boolean {
    if (!this.permitsPackage(id)) return false;
    if (facet !== undefined && !this.permitsFacet(facet)) return false;
    if (!audienceAllowedByCeiling(audience, this.audienceCeiling)) return false;
    return this.parent.allowsAudienceScope(id, audience, facet);
  }

  allowsNetworkAccess(id: string): boolean {
    if (this.allowNetwork === false) return false;
    return this.permitsPackage(id) && this.parent.allowsNetworkAccess(id);
  }

  createScopedView(childPolicy: ScopedExtensionPolicy): ExtensionHostView {
    return new ScopedExtensionView(this.parent, childPolicy, {
      allowedPackages: this.allowedPackages,
      deniedPackages: this.deniedPackages,
      allowedFacets: this.allowedFacets,
      audienceCeiling: this.audienceCeiling,
      allowNetwork: this.allowNetwork
    });
  }
}

export interface HookExecutionOptions {
  readonly audience?: AudienceScope;
  readonly signal?: AbortSignal;
}

export async function runWaterfallHook<TPayload>(
  host: ExtensionHostView,
  hook: HookPoint<TPayload, TPayload>,
  initialPayload: TPayload,
  options: HookExecutionOptions = {}
): Promise<TPayload> {
  let current = hook.parsePayload ? hook.parsePayload(initialPayload) : initialPayload;
  const entries = sortFacetsByPriority(host.listFacets(hook.facet));
  for (const entry of entries) {
    options.signal?.throwIfAborted();
    if (options.audience && !host.allowsAudienceScope(entry.packageId, options.audience, hook.facet.id)) {
      continue;
    }
    const next = await host.invokeFacetAsync(entry, async (handler) => {
      const output = await handler.handle(structuredClone(current), options.signal);
      return hook.parseResult
        ? hook.parseResult(output)
        : hook.parsePayload
          ? hook.parsePayload(output)
          : output;
    });
    if (next !== undefined) {
      current = next;
    }
  }
  return current;
}

export async function runBroadcastHook<TPayload>(
  host: ExtensionHostView,
  hook: HookPoint<TPayload, unknown>,
  payload: TPayload,
  options: HookExecutionOptions = {}
): Promise<number> {
  const validated = hook.parsePayload ? hook.parsePayload(payload) : payload;
  let delivered = 0;
  const entries = sortFacetsByPriority(host.listFacets(hook.facet));
  for (const entry of entries) {
    options.signal?.throwIfAborted();
    if (options.audience && !host.allowsAudienceScope(entry.packageId, options.audience, hook.facet.id)) {
      continue;
    }
    const completed = await host.invokeFacetAsync(entry, async (handler) => {
      const output = await handler.handle(structuredClone(validated), options.signal);
      if (hook.parseResult) hook.parseResult(output);
      return true;
    });
    if (completed === true) delivered += 1;
  }
  return delivered;
}
