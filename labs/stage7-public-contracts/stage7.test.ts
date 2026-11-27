import { describe, expect, it } from "vitest";
import * as agent from "@ai0/agent-core";
import * as agentKernel from "@ai0/agent-core/kernel";
import * as agentRuntime from "@ai0/agent-runtime";
import * as agentRuntimeKernel from "@ai0/agent-runtime/kernel";
import * as cognition from "@ai0/cognition-core";
import * as cognitionKernel from "@ai0/cognition-core/kernel";
import * as cognitionSubsystems from "@ai0/cognition-core/subsystems";
import * as expression from "@ai0/expression-core";
import * as expressionKernel from "@ai0/expression-core/kernel";
import * as extensionKernel from "@ai0/extension-core/kernel";
import * as gatewayKernel from "@ai0/gateway/kernel";
import * as perception from "@ai0/perception-core";
import * as perceptionKernel from "@ai0/perception-core/kernel";
import * as sdk from "@ai0/sdk";
import * as storageKernel from "@ai0/storage/kernel";

const manifest = {
  author: "stage7", version: "1", carrier_kind: "native_code_plugin" as const,
  permissions: { read_blackboard_domains: [], propose_mutation_domains: [],
    max_audience_scope: "only_owner" as const, network_access: false }
};
const stringValue = {
  jsonSchema: { type: "string" },
  parse(input: unknown) { if (typeof input !== "string") throw new TypeError("Expected string"); return input; }
};

describe("stage 7 runs the published universal contracts without a product profile", () => {
  it("exposes standalone L0 /kernel entrypoints across all seven stateful packages and 1:1 SDK facet parity", () => {
    expect(typeof extensionKernel.defineFacetPoint).toBe("function");
    expect(typeof agentKernel.runKernelAgentTurn).toBe("function");
    expect(typeof agentRuntimeKernel.UniversalAgentLoop).toBe("function");
    expect(typeof agentRuntime.createUniversalAgent).toBe("function");
    expect(typeof perceptionKernel.SensoryCoverageBucketManager).toBe("function");
    expect(typeof cognitionKernel.StateDomainArbiter).toBe("function");
    expect(typeof expressionKernel.KernelGroundingTracker).toBe("function");
    expect(typeof expressionKernel.applyDeliveryReceiptToIntent).toBe("function");
    expect(typeof storageKernel.CoordinatorStorageMutator).toBe("function");
    expect(typeof gatewayKernel.issueScopedCapabilityToken).toBe("function");
    expect(typeof gatewayKernel.verifyScopedCapabilityToken).toBe("function");

    const ownerFacets = new Map<string, string>();
    for (const api of [agent, cognition, perception, expression, sdk]) {
      for (const [name, facet] of Object.entries(api)) {
        if (!name.endsWith("Facet")) continue;
        const f = facet as sdk.FacetPoint<unknown>;
        if (api !== sdk) ownerFacets.set(name, `${f.id}@${f.version}`);
      }
    }
    for (const [name, key] of ownerFacets) {
      const author = (sdk as Record<string, unknown>)[name] as sdk.FacetPoint<unknown> | undefined;
      expect(author, name).toBeDefined();
      expect(`${author!.id}@${author!.version}`).toBe(key);
    }
  });

  it("runs cognition-core/subsystems firewall, CommonGround, and taint gate with zero companion plugins", () => {
    const clock = new cognitionKernel.VirtualClock({ targetInstance: "sandbox:stage7", initialVirtualTsMs: 1_000 });
    const events = new Map([
      ["evt_1", { event_id: "evt_1", redacted_at_ts_ms: null, principal_trust: "owner_verified" }]
    ]);
    const coordinator = new cognitionSubsystems.AuthoritativeStateCoordinator(clock, {
      getEventById: id => events.get(id),
      saveTurnDecisionTrace: () => {}
    });
    expect(coordinator.getSnapshot().D2_CONTINUOUS_STATES).toEqual({ values: {}, attributions: {} });
    expect(coordinator.submitProposal({
      proposal_id: "p_banter",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      interaction_frame: "playful_banter",
      memory_tier: "semantic_fact",
      epistemic_type: "observed_firsthand",
      source_event_ids: ["evt_1"],
      payload: { content_text: "I own the moon." }
    })).toMatchObject({ accepted: false, reason: "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT" });

    const gate = new cognitionSubsystems.ThreeDimensionalPolicyEngine();
    expect(gate.evaluate("owner_verified", "only_owner", "low_read_and_scoped_write", "untrusted_external")).toBe("DENY");
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
    host.setPackageEnabled(pkg, false);
    expect(writer.propose({ domain: "slides.count", base_rev: 0, payload: 42 }).accepted).toBe(true);
    await expect(sdk.decodeExtensionAsset(host, "slides.lines", "slides.titles", "A")).rejects.toThrow("UNAVAILABLE");
  });

  it("supports provider substitution when originating service owner is disabled, plus multi-step tool -> structured output convergence", async () => {
    const host = new sdk.ExtensionCoreHost();
    const contract = sdk.defineServiceContract({
      owner: "lab.labels", name: "normalize", version: 1, parseInput: stringValue.parse, parseOutput: stringValue.parse
    });
    // Provider B mounts and serves contract WITHOUT contract.owner ("lab.labels") being mounted at all!
    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.alt-provider", display_name: "Alt Labels", facets: [],
        services: { provides: [contract] } },
      activate(scope) {
        scope.provideService(contract, value => value.trim().toUpperCase());
      }
    }));
    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.integration", display_name: "Label integration",
        facets: [sdk.agentToolProviderFacet.id, sdk.agentContextContributorFacet.id],
        services: { requires: [{ ...contract, facet: sdk.agentToolProviderFacet.id }] } },
      activate(scope) {
        const service = scope.consumeService(contract, sdk.agentToolProviderFacet.id);
        scope.contributeFacet(sdk.agentToolProviderFacet, { tools: [{
          name: "normalize", description: "Normalize a label", inputSchema: stringValue, resultSchema: stringValue,
          execute: async (call, signal) => ({ status: "verified", value: await service.bind()(stringValue.parse(call.input), signal) }),
          project: value => value
        }] });
        scope.contributeFacet(sdk.agentContextContributorFacet, {
          contribute: () => [{ id: "convention", version: "1", content: "Use catalog labels." }]
        });
      }
    }));

    const signal = new AbortController().signal;
    const inputs = [{ role: "user" as const, content: "Normalize this label and return structured JSON." }];
    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.model", display_name: "Model", facets: [sdk.agentModelAdapterFacet.id] },
      activate(scope) {
        scope.contributeFacet(sdk.agentModelAdapterFacet, {
          capabilities: { tools: true, structuredOutput: true },
          async *model({ tools, rounds, output }) {
            if (tools.length && !rounds.length) {
              expect(output).toBeUndefined();
              yield { kind: "tool", id: "1", name: tools[0]!.name, input: " east " };
            } else if (!output) {
              yield { kind: "delta", text: "Tool completed." };
            } else {
              expect(tools).toEqual([]);
              expect(output.schema).toMatchObject({ required: ["normalized"] });
              yield { kind: "delta", text: JSON.stringify({ normalized: "EAST" }) };
            }
            yield { kind: "finish" };
          }
        });
      }
    }));

    const structured = await agent.runAgentTurn({
      inputs,
      signal,
      bindings: { host, modelPackageId: "lab.model", allowsTool: () => true },
      profile: {
        id: "lab.structured",
        version: "1",
        schema: { type: "object", required: ["normalized"], properties: { normalized: { type: "string" } } },
        parse: text => JSON.parse(text) as { normalized: string }
      }
    });
    expect(structured.rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: "EAST" });
    expect(structured.output).toEqual({ normalized: "EAST" });
  });

  it("projects standard SKILL.md manuals by default and gates side-effect tools across direct_inline vs dual_speed_w1_w2 in @ai0/agent-runtime", async () => {
    const host = new sdk.ExtensionCoreHost();
    expect(sdk.resolveEffectiveSkillProjections({ bodyMarkdown: "# SOP\nCheck before writing.", projections: undefined })).toEqual([
      { source: "body", facet: "agent.skill_manual", version: 1 }
    ]);

    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.skill", display_name: "Skill", carrier_kind: "markdown_skill_manual",
        facets: [sdk.agentSkillManualFacet.id] },
      activate(scope) {
        const errors = sdk.mountCarrierProjections(scope, { ...manifest, manifest_version: "2.0.0", extension_id: "lab.skill",
          display_name: "Skill", carrier_kind: "markdown_skill_manual", facets: [sdk.agentSkillManualFacet.id] }, {
          kind: "skill",
          skill: {
            id: "lab.skill", slug: "lab-skill", displayName: "Skill", description: "Check first", source: "soul_user",
            filePath: "/virtual/SKILL.md", readonly: false, enabled: true, requiredMcpTools: [], requiredVaultSecrets: [],
            capabilityRisk: "read_only_safe", maxAudienceScope: "only_owner", inCharacterDemeanor: "",
            crystallizeAsEpisodicMemory: false, bodyMarkdown: "Inspect before mutating."
          }
        });
        expect(errors).toEqual([]);
      }
    }));

    host.mountPackage(sdk.defineExtensionPackage({
      manifest: { ...manifest, extension_id: "lab.ws", display_name: "WS", facets: [sdk.agentToolProviderFacet.id] },
      activate(scope) {
        scope.contributeFacet(sdk.agentToolProviderFacet, { tools: [
          { name: "read_item", description: "Read", capabilityRisk: "read_only_safe", inputSchema: stringValue, resultSchema: stringValue,
            execute: call => ({ status: "verified", value: `read:${String(call.input)}` }), project: v => v },
          { name: "write_item", description: "Write", capabilityRisk: "low_read_and_scoped_write", inputSchema: stringValue, resultSchema: stringValue,
            execute: call => ({ status: "verified", value: `wrote:${String(call.input)}` }), project: v => v }
        ] });
      }
    }));

    const seenInDualSpeed: string[][] = [];
    const seenInDirect: string[][] = [];
    const runtime = agentRuntime.createUniversalAgent({
      host,
      manualPackageIds: ["lab.skill"],
      toolRoutingMode: "dual_speed_w1_w2",
      async *model({ tools }) {
        seenInDualSpeed.push(tools.map(t => t.name));
        yield { kind: "delta", text: "ok" };
        yield { kind: "finish" };
      }
    });
    await runtime.ingest({ text: "hello" });
    expect(seenInDualSpeed).toEqual([["read_item"]]);

    runtime.setToolRoutingMode("direct_inline");
    runtime.setModelSelection({
      async *model({ tools }) {
        seenInDirect.push(tools.map(t => t.name));
        yield { kind: "delta", text: "ok" };
        yield { kind: "finish" };
      }
    });
    await runtime.ingest({ text: "hello" });
    expect(seenInDirect).toEqual([["read_item", "write_item"]]);
    runtime.stop();
  });
});
