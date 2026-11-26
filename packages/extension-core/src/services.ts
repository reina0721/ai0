import { ExtensionServiceRefSchema, type Ai0ExtensionManifest, type AudienceScope, type ExtensionServiceRef } from "@ai0/protocol";

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

export interface ServiceCallContext { caller?: string; audience: AudienceScope; maxAudienceScope: AudienceScope }
type ServiceOperation<I, O> = (value: I, signal: AbortSignal | undefined, context: ServiceCallContext) => O | Promise<O>;
function intersect(a: AudienceScope, b: AudienceScope): AudienceScope {
  return a === b || b === "public_all" ? a : a === "public_all" ? b : "only_owner";
}
type AnyContract = ServiceContract<unknown, unknown>;
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
  contract?: AnyContract;
  operation?: ServiceOperation<unknown, unknown>;
  maxAudienceScope?: AudienceScope;
}

const unavailable = (status: Exclude<ServiceStatus, { status: "bound" }>): Binding =>
  ({ status, fingerprint: JSON.stringify(status) });

interface Lease {
  ref: ExtensionServiceRef;
  binding: Binding;
  revision: number;
  lifetime: AbortController;
}

function bindLease<I, O>(ref: ServiceContract<I, O>, lease: Lease, live: () => boolean, audience: AudienceScope, caller?: string) {
  if (!live()) throw new ServiceBindingError(ref, { status: "revoked" });
  const { binding, revision, lifetime } = lease;
  if (binding.status.status !== "bound") throw new ServiceBindingError(ref, binding.status);
  const ceiling = binding.maxAudienceScope!;
  if (intersect(audience, ceiling) !== audience) throw new ServiceBindingError(ref, { status: "denied" });
  const assertLive = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!live() || lease.revision !== revision) throw new ServiceBindingError(ref, { status: "revoked" });
  };
  return async (input: I, signal?: AbortSignal): Promise<O> => {
    const combined = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    assertLive(combined);
    const value = binding.contract!.parseInput(input);
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
      const parsed = binding.contract!.parseOutput(output) as O;
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
        update(lease, this.resolve(activation, lease.ref, new Set()));
      }
    }
    for (const [id, lease] of this.hostLeases) {
      update(lease, this.resolve(undefined, lease.ref, new Set(), lease.provider));
      if (lease.binding.status.status !== "bound") this.hostLeases.delete(id);
    }
    for (const activation of this.active.values()) activation.refreshEffects();
  }

  bindForHost<I, O>(ref: ServiceContract<I, O>, provider: string, audience: AudienceScope) {
    const id = JSON.stringify([key(ref), provider]);
    let lease = this.hostLeases.get(id);
    if (!lease) {
      const binding = this.resolve(undefined, ref, new Set(), provider);
      if (binding.status.status !== "bound") throw new ServiceBindingError(ref, binding.status);
      lease = { ref, provider, binding, revision: ++this.revision, lifetime: new AbortController() };
      this.hostLeases.set(id, lease);
    }
    return bindLease(ref, lease, () => this.hostLeases.get(id) === lease, audience);
  }

  private resolve(consumer: ServiceActivation | undefined, ref: ExtensionServiceRef, visiting: Set<string>, pin?: string): Binding {
    const id = key(ref);
    const owner = this.active.get(ref.owner);
    const contract = owner?.contracts.get(id);
    if (!owner || !contract) return unavailable({ status: "missing" });
    if (consumer) {
      const grant = this.grants.get(consumer.manifest.extension_id)?.get(id);
      if (!(grant ?? (contract.access !== "explicit"))) return unavailable({ status: "denied" });
    }
    if (visiting.has(id)) return unavailable({ status: "cycle" });
    const selected = pin ?? this.selection.get(id);
    const providers = [...this.active.values()].filter(pkg => pkg.providers.has(id) &&
      (selected === undefined || pkg.manifest.extension_id === selected));
    if (providers.length === 0) return unavailable({ status: "missing" });
    if (providers.length > 1) return unavailable({ status: "ambiguous", providers: providers.map(pkg => pkg.manifest.extension_id).sort() });
    const provider = providers[0]!;
    let ceiling = intersect(provider.manifest.permissions.max_audience_scope, owner.manifest.permissions.max_audience_scope);
    if (consumer) ceiling = intersect(ceiling, consumer.manifest.permissions.max_audience_scope);
    const dependencies: string[] = [];
    const ancestors = new Set(visiting).add(id);
    const declared = provider.manifest.services;
    for (const edge of declared?.requires ?? []) {
      if (edge.facet || (edge.service && key(edge.service) !== id)) continue;
      const binding = this.resolve(provider, edge, ancestors);
      if (binding.status.status !== "bound") return binding;
      ceiling = intersect(ceiling, binding.maxAudienceScope!);
      dependencies.push(binding.fingerprint);
    }
    for (const edge of declared?.optional ?? []) {
      if (edge.facet || (edge.service && key(edge.service) !== id)) continue;
      const binding = this.resolve(provider, edge, ancestors);
      if (binding.maxAudienceScope) ceiling = intersect(ceiling, binding.maxAudienceScope);
      dependencies.push(binding.fingerprint);
    }
    return {
      status: { status: "bound", provider: provider.manifest.extension_id },
      fingerprint: `${owner.generation}/${provider.generation}(${dependencies.join(",")})`,
      contract, operation: provider.providers.get(id)!, maxAudienceScope: ceiling
    };
  }

  current(activation: ServiceActivation) {
    return this.active.get(activation.manifest.extension_id) === activation;
  }
}

export class ServiceActivation implements ServiceActivationScope {
  readonly contracts = new Map<string, AnyContract>();
  readonly providers = new Map<string, ServiceOperation<unknown, unknown>>();
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
      return !ceiling || intersect(audience, ceiling) === audience;
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
    this.providers.set(id, operation as ServiceOperation<unknown, unknown>);
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
    const id = key(contract);
    const edges = [...this.manifest.services?.requires ?? [], ...this.manifest.services?.optional ?? []];
    const declared = edges.some(ref => key(ref) === id && (!ref.facet || ref.facet === target) &&
      (!ref.service || (typeof target === "object" && key(ref.service) === key(target))));
    if (!this.activating || !declared) {
      throw new ServiceBindingError(contract, { status: "denied" });
    }
    const lease = this.dependencies.get(id)!;
    const status = (): ServiceStatus => this.directory.current(this) ? structuredClone(lease.binding.status) : { status: "revoked" };
    return {
      status,
      bind: (audience = "only_owner") => bindLease(contract, lease, () => this.directory.current(this), audience, this.manifest.extension_id)
    };
  }

  diagnostics() {
    return [...this.dependencies.values()].map(({ ref, binding }) =>
      ({ service: { owner: ref.owner, name: ref.name, version: ref.version }, ...structuredClone(binding.status) }));
  }
}
