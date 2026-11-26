import { describe, expect, it, vi } from "vitest";
import type { Ai0ExtensionManifest } from "@ai0/protocol";
import { defineFacetPoint, defineServiceContract, ExtensionCoreHost, type ServiceClient } from "./index.js";

const number = (raw: unknown) => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new TypeError("Expected finite number");
  return raw;
};
const metric = defineServiceContract({ owner: "acme.metrics", name: "measure", version: 1, parseInput: number, parseOutput: number });
const hook = defineFacetPoint({ owner: "agent", name: "sample", version: 1, parse: number });
const sibling = defineFacetPoint({ owner: "agent", name: "optional_sample", version: 1, parse: number });
const manifest = (extension_id: string, services?: Ai0ExtensionManifest["services"], facets: string[] = []): Ai0ExtensionManifest =>
  ({ manifest_version: "2.0.0", extension_id, author: "lab", version: "1", display_name: extension_id, carrier_kind: "native_code_plugin",
    permissions: { max_audience_scope: "only_owner", read_blackboard_domains: [], propose_mutation_domains: [], network_access: false },
    facets, services });

describe("native service binding", () => {
  it("revokes dependent effects and enforces the narrowest audience along a transitive chain", async () => {
    const host = new ExtensionCoreHost();
    const index = defineServiceContract({ ...metric, name: "index" });
    const search = defineServiceContract({ ...metric, name: "search" });
    const published = manifest(metric.owner, { defines: [index, search] });
    published.permissions.max_audience_scope = "public_all";
    host.mountPackage({ manifest: published, activate(scope) { scope.defineService(index); scope.defineService(search); } });
    const cleanup = vi.fn();
    const acquired = vi.fn(() => cleanup);
    const consumer = manifest("tool", { requires: [search] }, [hook.id]);
    consumer.permissions.max_audience_scope = "public_all";
    host.mountPackage({ manifest: consumer, activate(scope) { scope.whenServiceAvailable(search, acquired); scope.contributeFacet(hook, 1); } });
    const middle = manifest("search", { provides: [search], requires: [index] });
    middle.permissions.max_audience_scope = "public_all";
    host.mountPackage({ manifest: middle, activate(scope) {
      const dependency = scope.consumeService(index);
      scope.provideService(search, (input, signal, context) => dependency.bind(context.audience)(input, signal));
    } });
    expect(host.getPackage("tool")?.status).toBe("waiting_dependencies");
    expect(acquired).not.toHaveBeenCalled();
    const provider = manifest("index", { provides: [index] });
    provider.permissions.max_audience_scope = "group:editors";
    host.mountPackage({ manifest: provider, activate(s) { s.provideService(index, n => n); } });
    expect(host.getPackage("tool")?.status).toBe("active");
    expect(acquired).toHaveBeenCalledOnce();
    expect(host.allowsAudienceScope("tool", "public_all", hook.id)).toBe(false);
    expect(() => host.bindService(search, "search", "group:viewers")).toThrow(/denied/u);
    expect(await host.bindService(search, "search", "group:editors")(2)).toBe(2);
    host.setPackageEnabled("index", false);
    expect(host.getPackage("search")?.status).toBe("waiting_dependencies");
    expect(host.getPackage("tool")?.status).toBe("waiting_dependencies");
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("gates only dependent facets, retains optional ones and pins operations across grants and selection changes", async () => {
    const host = new ExtensionCoreHost();
    let client!: ServiceClient<number, number>;
    host.mountPackage({ manifest: manifest("consumer", { requires: [{ ...metric, facet: hook.id }], optional: [{ ...metric, facet: sibling.id }] }, [hook.id, sibling.id]),
      activate(scope) {
        client = scope.consumeService(metric, hook.id);
        scope.contributeFacet(hook, 1);
        scope.contributeFacet(sibling, 2);
      } });
    expect(host.listFacets(hook)).toHaveLength(0);
    expect(host.listFacets(sibling)).toHaveLength(1);
    expect(client.status()).toEqual({ status: "missing" });
    const provider = (id: string, n: number) => host.mountPackage({ manifest: manifest(id, { provides: [metric] }),
      activate(scope) { scope.provideService(metric, value => value + n); } });
    provider("first", 1);
    host.mountPackage({ manifest: manifest(metric.owner, { defines: [metric] }), activate(scope) { scope.defineService(metric); } });
    const initial = host.listFacets(hook)[0]!;
    const first = client.bind();
    expect(await first(5)).toBe(6);
    provider("second", 2);
    expect(client.status()).toEqual({ status: "ambiguous", providers: ["first", "second"] });
    expect(host.listFacets(hook)).toHaveLength(0);
    expect(host.listFacets(sibling)).toHaveLength(1);
    expect(await host.bindService(metric, "second")(5)).toBe(7);
    host.selectServiceProvider(metric, "first");
    await expect(first(5)).rejects.toMatchObject({ reason: { status: "revoked" } });
    expect(host.invokeFacet(initial, value => value)).toBeUndefined();
    expect(await client.bind()(5)).toBe(6);
    const granted = client.bind();
    host.setServiceAccess("consumer", metric, false);
    expect(host.getPackage("consumer")?.serviceBindings).toContainEqual({ service: { owner: metric.owner, name: metric.name, version: 1 }, status: "denied" });
    expect(host.listFacets(hook)).toHaveLength(0);
    host.setServiceAccess("consumer", metric, true);
    await expect(granted(5)).rejects.toMatchObject({ reason: { status: "revoked" } });
    host.unmountPackage(metric.owner);
    expect(host.listFacets(hook)).toHaveLength(0);
    expect(host.listFacets(sibling)).toHaveLength(1);
    host.unmountPackage("consumer");
    expect(client.status()).toEqual({ status: "revoked" });
  });

  it("uses owner parsers, preserves host isolation, rejects late results and separates provider access from host grants", async () => {
    const host = new ExtensionCoreHost();
    const restricted = defineServiceContract({ ...metric, access: "explicit" });
    host.mountPackage({ manifest: manifest(metric.owner, { defines: [metric] }), activate(s) { s.defineService(restricted); } });
    let complete!: (value: number) => void;
    let pendingSignal: AbortSignal | undefined;
    host.mountPackage({ manifest: manifest("provider", { provides: [metric] }), activate(scope) {
      scope.provideService({ ...metric, parseInput: () => 0, parseOutput: () => 42 }, (_, signal) =>
        new Promise(resolve => { pendingSignal = signal; complete = resolve; }));
    } });
    let client!: ServiceClient<number, number>;
    host.mountPackage({ manifest: manifest("consumer", { requires: [metric] }), activate(scope) { client = scope.consumeService(metric); } });
    expect(client.status()).toEqual({ status: "denied" });
    expect(() => new ExtensionCoreHost().bindService(metric, "provider")).toThrow(/missing/u);
    host.setServiceAccess("consumer", metric, true);
    const operation = client.bind();
    await expect(operation(NaN)).rejects.toThrow("Expected finite number");
    const wrong = operation(1);
    complete(NaN);
    await expect(wrong).rejects.toThrow("Expected finite number");
    const late = operation(1);
    host.setPackageEnabled("provider", false);
    expect(pendingSignal?.aborted).toBe(true);
    await expect(late).rejects.toMatchObject({ reason: { status: "revoked" } });
    host.setPackageEnabled("provider", true);
    complete(9);
    const pinned = host.bindService(metric, "provider");
    host.configurePackage("provider", {}, 0);
    await expect(pinned(3)).rejects.toMatchObject({ reason: { status: "revoked" } });
    const absent = { ...metric, version: 2 };
    expect(() => host.bindService(absent, "provider")).toThrow(/missing/u);
    expect(host.mountPackage({ manifest: manifest("undeclared", undefined, [hook.id]), activate(scope) { scope.consumeService(metric); } }).status)
      .toBe("faulted_isolated");
    expect(() => host.mountPackage({ manifest: manifest("spoof", { defines: [metric] }) })).toThrow(/owner/u);
  });

  it("rejects circular required dependencies, validates separately bundled facets at the consuming boundary", () => {
    const host = new ExtensionCoreHost();
    const another = defineServiceContract({ ...metric, name: "other" });
    host.mountPackage({ manifest: manifest(metric.owner, { defines: [metric, another] }), activate(scope) {
      scope.defineService(metric); scope.defineService(another);
    } });
    for (const [service, dependency] of [[metric, another], [another, metric]] as const) {
      host.mountPackage({ manifest: manifest(service.name, { provides: [service], requires: [dependency] }), activate(scope) {
        const other = scope.consumeService(dependency);
        scope.provideService(service, value => other.bind()(value));
      } });
    }
    expect(() => host.bindService(metric, metric.name)).toThrow(/cycle/u);
    const cleanup = vi.fn();
    host.mountPackage({ manifest: manifest("invalid", undefined, [hook.id]), activate(scope) {
      scope.contributeFacet({ ...hook, parse: () => "unchecked" }, "unchecked");
      return cleanup;
    } });
    expect(host.listFacets(hook)).toHaveLength(0);
    expect(host.getPackage("invalid")?.status).toBe("faulted_isolated");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
