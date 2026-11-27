import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  AgentCore,
  type ExecutionIdempotencyEntry,
  type ExecutionIdempotencyStorePort
} from "@ai0/agent-core";
import { createUniversalAgent } from "@ai0/agent-runtime";
import {
  bindCustomStateDomainToDynamicContract,
  CognitionCore,
  VirtualClock,
  type CoordinatorStorageMutator,
  type ReadOnlyCognitiveSnapshot
} from "@ai0/cognition-core";
import { ExpressionCore } from "@ai0/expression-core";
import { PerceptionCore } from "@ai0/perception-core";
import {
  Ai0ExtensionManifestSchema,
  parseKnownExtensions,
  type AgentModelAdapter,
  type AgentModelEvent,
  type InteractionChannel,
  type PreparedAgentRequest
} from "@ai0/protocol";
import * as sdk from "@ai0/sdk";

const baseManifest = {
  author: "stage10",
  version: "1.0.0",
  manifest_version: "2.0.0" as const,
  carrier_kind: "native_code_plugin" as const,
  permissions: {
    read_blackboard_domains: [],
    propose_mutation_domains: [],
    max_audience_scope: "public_all" as const,
    network_access: false
  }
};

function makeDeterministicModelAdapter(
  decide: (request: PreparedAgentRequest, stepIndex: number) => AgentModelEvent[]
): AgentModelAdapter {
  let stepIndex = 0;
  return {
    capabilities: { tools: true, structuredOutput: false },
    async *model(request: PreparedAgentRequest): AsyncIterable<AgentModelEvent> {
      const events = decide(request, stepIndex++);
      for (const evt of events) {
        yield evt;
      }
    }
  };
}

function createSqliteIdempotencyAndCheckpointStore() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE checkpoints (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE tool_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      recorded_at_step INTEGER NOT NULL
    );
  `);

  const coordinatorStorage: CoordinatorStorageMutator = {
    getEventById: (id) => ({
      event_id: id,
      redacted_at_ts_ms: null,
      principal_trust: "owner_verified",
      summary_text: id
    }),
    saveTurnDecisionTrace: () => {},
    checkpointCoordinatorState: (snapshot) => {
      db.prepare(
        `INSERT INTO checkpoints (id, snapshot_json) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json`
      ).run(JSON.stringify(snapshot));
    },
    loadCoordinatorState: () => {
      const row = db.prepare(`SELECT snapshot_json FROM checkpoints WHERE id = 1`).get() as
        | { snapshot_json: string }
        | undefined;
      return row ? (JSON.parse(row.snapshot_json) as ReadOnlyCognitiveSnapshot) : undefined;
    }
  };

  const idempotencyStore: ExecutionIdempotencyStorePort = {
    get(idempotencyKey: string): ExecutionIdempotencyEntry | undefined {
      const row = db
        .prepare(`SELECT * FROM tool_idempotency WHERE idempotency_key = ?`)
        .get(idempotencyKey) as
        | {
            idempotency_key: string;
            scope_id: string;
            tool_name: string;
            input_hash: string;
            result_json: string;
            recorded_at_step: number;
          }
        | undefined;
      if (!row) return undefined;
      return {
        idempotencyKey: row.idempotency_key,
        scopeId: row.scope_id,
        toolName: row.tool_name,
        inputHash: row.input_hash,
        result: JSON.parse(row.result_json),
        recordedAtStep: row.recorded_at_step
      };
    },
    set(entry: ExecutionIdempotencyEntry): void {
      db.prepare(
        `INSERT INTO tool_idempotency (
          idempotency_key, scope_id, tool_name, input_hash, result_json, recorded_at_step
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          result_json = excluded.result_json,
          recorded_at_step = excluded.recorded_at_step`
      ).run(
        entry.idempotencyKey,
        entry.scopeId,
        entry.toolName,
        entry.inputHash,
        JSON.stringify(entry.result),
        entry.recordedAtStep
      );
    },
    listByScope(scopeId: string): readonly ExecutionIdempotencyEntry[] {
      const rows = db
        .prepare(`SELECT * FROM tool_idempotency WHERE scope_id = ? ORDER BY recorded_at_step ASC`)
        .all(scopeId) as Array<{
        idempotency_key: string;
        scope_id: string;
        tool_name: string;
        input_hash: string;
        result_json: string;
        recorded_at_step: number;
      }>;
      return rows.map((row) => ({
        idempotencyKey: row.idempotency_key,
        scopeId: row.scope_id,
        toolName: row.tool_name,
        inputHash: row.input_hash,
        result: JSON.parse(row.result_json),
        recordedAtStep: row.recorded_at_step
      }));
    }
  };

  return { db, coordinatorStorage, idempotencyStore };
}

describe("Stage 10 · Global Open-World Isomorphism, Contract Evolution, Idempotent Side-Effects & Endogenous Consolidation", () => {
  it("Counterexample 1: First-class contract-pack manifests, multi-hop DynamicContract v1->v2->v3 upcasting, and open wire parseKnownExtensions", () => {
    // 1. Pure contract-pack manifest passes without dummy facets, while empty manifest still fails
    const contractPackManifest = Ai0ExtensionManifestSchema.parse({
      ...baseManifest,
      extension_id: "contract-pack.iot-motion",
      display_name: "IoT Motion Contract Pack",
      contracts: {
        defines: [
          { kind: "perception_event", namespace: "iot", name: "motion", version: 1 },
          { kind: "perception_event", namespace: "iot", name: "motion", version: 2 },
          { kind: "perception_event", namespace: "iot", name: "motion", version: 3 }
        ]
      }
    });
    expect(contractPackManifest.facets).toEqual([]);
    expect(contractPackManifest.contracts?.defines).toHaveLength(3);
    expect(() =>
      Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "invalid.empty",
        display_name: "Empty"
      })
    ).toThrow(/Declare a facet or a service/);

    // 2. Mount v1 -> v2 -> v3 contracts and migrations on ExtensionCoreHost
    const host = new sdk.ExtensionCoreHost();
    const clock = new VirtualClock({ targetInstance: "sandbox:stage10-c1", initialVirtualTsMs: 1_000 });
    const perception = new PerceptionCore({ clock, host });

    host.mountPackage({
      manifest: contractPackManifest,
      activate(scope) {
        scope.registerDynamicContract({
          kind: "perception_event",
          namespace: "iot",
          name: "motion",
          version: 1,
          jsonSchema: { type: "object", required: ["zone"], properties: { zone: { type: "string" } } },
          parse(raw) {
            const r = raw as { zone?: unknown };
            if (typeof r?.zone !== "string") throw new TypeError("v1 requires zone");
            return { zone: r.zone };
          }
        });
        scope.registerDynamicContract({
          kind: "perception_event",
          namespace: "iot",
          name: "motion",
          version: 2,
          jsonSchema: {
            type: "object",
            required: ["zone", "confidence"],
            properties: { zone: { type: "string" }, confidence: { type: "number" } }
          },
          parse(raw) {
            const r = raw as { zone?: unknown; confidence?: unknown };
            if (typeof r?.zone !== "string" || typeof r?.confidence !== "number") {
              throw new TypeError("v2 requires zone + confidence");
            }
            return { zone: r.zone, confidence: r.confidence };
          }
        });
        scope.registerDynamicContract({
          kind: "perception_event",
          namespace: "iot",
          name: "motion",
          version: 3,
          jsonSchema: {
            type: "object",
            required: ["zone", "confidence", "vector3d"],
            properties: {
              zone: { type: "string" },
              confidence: { type: "number" },
              vector3d: { type: "array" }
            }
          },
          parse(raw) {
            const r = raw as { zone?: unknown; confidence?: unknown; vector3d?: unknown };
            if (typeof r?.zone !== "string" || typeof r?.confidence !== "number" || !Array.isArray(r?.vector3d)) {
              throw new TypeError("v3 requires zone + confidence + vector3d");
            }
            return { zone: r.zone, confidence: r.confidence, vector3d: r.vector3d as number[] };
          }
        });

        scope.registerDynamicContractMigration(
          sdk.defineDynamicContractMigration({
            kind: "perception_event",
            namespace: "iot",
            name: "motion",
            fromVersion: 1,
            toVersion: 2,
            migrate: (v1: { zone: string }) => ({ zone: v1.zone, confidence: 0.75 })
          })
        );
        scope.registerDynamicContractMigration(
          sdk.defineDynamicContractMigration({
            kind: "perception_event",
            namespace: "iot",
            name: "motion",
            fromVersion: 2,
            toVersion: 3,
            migrate: (v2: { zone: string; confidence: number }) => ({
              ...v2,
              vector3d: [0, 0, 1]
            })
          })
        );
      }
    });

    // 3. Legacy v1 sensor event auto-upcasts through v1 -> v2 -> v3 in PerceptionCore
    const frame = perception.normalizer.normalize(
      {
        event_id: "evt_motion_v1",
        timestamp: "2026-01-01T00:00:01.000Z",
        lifecycle: "commit",
        actor: { platform_uid: "sensor:hallway", display_name: "Hallway Sensor" },
        modality: "sensor",
        summary_text: "Hallway motion detected",
        confidence: 1,
        persistence_hint: "permanent",
        extensions: {
          "ai0.dynamic_event": {
            namespace: "iot",
            name: "motion",
            version: 1,
            upcastToLatest: true,
            payload: { zone: "north_hallway" }
          }
        }
      },
      {
        channelId: "channel.iot",
        principalId: "sensor:hallway",
        audienceScope: "only_owner"
      }
    );
    expect(frame.provenance.dynamicContractId).toBe("perception_event:iot.motion@3");

    // 4. Open wire parseKnownExtensions recognizes dynamic contract keys instead of degrading them
    const wireParsed = parseKnownExtensions(
      {
        "iot.motion@3": { zone: "north_hallway", confidence: 0.9, vector3d: [1, 0, 0] },
        "unknown.unregistered@1": { foo: "bar" }
      },
      undefined,
      (key, payload) => {
        const match = /^([a-z0-9_.]+)\.([a-z0-9_]+)@(\d+)$/.exec(key);
        if (!match) return undefined;
        const [, ns, name, ver] = match;
        if (host.getDynamicContract("perception_event", ns!, name!, Number(ver))) {
          return host.validateDynamicContractPayload("perception_event", ns!, name!, Number(ver), payload);
        }
        return undefined;
      }
    );
    expect(wireParsed.recognized["iot.motion@3"]).toEqual({
      zone: "north_hallway",
      confidence: 0.9,
      vector3d: [1, 0, 0]
    });
    expect(wireParsed.degraded_extensions).toEqual(["unknown.unregistered@1"]);

    perception.dispose();
  });

  it("Counterexample 2: Full 4-Core Isomorphism — AgentCore dynamicCapabilityContract, Z-axis execution_guard loop breaker, and crash-recovery ExecutionIdempotencyLedger", async () => {
    const host = new sdk.ExtensionCoreHost();
    let externalInvoiceCharges = 0;

    host.mountPackage({
      manifest: Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "tools.billing-and-deploy",
        display_name: "Billing & Deploy Tools",
        facets: ["agent.tool_provider", "agent.execution_guard"],
        contracts: {
          defines: [{ kind: "agent_capability", namespace: "deploy", name: "release", version: 1 }]
        }
      }),
      activate(scope) {
        scope.registerDynamicContract({
          kind: "agent_capability",
          namespace: "deploy",
          name: "release",
          version: 1,
          jsonSchema: {
            type: "object",
            required: ["service", "semver"],
            properties: { service: { type: "string" }, semver: { type: "string" } }
          },
          parse(raw) {
            const obj = raw as { service?: unknown; semver?: unknown };
            if (typeof obj?.service !== "string" || typeof obj?.semver !== "string" || !/^\d+\.\d+\.\d+$/.test(obj.semver)) {
              throw new TypeError("semver must match X.Y.Z");
            }
            return obj;
          }
        });

        // Z-axis execution guard: blocks exact repeated tool calls in priorRounds (oscillation / loop breaker)
        scope.contributeFacet(sdk.agentExecutionGuardFacet, {
          priority: 10,
          beforeToolCall({ call, priorRounds }) {
            const identicalPriorCalls = priorRounds
              .flatMap((r) => r.receipts)
              .filter(
                (rec) =>
                  rec.call.name === call.name &&
                  JSON.stringify(rec.call.input) === JSON.stringify(call.input)
              );
            if (identicalPriorCalls.length >= 1) {
              return { action: "block", reason: "TOOL_LOOP_OSCILLATION" };
            }
            return { action: "allow" };
          }
        });

        scope.contributeFacet(sdk.agentToolProviderFacet, {
          tools: [
            {
              name: "deploy.release_service",
              description: "Deploy service under dynamic agent_capability contract",
              capabilityRisk: "low_read_and_scoped_write",
              dynamicCapabilityContract: { namespace: "deploy", name: "release", version: 1 },
              inputSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              resultSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              execute: (call) => ({ status: "verified", value: { deployed: call.input } }),
              project: (v) => v
            },
            {
              name: "ops.ping_cluster",
              description: "Read-only cluster ping",
              capabilityRisk: "read_only_safe",
              inputSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              resultSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              execute: () => ({ status: "verified", value: { ok: true } }),
              project: (v) => v
            },
            {
              name: "billing.charge_invoice",
              description: "Irreversible external invoice charge",
              capabilityRisk: "low_read_and_scoped_write",
              inputSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              resultSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              execute: (call) => {
                externalInvoiceCharges += 1;
                return {
                  status: "verified",
                  value: {
                    chargeId: "chg_001",
                    invoiceId: (call.input as { invoiceId: string }).invoiceId,
                    executionSeq: externalInvoiceCharges
                  }
                };
              },
              project: (v) => v
            }
          ]
        });
      }
    });

    // Part A: AgentCore validates dynamicCapabilityContract & blocks oscillation via agent.execution_guard@1
    const agentCore = new AgentCore({ host });
    expect(agentCore.listDynamicCapabilities()).toHaveLength(1);

    const guardAndCapReport = await agentCore.runTurn({
      signal: new AbortController().signal,
      inputs: [{ role: "user", content: "Deploy invalid semver then loop ping" }],
      adapter: makeDeterministicModelAdapter((_req, step) => {
        if (step === 0) {
          return [
            { kind: "tool", id: "c1", name: "deploy.release_service", input: { service: "api", semver: "bad-ver" } },
            { kind: "tool", id: "c2", name: "ops.ping_cluster", input: { region: "us-east" } },
            { kind: "finish" }
          ];
        }
        if (step === 1) {
          // Attempt identical ping call -> should be blocked by agent.execution_guard@1!
          return [
            { kind: "tool", id: "c3", name: "ops.ping_cluster", input: { region: "us-east" } },
            { kind: "finish" }
          ];
        }
        return [{ kind: "delta", text: "Handled guard & capability checks" }, { kind: "finish" }];
      }),
      bindings: {
        host,
        allowsTool: () => true
      }
    });

    const step0Receipts = guardAndCapReport.rounds[0]!.receipts;
    expect(step0Receipts[0]!.result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("DYNAMIC_CAPABILITY_INVALID")
    });
    expect(step0Receipts[1]!.result).toEqual({ status: "verified", value: { ok: true } });

    const step1Receipts = guardAndCapReport.rounds[1]!.receipts;
    expect(step1Receipts[0]!.result).toEqual({
      status: "failed",
      error: "EXECUTION_GUARD_BLOCKED:TOOL_LOOP_OSCILLATION"
    });
    agentCore.dispose();

    // Part B: Durable ExecutionIdempotencyLedger prevents duplicate external side-effects on crash recovery!
    const { db, coordinatorStorage, idempotencyStore } = createSqliteIdempotencyAndCheckpointStore();
    const clock1 = new VirtualClock({ targetInstance: "sandbox:stage10-crash1", initialVirtualTsMs: 10_000 });
    const runtime1 = createUniversalAgent({
      host,
      clock: clock1,
      coordinatorStorage,
      idempotencyStore
    });

    const bgTask = runtime1.startAsyncGoalTask({
      taskId: "task_invoice_settlement",
      goal: "Charge invoice inv_900 and finalize receipt",
      sourceEventId: "evt_settle_1",
      capabilityRisk: "low_read_and_scoped_write",
      steps: [{ step_title: "Charge invoice" }, { step_title: "Finalize settlement" }]
    });
    expect(bgTask.status).toBe("running");

    // Epoch 1 crashes right after Step 0 executes `billing.charge_invoice`!
    await expect(
      runtime1.executeAsyncGoalTask({
        taskId: "task_invoice_settlement",
        inputs: [{ role: "user", content: "Settle inv_900" }],
        adapter: makeDeterministicModelAdapter((_req, step) => {
          if (step === 0) {
            return [
              { kind: "tool", id: "pay_1", name: "billing.charge_invoice", input: { invoiceId: "inv_900" } },
              { kind: "finish" }
            ];
          }
          throw new Error("SIMULATED_PROCESS_CRASH_AFTER_STEP_0");
        })
      })
    ).rejects.toThrow("SIMULATED_PROCESS_CRASH_AFTER_STEP_0");

    expect(externalInvoiceCharges).toBe(1);
    runtime1.stop();

    // Epoch 2 boots fresh process over the same SQLite checkpoint + idempotency ledger
    const clock2 = new VirtualClock({ targetInstance: "sandbox:stage10-crash2", initialVirtualTsMs: 12_000 });
    const runtime2 = createUniversalAgent({
      host,
      clock: clock2,
      coordinatorStorage,
      idempotencyStore
    });
    expect(runtime2.reconcileCrashRecovery()).toEqual(["task_invoice_settlement"]);
    runtime2.resumeAsyncGoalTask("task_invoice_settlement");

    const resumedOutcome = await runtime2.executeAsyncGoalTask({
      taskId: "task_invoice_settlement",
      inputs: [{ role: "user", content: "Settle inv_900" }],
      adapter: makeDeterministicModelAdapter((_req, step) => {
        if (step === 0) {
          // Model replays the exact same Step 0 tool call after crash recovery!
          return [
            { kind: "tool", id: "pay_retry_1", name: "billing.charge_invoice", input: { invoiceId: "inv_900" } },
            { kind: "finish" }
          ];
        }
        return [{ kind: "delta", text: "Invoice inv_900 settled safely without double charge." }, { kind: "finish" }];
      })
    });

    // External side effect was NOT executed a second time!
    expect(externalInvoiceCharges).toBe(1);
    expect(runtime2.agentCore.idempotencyLedger.totalReplayHits).toBe(1);
    expect(resumedOutcome.task.status).toBe("completed");
    expect(resumedOutcome.report.rounds[0]!.receipts[0]!.result).toEqual({
      status: "verified",
      value: { chargeId: "chg_001", invoiceId: "inv_900", executionSeq: 1 }
    });

    runtime2.stop();
    db.close();
  });

  it("Counterexample 3: PerceptionCore causal watermark monotonicity & ExpressionCore downstream transcoding + duplicate coalescing", () => {
    const host = new sdk.ExtensionCoreHost();
    const clock = new VirtualClock({ targetInstance: "sandbox:stage10-c3", initialVirtualTsMs: 5_000 });
    const perception = new PerceptionCore({ clock, host });

    // 1. Causal watermark monotonicity: t=5000 arrives before delayed out-of-order packet t=3200
    const freshUpdate = perception.coverage.upsert({
      channel_id: "channel.smart_lock",
      modality: "sensor",
      source_key: "front_door",
      coverage: "live_foveal",
      summary_text: "Front door locked",
      frame_span_ms: 100,
      freshness_ttl_ms: 10_000,
      audience_scope: "only_owner",
      updated_at_virtual_ts: 5_000,
      competing_hypotheses: [],
      authorized: true
    });
    expect(freshUpdate.stale_watermark_rejected).toBeUndefined();
    expect(freshUpdate.bucket.summary_text).toBe("Front door locked");

    const delayedOutOfOrder = perception.coverage.upsert({
      channel_id: "channel.smart_lock",
      modality: "sensor",
      source_key: "front_door",
      coverage: "live_foveal",
      summary_text: "Front door unlocked (stale packet)",
      frame_span_ms: 100,
      freshness_ttl_ms: 10_000,
      audience_scope: "only_owner",
      updated_at_virtual_ts: 3_200,
      competing_hypotheses: [],
      authorized: true
    });
    expect(delayedOutOfOrder.stale_watermark_rejected).toBe(true);
    expect(delayedOutOfOrder.bucket.summary_text).toBe("Front door locked");
    expect(perception.coverage.get("channel.smart_lock", "sensor", "front_door")?.summary_text).toBe(
      "Front door locked"
    );

    // 2. ExpressionCore downstream transcodeExpression + dynamic expression_protocol validation + coalescing
    host.mountPackage({
      manifest: Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "media.viseme-transcoder",
        display_name: "Viseme Transcoder",
        facets: ["expression.media_transcoder"],
        contracts: {
          defines: [{ kind: "expression_protocol", namespace: "avatar", name: "viseme_timeline", version: 1 }]
        }
      }),
      activate(scope) {
        scope.registerDynamicContract({
          kind: "expression_protocol",
          namespace: "avatar",
          name: "viseme_timeline",
          version: 1,
          jsonSchema: { type: "object", required: ["phonemeCount"] },
          parse(raw) {
            const obj = raw as { phonemeCount?: unknown };
            if (typeof obj?.phonemeCount !== "number" || obj.phonemeCount < 0) {
              throw new TypeError("Invalid viseme_timeline");
            }
            return obj;
          }
        });

        scope.contributeFacet(sdk.expressionMediaTranscoderFacet, {
          priority: 5,
          transcodeExpression(intent) {
            const text = intent.utterance ?? "";
            return {
              "avatar.viseme_timeline@1": {
                phonemeCount: text.length
              }
            };
          }
        });
      }
    });

    const expression = new ExpressionCore({
      host,
      clock,
      coalesceDuplicateWindowMs: 500
    });
    const avatarChannel: InteractionChannel = {
      protocol_version: "0.1.0",
      channel_id: "channel.avatar_stage",
      channel_kind: "webchat",
      display_name: "Avatar Stage",
      venue_type: "private_1on1",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 200,
      capabilities: {
        sensors: ["text"],
        supported_extensions: [],
        actuators: []
      }
    };
    expression.mountChannel(avatarChannel);

    const firstDispatch = expression.negotiateAndRecord({
      intentId: "int_1",
      correlationEventId: "evt_1",
      intent: "communicate",
      utterance: "Build succeeded",
      deliveryConstraints: { audienceScope: "only_owner" }
    });
    expect(firstDispatch.status).toBe("dispatched");
    if (firstDispatch.status !== "dispatched") throw new Error("expected dispatched");
    expect(firstDispatch.coalesced).toBeUndefined();
    expect(firstDispatch.envelope.extensions["avatar.viseme_timeline@1"]).toEqual({
      phonemeCount: "Build succeeded".length
    });

    // Rapid duplicate utterance 200ms later is coalesced!
    clock.advanceBy(200);
    const secondDispatch = expression.negotiateAndRecord({
      intentId: "int_2",
      correlationEventId: "evt_2",
      intent: "communicate",
      utterance: "Build succeeded",
      deliveryConstraints: { audienceScope: "only_owner" }
    });
    expect(secondDispatch.status).toBe("dispatched");
    if (secondDispatch.status !== "dispatched") throw new Error("expected dispatched");
    expect(secondDispatch.coalesced).toBe(true);
    expect(secondDispatch.envelope.intent_id).toBe("int_1");

    // Advancing past 500ms window allows fresh emission
    clock.advanceBy(400);
    const thirdDispatch = expression.negotiateAndRecord({
      intentId: "int_3",
      correlationEventId: "evt_3",
      intent: "communicate",
      utterance: "Build succeeded",
      deliveryConstraints: { audienceScope: "only_owner" }
    });
    expect(thirdDispatch.status).toBe("dispatched");
    if (thirdDispatch.status !== "dispatched") throw new Error("expected dispatched");
    expect(thirdDispatch.coalesced).toBeUndefined();
    expect(thirdDispatch.envelope.intent_id).toBe("int_3");

    perception.dispose();
    expression.dispose();
  });

  it("Counterexample 4: Bounded Serializable OCC Runner prevents background transaction starvation under W1 contention and enforces custom_domain jsonSchema", () => {
    const host = new sdk.ExtensionCoreHost();
    host.mountPackage({
      manifest: Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "domain.ops-runbook",
        display_name: "Ops Runbook Domain",
        facets: ["cognition.state_domain"],
        permissions: {
          read_blackboard_domains: ["custom.ops.runbook"],
          propose_mutation_domains: ["custom.ops.runbook"],
          max_audience_scope: "only_owner",
          network_access: false
        }
      }),
      activate(scope) {
        bindCustomStateDomainToDynamicContract(scope, {
          domain: "custom.ops.runbook",
          description: "Strict OCC ops runbook counter",
          initialState: { entries: [] as string[] },
          jsonSchema: {
            type: "object",
            required: ["entry"],
            properties: { entry: { type: "string" } },
            additionalProperties: false
          },
          reduce(state, proposal) {
            const cur = state as { entries: string[] };
            const entry = (proposal.payload as { entry: string }).entry;
            return { value: { entries: [...cur.entries, entry] } };
          }
        });
      }
    });

    const clock = new VirtualClock({ targetInstance: "sandbox:stage10-c4", initialVirtualTsMs: 1_000 });
    const cognition = new CognitionCore({ clock, host });

    // 1. Malformed custom domain payload is automatically rejected by declared jsonSchema!
    const badSchemaRes = cognition.submitProposal({
      proposal_id: "bad_schema_1",
      domain: "custom.ops.runbook",
      base_rev: 0,
      payload: { entry: 12345 as unknown as string }
    });
    expect(badSchemaRes.accepted).toBe(false);
    expect(badSchemaRes.reason).toBe("CUSTOM_DOMAIN_SCHEMA_INVALID");

    // 2. Concurrent W1 contention: inject 2 concurrent W1 commits right before attempts 1 and 2 commit!
    let injectedInterferences = 0;
    const occRes = cognition.runSerializableTransaction(
      "w3_background_sync",
      (snapshot, attempt) => {
        if (injectedInterferences < 2) {
          injectedInterferences += 1;
          // Simulate a fast W1 turn pre-empting and advancing custom.ops.runbook before W3's bundle lands!
          cognition.submitProposal({
            proposal_id: `w1_fast_preempt_${attempt}`,
            domain: "custom.ops.runbook",
            base_rev: snapshot.domain_revs["custom.ops.runbook"] ?? 0,
            payload: { entry: `w1_turn_${attempt}` }
          });
        }
        return [
          {
            proposal_id: `w3_item_${attempt}`,
            domain: "custom.ops.runbook",
            base_rev: snapshot.domain_revs["custom.ops.runbook"] ?? 0,
            payload: { entry: "w3_consolidated_summary" }
          }
        ];
      },
      { maxRetries: 4 }
    );

    expect(occRes.accepted).toBe(true);
    expect(occRes.attempts).toBe(3);
    expect(occRes.tx_id).toBe("w3_background_sync#retry2");
    expect(cognition.getSnapshot().custom_domains?.["custom.ops.runbook"]).toEqual({
      entries: ["w1_turn_1", "w1_turn_2", "w3_consolidated_summary"]
    });

    cognition.dispose();
  });

  it("Counterexample 5: Multi-premise JTMS (all_of vs any_of), temporal validUntilMs expiry, and in-flight W2 AbortSignal kill on premise invalidation", async () => {
    const host = new sdk.ExtensionCoreHost();
    let sideEffectRuns = 0;
    let step1AbortedBySignal = false;
    let notifySlowStepStarted!: () => void;
    const slowStepStarted = new Promise<void>((resolve) => {
      notifySlowStepStarted = resolve;
    });

    host.mountPackage({
      manifest: Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "tools.staged-migration",
        display_name: "Staged Migration Tools",
        facets: ["agent.tool_provider"]
      }),
      activate(scope) {
        scope.contributeFacet(sdk.agentToolProviderFacet, {
          tools: [
            {
              name: "infra.allocate_staging_slot",
              description: "Step 0 fast side effect",
              capabilityRisk: "low_read_and_scoped_write",
              inputSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              resultSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              execute: () => {
                sideEffectRuns += 1;
                return { status: "verified", value: { allocated: true } };
              },
              project: (v) => v
            },
            {
              name: "infra.cutover_traffic",
              description: "Step 1 long-running operation awaiting AbortSignal",
              capabilityRisk: "low_read_and_scoped_write",
              inputSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              resultSchema: { jsonSchema: { type: "object" }, parse: (v) => v },
              execute: (_call, signal) =>
                new Promise((_resolve, reject) => {
                  notifySlowStepStarted();
                  signal.addEventListener(
                    "abort",
                    () => {
                      step1AbortedBySignal = true;
                      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
                    },
                    { once: true }
                  );
                }),
              project: (v) => v
            }
          ]
        });
      }
    });

    const clock = new VirtualClock({ targetInstance: "sandbox:stage10-c5", initialVirtualTsMs: 1_000 });
    const agent = createUniversalAgent({ host, clock, enableIntrinsicTools: true });

    // 1. Create two independent premises M_A and M_B, plus conjunctive (all_of), disjunctive (any_of), and temporal memories
    const mA = (
      await agent.proposeMemory({
        content: " Canary telemetry node A reports zero packet loss ",
        memoryTier: "episodic_trace"
      })
    ).record!;
    const mB = (
      await agent.proposeMemory({
        content: " Canary telemetry node B reports zero packet loss ",
        memoryTier: "episodic_trace"
      })
    ).record!;

    const mConj = (
      await agent.proposeMemory({
        content: "Both canary nodes A and B are simultaneously lossless",
        memoryTier: "semantic_fact",
        basedOnMemoryIds: [mA.memoryId, mB.memoryId],
        premiseQuantifier: "all_of"
      })
    ).record!;

    const mDisj = (
      await agent.proposeMemory({
        content: "At least one canary node confirms regional link health",
        memoryTier: "semantic_fact",
        basedOnMemoryIds: [mA.memoryId, mB.memoryId],
        premiseQuantifier: "any_of",
        minPremiseCount: 1
      })
    ).record!;

    const mTemp = (
      await agent.proposeMemory({
        content: "Maintenance window green-light token active",
        memoryTier: "semantic_fact",
        validUntilMs: 5_000
      })
    ).record!;

    // Start in-flight W2 task depending on mConj!
    const cutoverTask = agent.startAsyncGoalTask({
      taskId: "task_canary_cutover",
      goal: "Cut over traffic while both canary nodes are lossless",
      sourceEventId: "evt_cutover_start",
      basedOnMemoryIds: [mConj.memoryId],
      capabilityRisk: "low_read_and_scoped_write",
      steps: [{ step_title: "Allocate staging slot" }, { step_title: "Cut over traffic" }]
    });
    expect(cutoverTask.status).toBe("running");

    const inFlightPromise = agent.executeAsyncGoalTask({
      taskId: "task_canary_cutover",
      inputs: [{ role: "user", content: "Run canary cutover" }],
      adapter: makeDeterministicModelAdapter((_req, step) => {
        if (step === 0) {
          return [{ kind: "tool", id: "s0", name: "infra.allocate_staging_slot", input: {} }, { kind: "finish" }];
        }
        return [{ kind: "tool", id: "s1", name: "infra.cutover_traffic", input: {} }, { kind: "finish" }];
      })
    });

    // Wait until Step 0 succeeded and Step 1 is actively mid-flight!
    await slowStepStarted;
    expect(sideEffectRuns).toBe(1);

    // Refute M_A mid-flight!
    const rev1 = await agent.reviseMemory({
      targetMemoryId: mA.memoryId,
      relation: "contradicts",
      reason: "Node A suffered fiber cut"
    });
    expect(rev1.accepted).toBe(true);
    expect(rev1.invalidatedMemoryIds).toContain(mA.memoryId);
    expect(rev1.invalidatedMemoryIds).toContain(mConj.memoryId);
    // Disjunctive `any_of` memory survives because M_B is still active!
    expect(rev1.invalidatedMemoryIds).not.toContain(mDisj.memoryId);
    expect(agent.defaultMemory.getById(mDisj.memoryId)?.validityStatus).toBe("active");

    // In-flight W2 task was IMMEDIATELY killed via AbortSignal, recording 1 prior side effect!
    await expect(inFlightPromise).rejects.toThrow(/premise invalidated|Node A suffered fiber cut/i);
    expect(step1AbortedBySignal).toBe(true);
    const haltedTask = agent.taskWorker.getTask("task_canary_cutover")!;
    expect(haltedTask.status).toBe("premise_invalidated_needs_review");
    expect(haltedTask.executed_side_effects_count).toBe(1);

    // Now refute M_B -> M_disj loses its last active premise and cascades to `stale_premise_invalidated`!
    const rev2 = await agent.reviseMemory({
      targetMemoryId: mB.memoryId,
      relation: "contradicts",
      reason: "Node B also lost link"
    });
    expect(rev2.invalidatedMemoryIds).toContain(mDisj.memoryId);
    expect(agent.defaultMemory.getById(mDisj.memoryId)?.validityStatus).toBe("stale_premise_invalidated");

    // Temporal validity window check: active at t=4000, automatically excluded at t=5000!
    clock.advanceBy(3_000); // t = 4000
    expect((await agent.retrieveMemories({ query: "Maintenance window", audienceScope: "only_owner" })).map((m) => m.memoryId)).toContain(
      mTemp.memoryId
    );
    clock.advanceBy(1_500); // t = 5500 >= validUntilMs (5000)
    expect((await agent.retrieveMemories({ query: "Maintenance window", audienceScope: "only_owner" })).map((m) => m.memoryId)).not.toContain(
      mTemp.memoryId
    );

    agent.stop();
  });

  it("Counterexample 6: Companion-neutral endogenous experience crystallization (cognition.consolidation_strategy@1) & native custom_domains blackboard projection", async () => {
    const host = new sdk.ExtensionCoreHost();
    host.mountPackage({
      manifest: Ai0ExtensionManifestSchema.parse({
        ...baseManifest,
        extension_id: "cognition.habit-crystallizer",
        display_name: "Pattern Frequency Consolidation Strategy & Workspace Telemetry Domain",
        facets: ["cognition.consolidation_strategy", "cognition.state_domain"],
        permissions: {
          read_blackboard_domains: ["custom.workspace.metrics"],
          propose_mutation_domains: ["custom.workspace.metrics"],
          max_audience_scope: "only_owner",
          network_access: false
        }
      }),
      activate(scope) {
        bindCustomStateDomainToDynamicContract(scope, {
          domain: "custom.workspace.metrics",
          initialState: { failingSuites: 0, activeBranch: "main" },
          jsonSchema: {
            type: "object",
            required: ["failingSuites", "activeBranch"],
            properties: {
              failingSuites: { type: "integer" },
              activeBranch: { type: "string" }
            }
          },
          reduce(_state, proposal) {
            return { value: proposal.payload };
          }
        });

        // Companion-neutral consolidation strategy: crystallizes >= 3 matching episodic traces into a semantic_fact
        // requiring at least minPremiseCount = 2 active supporting episodes to stay valid!
        scope.contributeFacet(sdk.cognitionConsolidationStrategyFacet, {
          priority: 10,
          consolidate({ episodes }) {
            const buildEpisodes = episodes.filter((ep) => ep.content.includes("run pnpm build before vitest"));
            if (buildEpisodes.length >= 3) {
              return [
                {
                  content: "Workspace rule: Always run pnpm build before vitest so dist declarations stay fresh.",
                  supportingMemoryIds: buildEpisodes.map((ep) => ep.memoryId),
                  audienceScope: "only_owner",
                  minPremiseCount: 2
                }
              ];
            }
            return [];
          }
        });
      }
    });

    const clock = new VirtualClock({ targetInstance: "sandbox:stage10-c6", initialVirtualTsMs: 2_000 });
    const agent = createUniversalAgent({ host, clock });

    // 1. Update custom domain WITHOUT mounting any cognition.context_contributor@1
    expect(
      agent.cognitionCore.submitProposal({
        proposal_id: "metrics_1",
        domain: "custom.workspace.metrics",
        base_rev: 0,
        payload: { failingSuites: 0, activeBranch: "feat/open-world" }
      }).accepted
    ).toBe(true);

    // Native custom_domains projection appears for only_owner, and is masked for public_all!
    const ownerBoard = await agent.cognitionCore.compileBlackboard(
      { max_total_tokens: 1_000, tier0_safety_invariants: "Follow safety rules." },
      "only_owner"
    );
    expect(ownerBoard.slots.some((s) => s.slot_id === "slot.custom.workspace.metrics")).toBe(true);
    expect(ownerBoard.compiled_prompt_text).toContain("feat/open-world");

    const publicBoard = await agent.cognitionCore.compileBlackboard(
      { max_total_tokens: 1_000, tier0_safety_invariants: "Follow safety rules." },
      "public_all"
    );
    expect(publicBoard.slots.some((s) => s.slot_id === "slot.custom.workspace.metrics")).toBe(false);
    expect(publicBoard.compiled_prompt_text).not.toContain("feat/open-world");

    // 2. Record 3 verified episodic_trace observations and run endogenous consolidation
    const ep1 = (await agent.proposeMemory({ content: "Session 1: had to run pnpm build before vitest", memoryTier: "episodic_trace" })).record!;
    const ep2 = (await agent.proposeMemory({ content: "Session 2: needed to run pnpm build before vitest", memoryTier: "episodic_trace" })).record!;
    const ep3 = (await agent.proposeMemory({ content: "Session 3: verified we must run pnpm build before vitest", memoryTier: "episodic_trace" })).record!;

    const crystallized = await agent.runConsolidationCycle();
    expect(crystallized).toHaveLength(1);
    const habit = crystallized[0]!;
    expect(habit.memoryTier).toBe("semantic_fact");
    expect(habit.premiseQuantifier).toBe("any_of");
    expect(habit.minPremiseCount).toBe(2);
    expect(habit.basedOnMemoryIds).toEqual([ep1.memoryId, ep2.memoryId, ep3.memoryId]);

    // Refuting 1 of 3 episodes leaves 2 >= minPremiseCount(2), so the crystallized habit stays active!
    await agent.reviseMemory({
      targetMemoryId: ep1.memoryId,
      relation: "contradicts",
      reason: "Session 1 log was from a different repo"
    });
    expect(agent.defaultMemory.getById(habit.memoryId)?.validityStatus).toBe("active");

    // Refuting a 2nd episode drops active premises to 1 < minPremiseCount(2), retiring the habit automatically!
    await agent.reviseMemory({
      targetMemoryId: ep2.memoryId,
      relation: "contradicts",
      reason: "Session 2 log was also misattributed"
    });
    expect(agent.defaultMemory.getById(habit.memoryId)?.validityStatus).toBe("stale_premise_invalidated");

    agent.stop();
  });
});
