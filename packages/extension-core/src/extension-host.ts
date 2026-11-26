import { Ai0ExtensionManifestSchema, type Ai0ExtensionManifest, type AudienceScope, type StateDomain } from "@ai0/protocol";
import type { FacetPoint } from "./facet-point.js";

export type PackageConfig = Readonly<Record<string, unknown>>;
export interface ExtensionActivationScope {
  contributeFacet<T>(point: FacetPoint<T>, implementation: T): void;
  onDispose(dispose: () => void): void;
}
export interface ExtensionPackageDefinition {
  manifest: Ai0ExtensionManifest;
  activate?(scope: ExtensionActivationScope, config: PackageConfig): void | (() => void);
}
export interface FacetRegistration<T> {
  readonly packageId: string;
  readonly generation: number;
  readonly implementation: T;
}
export interface ExtensionPackageState {
  manifest: Ai0ExtensionManifest;
  config: PackageConfig;
  enabled: boolean;
  rev: number;
  status: "active" | "disabled" | "faulted_isolated";
  lastError?: string;
}
interface MountedPackage extends ExtensionPackageState {
  activate: ExtensionPackageDefinition["activate"];
  registrations: { point: FacetPoint<unknown>; entry: FacetRegistration<unknown> }[];
  disposers: (() => void)[];
}

export function sortFacetsByPriority<T extends { priority?: number }>(facets: readonly FacetRegistration<T>[]) {
  return [...facets].sort((a, b) => (a.implementation.priority ?? 0) - (b.implementation.priority ?? 0)
    || (a.packageId < b.packageId ? -1 : a.packageId > b.packageId ? 1 : 0));
}

export class ExtensionCoreHost {
  private readonly packages = new Map<string, MountedPackage>();
  private readonly transitioning = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private generation = 0;

  registerPackage(definition: ExtensionPackageDefinition, config: PackageConfig = {}) {
    return this.mountPackage(definition, config);
  }

  mountPackage(definition: ExtensionPackageDefinition, config: PackageConfig = {}) {
    const manifest = Ai0ExtensionManifestSchema.parse(definition.manifest);
    const id = manifest.extension_id;
    if (this.packages.has(id)) throw new Error(`Package already mounted: ${id}`);
    const pkg: MountedPackage = {
      manifest, activate: definition.activate, config: structuredClone(config), rev: (this.revisions.get(id) ?? -1) + 1,
      enabled: true, status: "disabled", registrations: [], disposers: []
    };
    this.transition(id, () => {
      this.packages.set(id, pkg);
      this.revisions.set(id, pkg.rev);
      this.start(pkg);
    });
    return this.snapshot(pkg);
  }

  unmountPackage(id: string): boolean {
    const pkg = this.packages.get(id);
    if (!pkg) return false;
    this.transition(id, () => {
      this.packages.delete(id);
      this.stop(pkg, "disabled");
    });
    return true;
  }

  setPackageEnabled(id: string, enabled: boolean): void {
    const pkg = this.require(id);
    if (pkg.enabled === enabled && pkg.status !== "faulted_isolated") return;
    this.transition(id, () => {
      pkg.enabled = enabled;
      if (enabled) this.start(pkg);
      else this.stop(pkg, "disabled");
    });
  }

  hotReloadPackage(id: string, config: PackageConfig, expectedRev: number): number {
    return this.configurePackage(id, config, expectedRev);
  }

  configurePackage(id: string, config: PackageConfig, expectedRev: number): number {
    const pkg = this.require(id);
    if (pkg.rev !== expectedRev) throw new Error(`Extension revision conflict: expected ${expectedRev}, current ${pkg.rev}`);
    const nextConfig = structuredClone(config);
    this.transition(id, () => {
      pkg.config = nextConfig;
      this.revisions.set(id, ++pkg.rev);
      this.stop(pkg, "disabled");
      if (pkg.enabled) this.start(pkg);
    });
    return pkg.rev;
  }

  listPackages(): ExtensionPackageState[] {
    return [...this.packages.values()].map(pkg => this.snapshot(pkg));
  }

  getPackage(id: string): ExtensionPackageState | undefined {
    const pkg = this.packages.get(id);
    return pkg && this.snapshot(pkg);
  }

  listFacets<T>(point: FacetPoint<T>): readonly FacetRegistration<T>[] {
    return [...this.packages.values()].filter(pkg => pkg.status === "active")
      .flatMap(pkg => pkg.registrations.filter(item => item.point.id === point.id && item.point.version === point.version)
        .map(item => item.entry as FacetRegistration<T>));
  }

  invokeFacet<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R): R | undefined {
    const pkg = this.livePackage(entry);
    if (!pkg) return undefined;
    try {
      const result = invoke(entry.implementation);
      return this.livePackage(entry) ? result : undefined;
    } catch (error) {
      if (this.livePackage(entry)) this.transition(entry.packageId, () => this.isolate(pkg, error));
      return undefined;
    }
  }

  async invokeFacetAsync<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R | Promise<R>): Promise<R | undefined> {
    const pkg = this.livePackage(entry);
    if (!pkg) return undefined;
    try {
      const result = await invoke(entry.implementation);
      return this.livePackage(entry) ? result : undefined;
    } catch (error) {
      if (this.livePackage(entry)) this.isolate(pkg, error);
      return undefined;
    }
  }

  allowsReadDomain(id: string, domain: StateDomain): boolean {
    return this.permissions(id)?.read_blackboard_domains.includes(domain) === true;
  }

  allowsProposeDomain(id: string, domain: StateDomain): boolean {
    return this.permissions(id)?.propose_mutation_domains.includes(domain) === true;
  }

  allowsAudienceScope(id: string, audience: AudienceScope): boolean {
    const ceiling = this.permissions(id)?.max_audience_scope;
    return ceiling !== undefined && (audience === "only_owner" || audience === ceiling || ceiling === "public_all");
  }

  allowsNetworkAccess(id: string): boolean {
    return this.permissions(id)?.network_access === true;
  }

  private transition(id: string, update: () => void): void {
    if (this.transitioning.has(id)) throw new Error(`Package lifecycle is already changing: ${id}`);
    this.transitioning.add(id);
    try {
      update();
    } finally {
      this.transitioning.delete(id);
    }
  }

  private permissions(id: string) {
    const pkg = this.packages.get(id);
    return pkg?.status === "active" ? pkg.manifest.permissions : undefined;
  }

  private snapshot({ manifest, config, status, enabled, rev, lastError }: MountedPackage): ExtensionPackageState {
    return structuredClone({ manifest, config, status, enabled, rev, ...(lastError === undefined ? {} : { lastError }) });
  }

  private require(id: string): MountedPackage {
    const pkg = this.packages.get(id);
    if (!pkg) throw new Error(`Unknown package: ${id}`);
    return pkg;
  }

  private livePackage(entry: FacetRegistration<unknown>) {
    const pkg = this.packages.get(entry.packageId);
    return pkg?.status === "active" && pkg.registrations.some(item => item.entry === entry) ? pkg : undefined;
  }

  private start(pkg: MountedPackage): void {
    const packageId = pkg.manifest.extension_id;
    const generation = ++this.generation;
    const registrations: MountedPackage["registrations"] = [];
    const disposers: MountedPackage["disposers"] = [];
    let activating = true;
    const dispose = (cleanup: () => void) => {
      if (!activating) throw new Error("Extension activation has ended");
      disposers.push(cleanup);
    };
    pkg.lastError = undefined;
    try {
      const cleanup = pkg.activate?.({
        contributeFacet(point, implementation) {
          if (!activating || !pkg.manifest.facets.includes(point.id)) {
            throw new Error(`Facet contribution denied: ${point.id}`);
          }
          registrations.push({ point, entry: Object.freeze({ packageId, generation, implementation: point.parse(implementation) }) });
        },
        onDispose: dispose
      }, structuredClone(pkg.config));
      if (cleanup) dispose(cleanup);
      pkg.registrations = registrations;
      pkg.disposers = disposers;
      pkg.status = "active";
    } catch (error) {
      pkg.disposers = disposers;
      this.isolate(pkg, error);
    } finally {
      activating = false;
    }
  }

  private stop(pkg: MountedPackage, status: MountedPackage["status"]): void {
    pkg.status = status;
    pkg.registrations = [];
    for (const dispose of pkg.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        pkg.lastError ??= error instanceof Error ? error.message : String(error);
      }
    }
  }

  private isolate(pkg: MountedPackage, error: unknown): void {
    pkg.lastError = error instanceof Error ? error.message : String(error);
    this.stop(pkg, "faulted_isolated");
  }
}
