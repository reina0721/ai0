import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAgentTurn } from "@ai0/agent-core";
import { subscribePerceptionSource } from "@ai0/perception-core";
import { bindActuatorDelivery, RealizerVocabularyNegotiator } from "@ai0/expression-core";
import { McpServerConfigSchema, type CarrierProjection } from "@ai0/protocol";
import { agentToolProviderFacet, agentContextContributorFacet, agentSkillManualFacet, cognitionContextContributorFacet,
  cognitionSleepOrganFacet, consoleUiSlotFacet, expressionIntentDecoratorFacet, ExtensionComposition, ExtensionCoreHost } from "@ai0/sdk";
import { importUserSkillMarkdown, listAgentSkills, setAgentSkillEnabled } from "@ai0/storage";
import { RuntimePluginLoader } from "./plugin-loader.js";
import { probeMcpServer, withCurrentMcpDiscovery } from "./mcp-probe.js";
import { captionAudit, captionService } from "./test-support/caption-audit.js";

const intent = { intent: "communicate" as const, intentId: "reply", correlationEventId: "turn",
  utterance: "OK", deliveryConstraints: { audienceScope: "only_owner" as const } };
const channel = { protocol_version: "0.1.0" as const, channel_id: "display", channel_kind: "webchat" as const,
  display_name: "display", venue_type: "private_1on1" as const, current_audience: { scope: "only_owner" as const, member_count: 1 },
  latency_budget_ms: 100, capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] } };
const route = (source: string, facet: string, version = 1, options?: Record<string, unknown>): CarrierProjection =>
  ({ source, facet, version, options });

it("projects a disk SKILL's trigger, SOP, output and tone separately and disables every bound facet together", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-skill-projections-"));
  const composition = new ExtensionComposition();
  try {
    const projections = [route("description", "cognition.context_contributor", 1, { whenTextIncludes: "review" }),
      route("section:SOP", "agent.skill_manual"), route("section:Output", "agent.context_contributor"),
      route("tone", "expression.intent_decorator"), route("episodic", "cognition.sleep_organ", 1, { whenTextIncludes: "review" }),
      route("body", "agent.context_contributor", 27)];
    const skill = importUserSkillMarkdown(root, [
      "---", "skill_id: manual", "display_name: Manual", "description: Review the interval", "required_mcp_tools: [write_file]",
      "in_character_demeanor: calm", "crystallize_as_episodic_memory: true", "projections:", ...projections.map(mapping => "  - " + JSON.stringify(mapping)),
      "---", "# SOP", "Read both intervals.", "# Output", "Give the overlap in milliseconds."
    ].join("\n"));
    expect(skill.projections).toEqual(projections);
    const loader = new RuntimePluginLoader({ builtinPluginsDir: join(root, "empty"), userPluginsDir: join(root, "user") });
    const host = new ExtensionCoreHost();
    const refresh = async () => {
      loader.reload(undefined, { skills: listAgentSkills(root), servers: [] });
      await loader.mountIntoHost(host, composition);
    };
    await refresh();
    const id = "carrier:skill:manual";
    expect(loader.activationError(host, id)).toMatch(/Unsupported target version/u);
    expect(host.getPackage(id)?.manifest.permissions.read_blackboard_domains).toEqual([]);
    expect(host.listFacets(agentToolProviderFacet)).toEqual([]);
    expect(host.listFacets(agentSkillManualFacet)[0]?.implementation.instructions).toBe("Read both intervals.");
    expect(host.listFacets(agentSkillManualFacet)[0]?.implementation.allowedTools).toEqual(["write_file"]);
    expect(host.allowsProposeDomain(id, "D3_MEMORY_PROJECTION")).toBe(false);
    const memory = host.listFacets(cognitionSleepOrganFacet)[0]!;
    expect(await memory.implementation.onSleepCycleWakeup({}, [])).toEqual([]);
    expect(await memory.implementation.onSleepCycleWakeup({ domain_revs: {D3_MEMORY_PROJECTION: 9} },
      [{event_id: "human-3", summary_text: "please review"}])).toMatchObject([{base_rev: 9, source_event_ids: ["human-3"], taint_level: "untrusted_external"}]);
    const trigger = host.listFacets(cognitionContextContributorFacet)[0]!;
    expect(await trigger.implementation.contributeToBlackboard({}, 100, { text: "now" })).toBeNull();
    expect(await trigger.implementation.contributeToBlackboard({}, 100, { text: "please review" })).toMatchObject({ text: "Review the interval" });
    expect(host.listFacets(expressionIntentDecoratorFacet)[0]?.implementation.decorate(intent, channel).expressiveStance?.semanticCue).toBe("calm");
    await runAgentTurn({ inputs: [], signal: new AbortController().signal, bindings: { host, manualPackageIds: [id] }, async *model(request) {
      expect(request.prompt.observations).toEqual([{ content: "Read both intervals." }, { content: "Give the overlap in milliseconds." }]);
      expect(request.tools).toEqual([]);
      yield { kind: "finish" };
    } });
    setAgentSkillEnabled(root, skill.id, false);
    await refresh();
    expect(host.listFacets(agentContextContributorFacet)).toHaveLength(0);
    expect(host.invokeFacet(trigger, () => "stale")).toBeUndefined();
  } finally { await composition.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it("mounts a declared flow as a callable pipeline and independent passive facets", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-flow-projections-"));
  const composition = new ExtensionComposition();
  try {
    const dir = join(root, "flow");
    mkdirSync(dir);
    const manifest = { ...captionService.manifest, extension_id: "review.flow", carrier_kind: "visual_cognitive_flow",
      services: { requires: [{ ...captionAudit, facet: "agent.tool_provider" }] },
      values: { notice: "Inspect the two subtitle intervals.", slot: { slot_target: "slot.review.results", widget_type: "markdown_card_list", title: "Review" } },
      flows: { verify: [captionAudit] }, facets: ["agent.context_contributor", "agent.tool_provider", "console.ui_slot"],
      projections: [route("notice", "agent.context_contributor"), route("slot", "console.ui_slot"),
        route("verify", "agent.tool_provider", 1, { inputSchema: { type: "object" }, outputSchema: { type: "object" } })] };
    writeFileSync(join(dir, "ai0.extension.json"), JSON.stringify(manifest));
    const loader = new RuntimePluginLoader({ builtinPluginsDir: root, userPluginsDir: join(root, "user") });
    const host = new ExtensionCoreHost();
    await loader.mountIntoHost(host, composition);
    expect(host.listFacets(agentToolProviderFacet)).toHaveLength(0);
    expect(host.listFacets(consoleUiSlotFacet)[0]?.implementation.slots[0]?.title).toBe("Review");
    expect(loader.getDescriptor("review.flow", undefined, host)?.ui_slots).toContainEqual(manifest.values.slot);
    host.mountPackage(captionService);
    const answer = await runAgentTurn({ inputs: [], signal: new AbortController().signal, bindings: { host, allowsTool: () => true },
      async *model({ step }) { if (!step) yield { kind: "tool", id: "a", name: "verify", input: {
        left: { id: "a", startMs: 1000, endMs: 3000 }, right: { id: "b", startMs: 2500, endMs: 4000 } } }; } });
    expect(answer.rounds[0]?.receipts[0]?.result).toMatchObject({ status: "unverified", value: { overlapMs: 500 } });
    host.setServiceAccess("review.flow", captionAudit, false);
    expect(host.listFacets(agentToolProviderFacet)).toHaveLength(0);
    expect(host.listFacets(agentContextContributorFacet)).toHaveLength(1);
  } finally { await composition.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it("uses MCP tool discovery, calls, static resource reads and live resource change notifications under separate grants", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-projected-mcp-"));
  const composition = new ExtensionComposition();
  try {
    const journal = join(root, "requests.txt");
    writeFileSync(journal, "");
    const fixture = join(root, "resource-service.mjs");
    writeFileSync(fixture, [
      'import {createInterface} from "node:readline"; import {appendFileSync} from "node:fs";',
      'const write = body => process.stdout.write(JSON.stringify({jsonrpc:"2.0",...body})+"\\n"); let revision=1;',
      'const tools=[{name:"measure",description:"Measure text",inputSchema:{type:"object",properties:{text:{type:"string"}},required:["text"]}},',
      '{name:"highlight",inputSchema:{type:"object"},outputSchema:{type:"object"}}];',
      'createInterface({input:process.stdin}).on("line", line => { const {id,method,params} = JSON.parse(line);',
      'appendFileSync(process.argv[2], method+"\\n"); if(id===undefined) return; let result={};',
      'if (method==="initialize") result={protocolVersion:params.protocolVersion,serverInfo:{name:"captions",version:"1"},capabilities:{...(process.argv[3]?{}:{tools:{}}),resources:{subscribe:true}}};',
      'if (method==="tools/list") result={tools};',
      'if (method==="tools/call") result=params.name==="highlight"?{content:[],structuredContent:{intent_id:params.arguments.intent_id,chunk_seq:params.arguments.chunk_seq,status:"rendered"}}:{content:[{type:"text",text:String(params.arguments.text.length)}]};',
      'if (method==="resources/read") result={contents:[{uri:params.uri,text:"revision "+revision}]};',
      'if (method==="resources/read" && params.uri==="caption://offline") return write({id,error:{code:-32002,message:"offline"}});',
      'if (method==="resources/subscribe") setTimeout(()=>{ revision++; write({method:"notifications/resources/updated",params:{uri:params.uri}}); },180);',
      'write({id,result}); });'
    ].join("\n"));
    const server = McpServerConfigSchema.parse({ id: "editor", name: "editor", command: process.execPath, args: [fixture, journal],
      projections: [route("tool:measure", "agent.tool_provider", 1), route("resource:caption://timeline", "perception.source", 1),
        route("tool:highlight", "expression.realizer", 1, { channel: { ...channel, capabilities: { ...channel.capabilities, actuators: [
          { actuator_id: "highlight", description: "Highlight selection", parameters_json_schema: {}, requires_local_user_consent: true }
        ] } } }),
        route("resource:caption://timeline", "cognition.context_contributor"),
        route("resource:caption://offline", "cognition.context_contributor")] });
    const probe = await probeMcpServer(server);
    expect(probe.ok, probe.detail).toBe(true);
    server.status = "connected"; server.discoveredTools = probe.tools;
    const resourceOnly = { ...server, args: [...server.args, "resource-only"] };
    expect(withCurrentMcpDiscovery(resourceOnly, server)).toMatchObject({ status: "untested", discoveredTools: [] });
    const resourceProbe = await probeMcpServer(resourceOnly);
    expect(resourceProbe).toMatchObject({ ok: true, tools: [] });
    const requests = () => readFileSync(journal, "utf8").trim().split("\n");
    const count = requests().length;
    const host = new ExtensionCoreHost();
    const loader = new RuntimePluginLoader({ builtinPluginsDir: join(root, "empty"), userPluginsDir: join(root, "user") });
    loader.reload(undefined, { skills: [], servers: [server] });
    await loader.mountIntoHost(host, composition);
    expect(requests()).toHaveLength(count);
    const id = "carrier:mcp:editor";
    const result = await runAgentTurn({ inputs: [], signal: new AbortController().signal, bindings: {host, allowsTool: key => key === id},
      async *model({step, tools}) {
        if (step) return;
        expect(tools[0]?.inputSchema).toEqual(probe.tools[0]?.inputSchema);
        yield { kind: "tool", id: "a", name: "measure", input: { text: "abc" } };
      } });
    expect(result.rounds[0]?.receipts[0]?.result).toMatchObject({ status: "unverified", value: [{ type: "text", text: "3" }] });
    expect(await host.listFacets(cognitionContextContributorFacet)[0]?.implementation.contributeToBlackboard({}, 100)).toMatchObject({ text: "revision 1" });
    const offline = host.listFacets(cognitionContextContributorFacet)[1]!;
    expect(await host.invokeFacetAsync(offline, facet => facet.contributeToBlackboard({}, 100))).toBeNull();
    expect(loader.activationError(host, id)).toContain("caption://offline");
    expect(host.getPackage(id)?.status).toBe("active");
    const action = new RealizerVocabularyNegotiator(host).negotiate({ ...intent, intent: "actuate", actuationHint: { semanticAction: "highlight" } }, channel.channel_id);
    if (!action.envelope) throw new Error("No matching endpoint");
    const signal = new AbortController().signal;
    await expect(bindActuatorDelivery(host, id, channel.channel_id, () => false)(action.envelope, signal)).rejects.toThrow("Actuation denied");
    expect(await bindActuatorDelivery(host, id, channel.channel_id, name => name === "highlight")(action.envelope, signal)).toEqual({
      intent_id: intent.intentId, chunk_seq: 0, status: "rendered"
    });
    const observations: string[] = [];
    const stop = await subscribePerceptionSource(host, id, "only_owner", new AbortController().signal, value => observations.push(value.content));
    await expect.poll(() => observations).toEqual(["revision 1", "revision 2"]);
    loader.reload(undefined, { skills: [], servers: [{ ...server, enabled: false }] });
    await loader.mountIntoHost(host, composition);
    expect(host.listFacets(agentToolProviderFacet)).toHaveLength(0);
    stop();
    expect(requests().filter(item => item === "tools/call")).toHaveLength(2);
  } finally { await composition.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
