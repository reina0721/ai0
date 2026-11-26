import { describe, expect, it } from "vitest";
import { ChannelFacetRuntime, ExtensionCore, consoleConfigSchemaFacet, consoleSurfaceFacet,
  expressionRealizerFacet, perceptionIngressFacet } from "./index.js";
import type { ExtensionPackageDefinition, ExtensionActivationScope, OutboundIntentPlan } from "./index.js";

const permissions = { readDomains: ["health"], proposeDomains: [] as string[],
  maxAudienceScope: "group:default" as const, networkAccess: false };

function webchat(version: 1 | 2, cleanup: () => void = () => undefined): ExtensionPackageDefinition {
  return {
    id: "builtin.webchat", displayName: "Webchat", version: String(version), permissions,
    facets: [consoleSurfaceFacet.id, perceptionIngressFacet.id, expressionRealizerFacet.id],
    activate(scope) {
      scope.contributeFacet(consoleSurfaceFacet, { route: "/webchat", title: "Webchat v" + version });
      scope.contributeFacet(perceptionIngressFacet, { channelId: "webchat", venueType: "web_console",
        defaultAudienceScope: "only_owner", modalities: version === 1
          ? { text: "live_foveal" } : { text: "live_foveal", image: "live_foveal" } });
      scope.contributeFacet(expressionRealizerFacet, { channelId: "webchat", venueType: "web_console",
        audienceScope: "only_owner", verbal: true, embodimentSurface: version === 1 ? null : {
          surfaceId: "header_bot_icon", supportedTokens: [
            { token: "bot_icon:gentle_smile", semanticAction: "gentle_smile", kind: "nonverbal", quiet: true }
          ]
        } });
      return cleanup;
    }
  };
}

function headless(): ExtensionPackageDefinition {
  return {
    id: "channel.napcat-onebot", displayName: "NapCat OneBot", version: "1", permissions,
    facets: [perceptionIngressFacet.id, expressionRealizerFacet.id, consoleConfigSchemaFacet.id],
    activate(scope) {
      scope.contributeFacet(perceptionIngressFacet, { channelId: "napcat-onebot", venueType: "headless_im",
        defaultAudienceScope: "group:default", modalities: { text: "live_foveal" } });
      scope.contributeFacet(expressionRealizerFacet, { channelId: "napcat-onebot", venueType: "headless_im",
        audienceScope: "group:default", verbal: true, embodimentSurface: null });
      scope.contributeFacet(consoleConfigSchemaFacet, { fields: [{ key: "endpoint", type: "string", required: true }] });
    }
  };
}

const intent: OutboundIntentPlan = { targetChannelId: "webchat", audienceScope: "only_owner",
  utterance: "I am listening.", nonverbalCue: { semanticAction: "gentle_smile", quiet: true } };
const image = { channelId: "webchat", modality: "image" };

describe("composite channel facets", () => {
  it("upgrades one cohesive package and renegotiates the same observation and intent", () => {
    const extensions = new ExtensionCore();
    const runtime = new ChannelFacetRuntime(extensions);
    const disposed: number[] = [];
    extensions.mount(webchat(1, () => disposed.push(1)));
    expect(extensions.listPackages()).toMatchObject([{ id: "builtin.webchat", generation: 1,
      status: "active", activeFacets: 3 }]);
    expect(runtime.listSurfaces()[0]?.implementation.route).toBe("/webchat");
    expect(runtime.admitObservation(image)).toMatchObject({ admitted: false, coverage: "blind" });
    expect(runtime.realizeIntent(intent)).toMatchObject({ delivered: true,
      delivery: { text: "I am listening.", boundTokens: [], degradedNonverbal: true } });
    const old = extensions.listFacets(expressionRealizerFacet)[0];
    expect(old).toBeDefined();

    extensions.remount(webchat(2));
    expect(extensions.listPackages()).toMatchObject([{ id: "builtin.webchat", generation: 2,
      status: "active", activeFacets: 3 }]);
    expect(disposed).toEqual([1]);
    expect(runtime.listSurfaces()).toMatchObject([{ generation: 2, implementation: { title: "Webchat v2" } }]);
    if (old) expect(extensions.invokeFacet(old, () => "stale registration")).toBeUndefined();
    expect(runtime.admitObservation(image)).toMatchObject({ admitted: true, coverage: "live_foveal" });
    expect(runtime.realizeIntent(intent)).toMatchObject({ delivered: true,
      delivery: { text: "I am listening.", boundTokens: ["bot_icon:gentle_smile"], degradedNonverbal: false } });
  });

  it("exposes config for a headless channel and enforces its audience ceiling both ways", () => {
    const extensions = new ExtensionCore();
    const runtime = new ChannelFacetRuntime(extensions);
    extensions.mount(headless());
    expect(runtime.listSurfaces()).toEqual([]);
    expect(runtime.listChannels()).toMatchObject([{ channelId: "napcat-onebot", embodimentSurface: null }]);
    expect(runtime.listConfigSchemas()).toMatchObject([{ packageId: "channel.napcat-onebot",
      implementation: { fields: [{ key: "endpoint", type: "string" }] } }]);
    const observation = { channelId: "napcat-onebot", modality: "text" };
    const outbound = { ...intent, targetChannelId: observation.channelId, audienceScope: "group:default" as const };
    expect(runtime.admitObservation(observation)).toMatchObject({ admitted: true, audienceScope: "group:default" });
    expect(runtime.realizeIntent(outbound).delivered).toBe(true);
    expect(runtime.admitObservation({ ...observation, audienceScope: "public_all" }))
      .toMatchObject({ admitted: false, reason: "audience_denied" });
    expect(runtime.realizeIntent({ ...outbound, audienceScope: "public_all" }))
      .toEqual({ delivered: false, reason: "audience_denied" });
  });

  it("cleans up partial activation and isolates a throwing delivery without harming siblings", () => {
    const extensions = new ExtensionCore({ health: "ok", private: "owner" });
    const runtime = new ChannelFacetRuntime(extensions);
    extensions.mount(webchat(1));
    extensions.mount(headless());
    const cleanup: string[] = [];
    extensions.mount({
      id: "partial", displayName: "Partial", version: "1", permissions, facets: [consoleSurfaceFacet.id],
      activate(scope) {
        scope.contributeFacet(consoleSurfaceFacet, { route: "/partial", title: "Partial" });
        scope.onDispose(() => cleanup.push("partial"));
        throw new Error("activation failed");
      }
    });
    expect(extensions.listPackages().find(pkg => pkg.id === "partial"))
      .toMatchObject({ status: "faulted_isolated", lastError: "activation failed", activeFacets: 0 });
    expect(runtime.listSurfaces().map(entry => entry.packageId)).toEqual(["builtin.webchat"]);

    let activeScope: ExtensionActivationScope | undefined;
    extensions.mount({
      id: "faulty", displayName: "Faulty", version: "1", permissions, facets: [expressionRealizerFacet.id],
      activate(scope) {
        activeScope = scope;
        scope.onDispose(() => cleanup.push("faulty"));
        scope.contributeFacet(expressionRealizerFacet, { channelId: "faulty", venueType: "cli",
          audienceScope: "only_owner", verbal: true, embodimentSurface: null,
          deliver() { throw new Error("delivery failed"); } });
      }
    });
    expect(activeScope).toBeDefined();
    expect(activeScope?.readDomain("health")).toBe("ok");
    expect(() => activeScope?.readDomain("private")).toThrow("Permission denied: read private");
    expect(() => activeScope?.proposeDomainMutation("health", "corrupt")).toThrow("Permission denied: propose health");
    expect(extensions.inspectDomain("health")).toBe("ok");
    const network = () => cleanup.push("network");
    expect(() => activeScope?.withNetworkAccess(network)).toThrow("Permission denied: network access");
    expect(runtime.realizeIntent({ ...intent, targetChannelId: "faulty" }))
      .toEqual({ delivered: false, reason: "facet_fault" });
    expect(extensions.listPackages().find(pkg => pkg.id === "faulty"))
      .toMatchObject({ status: "faulted_isolated", lastError: "delivery failed", activeFacets: 0 });
    expect(cleanup).toEqual(["partial", "faulty"]);
    expect(runtime.realizeIntent(intent).delivered).toBe(true);
    expect(runtime.realizeIntent({ ...intent, targetChannelId: "napcat-onebot" }).delivered).toBe(true);
  });

  it("validates declared facets and replaces configuration with deterministic cleanup", () => {
    const extensions = new ExtensionCore();
    const runtime = new ChannelFacetRuntime(extensions);
    extensions.mount({ id: "undeclared", displayName: "Undeclared", version: "1", permissions, facets: [],
      activate(scope) {
        scope.contributeFacet(consoleSurfaceFacet, { route: "/bad", title: "Bad" });
      } });
    expect(extensions.listPackages()[0]).toMatchObject({ status: "faulted_isolated",
      lastError: "Permission denied: contribute console.surface" });
    const lifecycle: string[] = [];
    const configurable: ExtensionPackageDefinition<{ title: string }> = {
      id: "configurable", displayName: "Configurable", version: "1", permissions, facets: [consoleSurfaceFacet.id],
      activate(scope, { title }) {
        lifecycle.push("start " + title);
        scope.onDispose(() => lifecycle.push("end " + title));
        scope.contributeFacet(consoleSurfaceFacet, { route: "/configurable", title });
      }
    };
    extensions.mount(configurable, { title: "First" });
    extensions.configure(configurable.id, { title: "Second" });
    expect(runtime.listSurfaces()).toMatchObject([{ generation: 2, implementation: { title: "Second" } }]);
    extensions.disable(configurable.id);
    expect(lifecycle).toEqual(["start First", "end First", "start Second", "end Second"]);
    expect(runtime.listSurfaces()).toEqual([]);
  });
});
