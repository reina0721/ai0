import { describe, expect, it, vi } from "vitest";
import type { Ai0ExtensionManifest } from "@ai0/protocol";
import { defineFacetPoint, ExtensionComposition, ExtensionCoreHost, sortFacetsByPriority, type ExtensionPackageDefinition } from "./index.js";

const point = defineFacetPoint<{ priority?: number; run(): string }>({
  owner: "agent", name: "test_hook", version: 1,
  parse(raw) {
    const facet = raw as { priority?: number; run?: unknown } | null;
    if (typeof facet?.run !== "function") throw new TypeError("Invalid hook");
    return facet as { priority?: number; run(): string };
  }
});
const other = defineFacetPoint({ owner: "console", name: "surface", version: 1, parse: String });

function manifest(id: string, facets = [point.id, other.id]): Ai0ExtensionManifest {
  return {
    manifest_version: "2.0.0", extension_id: id, display_name: id, version: "1", author: "test",
    carrier_kind: "native_code_plugin", facets,
    permissions: {
      read_blackboard_domains: ["D1_WORKING_TURN"], propose_mutation_domains: ["D4_COMMITMENTS_TASKS"],
      max_audience_scope: "group:team", network_access: false
    }
  };
}

function definition(id: string, cleanup: () => void, priority = 0): ExtensionPackageDefinition {
  return {
    manifest: manifest(id),
    activate(scope, config) {
      scope.contributeFacet(point, { priority, run: () => String(config.text ?? id) });
      scope.contributeFacet(other, id);
      return cleanup;
    }
  };
}

describe("facet contracts and composition", () => {
  it("derives a stable facet ID and rejects invalid versions and implementations", () => {
    expect(point).toMatchObject({ id: "agent.test_hook", version: 1 });
    expect(Object.isFrozen(point)).toBe(true);
    expect(() => point.parse({ run: "invalid" })).toThrow("Invalid hook");
    expect(() => defineFacetPoint({ ...point, version: 0 })).toThrow("Invalid facet version");
  });

  it("acquires a contribution when the owner mounts and releases it when the owner disposes", async () => {
    const composition = new ExtensionComposition();
    const accept = vi.fn(() => release);
    const release = vi.fn();
    const contribution = composition.mount("contributor", scope => scope.contribute(other, "available"));
    try {
      await contribution.ready();
      expect(accept).not.toHaveBeenCalled();
      const owner = composition.mount(other.owner, scope => { scope.define(other, accept); });
      await owner.ready();
      await expect.poll(() => accept.mock.calls.length).toBe(1);
      expect(accept).toHaveBeenCalledWith("available");
      await owner.dispose();
      await expect.poll(() => release.mock.calls.length).toBe(1);
    } finally {
      await composition.dispose();
    }
  });
});

describe("ExtensionCoreHost", () => {
  it("activates multiple facets and orders middleware by priority and package ID", () => {
    const host = new ExtensionCoreHost();
    for (const [id, priority] of [["z", 0], ["a", 0], ["m", -1]] as const) {
      host.registerPackage(definition(id, vi.fn(), priority));
    }
    expect(host.listFacets(other)).toHaveLength(3);
    expect(sortFacetsByPriority(host.listFacets(point)).map(entry => host.invokeFacet(entry, facet => facet.run())))
      .toEqual(["m", "a", "z"]);
  });

  it("reloads with optimistic revisions, disposes old facets and preserves disabled configuration", () => {
    const host = new ExtensionCoreHost();
    const cleanup = vi.fn();
    host.mountPackage(definition("first", cleanup));
    const [previous] = host.listFacets(point);
    expect(host.hotReloadPackage("first", { text: "changed" }, 0)).toBe(1);
    expect(host.configurePackage.bind(host, "first", {}, 0)).toThrow(/revision conflict/i);
    expect(() => host.hotReloadPackage("first", {}, 0)).toThrow(/revision conflict/i);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.invokeFacet(previous!, facet => facet.run())).toBeUndefined();
    host.setPackageEnabled("first", false);
    expect(host.configurePackage("first", { text: "disabled configuration" }, 1)).toBe(2);
    expect(host.listFacets(point)).toHaveLength(0);
    expect(host.listFacets(other)).toHaveLength(0);
    host.setPackageEnabled("first", true);
    expect(host.invokeFacet(host.listFacets(point)[0]!, facet => facet.run())).toBe("disabled configuration");
    expect(host.listFacets(other)).toHaveLength(1);
    expect(host.unmountPackage("first")).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(host.getPackage("first")).toBeUndefined();
    expect(host.listFacets(point)).toHaveLength(0);
    expect(host.listFacets(other)).toHaveLength(0);
  });

  it("cleans partial activation and isolates synchronous and asynchronous hook faults", async () => {
    const host = new ExtensionCoreHost();
    const cleanup = vi.fn();
    host.mountPackage(definition("sibling", vi.fn()));
    const failed = host.mountPackage({
      manifest: manifest("partial", [point.id]),
      activate(scope) {
        scope.onDispose(cleanup);
        scope.contributeFacet(point, { run: () => "partial" });
        scope.contributeFacet(other, "undeclared");
      }
    });
    expect(failed).toMatchObject({ status: "faulted_isolated", lastError: /contribution denied/i });
    expect(cleanup).toHaveBeenCalledOnce();
    for (const method of ["invokeFacet", "invokeFacetAsync"] as const) {
      host.mountPackage(definition(method, cleanup));
      const entry = host.listFacets(point).find(item => item.packageId === method)!;
      expect(await host[method](entry, () => { throw new Error("hook failed"); })).toBeUndefined();
      expect(host.getPackage(method)).toMatchObject({ status: "faulted_isolated", lastError: "hook failed" });
    }
    expect(host.listFacets(other).map(entry => entry.packageId)).toEqual(["sibling"]);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("discards in-flight results and failures after a reload", async () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(definition("first", vi.fn()));
    const [entry] = host.listFacets(point);
    let reject!: (reason: unknown) => void;
    let resolve!: (value: string) => void;
    const failed = host.invokeFacetAsync(entry!, () => new Promise<never>((_, fail) => { reject = fail; }));
    const succeeded = host.invokeFacetAsync(entry!, () => new Promise<string>(done => { resolve = done; }));
    host.configurePackage("first", {}, 0);
    reject(new Error("old generation"));
    resolve("old result");
    expect(await failed).toBeUndefined();
    expect(await succeeded).toBeUndefined();
    expect(host.getPackage("first")?.status).toBe("active");
  });

  it("enforces declared permissions and revokes them at disable", () => {
    const host = new ExtensionCoreHost();
    host.mountPackage(definition("first", vi.fn()));
    expect(host.allowsReadDomain("first", "D1_WORKING_TURN")).toBe(true);
    expect(host.allowsReadDomain("first", "D2_HOMEOSTASIS_AFFECT")).toBe(false);
    expect(host.allowsProposeDomain("first", "D4_COMMITMENTS_TASKS")).toBe(true);
    expect(host.allowsProposeDomain("first", "D1_WORKING_TURN")).toBe(false);
    expect(host.allowsAudienceScope("first", "only_owner")).toBe(true);
    expect(host.allowsAudienceScope("first", "group:team")).toBe(true);
    expect(host.allowsAudienceScope("first", "group:other")).toBe(false);
    expect(host.allowsAudienceScope("first", "public_all")).toBe(false);
    expect(host.allowsNetworkAccess("first")).toBe(false);
    host.setPackageEnabled("first", false);
    expect(host.allowsReadDomain("first", "D1_WORKING_TURN")).toBe(false);
  });
});
