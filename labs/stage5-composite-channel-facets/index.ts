import type { Coverage } from "../stage2-airi-dissection/index.js";
import type { RealizerCapability } from "../stage3-perception-expression/index.js";

export type CoreOwner = "agent" | "perception" | "cognition" | "expression" | "console";
const audienceRanks = { only_owner: 0, direct_peer: 1, "group:default": 2, public_all: 3 } as const;
export type AudienceScopeRank = keyof typeof audienceRanks;
export type ChannelAudienceScope = AudienceScopeRank;

function allowsAudience(scope: ChannelAudienceScope, ceiling: AudienceScopeRank) {
  return Object.hasOwn(audienceRanks, scope) && Object.hasOwn(audienceRanks, ceiling)
    && audienceRanks[scope] <= audienceRanks[ceiling];
}

export interface FacetPoint<T> {
  readonly owner: CoreOwner;
  readonly name: string;
  readonly id: string;
  readonly version: number;
  parse(raw: unknown): T;
}

export function defineFacetPoint<T>(contract: Omit<FacetPoint<T>, "id">): FacetPoint<T> {
  return Object.freeze({ ...contract, id: `${contract.owner}.${contract.name}` });
}

export interface ExtensionPermissions {
  readonly readDomains: readonly string[];
  readonly proposeDomains: readonly string[];
  readonly maxAudienceScope: AudienceScopeRank;
  readonly networkAccess: boolean;
}

export interface ExtensionPackageManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly permissions: ExtensionPermissions;
  readonly facets: readonly string[];
}

export interface ExtensionPackageDefinition<TConfig = Record<string, unknown>> extends ExtensionPackageManifest {
  activate(scope: ExtensionActivationScope, config: Readonly<TConfig>): void | (() => void);
}

export interface ExtensionActivationScope {
  contributeFacet<T>(point: FacetPoint<T>, implementation: T): void;
  onDispose(dispose: () => void): void;
  readDomain(domain: string): unknown;
  proposeDomainMutation(domain: string, value: unknown): void;
  withNetworkAccess<T>(operation: () => T): T;
}

export interface FacetRegistration<T> {
  readonly packageId: string;
  readonly generation: number;
  readonly implementation: T;
}

type PackageStatus = "active" | "disabled" | "faulted_isolated";
interface MountedPackage {
  manifest: ExtensionPackageManifest;
  generation: number;
  status: PackageStatus;
  lastError?: string;
  activate(scope: ExtensionActivationScope, config: unknown): void | (() => void);
  registrations: { point: FacetPoint<unknown>; entry: FacetRegistration<unknown> }[];
  disposers: (() => void)[];
}

export class ExtensionCore {
  private readonly packages = new Map<string, MountedPackage>();
  private readonly generations = new Map<string, number>();
  private readonly domains = new Map<string, unknown>();

  constructor(initialDomains: Readonly<Record<string, unknown>> = {}) {
    for (const [domain, value] of Object.entries(initialDomains)) this.domains.set(domain, structuredClone(value));
  }

  listPackages() {
    return [...this.packages.values()].map(({ manifest, generation, status, lastError, registrations }) =>
      ({ ...structuredClone(manifest), generation, status, lastError, activeFacets: registrations.length }));
  }

  listFacets<T>(point: FacetPoint<T>): readonly FacetRegistration<T>[] {
    return [...this.packages.values()].filter(pkg => pkg.status === "active")
      .flatMap(pkg => pkg.registrations.filter(item => item.point === point)
        .map(item => item.entry as FacetRegistration<T>));
  }

  allowsAudience(packageId: string, audience: ChannelAudienceScope) {
    const pkg = this.packages.get(packageId);
    return pkg?.status === "active" && allowsAudience(audience, pkg.manifest.permissions.maxAudienceScope);
  }

  mount<T>(pkg: ExtensionPackageDefinition<T>, config?: Readonly<T>) {
    if (this.packages.has(pkg.id)) throw new Error(`Package already mounted: ${pkg.id}`);
    this.start(pkg, (scope, value) => pkg.activate(scope, value as Readonly<T>), config ?? {});
  }

  remount<T>(pkg: ExtensionPackageDefinition<T>, config?: Readonly<T>) {
    this.unmount(pkg.id);
    this.mount(pkg, config);
  }

  configure(packageId: string, config: unknown) {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`Unknown package: ${packageId}`);
    this.unmount(packageId);
    this.start(pkg.manifest, pkg.activate, config);
  }

  disable(packageId: string) {
    const pkg = this.packages.get(packageId);
    if (pkg) this.stop(pkg, "disabled");
  }

  unmount(packageId: string) {
    this.disable(packageId);
    this.packages.delete(packageId);
  }

  inspectDomain(domain: string): unknown {
    return structuredClone(this.domains.get(domain));
  }

  invokeFacet<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R): R | undefined {
    const pkg = this.livePackage(entry);
    if (!pkg) return undefined;
    try {
      return invoke(entry.implementation);
    } catch (error) {
      this.isolate(pkg, error);
      return undefined;
    }
  }

  async invokeFacetAsync<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => Promise<R>) {
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

  private livePackage(entry: FacetRegistration<unknown>) {
    const pkg = this.packages.get(entry.packageId);
    return pkg?.status === "active" && pkg.registrations.some(item => item.entry === entry) ? pkg : undefined;
  }

  private stop(pkg: MountedPackage, status: PackageStatus) {
    pkg.status = status;
    pkg.registrations.length = 0;
    for (const dispose of pkg.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        pkg.lastError ??= error instanceof Error ? error.message : String(error);
      }
    }
  }

  private isolate(pkg: MountedPackage, error: unknown) {
    pkg.lastError = error instanceof Error ? error.message : String(error);
    this.stop(pkg, "faulted_isolated");
  }

  private start(definition: ExtensionPackageManifest, activate: MountedPackage["activate"], config: unknown) {
    const { id, displayName, version, permissions, facets } = definition;
    const manifest = structuredClone({ id, displayName, version, permissions, facets });
    const generation = (this.generations.get(id) ?? 0) + 1;
    const pkg: MountedPackage = { manifest, generation, status: "active", activate, registrations: [], disposers: [] };
    this.generations.set(id, generation);
    this.packages.set(id, pkg);
    let activating = true;
    const checkActive = () => {
      if (pkg.status !== "active" || this.packages.get(id) !== pkg) throw new Error("Inactive extension scope");
    };
    const check = (allowed: boolean, operation: string) => {
      checkActive();
      if (!allowed) throw new Error(`Permission denied: ${operation}`);
    };
    try {
      const dispose = activate({
        contributeFacet: (point, implementation) => {
          check(activating && manifest.facets.includes(point.id), `contribute ${point.id}`);
          const entry = Object.freeze({ packageId: id, generation, implementation: point.parse(implementation) });
          pkg.registrations.push({ point, entry });
        },
        onDispose: dispose => {
          checkActive();
          pkg.disposers.push(dispose);
        },
        readDomain: domain => {
          check(manifest.permissions.readDomains.includes(domain), `read ${domain}`);
          return this.inspectDomain(domain);
        },
        proposeDomainMutation: (domain, value) => {
          check(manifest.permissions.proposeDomains.includes(domain), `propose ${domain}`);
          this.domains.set(domain, structuredClone(value));
        },
        withNetworkAccess: operation => {
          check(manifest.permissions.networkAccess, "network access");
          return operation();
        }
      }, structuredClone(config));
      if (dispose) pkg.disposers.push(dispose);
    } catch (error) {
      this.isolate(pkg, error);
    } finally {
      activating = false;
    }
  }
}

export interface ConsoleSurface { route: string; title: string; mountPoint?: string }
export interface ConsoleConfigSchema {
  fields: readonly { key: string; type: "string" | "number" | "boolean"; required?: boolean; defaultValue?: unknown }[];
  validate?: (config: Record<string, unknown>) => Record<string, unknown>;
}
export interface PerceptionIngress {
  channelId: string;
  venueType: string;
  defaultAudienceScope: ChannelAudienceScope;
  modalities: Readonly<Record<string, Coverage>>;
}
export interface EmbodimentSurface {
  surfaceId: string;
  supportedTokens: readonly RealizerCapability[];
}
export interface ExpressionRealizer {
  channelId: string;
  venueType: string;
  audienceScope: ChannelAudienceScope;
  verbal: boolean;
  embodimentSurface: EmbodimentSurface | null;
  deliver?: (payload: RealizedChannelDelivery) => void;
}
export interface InteractionChannel {
  channelId: string;
  packageId: string;
  venueType: string;
  audienceScope: ChannelAudienceScope;
  modalities: Readonly<Record<string, Coverage>>;
  verbal: boolean;
  embodimentSurface: EmbodimentSurface | null;
}
export interface ChannelObservation {
  channelId: string;
  modality: string;
  audienceScope?: ChannelAudienceScope;
}
export interface OutboundIntentPlan {
  targetChannelId: string;
  audienceScope: ChannelAudienceScope;
  utterance?: string;
  nonverbalCue?: { semanticAction: string; quiet?: boolean; maxLatencyMs?: number };
  metadata?: Readonly<Record<string, unknown>>;
}
export interface RealizedChannelDelivery {
  channelId: string;
  audienceScope: ChannelAudienceScope;
  text?: string;
  boundTokens: readonly string[];
  degradedNonverbal: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new TypeError("Invalid facet implementation");
}
function record(raw: unknown): Record<string, unknown> {
  requireValid(typeof raw === "object" && raw !== null && !Array.isArray(raw));
  return raw as Record<string, unknown>;
}
function validAudience(value: unknown): value is ChannelAudienceScope {
  return typeof value === "string" && Object.hasOwn(audienceRanks, value);
}
const covered: readonly Coverage[] = ["live_foveal", "peripheral", "on_demand"];
const coverageValues: readonly unknown[] = [...covered, "blind", "stale", "disconnected"];

export const consoleSurfaceFacet = defineFacetPoint<ConsoleSurface>({
  owner: "console", name: "surface", version: 1,
  parse(raw) {
    const value = record(raw);
    requireValid(typeof value.route === "string" && typeof value.title === "string"
      && (value.mountPoint === undefined || typeof value.mountPoint === "string"));
    return { route: value.route, title: value.title, mountPoint: value.mountPoint };
  }
});

export const consoleConfigSchemaFacet = defineFacetPoint<ConsoleConfigSchema>({
  owner: "console", name: "config_schema", version: 1,
  parse(raw) {
    const value = record(raw);
    requireValid(Array.isArray(value.fields) && (value.validate === undefined || typeof value.validate === "function"));
    for (const field of value.fields) {
      const { key, type, required } = record(field);
      requireValid(typeof key === "string" && (type === "string" || type === "number" || type === "boolean")
        && (required === undefined || typeof required === "boolean"));
    }
    return { fields: structuredClone(value.fields), validate: value.validate as ConsoleConfigSchema["validate"] };
  }
});

export const perceptionIngressFacet = defineFacetPoint<PerceptionIngress>({
  owner: "perception", name: "ingress", version: 1,
  parse(raw) {
    const { channelId, venueType, defaultAudienceScope, modalities } = record(raw);
    const modalitiesRecord = record(modalities);
    requireValid(typeof channelId === "string" && channelId && typeof venueType === "string"
      && validAudience(defaultAudienceScope) && Object.values(modalitiesRecord).every(value => coverageValues.includes(value)));
    return { channelId, venueType, defaultAudienceScope, modalities: { ...modalitiesRecord } as Record<string, Coverage> };
  }
});

export const expressionRealizerFacet = defineFacetPoint<ExpressionRealizer>({
  owner: "expression", name: "realizer", version: 1,
  parse(raw) {
    const { channelId, venueType, audienceScope, verbal, embodimentSurface, deliver } = record(raw);
    requireValid(typeof channelId === "string" && channelId && typeof venueType === "string"
      && validAudience(audienceScope) && typeof verbal === "boolean"
      && (deliver === undefined || typeof deliver === "function"));
    let surface: EmbodimentSurface | null = null;
    if (embodimentSurface !== null) {
      const { surfaceId, supportedTokens } = record(embodimentSurface);
      requireValid(typeof surfaceId === "string" && Array.isArray(supportedTokens));
      for (const capability of supportedTokens) {
        const { token, semanticAction, kind, quiet, latencyMs } = record(capability);
        requireValid(typeof token === "string" && typeof semanticAction === "string"
          && (kind === "verbal" || kind === "nonverbal") && typeof quiet === "boolean"
          && (latencyMs === undefined || (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0)));
      }
      surface = { surfaceId, supportedTokens: structuredClone(supportedTokens) };
    }
    return { channelId, venueType, audienceScope, verbal, embodimentSurface: surface,
      deliver: deliver as ExpressionRealizer["deliver"] };
  }
});

export class ChannelFacetRuntime {
  constructor(readonly extensions: ExtensionCore) {}

  listSurfaces() { return this.extensions.listFacets(consoleSurfaceFacet); }
  listConfigSchemas() { return this.extensions.listFacets(consoleConfigSchemaFacet); }

  listChannels(): readonly InteractionChannel[] {
    const ingress = this.extensions.listFacets(perceptionIngressFacet);
    return this.extensions.listFacets(expressionRealizerFacet).flatMap(({ packageId, implementation: realizer }) => {
      const input = ingress.find(entry => entry.packageId === packageId
        && entry.implementation.channelId === realizer.channelId)?.implementation;
      const { channelId, venueType, audienceScope, verbal, embodimentSurface } = realizer;
      return input ? [{ channelId, packageId, venueType, audienceScope, verbal,
        embodimentSurface, modalities: input.modalities }] : [];
    });
  }

  admitObservation(frame: ChannelObservation) {
    const entry = this.extensions.listFacets(perceptionIngressFacet)
      .find(item => item.implementation.channelId === frame.channelId);
    if (!entry) return { admitted: false, coverage: "blind" as const, reason: "unknown_channel" as const };
    const { modalities, defaultAudienceScope } = entry.implementation;
    const coverage = Object.hasOwn(modalities, frame.modality) ? modalities[frame.modality] ?? "blind" : "blind";
    const audienceScope = frame.audienceScope ?? defaultAudienceScope;
    if (!this.extensions.allowsAudience(entry.packageId, audienceScope)) {
      return { admitted: false, coverage, reason: "audience_denied" as const };
    }
    return { admitted: covered.includes(coverage), coverage, audienceScope };
  }

  realizeIntent(intent: OutboundIntentPlan):
    { delivered: true; delivery: RealizedChannelDelivery }
    | { delivered: false; reason: "unknown_channel" | "audience_denied" | "facet_fault" | "unsupported_intent" } {
    const entry = this.extensions.listFacets(expressionRealizerFacet)
      .find(item => item.implementation.channelId === intent.targetChannelId);
    if (!entry) return { delivered: false, reason: "unknown_channel" };
    const { audienceScope, verbal, embodimentSurface } = entry.implementation;
    if (!this.extensions.allowsAudience(entry.packageId, intent.audienceScope)
      || !allowsAudience(intent.audienceScope, audienceScope)) return { delivered: false, reason: "audience_denied" };
    const cue = intent.nonverbalCue;
    const token = cue && embodimentSurface?.supportedTokens.find(capability => capability.kind === "nonverbal"
      && capability.semanticAction === cue.semanticAction && (!cue.quiet || capability.quiet)
      && (cue.maxLatencyMs === undefined || (capability.latencyMs ?? 0) <= cue.maxLatencyMs));
    const text = verbal ? intent.utterance : undefined;
    if (text === undefined && !token) return { delivered: false, reason: "unsupported_intent" };
    const delivery: RealizedChannelDelivery = {
      channelId: intent.targetChannelId, audienceScope: intent.audienceScope, text,
      boundTokens: token ? [token.token] : [], degradedNonverbal: Boolean(cue && !token), metadata: intent.metadata
    };
    return this.extensions.invokeFacet(entry, realizer => {
      realizer.deliver?.(delivery);
      return { delivered: true as const, delivery };
    }) ?? { delivered: false, reason: "facet_fault" };
  }
}
