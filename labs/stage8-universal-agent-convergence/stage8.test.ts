import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createUniversalAgent } from "@ai0/agent-runtime";
import { HandshakeManifestSchema } from "@ai0/protocol";
import * as sdk from "@ai0/sdk";

const baseManifest = {
  author: "stage8",
  version: "1.0.0",
  carrier_kind: "native_code_plugin" as const,
  permissions: {
    read_blackboard_domains: [],
    propose_mutation_domains: [],
    max_audience_scope: "only_owner" as const,
    network_access: false
  }
};

const stringSchema = {
  jsonSchema: { type: "string" },
  parse(v: unknown) {
    if (typeof v !== "string") throw new TypeError("Expected string");
    return v;
  }
};

describe("stage 8 converges Tier-I Universal Agent Engineering with Tier-II Situated Subjecthood and Tier-III Domain Plugins", () => {
  it("Trace 1 (Tier-I Pure General Agent): hot-swaps memory & workspace providers, updates D4 plans, runs HookPoints, and enforces ScopedExtensionView subagent attenuation", async () => {
    const host = new sdk.ExtensionCoreHost();
    const virtualFiles = new Map<string, string>([["src/app.ts", "export const port = 3000;"]]);
    let adminSecretCalled = false;
    let netToolCalled = false;

    // Replaceable virtual workspace tool provider (`agent.tool_provider@1`)
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier1.virtual-fs",
          display_name: "Virtual Workspace",
          facets: [sdk.agentToolProviderFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.agentToolProviderFacet, {
            tools: [
              {
                name: "vfs.read",
                description: "Read virtual file",
                capabilityRisk: "read_only_safe",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: (call) => ({ status: "verified", value: virtualFiles.get(String(call.input)) ?? "missing" }),
                project: (v) => v
              },
              {
                name: "vfs.write",
                description: "Write virtual file",
                capabilityRisk: "low_read_and_scoped_write",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: (call) => {
                  virtualFiles.set("src/app.ts", String(call.input));
                  return { status: "verified", value: "updated" };
                },
                project: (v) => v
              }
            ]
          });
        }
      })
    );

    // Privileged & network packages that MUST be attenuated away from a restricted subagent
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier1.secret-admin",
          display_name: "Secret Admin",
          facets: [sdk.agentToolProviderFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.agentToolProviderFacet, {
            tools: [
              {
                name: "admin.wipe",
                description: "Wipe cluster",
                capabilityRisk: "low_read_and_scoped_write",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: () => {
                  adminSecretCalled = true;
                  return { status: "verified", value: "wiped" };
                },
                project: (v) => v
              }
            ]
          });
        }
      })
    );

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier1.net-fetch",
          display_name: "Network Fetch",
          facets: [sdk.agentToolProviderFacet.id],
          permissions: { ...baseManifest.permissions, network_access: true }
        },
        activate(scope) {
          scope.contributeFacet(sdk.agentToolProviderFacet, {
            tools: [
              {
                name: "net.ping",
                description: "Ping network",
                capabilityRisk: "read_only_safe",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: () => {
                  netToolCalled = true;
                  return { status: "verified", value: "pong" };
                },
                project: (v) => v
              }
            ]
          });
        }
      })
    );

    const subagentVisibleTools: string[][] = [];
    const agent = createUniversalAgent({
      host,
      bypassPerception: true,
      bypassExpression: true,
      toolRoutingMode: "direct_inline",
      enableIntrinsicTools: true,
      async *model({ tools, rounds, messages }) {
        let userMsg = "";
        for (const m of messages) {
          if (m.role === "user" && "content" in m && typeof m.content === "string") {
            userMsg = m.content;
          }
        }
        // Subagent invocation branch
        if (userMsg.startsWith("Inspect src/app.ts only")) {
          subagentVisibleTools.push(tools.map((t) => t.name));
          if (rounds.length === 0) {
            yield { kind: "tool", id: "sub1", name: "vfs.read", input: "src/app.ts" };
          } else if (rounds.length === 1) {
            // Attempt unauthorized call to admin.wipe & net.ping even though excluded by ScopedExtensionView!
            yield { kind: "tool", id: "sub_illegal", name: "admin.wipe", input: "now" };
          } else {
            yield { kind: "delta", text: "Subagent verified port=3000" };
          }
          yield { kind: "finish" };
          return;
        }

        // Parent turn branch
        if (rounds.length === 0) {
          yield {
            kind: "tool",
            id: "p1",
            name: "agent.update_plan",
            input: {
              goal: "Audit and update port",
              steps: [
                { stepId: "s1", title: "Delegate read audit to restricted subagent", status: "in_progress" },
                { stepId: "s2", title: "Store architecture note in memory", status: "pending" }
              ]
            }
          };
        } else if (rounds.length === 1) {
          yield {
            kind: "tool",
            id: "p2",
            name: "agent.delegate_subagent",
            input: {
              task: "Inspect src/app.ts only",
              allowedPackages: ["tier1.virtual-fs", "tier1.net-fetch"],
              allowedTools: ["vfs.read"],
              allowNetwork: false
            }
          };
        } else if (rounds.length === 2) {
          yield {
            kind: "tool",
            id: "p3",
            name: "agent.propose_memory",
            input: { content: "Service default port is 3000", memoryTier: "semantic_fact" }
          };
        } else {
          yield { kind: "delta", text: "Completed plan, subagent audit, and memory persistence." };
        }
        yield { kind: "finish" };
      }
    });

    const turn1 = await agent.ingest({ text: "Audit src/app.ts and remember the port", nowMs: 100 });
    expect(turn1.cycles[0]!.delivery.text).toBe("Completed plan, subagent audit, and memory persistence.");
    // Verify delegate_subagent receipt settles cleanly to `status: "verified"` when subagent stopReason === "finished"
    expect(turn1.cycles[0]!.action.rounds[1]?.receipts[0]?.result).toMatchObject({
      status: "verified",
      value: { stopReason: "finished", summary: "Subagent verified port=3000" }
    });
    expect(agent.getActivePlan()?.goal).toBe("Audit and update port");
    // Subagent ONLY saw `vfs.read`; `tier1.secret-admin`, `tier1.net-fetch` (network_access=true), `vfs.write`, and recursive `delegate_subagent` were all stripped!
    expect(subagentVisibleTools[0]).toEqual(["vfs.read"]);
    expect(adminSecretCalled).toBe(false);
    expect(netToolCalled).toBe(false);

    // Built-in InMemoryCognitiveMemoryProvider captured the verified memory
    const builtInRecalled = await agent.retrieveMemories({ query: "port 3000", audienceScope: "only_owner" });
    expect(builtInRecalled).toHaveLength(1);
    expect(builtInRecalled[0]?.content).toContain("3000");

    // Hot-swap `cognition.memory_provider@1` with zero core code changes!
    const externalRecords: sdk.FacetPoint<unknown>[] = [];
    void externalRecords;
    const customStore: Array<{ id: string; text: string }> = [{ id: "ext_1", text: "Replaced vector memory: port migrated to 8080" }];
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier1.custom-memory",
          display_name: "Custom Vector Memory",
          facets: [sdk.cognitionMemoryProviderFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.cognitionMemoryProviderFacet, {
            priority: 1,
            retrieve: () =>
              customStore.map((item) => ({
                memoryId: item.id,
                content: item.text,
                memoryTier: "semantic_fact" as const,
                audienceScope: "only_owner" as const,
                createdAtMs: 200
              }))
          });
        }
      })
    );
    const swappedRecalled = await agent.retrieveMemories({ query: "port", audienceScope: "only_owner" });
    expect(swappedRecalled.map((m) => m.content)).toEqual(["Replaced vector memory: port migrated to 8080"]);

    // Verify custom HookPoint (`custom.*` namespace) waterfall execution on the same host
    const reviewHook = sdk.defineHookPoint<{ approved: boolean; tags: string[] }>({
      owner: "custom.ci",
      name: "gate",
      version: 1
    });
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier1.ci-hook",
          display_name: "CI Gate Hook",
          facets: [reviewHook.facet.id]
        },
        activate(scope) {
          scope.contributeFacet(reviewHook.facet, {
            handle: (state) => ({ approved: state.approved, tags: [...state.tags, "lint_passed"] })
          });
        }
      })
    );
    expect(await sdk.runWaterfallHook(host, reviewHook, { approved: true, tags: [] })).toEqual({
      approved: true,
      tags: ["lint_passed"]
    });
    agent.stop();
  });

  it("Trace 2 & Trace 3 (Tier-I + Tier-II Situated Subject Convergence -> Tier-III Companion Overlay & Clean Ablation)", async () => {
    const host = new sdk.ExtensionCoreHost();
    let writeCalledAfterUntrustedWeb = false;

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier2.tools",
          display_name: "Web & Workspace Tools",
          facets: [sdk.agentToolProviderFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.agentToolProviderFacet, {
            tools: [
              {
                name: "web.fetch_url",
                description: "Fetch external page",
                capabilityRisk: "read_only_safe",
                resultTaint: "untrusted_external",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: () => ({ status: "verified", value: "External untrusted article" }),
                project: (v) => v
              },
              {
                name: "workspace.write_file",
                description: "Write workspace file",
                capabilityRisk: "low_read_and_scoped_write",
                inputSchema: stringSchema,
                resultSchema: stringSchema,
                execute: () => {
                  writeCalledAfterUntrustedWeb = true;
                  return { status: "verified", value: "written" };
                },
                project: (v) => v
              }
            ]
          });
        }
      })
    );

    const w1SeenTools: string[][] = [];
    const agent = createUniversalAgent({
      host,
      toolRoutingMode: "dual_speed_w1_w2",
      enableIntrinsicTools: true,
      async *model({ tools, rounds }) {
        w1SeenTools.push(tools.map((t) => t.name));
        if (rounds.length === 0) {
          // W1 autonomously dispatches a background goal to D4 while replying immediately!
          yield {
            kind: "tool",
            id: "bg1",
            name: "agent.dispatch_background_goal",
            input: { goal: "Summarize docs and save notes", capabilityRisk: "low_read_and_scoped_write" }
          };
        } else {
          yield { kind: "delta", text: "On it! Let me check that in the background. Everything will stay safe." };
        }
        yield { kind: "finish" };
      }
    });

    // Mount situated voice/stage channel (`Tier II` expression grounding) with ZERO `Tier III` companion plugins!
    agent.mountChannel(
      HandshakeManifestSchema.parse({
        protocol_version: "0.1.0",
        auth_token: "tok_stage8_voice",
        channel_id: "stage.voice",
        channel_kind: "desktop_stage",
        display_name: "Voice Stage",
        venue_type: "private_1on1",
        current_audience: { scope: "only_owner", member_count: 1 },
        latency_budget_ms: 1500,
        capabilities: {
          sensors: ["text", "audio_transcript"],
          supported_extensions: [],
          actuators: [],
          embodiment_surface: null
        }
      })
    );
    expect(agent.coordinator.getSnapshot().D2_CONTINUOUS_STATES.values).toEqual({});

    // EpistemicMemoryFirewall blocks playful_banter from polluting semantic_fact even without companion plugins!
    const banterAttempt = await agent.proposeMemory({
      content: "User lives on Mars",
      memoryTier: "semantic_fact",
      interactionFrame: "playful_banter"
    });
    expect(banterAttempt).toEqual({ accepted: false, reason: "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT" });

    // W1 turn: side-effect tools (`workspace.write_file`, `agent.propose_memory`) are gated out of W1;
    // `agent.dispatch_background_goal` registers a D4 task cleanly!
    const w1Turn = await agent.ingest({ channelId: "stage.voice", text: "Check docs in background", nowMs: 1_000 });
    expect(w1SeenTools[0]).not.toContain("workspace.write_file");
    expect(w1SeenTools[0]).toContain("agent.dispatch_background_goal");
    const activeTasks = Object.values(agent.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks);
    expect(activeTasks).toHaveLength(1);
    const dispatchedTaskId = activeTasks[0]!.task_id;

    // Expression grounding: interrupt voice playback at 18 chars -> unsaid_remainder preserved!
    const delivery = w1Turn.cycles[0]!.delivery;
    expect(delivery.mode).toBe("realizer_negotiated");
    if (delivery.mode === "realizer_negotiated" && delivery.dispatch.status === "dispatched") {
      const recovered = agent.receiveDeliveryReceipt({
        intent_id: delivery.dispatch.envelope.intent_id,
        chunk_seq: 0,
        status: "interrupted",
        spoken_char_offset: 6
      });
      expect(recovered?.spoken_char_offset).toBe(6);
      expect(recovered?.unsaid_remainder).toContain("Let me check that in the background.");
    }

    // W2 executes the dispatched task: fetching untrusted_external web content dynamically revokes workspace.write_file!
    const w2Result = await agent.executeAsyncGoalTask({
      taskId: dispatchedTaskId,
      inputs: [{ id: "w2_goal", role: "user", content: "Fetch URL then try writing" }],
      async *model({ rounds }) {
        if (rounds.length === 0) {
          yield { kind: "tool", id: "w2_1", name: "web.fetch_url", input: "https://example.com" };
        } else if (rounds.length === 1) {
          yield { kind: "tool", id: "w2_2", name: "workspace.write_file", input: "injected" };
        } else {
          yield { kind: "delta", text: "Finished safely without writing." };
        }
        yield { kind: "finish" };
      }
    });
    expect(writeCalledAfterUntrustedWeb).toBe(false);
    expect(w2Result.report.rounds[1]?.receipts[0]?.result).toMatchObject({ status: "failed" });

    // Trace 3: Dynamically mount Tier-III Companion organs (state dynamics + lorebook context) without changing a line of Tier-I / Tier-II!
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "tier3.companion-organ",
          display_name: "Companion Homeostasis & Lore",
          facets: [sdk.cognitionStateDynamicsFacet.id, sdk.cognitionContextContributorFacet.id],
          permissions: {
            ...baseManifest.permissions,
            read_blackboard_domains: ["D2_CONTINUOUS_STATES"]
          }
        },
        activate(scope) {
          scope.contributeFacet(sdk.cognitionStateDynamicsFacet, {
            descriptors: [{ id: "warmth", topology: "bipolar_tanh", baseline: 0.25, halfLifeMs: 5_000, wakeupThresholds: [] }]
          });
          scope.contributeFacet(sdk.cognitionContextContributorFacet, {
            priority: 1,
            contributeToBlackboard: () => ({ slot_id: "slot.companion_lore", text: "Shared stargazing memory." })
          });
        }
      })
    );
    expect(agent.coordinator.getSnapshot().D2_CONTINUOUS_STATES.values.warmth).toBeCloseTo(0.25, 5);

    const seenCompanionContext: string[] = [];
    agent.setModelSelection({
      async *model({ messages }) {
        for (const msg of messages) {
          if ("content" in msg && typeof msg.content === "string") seenCompanionContext.push(msg.content);
        }
        yield { kind: "delta", text: "Warm reply" };
        yield { kind: "finish" };
      }
    });
    await agent.ingest({ channelId: "stage.voice", text: "Remember the stars?", nowMs: 2_000 });
    expect(seenCompanionContext.some((c) => c.includes("Shared stargazing memory."))).toBe(true);

    // Unmount Tier-III plugin -> D2 immediately returns to empty `{}`!
    host.unmountPackage("tier3.companion-organ");
    expect(agent.coordinator.getSnapshot().D2_CONTINUOUS_STATES.values).toEqual({});
    agent.stop();
  });

  it("Trace 4 (Headless Discovery Loader): discovers SKILL.md and declarative plugins from disk without apps/daemon", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ai0-stage8-loader-"));
    try {
      const skillFolder = join(tempDir, "skills", "code-audit");
      mkdirSync(skillFolder, { recursive: true });
      writeFileSync(
        join(skillFolder, "SKILL.md"),
        [
          "---",
          "skill_id: skill.code-audit",
          "display_name: Code Audit SOP",
          "description: Verify boundaries before mutating files",
          "required_mcp_tools: []",
          "capability_risk: read_only_safe",
          "max_audience_scope: only_owner",
          "in_character_demeanor: focused",
          "crystallize_as_episodic_memory: false",
          "---",
          "Always list and read target files before proposing edits."
        ].join("\n"),
        "utf8"
      );

      const pluginFolder = join(tempDir, "plugins", "project-conventions");
      mkdirSync(pluginFolder, { recursive: true });
      writeFileSync(
        join(pluginFolder, "ai0.extension.json"),
        JSON.stringify({
          manifest_version: "2.0.0",
          extension_id: "local.conventions",
          display_name: "Project Conventions",
          version: "1.0.0",
          author: "stage8",
          carrier_kind: "declarative_soul_asset",
          default_enabled: true,
          facets: ["agent.context_contributor"],
          values: {
            style_guide: "Prefer pure functions and explicit error returns."
          },
          projections: [{ source: "style_guide", facet: "agent.context_contributor", version: 1 }],
          permissions: {
            read_blackboard_domains: [],
            propose_mutation_domains: [],
            max_audience_scope: "only_owner",
            network_access: false
          }
        }),
        "utf8"
      );

      const host = new sdk.ExtensionCoreHost();
      const loadReport = await sdk.discoverAndMountExtensions(host, {
        pluginDirs: [join(tempDir, "plugins")],
        skillDirs: [join(tempDir, "skills")]
      });
      expect(loadReport.errors).toEqual([]);
      expect(loadReport.mountedPackageIds).toEqual(["local.conventions", "skill.code-audit"]);
      expect(host.listFacets(sdk.agentSkillManualFacet).map((f) => f.packageId)).toEqual(["skill.code-audit"]);
      expect(host.listFacets(sdk.agentContextContributorFacet).map((f) => f.packageId)).toEqual(["local.conventions"]);

      // Progressive skill disclosure & activation: Step 0 has zero skill manuals bound;
      // the model calls `agent.list_skills` -> `agent.activate_skill`, and Step 2 automatically receives the SKILL.md manual!
      const observationsByStep: string[][] = [];
      const progressiveAgent = createUniversalAgent({
        host,
        bypassPerception: true,
        bypassExpression: true,
        enableIntrinsicTools: true,
        async *model({ rounds, prompt }) {
          observationsByStep.push(prompt.observations.map((o) => o.content));
          if (rounds.length === 0) {
            yield { kind: "tool", id: "sk1", name: "agent.list_skills", input: {} };
          } else if (rounds.length === 1) {
            yield { kind: "tool", id: "sk2", name: "agent.activate_skill", input: { packageId: "skill.code-audit" } };
          } else {
            yield { kind: "delta", text: "Skill activated and applied." };
          }
          yield { kind: "finish" };
        }
      });

      const skillTurn = await progressiveAgent.ingest({ text: "Prepare for code audit" });
      expect(skillTurn.cycles[0]!.delivery.text).toBe("Skill activated and applied.");
      expect(observationsByStep[0]?.some((c) => c.includes("Always list and read target files"))).toBe(false);
      expect(observationsByStep[2]?.some((c) => c.includes("Always list and read target files"))).toBe(true);
      progressiveAgent.stop();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
