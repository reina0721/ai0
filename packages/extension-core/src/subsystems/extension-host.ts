import { Ai0ExtensionManifestSchema, type Ai0ExtensionManifest, type AudienceScope, type StateDomain, type ExtensionServiceRef } from "@ai0/protocol";
import type { FacetPoint } from "../kernel/facet-point.js";
import { ServiceBindingError, type ServiceContract, type ServiceStatus } from "../kernel/service-contract.js";
import { ServiceDirectory, type ServiceActivation, type ServiceActivationScope } from "./service-directory.js";

export type PackageConfig = Readonly<Record<string, unknown>>;
export interface ExtensionActivationScope extends ServiceActivationScope {
  contributeFacet<T>(point: FacetPoint<T>, implementation: T): void;
  onDispose(dispose: () => void): void;
}
export interface ExtensionPackageDefinition {
  manifest: Ai0ExtensionManifest;
  activate?(scope: ExtensionActivationScope, config: PackageConfig): void | (() => void);
}
export interface FacetRegistration<T> {
  readonly packageId: string;
  readonly facetId: string;
  readonly generation: number;
  readonly implementation: T;
}
export interface ExtensionPackageState {
  manifest: Ai0ExtensionManifest;
  config: PackageConfig;
  enabled: boolean;
  rev: number;
  status: "active" | "disabled" | "waiting_dependencies" | "faulted_isolated";
  lastError?: string;
  serviceBindings?: (ServiceStatus & { service: ExtensionServiceRef })[];
}
interface MountedPackage extends ExtensionPackageState {
  activate: ExtensionPackageDefinition["activate"];
  services?: ServiceActivation;
  registrations: {
    point: FacetPoint<unknown>; raw: unknown; declared: unknown; generation: number; binding?: string;
    views: WeakMap<FacetPoint<unknown>, FacetRegistration<unknown>>;
  }[];
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
  private readonly services = new ServiceDirectory();
  private readonly issued = new WeakMap<FacetRegistration<unknown>, { registration: MountedPackage["registrations"][number]; binding: string }>();
  private readonly revoked = new Set<() => void>();
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

  setServiceAccess(consumer: string, ref: ExtensionServiceRef, allowed: boolean): void {
    this.services.setAccess(consumer, ref, allowed);
    this.notifyRevocations();
  }

  selectServiceProvider(ref: ExtensionServiceRef, packageId?: string): void {
    this.services.select(ref, packageId);
    this.notifyRevocations();
  }

  bindService<I, O>(contract: ServiceContract<I, O>, providerPackageId: string, audience: AudienceScope = "only_owner") {
    return this.services.bindForHost(contract, providerPackageId, audience);
  }

  /** End pending work immediately when this exact registration or one of its declared bindings expires. */
  leaseFacet<T>(entry: FacetRegistration<T>): { signal: AbortSignal; dispose(): void } {
    const controller = new AbortController();
    const check = () => {
      if (this.livePackage(entry)) return;
      this.revoked.delete(check);
      controller.abort(new Error("Extension registration revoked: " + entry.packageId));
    };
    this.revoked.add(check);
    check();
    return { signal: controller.signal, dispose: () => { this.revoked.delete(check); } };
  }

  private notifyRevocations() {
    for (const check of [...this.revoked]) check();
  }

  listFacets<T>(point: FacetPoint<T>): readonly FacetRegistration<T>[] {
    const result: FacetRegistration<T>[] = [];
    for (const pkg of this.packages.values()) {
      if (pkg.status !== "active") continue;
      const binding = pkg.services?.facetBinding(point.id);
      if (binding === undefined) continue;
      for (const registration of pkg.registrations) {
        if (registration.point.id !== point.id || registration.point.version !== point.version) continue;
        if (registration.binding !== binding) {
          registration.binding = binding;
          registration.generation = ++this.generation;
          registration.views = new WeakMap();
        }
        let entry = registration.views.get(point) as FacetRegistration<T> | undefined;
        if (!entry) {
          try {
            entry = Object.freeze({ packageId: pkg.manifest.extension_id, facetId: point.id, generation: registration.generation,
              implementation: point === registration.point ? registration.declared as T : point.parse(registration.raw) });
          } catch (error) {
            this.isolate(pkg, error);
            break;
          }
          registration.views.set(point, entry);
          this.issued.set(entry, { registration, binding });
        }
        result.push(entry);
      }
    }
    return result.filter(entry => this.livePackage(entry));
  }

  invokeFacet<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R): R | undefined {
    const pkg = this.livePackage(entry);
    if (!pkg) return undefined;
    try {
      const result = invoke(entry.implementation);
      return this.livePackage(entry) ? result : undefined;
    } catch (error) {
      if (!(error instanceof ServiceBindingError) && this.livePackage(entry)) this.transition(entry.packageId, () => this.isolate(pkg, error));
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
      if (!(error instanceof ServiceBindingError) && this.livePackage(entry)) this.isolate(pkg, error);
      return undefined;
    }
  }

  allowsReadDomain(id: string, domain: StateDomain): boolean {
    return this.permissions(id)?.read_blackboard_domains.includes(domain) === true;
  }

  allowsProposeDomain(id: string, domain: StateDomain): boolean {
    return this.permissions(id)?.propose_mutation_domains.includes(domain) === true;
  }

  allowsAudienceScope(id: string, audience: AudienceScope, facet?: string): boolean {
    const ceiling = this.permissions(id)?.max_audience_scope;
    return ceiling !== undefined && (audience === "only_owner" || audience === ceiling || ceiling === "public_all") &&
      this.packages.get(id)?.services?.allowsAudience(audience, facet) === true;
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
      this.notifyRevocations();
    }
  }

  private permissions(id: string) {
    const pkg = this.packages.get(id);
    return pkg?.status === "active" ? pkg.manifest.permissions : undefined;
  }

  private snapshot({ manifest, config, status, enabled, rev, lastError, services }: MountedPackage): ExtensionPackageState {
    lastError ??= services?.effectError;
    return structuredClone({ manifest, config, status: status === "active" && services?.waiting() ? "waiting_dependencies" : status, enabled, rev, ...(lastError === undefined ? {} : { lastError }),
      ...(services?.dependencies.size ? { serviceBindings: services.diagnostics() } : {}) });
  }

  private require(id: string): MountedPackage {
    const pkg = this.packages.get(id);
    if (!pkg) throw new Error(`Unknown package: ${id}`);
    return pkg;
  }

  private livePackage(entry: FacetRegistration<unknown>) {
    const pkg = this.packages.get(entry.packageId);
    const view = this.issued.get(entry);
    return pkg?.status === "active" && view && pkg.registrations.includes(view.registration) &&
      pkg.services?.facetBinding(view.registration.point.id) === view.binding ? pkg : undefined;
  }

  private start(pkg: MountedPackage): void {
    const generation = ++this.generation;
    const services = this.services.prepare(pkg.manifest, generation);
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
        defineService: services.defineService.bind(services),
        provideService: services.provideService.bind(services),
        consumeService: services.consumeService.bind(services),
        whenServiceAvailable: services.whenServiceAvailable.bind(services),
        contributeFacet(point, implementation) {
          if (!activating || !pkg.manifest.facets.includes(point.id)) {
            throw new Error(`Facet contribution denied: ${point.id}`);
          }
          registrations.push({ point, raw: implementation, declared: point.parse(implementation), generation, views: new WeakMap() });
        },
        onDispose: dispose
      }, structuredClone(pkg.config));
      if (cleanup) dispose(cleanup);
      pkg.registrations = registrations;
      pkg.disposers = disposers;
      pkg.status = "active";
      pkg.services = services;
      this.services.publish(services);
    } catch (error) {
      pkg.disposers = disposers;
      this.isolate(pkg, error);
    } finally {
      activating = false;
      services.seal();
    }
  }

  private stop(pkg: MountedPackage, status: MountedPackage["status"]): void {
    pkg.status = status;
    this.services.withdraw(pkg.manifest.extension_id);
    pkg.services = undefined;
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
    this.notifyRevocations();
  }
}
