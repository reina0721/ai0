import { describe, expect, it } from "vitest";
import {
  defineFacetPoint,
  defineHookPoint,
  ExtensionCoreHost,
  runBroadcastHook,
  runWaterfallHook,
  type ExtensionHostChangeEvent
} from "./index.js";

const baseManifest = {
  manifest_version: "2.0.0" as const,
  version: "1.0.0",
  author: "test",
  carrier_kind: "native_code_plugin" as const
};

describe("ScopedExtensionView monotonic attenuation, custom.* facets, and HookPoint isolation", () => {
  it("enforces monotonic attenuation across nested ScopedExtensionViews and tracks host change events", () => {
    const host = new ExtensionCoreHost();
    const events: ExtensionHostChangeEvent[] = [];
    const unsubscribe = host.onDidChange((e) => events.push(e));

    const customFacet = defineFacetPoint<{ tag: string }>({
      owner: "custom.analytics",
      name: "tagger",
      version: 1,
      parse(raw) {
        const val = raw as { tag?: unknown } | null;
        if (typeof val?.tag !== "string") throw new TypeError("Expected tag");
        return { tag: val.tag };
      }
    });

    host.mountPackage({
      manifest: {
        ...baseManifest,
        extension_id: "pkg.local",
        display_name: "Local",
        facets: [customFacet.id],
        permissions: {
          read_blackboard_domains: ["D1_WORKING_TURN"],
          propose_mutation_domains: [],
          max_audience_scope: "public_all",
          network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(customFacet, { tag: "local" });
      }
    });

    host.mountPackage({
      manifest: {
        ...baseManifest,
        extension_id: "pkg.net",
        display_name: "Networked",
        facets: [customFacet.id],
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "public_all",
          network_access: true
        }
      },
      activate(scope) {
        scope.contributeFacet(customFacet, { tag: "net" });
      }
    });

    const sessionView = host.createScopedView({
      scopeId: "session",
      allowedPackages: ["pkg.local", "pkg.net"],
      audienceCeiling: "group:team_alpha",
      allowNetwork: false
    });
    // Networked package is hidden when allowNetwork === false
    expect(sessionView.listFacets(customFacet).map((f) => f.packageId)).toEqual(["pkg.local"]);
    expect(sessionView.allowsNetworkAccess("pkg.net")).toBe(false);
    expect(sessionView.allowsAudienceScope("pkg.local", "group:team_alpha", customFacet.id)).toBe(true);
    expect(sessionView.allowsAudienceScope("pkg.local", "public_all", customFacet.id)).toBe(false);

    // Child view attempts to re-enable network, widen audience to public_all, and add an unpermitted package:
    // monotonic attenuation MUST clamp every dimension to the stricter intersection!
    const childSubagentView = sessionView.createScopedView({
      scopeId: "subagent",
      allowedPackages: ["pkg.net", "pkg.local"],
      audienceCeiling: "public_all",
      allowNetwork: true
    });
    expect(childSubagentView.allowsNetworkAccess("pkg.net")).toBe(false);
    expect(childSubagentView.listFacets(customFacet).map((f) => f.packageId)).toEqual(["pkg.local"]);
    expect(childSubagentView.allowsAudienceScope("pkg.local", "public_all", customFacet.id)).toBe(false);
    expect(childSubagentView.allowsAudienceScope("pkg.local", "group:team_alpha", customFacet.id)).toBe(true);

    const narrowerGroupView = sessionView.createScopedView({
      audienceCeiling: "group:other_team"
    });
    // Disjoint group ceilings meet at bottom ("only_owner")
    expect(narrowerGroupView.allowsAudienceScope("pkg.local", "group:team_alpha", customFacet.id)).toBe(false);
    expect(narrowerGroupView.allowsAudienceScope("pkg.local", "only_owner", customFacet.id)).toBe(true);

    unsubscribe();
    expect(events.map((e) => `${e.packageId}:${e.reason}`)).toEqual(["pkg.local:mounted", "pkg.net:mounted"]);
  });

  it("executes waterfall and broadcast HookPoints in priority order and fault-isolates throwing handlers", async () => {
    const host = new ExtensionCoreHost();
    const transformHook = defineHookPoint<{ text: string }>({
      owner: "custom.pipeline",
      name: "transform",
      version: 1,
      parsePayload(raw) {
        const v = raw as { text?: unknown } | null;
        if (typeof v?.text !== "string") throw new TypeError("Expected text");
        return { text: v.text };
      }
    });

    host.mountPackage({
      manifest: {
        ...baseManifest,
        extension_id: "hook.first",
        display_name: "First",
        facets: [transformHook.facet.id],
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "only_owner",
          network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(transformHook.facet, {
          priority: 1,
          handle: ({ text }) => ({ text: `${text}->first` })
        });
      }
    });

    host.mountPackage({
      manifest: {
        ...baseManifest,
        extension_id: "hook.faulty",
        display_name: "Faulty",
        facets: [transformHook.facet.id],
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "only_owner",
          network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(transformHook.facet, {
          priority: 2,
          handle: () => {
            throw new Error("boom in hook");
          }
        });
      }
    });

    host.mountPackage({
      manifest: {
        ...baseManifest,
        extension_id: "hook.last",
        display_name: "Last",
        facets: [transformHook.facet.id],
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "only_owner",
          network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(transformHook.facet, {
          priority: 3,
          handle: ({ text }) => ({ text: `${text}->last` })
        });
      }
    });

    const transformed = await runWaterfallHook(host, transformHook, { text: "seed" });
    expect(transformed).toEqual({ text: "seed->first->last" });
    expect(host.getPackage("hook.faulty")?.status).toBe("faulted_isolated");
    expect(host.getPackage("hook.first")?.status).toBe("active");
    expect(host.getPackage("hook.last")?.status).toBe("active");

    const deliveredCount = await runBroadcastHook(host, transformHook, { text: "ping" });
    expect(deliveredCount).toBe(2);
  });
});
