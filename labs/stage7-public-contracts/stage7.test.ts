import { describe, expect, it } from "vitest";
import * as agent from "@ai0/agent-core";
import * as cognition from "@ai0/cognition-core";
import * as perception from "@ai0/perception-core";
import * as expression from "@ai0/expression-core";
import * as sdk from "@ai0/sdk";

const manifest = {
  author: "stage7", version: "1", carrier_kind: "native_code_plugin" as const,
  permissions: { read_blackboard_domains: [], propose_mutation_domains: [],
    max_audience_scope: "only_owner" as const, network_access: false }
};
const stringValue = {
  jsonSchema: { type: "string" },
  parse(input: unknown) { if (typeof input !== "string") throw new TypeError("Expected string"); return input; }
};

describe("stage 7 runs the published contracts without a product profile", () => {
  it("binds every public domain facet using the author SDK's identifier and version", () => {
    for (const api of [agent, cognition, perception, expression]) {
      for (const [name, facet] of Object.entries(api)) {
        if (!name.endsWith("Facet")) continue;
        const author = (sdk as Record<string, unknown>)[name] as sdk.FacetPoint<unknown> | undefined;
        expect(author, name).toBeDefined();
        expect(facet, name).toMatchObject({ id: author!.id, version: author!.version });
      }
    }
  });

  it("replaces a domain reducer guard, asset decoder and non-audio cursor independently", async () => {
    const host = new sdk.ExtensionCoreHost();
    const pkg = "lab.slides";
    host.mountPackage(sdk.defineExtensionPackage({ manifest: { ...manifest, extension_id: pkg, display_name: "Slides",
      facets: [sdk.cognitionProposalPolicyFacet.id, sdk.expressionMediaTranscoderFacet.id, sdk.extensionAssetCodecFacet.id] },
      activate(scope) {
        scope.contributeFacet(sdk.cognitionProposalPolicyFacet, { domain: "slides.count", review: ({ payload }) =>
          typeof payload === "number" && payload > 10 ? { action: "reject", reason: "CAPACITY" } : { action: "allow" } });
        scope.contributeFacet(sdk.extensionAssetCodecFacet, {
          format: "slides.lines", target: "slides.titles", decode: value => stringValue.parse(value).split("\n")
        });
        scope.contributeFacet(sdk.expressionMediaTranscoderFacet, { cursor: {
          extension: "slides.timings", resolve: (_data, { playback_cursor: cursor }) =>
            cursor?.unit === "slide" ? cursor.position * 2 : undefined
        } });
      }
    }));
    const arbiter = new cognition.StateDomainArbiter(cognition.mountedProposalPolicies(host, (id, domain) =>
      id === pkg && domain === "slides.count"));
    arbiter.registerValue("slides.count", 0, (_prior, proposed) => ({ value: Number(proposed.payload) }));
    const writer = arbiter.bind("slides.count", { canRead: () => true, canPropose: () => true });
    expect(writer.propose({ domain: "slides.count", base_rev: 0, payload: 42 })).toMatchObject({ accepted: false, reason: "CAPACITY" });
    expect(writer.read()).toEqual({ revision: 0, value: 0 });
    expect(await sdk.decodeExtensionAsset(host, "slides.lines", "slides.titles", "A\nB")).toEqual(["A", "B"]);
    const tracker = new expression.GroundingReceiptTracker(host);
    const envelope = { intent_id: "present", correlation_event_id: "event", chunk_seq: 0, is_final: true,
      action_type: "speak" as const, fallback_text: "A🎬BC", extensions: { "slides.timings": {} } };
    const receipt = { intent_id: "present", chunk_seq: 0, status: "interrupted" as const, playback_cursor: { unit: "slide", position: 1 } };
    tracker.recordGenerated(envelope);
    expect(tracker.receive(receipt)?.unsaid_remainder).toBe("BC");
    tracker.recordGenerated({ ...envelope, intent_id: "shared", delivery_constraints: { audienceScope: "public_all" } });
    expect(tracker.receive({ ...receipt, intent_id: "shared", spoken_char_offset: 1 })?.unsaid_remainder).toBe("🎬BC");
    tracker.recordGenerated({ ...envelope, intent_id: "withdrawn" });
    host.setPackageEnabled(pkg, false);
    expect(tracker.receive({ ...receipt, intent_id: "withdrawn" })?.unsaid_remainder).toBe("A🎬BC");
    expect(writer.propose({ domain: "slides.count", base_rev: 0, payload: 42 }).accepted).toBe(true);
    await expect(sdk.decodeExtensionAsset(host, "slides.lines", "slides.titles", "A")).rejects.toThrow("UNAVAILABLE");
  });

  it("reuses an unknown service from a workflow and a model, then removes each contribution independently", async () => {
    const host = new sdk.ExtensionCoreHost();
    const contract = sdk.defineServiceContract({
      owner: "lab.labels", name: "normalize", version: 1, parseInput: stringValue.parse, parseOutput: stringValue.parse
    });
    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: contract.owner, display_name: "Labels", facets: [],
        services: { defines: [contract], provides: [contract] } },
      activate(scope) {
        scope.defineService(contract);
        scope.provideService(contract, value => value.trim().toUpperCase());
      }
    }));
    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.integration", display_name: "Label integration",
        facets: [sdk.agentToolDefinitionFacet.id, sdk.agentContextContributorFacet.id],
        services: { requires: [{ ...contract, facet: sdk.agentToolDefinitionFacet.id }] } },
      activate(scope) {
        const service = scope.consumeService(contract, sdk.agentToolDefinitionFacet.id);
        scope.contributeFacet(sdk.agentToolDefinitionFacet, { tools: [{
          name: "normalize", description: "Normalize a label", inputSchema: stringValue, resultSchema: stringValue,
          execute: async (call, signal) => ({ status: "verified", value: await service.bind()(stringValue.parse(call.input), signal) }),
          project: value => value
        }] });
        scope.contributeFacet(sdk.agentContextContributorFacet, {
          contribute: () => [{ id: "convention", version: "1", content: "Use catalog labels." }]
        });
      }
    }));
    const invoke = host.bindService(contract, contract.owner);
    const signal = new AbortController().signal;
    const inputs = [{ role: "user" as const, content: "Normalize this label." }];
    const normalized = await invoke(" east ");
    const run = (id: string, allowTool: boolean) => agent.runAgentTurn({
      inputs, signal, bindings: { host, modelPackageId: id, allowsTool: () => allowTool }
    });
    for (const provider of ["lab.first", "lab.second"]) {
      host.mountPackage(sdk.defineExtensionPackage({
        manifest: { ...manifest, extension_id: provider, display_name: provider, facets: [sdk.agentModelAdapterFacet.id] },
        activate(scope) {
          scope.contributeFacet(sdk.agentModelAdapterFacet, { capabilities: { tools: true, structuredOutput: false },
            async *model({ tools, rounds, messages, output }) {
              expect(output).toBeUndefined();
              expect(messages[0]).toEqual(inputs[0]);
              if (tools.length && !rounds.length) yield { kind: "tool", id: "1", name: tools[0]!.name, input: " east " };
              else yield { kind: "delta", text: provider };
            }
          });
        }
      }));
      const report = await run(provider, true);
      expect(report.rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: normalized });
      expect(report.rounds.at(-1)?.text).toBe(provider);
      expect(report.goalVerification).toBe("not_applicable");
    }
    const direct = await run("lab.first", false);
    expect(direct.steps).toHaveLength(1);
    expect(direct.steps[0]?.tools).toEqual([]);
    host.setPackageEnabled(contract.owner, false);
    await expect(invoke(" east ")).rejects.toThrow();
    const retained = await run("lab.second", true);
    expect(retained.steps[0]?.tools).toEqual([]);
    expect(retained.steps[0]?.fragments.map(part => part.source)).toContain("lab.integration");
    host.setPackageEnabled("lab.integration", false);
    const minimal = await run("lab.second", true);
    expect(minimal.steps[0]?.fragments).toHaveLength(1);
    expect(minimal.steps[0]?.fragments[0]?.role).toBe("user");
  });
});
