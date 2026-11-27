import type { Ai0ExtensionManifest, AudienceScope, ExtensionServiceRef } from "@ai0/protocol";
import {
  defineServiceContract,
  intersectAudienceScopes,
  ServiceBindingError,
  type ServiceClient,
  type ServiceContract,
  type ServiceOperation,
  type ServiceStatus
} from "../kernel/service-contract.js";

type AnyContract = ServiceContract<unknown, unknown>;

export interface ServiceActivationScope {
  defineService<I, O>(contract: ServiceContract<I, O>): void;
  provideService<I, O>(contract: ServiceContract<I, O>, operation: ServiceOperation<I, O>): void;
  consumeService<I, O>(contract: ServiceContract<I, O>, target?: string | ExtensionServiceRef): ServiceClient<I, O>;
  whenServiceAvailable<I, O>(contract: ServiceContract<I, O>,
    acquired: (call: ReturnType<ServiceClient<I, O>["bind"]>) => void | (() => void), target?: string | ExtensionServiceRef): void;
}

function key(ref: ExtensionServiceRef): string {
  return JSON.stringify([ref.owner, ref.name, ref.version]);
}

interface Binding {
  status: ServiceStatus;
  fingerprint: string;
  ownerContract?: AnyContract;
  providerContract?: AnyContract;
  operation?: ServiceOperation<unknown, unknown>;
  maxAudienceScope?: AudienceScope;
}

const unavailable = (status: Exclude<ServiceStatus, { status: "bound" }>): Binding =>
  ({ status, fingerprint: JSON.stringify(status) });

interface Lease {
  ref: ExtensionServiceRef;
  contract?: AnyContract;
  binding: Binding;
  revision: number;
  lifetime: AbortController;
}

interface ProvidedService {
  contract: AnyContract;
  operation: ServiceOperation<unknown, unknown>;
}

function bindLease<I, O>(consumerContract: ServiceContract<I, O>, lease: Lease, live: () => boolean, audience: AudienceScope, caller?: string) {
  const validatedConsumer = defineServiceContract(consumerContract);
  if (!live()) throw new ServiceBindingError(validatedConsumer, { status: "revoked" });
  const { binding, revision, lifetime } = lease;
  if (binding.status.status !== "bound") throw new ServiceBindingError(validatedConsumer, binding.status);
  const ceiling = binding.maxAudienceScope!;
  if (intersectAudienceScopes(audience, ceiling) !== audience) throw new ServiceBindingError(validatedConsumer, { status: "denied" });
  const assertLive = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!live() || lease.revision !== revision) throw new ServiceBindingError(validatedConsumer, { status: "revoked" });
  };
  return async (input: I, signal?: AbortSignal): Promise<O> => {
    const combined = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    assertLive(combined);
    let value: unknown = validatedConsumer.parseInput(input);
    if (binding.ownerContract && binding.ownerContract !== validatedConsumer) {
      value = binding.ownerContract.parseInput(value);
    }
    if (binding.providerContract && binding.providerContract !== validatedConsumer && binding.providerContract !== binding.ownerContract) {
      value = binding.providerContract.parseInput(value);
    }
    assertLive(combined);
    let rejectOnAbort!: () => void;
    const revoked = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(combined.reason);
      combined.addEventListener("abort", rejectOnAbort, { once: true });
    });
    try {
      const operation = new Promise<unknown>(resolve => {
        resolve(binding.operation!(value, combined, { audience, maxAudienceScope: ceiling, caller }));
      });
      const output = await Promise.race([operation, revoked]);
      assertLive(combined);
      let verified: unknown = output;
      if (binding.ownerContract) {
        verified = binding.ownerContract.parseOutput(verified);
      }
      const parsed = validatedConsumer.parseOutput(verified) as O;
      if (binding.providerContract && binding.providerContract !== validatedConsumer && binding.providerContract !== binding.ownerContract) {
        binding.providerContract.parseOutput(output);
      }
      assertLive(combined);
      return parsed;
    } finally {
      combined.removeEventListener("abort", rejectOnAbort);
    }
  };
}

/** A directory belongs to one host (e.g. a live instance or an isolated sandbox). */
export class ServiceDirectory {
  private readonly active = new Map<string, ServiceActivation>();
  private readonly grants = new Map<string, Map<string, boolean>>();
  private readonly selection = new Map<string, string>();
  private readonly hostLeases = new Map<string, Lease & { provider: string }>();
  private revision = 0;

  prepare(manifest: Ai0ExtensionManifest, generation: number) {
    return new ServiceActivation(this, manifest, generation);
  }

  publish(activation: ServiceActivation) {
    this.active.set(activation.manifest.extension_id, activation);
    activation.seal();
    this.refresh();
  }

  withdraw(id: string) {
    const current = this.active.get(id);
    if (!current) return;
    this.active.delete(id);
    for (const lease of current.dependencies.values())
      lease.lifetime.abort(new ServiceBindingError(lease.ref, { status: "revoked" }));
    current.releaseEffects();
    this.refresh();
  }

  setAccess(consumer: string, ref: ExtensionServiceRef, allowed: boolean) {
    const refs = this.grants.get(consumer) ?? new Map<string, boolean>();
    refs.set(key(ref), allowed);
    this.grants.set(consumer, refs);
    this.refresh();
  }

  select(ref: ExtensionServiceRef, provider?: string) {
    if (provider === undefined) this.selection.delete(key(ref));
    else this.selection.set(key(ref), provider);
    this.refresh();
  }

  private refresh() {
    const update = (lease: Lease, binding: Binding) => {
      if (binding.fingerprint !== lease.binding.fingerprint) {
        const prior = lease.lifetime;
        lease.lifetime = new AbortController();
        lease.revision = ++this.revision;
        lease.binding = binding;
        prior.abort(new ServiceBindingError(lease.ref, { status: "revoked" }));
      }
    };
    for (const activation of this.active.values()) {
      for (const lease of activation.dependencies.values()) {
        update(lease, this.resolve(activation, lease.ref, new Set(), undefined, lease.contract));
      }
    }
    for (const [id, lease] of this.hostLeases) {
      update(lease, this.resolve(undefined, lease.ref, new Set(), lease.provider, lease.contract));
      if (lease.binding.status.status !== "bound") this.hostLeases.delete(id);
    }
    for (const activation of this.active.values()) activation.refreshEffects();
  }

  bindForHost<I, O>(ref: ServiceContract<I, O>, provider: string, audience: AudienceScope) {
    const contract = defineServiceContract(ref);
    const id = JSON.stringify([key(contract), provider]);
    let lease = this.hostLeases.get(id);
    if (!lease) {
      const binding = this.resolve(undefined, contract, new Set(), provider, contract);
      if (binding.status.status !== "bound") throw new ServiceBindingError(contract, binding.status);
      lease = { ref: contract, contract, provider, binding, revision: ++this.revision, lifetime: new AbortController() };
      this.hostLeases.set(id, lease);
    }
    return bindLease(contract, lease, () => this.hostLeases.get(id) === lease, audience);
  }

  private resolve(
    consumer: ServiceActivation | undefined,
    ref: ExtensionServiceRef,
    visiting: Set<string>,
    pin?: string,
    consumerContract?: AnyContract
  ): Binding {
    const id = key(ref);
    const owner = this.active.get(ref.owner);
    const ownerContract = owner?.contracts.get(id);
    if (owner && owner.manifest.services?.defines?.some(entry => key(entry) === id) && !ownerContract) {
      return unavailable({ status: "missing" });
    }
    if (visiting.has(id)) return unavailable({ status: "cycle" });
    const selected = pin ?? this.selection.get(id);
    const providers = [...this.active.values()].filter(pkg => pkg.providers.has(id) &&
      (selected === undefined || pkg.manifest.extension_id === selected));
    const singleProvided = providers.length === 1 ? providers[0]!.providers.get(id) : undefined;
    const explicitAccess = ownerContract?.access === "explicit" ||
      consumerContract?.access === "explicit" ||
      singleProvided?.contract.access === "explicit";
    if (consumer) {
      const grant = this.grants.get(consumer.manifest.extension_id)?.get(id);
      if (!(grant ?? !explicitAccess)) return unavailable({ status: "denied" });
    }
    if (providers.length === 0) return unavailable({ status: "missing" });
    if (providers.length > 1) {
      return unavailable({ status: "ambiguous", providers: providers.map(pkg => pkg.manifest.extension_id).sort() });
    }
    const provider = providers[0]!;
    const provided = provider.providers.get(id)!;
    let ceiling = provider.manifest.permissions.max_audience_scope;
    if (owner && ownerContract) {
      ceiling = intersectAudienceScopes(ceiling, owner.manifest.permissions.max_audience_scope);
    }
    if (consumer) {
      ceiling = intersectAudienceScopes(ceiling, consumer.manifest.permissions.max_audience_scope);
    }
    const dependencies: string[] = [];
    const ancestors = new Set(visiting).add(id);
    const declared = provider.manifest.services;
    for (const edge of declared?.requires ?? []) {
      if (edge.facet || (edge.service && key(edge.service) !== id)) continue;
      const depLease = provider.dependencies.get(key(edge));
      const binding = this.resolve(provider, edge, ancestors, undefined, depLease?.contract);
      if (binding.status.status !== "bound") return binding;
      ceiling = intersectAudienceScopes(ceiling, binding.maxAudienceScope!);
      dependencies.push(binding.fingerprint);
    }
    for (const edge of declared?.optional ?? []) {
      if (edge.facet || (edge.service && key(edge.service) !== id)) continue;
      const depLease = provider.dependencies.get(key(edge));
      const binding = this.resolve(provider, edge, ancestors, undefined, depLease?.contract);
      if (binding.maxAudienceScope) ceiling = intersectAudienceScopes(ceiling, binding.maxAudienceScope);
      dependencies.push(binding.fingerprint);
    }
    return {
      status: { status: "bound", provider: provider.manifest.extension_id },
      fingerprint: `${owner && ownerContract ? owner.generation : "static"}/${provider.generation}(${dependencies.join(",")})`,
      ownerContract,
      providerContract: provided.contract,
      operation: provided.operation,
      maxAudienceScope: ceiling
    };
  }

  current(activation: ServiceActivation) {
    return this.active.get(activation.manifest.extension_id) === activation;
  }
}

export class ServiceActivation implements ServiceActivationScope {
  readonly contracts = new Map<string, AnyContract>();
  readonly providers = new Map<string, ProvidedService>();
  readonly dependencies = new Map<string, Lease>();
  private activating = true;
  private readonly effects: { update(): void; release(): void }[] = [];
  effectError?: string;

  constructor(private readonly directory: ServiceDirectory, readonly manifest: Ai0ExtensionManifest, readonly generation: number) {
    for (const ref of [...manifest.services?.requires ?? [], ...manifest.services?.optional ?? []]) {
      this.dependencies.set(key(ref), { ref, binding: unavailable({ status: "missing" }), revision: 0, lifetime: new AbortController() });
    }
  }

  seal() { this.activating = false; }

  refreshEffects() {
    for (const effect of this.effects) {
      try { effect.update(); } catch (error) { this.effectError = String(error); }
    }
  }
  releaseEffects() {
    for (const effect of this.effects.splice(0).reverse()) {
      try { effect.release(); } catch (error) { this.effectError = String(error); }
    }
  }
  whenServiceAvailable<I, O>(ref: ServiceContract<I, O>, acquired: (call: ReturnType<ServiceClient<I, O>["bind"]>) => void | (() => void),
    target?: string | ExtensionServiceRef) {
    const client = this.consumeService(ref, target);
    const lease = this.dependencies.get(key(ref))!;
    let revision = -1;
    let cleanup: void | (() => void);
    const release = () => { const stop = cleanup; cleanup = undefined; if (stop) stop(); };
    this.effects.push({ release, update: () => {
      if (lease.revision === revision) return;
      revision = lease.revision;
      release();
      if (client.status().status === "bound") {
        const current = revision;
        const stop = acquired(client.bind());
        if (!this.directory.current(this) || lease.revision !== current) { if (stop) stop(); }
        else cleanup = stop;
      }
    } });
  }

  waiting() {
    return this.manifest.services?.requires?.some(ref => !ref.facet && !ref.service && this.dependencies.get(key(ref))?.binding.status.status !== "bound") ?? false;
  }

  allowsAudience(audience: AudienceScope, facet?: string) {
    return [...this.manifest.services?.requires ?? [], ...this.manifest.services?.optional ?? []].every(ref => {
      if (ref.service || (ref.facet && ref.facet !== facet)) return true;
      const ceiling = this.dependencies.get(key(ref))?.binding.maxAudienceScope;
      return !ceiling || intersectAudienceScopes(audience, ceiling) === audience;
    });
  }

  defineService<I, O>(contract: ServiceContract<I, O>): void {
    const id = key(contract);
    if (!this.activating || this.manifest.extension_id !== contract.owner || this.contracts.has(id) ||
        !this.manifest.services?.defines?.some(ref => key(ref) === id)) throw new Error("Service definition denied: " + id);
    this.contracts.set(id, defineServiceContract(contract));
  }

  provideService<I, O>(contract: ServiceContract<I, O>, operation: ServiceOperation<I, O>): void {
    const id = key(contract);
    if (!this.activating || typeof operation !== "function" || this.providers.has(id) ||
        !this.manifest.services?.provides?.some(ref => key(ref) === id)) throw new Error("Service provision denied: " + id);
    this.providers.set(id, {
      contract: defineServiceContract(contract) as AnyContract,
      operation: operation as ServiceOperation<unknown, unknown>
    });
  }

  facetBinding(facet: string): string | undefined {
    const revisions = [];
    for (const ref of this.manifest.services?.requires ?? []) {
      if (ref.service || (ref.facet && ref.facet !== facet)) continue;
      const lease = this.dependencies.get(key(ref))!;
      if (lease.binding.status.status !== "bound") return undefined;
      revisions.push(lease.revision);
    }
    // Optional dependencies keep the facet available, but invalidate an in-flight handle on change.
    for (const ref of this.manifest.services?.optional ?? []) {
      if (!ref.service && (!ref.facet || ref.facet === facet)) revisions.push(this.dependencies.get(key(ref))!.revision);
    }
    return JSON.stringify(revisions);
  }

  consumeService<I, O>(contract: ServiceContract<I, O>, target?: string | ExtensionServiceRef): ServiceClient<I, O> {
    const validated = defineServiceContract(contract);
    const id = key(validated);
    const edges = [...this.manifest.services?.requires ?? [], ...this.manifest.services?.optional ?? []];
    const declared = edges.some(ref => key(ref) === id && (!ref.facet || ref.facet === target) &&
      (!ref.service || (typeof target === "object" && key(ref.service) === key(target))));
    if (!this.activating || !declared) {
      throw new ServiceBindingError(validated, { status: "denied" });
    }
    const lease = this.dependencies.get(id)!;
    lease.contract = validated as AnyContract;
    const status = (): ServiceStatus => this.directory.current(this) ? structuredClone(lease.binding.status) : { status: "revoked" };
    return {
      status,
      bind: (audience = "only_owner") => bindLease(validated, lease, () => this.directory.current(this), audience, this.manifest.extension_id)
    };
  }

  diagnostics() {
    return [...this.dependencies.values()].map(({ ref, binding }) =>
      ({ service: { owner: ref.owner, name: ref.name, version: ref.version }, ...structuredClone(binding.status) }));
  }
}
