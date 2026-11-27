import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runAgentTurn } from "@ai0/agent-core";
import { cognitionContextContributorFacet } from "@ai0/cognition-core";
import { expressionRealizerFacet, RealizerVocabularyNegotiator } from "@ai0/expression-core";
import { PerceptionFilterPipeline, perceptionFilterFacet } from "@ai0/perception-core";
import { agentToolProviderFacet, defineServiceContract, ExtensionComposition, ExtensionCoreHost } from "@ai0/sdk";
import type { UniversalObservationFrame } from "@ai0/protocol";
import { RuntimePluginLoader } from "./plugin-loader.js";
import { captionAudit, captionEditor, captionService } from "./test-support/caption-audit.js";

const input = { left: { id: "A", startMs: 1000, endMs: 3000 }, right: { id: "B", startMs: 2500, endMs: 4000 } };
const interval = { startMs: 2500, endMs: 3000 };
const finding = { kind: "overlap", ids: ["A", "B"], overlapMs: 500, interval };

it("composes one caption service into independent model, observation, review and display paths", async () => {
  const host = new ExtensionCoreHost();
  const highlight = vi.fn();
  let review: { eventId: string; revision: number; accepted: boolean } | undefined;
  const editor = captionEditor({ reviewed: () => review, highlight });
  const editorId = editor.manifest.extension_id;
  host.mountPackage(editor);
  expect(host.listFacets(agentToolProviderFacet)).toHaveLength(0);
  expect(host.listFacets(expressionRealizerFacet)).toHaveLength(1);
  host.mountPackage(captionService);
  const workflowAudit = host.bindService(captionAudit, "caption");
  expect(await workflowAudit(input)).toEqual(finding);

  const turn = await runAgentTurn({
    signal: new AbortController().signal, inputs: [{ role: "user", content: "Measure the overlap." }],
    bindings: { host, allowsTool: (id, name) => id === editorId && name === "caption_overlap" },
    async *model({ tools, rounds }) {
      if (!rounds.length) {
        expect(tools.map(tool => tool.name)).toEqual(["caption_overlap"]);
        yield { kind: "tool", name: "caption_overlap", id: "call-1", input };
      } else {
        expect(rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: { overlapMs: 500 } });
        yield { kind: "delta", text: "500 ms" };
      }
    }
  });
  expect(turn.rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: await workflowAudit(input) });
  expect(highlight).not.toHaveBeenCalled();
  const context = () => host.invokeFacetAsync(host.listFacets(cognitionContextContributorFacet)[0]!,
    impl => impl.contributeToBlackboard({ domain_revs: {} }, 128));
  expect(await context()).toBeNull();
  review = { eventId: "human-accepted-2", revision: 2, accepted: true };
  expect(await context()).toEqual({ slot_id: "caption.review", text: JSON.stringify(review) });

  const perception = new PerceptionFilterPipeline(host);
  const frame: UniversalObservationFrame = {
    channel: { channelId: editorId, modality: "custom.caption", sensorCoverage: "on_demand" },
    attribution: { principalId: "editor", subjectAnchor: "timeline" },
    provenance: { epistemicTier: "untrusted_utterance", trustedGrant: false },
    contextFrame: { socialFrame: "workspace", audienceScope: "only_owner" }, interpretation: { rawPayload: {}, primaryCue: "revision" },
    chronology: { observedAtMs: 100, freshnessTtlMs: 50, turnId: "sequence", revision: 1 }, domain_payload: input
  };
  expect(perception.ingest({ lifecycle: "commit", frame }, editorId, 100)).toEqual({ kind: "hold" });
  const next = { ...frame, chronology: { ...frame.chronology, revision: 2 } };
  perception.ingest({ lifecycle: "commit", frame: next }, editorId, 101);
  expect(perception.ingest({ lifecycle: "commit", frame }, editorId, 102)).toEqual({ kind: "suppress" });
  await expect.poll(() => perception.flushDue(102).map(event => [event.frame?.chronology.revision, event.frame?.domain_payload]))
    .toEqual([[2, finding]]);

  const output = new RealizerVocabularyNegotiator(host).negotiate({ intent: "actuate", intentId: "render-2", correlationEventId: "revision-2",
    actuationHint: { semanticAction: "highlight", arguments: interval }, deliveryConstraints: { audienceScope: "only_owner" } }, editorId);
  if (output.status !== "dispatched") throw new Error("Expected a compatible editor");
  await host.invokeFacetAsync(host.listFacets(expressionRealizerFacet)[0]!, realizer => realizer.deliver?.(output.envelope));
  expect(highlight).toHaveBeenCalledExactlyOnceWith(interval);

  for (const [disabled, removed] of [
    ["tool", agentToolProviderFacet.id], ["perception", perceptionFilterFacet.id],
    ["cognition", cognitionContextContributorFacet.id], ["expression", expressionRealizerFacet.id]
  ]) {
    host.configurePackage(editorId, { [disabled!]: false }, host.getPackage(editorId)!.rev);
    expect([
      ...host.listFacets(agentToolProviderFacet).map(() => agentToolProviderFacet.id),
      ...host.listFacets(perceptionFilterFacet).map(() => perceptionFilterFacet.id),
      ...host.listFacets(cognitionContextContributorFacet).map(() => cognitionContextContributorFacet.id),
      ...host.listFacets(expressionRealizerFacet).map(() => expressionRealizerFacet.id)
    ].sort()).toEqual(editor.manifest.facets.filter(id => id !== removed).sort());
    expect(await workflowAudit(input)).toEqual(finding);
  }
});

it("loads native service-only manifest entries and withdraws the dependent entry when its provider is disabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-service-loader-"));
  const composition = new ExtensionComposition();
  const ref = { owner: "example.owner", name: "double", version: 1 };
  const result = { owner: "example.consumer", name: "result", version: 1 };
  const packages = [
    { id: ref.owner, services: { defines: [ref], provides: [ref] },
      activation: "s.defineService(source); s.provideService(source, value => value * 2);" },
    { id: result.owner, services: { defines: [result], provides: [result], requires: [ref] },
      activation: "const client = s.consumeService(source); s.defineService(target); s.provideService(target, value => client.bind()(value));" }
  ];
  try {
    for (const pkg of packages) {
      const dir = join(root, pkg.id);
      mkdirSync(join(dir, "dist"), { recursive: true });
      const manifest = { ...captionService.manifest, extension_id: pkg.id, services: pkg.services, entry: "dist/index.mjs" };
      writeFileSync(join(dir, "ai0.extension.json"), JSON.stringify(manifest));
      writeFileSync(join(dir, "dist", "index.mjs"), [
        'const parse = value => { if (!Number.isFinite(value)) throw new Error("number required"); return value; };',
        `const source = { ...${JSON.stringify(ref)}, parseInput: parse, parseOutput: parse };`,
        `const target = { ...${JSON.stringify(result)}, parseInput: parse, parseOutput: parse };`,
        `export default { manifest: ${JSON.stringify(manifest)}, activate(s) { ${pkg.activation} } };`
      ].join("\n"));
    }
    const host = new ExtensionCoreHost();
    const loader = new RuntimePluginLoader({ builtinPluginsDir: root, userPluginsDir: join(root, "unused") });
    await loader.mountIntoHost(host, composition);
    const contract = defineServiceContract({ ...result, parseInput: Number, parseOutput: Number });
    expect(loader.getDescriptor(ref.owner)?.services?.provides).toEqual([ref]);
    const pinned = host.bindService(contract, result.owner);
    expect(await pinned(5)).toBe(10);
    loader.reload(new Map([[ref.owner, false]]));
    await loader.mountIntoHost(host, composition);
    await expect(pinned(5)).rejects.toMatchObject({ reason: { status: "revoked" } });
    expect(() => host.bindService(contract, result.owner)).toThrow(/missing/u);
  } finally {
    await composition.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
