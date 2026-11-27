import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createUniversalAgent, PrincipalIdentityBinder } from "@ai0/agent-runtime";
import {
  CognitionCore,
  VirtualClock,
  type CoordinatorStorageMutator,
  type ReadOnlyCognitiveSnapshot
} from "@ai0/cognition-core";
import { ExpressionCore } from "@ai0/expression-core";
import { PerceptionCore } from "@ai0/perception-core";
import {
  OpenInteractionFrameSchema,
  SkillMarkdownFrontmatterSchema,
  type AgentModelAdapter,
  type AgentModelEvent,
  type InteractionChannel,
  type PreparedAgentRequest
} from "@ai0/protocol";
import * as sdk from "@ai0/sdk";

const baseManifest = {
  author: "stage9",
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
      yield { kind: "finish" };
    }
  };
}

function createSqliteCoordinatorStorage(): {
  db: DatabaseSync;
  mutator: CoordinatorStorageMutator;
  setInjectedCheckpointFault: (fault: Error | undefined) => void;
} {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY,
      redacted_at_ts_ms INTEGER DEFAULT NULL,
      principal_trust TEXT NOT NULL,
      summary_text TEXT NOT NULL
    );
    CREATE TABLE memories (
      memory_id TEXT PRIMARY KEY,
      content_text TEXT NOT NULL,
      epistemic_type TEXT NOT NULL,
      source_events_json TEXT NOT NULL
    );
    CREATE TABLE checkpoints (
      state_rev INTEGER PRIMARY KEY,
      snapshot_json TEXT NOT NULL
    );
    CREATE TABLE traces (
      trace_id TEXT PRIMARY KEY,
      tx_id TEXT,
      domain TEXT NOT NULL,
      accepted INTEGER NOT NULL
    );
  `);

  let injectedFault: Error | undefined;

  const mutator: CoordinatorStorageMutator = {
    runInTransaction<T>(operation: () => T): T {
      if (db.isTransaction) return operation();
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = operation();
        db.exec("COMMIT");
        return out;
      } catch (err) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw err;
      }
    },
    getEventById(eventId: string) {
      const row = db
        .prepare("SELECT * FROM events WHERE event_id = ?")
        .get(eventId) as
        | { event_id: string; redacted_at_ts_ms: number | null; principal_trust: string; summary_text: string }
        | undefined;
      if (!row) return undefined;
      return {
        event_id: row.event_id,
        redacted_at_ts_ms: row.redacted_at_ts_ms,
        principal_trust: row.principal_trust,
        payload: { summary_text: row.summary_text }
      };
    },
    applyMemoryProjection(memory) {
      const nextCount = Number(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n ?? 0);
      const memId = `mem_${memory.source_event_ids[0] ?? "tx"}_${nextCount}`;
      db.prepare(
        "INSERT INTO memories (memory_id, content_text, epistemic_type, source_events_json) VALUES (?, ?, ?, ?)"
      ).run(
        memId,
        String(memory.content_text ?? ""),
        String(memory.epistemic_type),
        JSON.stringify(memory.source_event_ids)
      );
    },
    checkpointCoordinatorState(snapshot: ReadOnlyCognitiveSnapshot) {
      if (injectedFault) {
        throw injectedFault;
      }
      db.prepare(
        "INSERT OR REPLACE INTO checkpoints (state_rev, snapshot_json) VALUES (?, ?)"
      ).run(snapshot.state_rev, JSON.stringify(snapshot));
    },
    loadCoordinatorState(): ReadOnlyCognitiveSnapshot | undefined {
      const row = db
        .prepare("SELECT snapshot_json FROM checkpoints ORDER BY state_rev DESC LIMIT 1")
        .get() as { snapshot_json: string } | undefined;
      return row ? (JSON.parse(row.snapshot_json) as ReadOnlyCognitiveSnapshot) : undefined;
    },
    latestStateRevision(): number {
      const row = db.prepare("SELECT MAX(state_rev) AS rev FROM checkpoints").get() as
        | { rev: number | null }
        | undefined;
      return Number(row?.rev ?? 0);
    },
    saveTurnDecisionTrace(trace) {
      db.prepare(
        "INSERT OR REPLACE INTO traces (trace_id, tx_id, domain, accepted) VALUES (?, ?, ?, ?)"
      ).run(trace.trace_id, trace.tx_id ?? null, trace.domain, trace.accepted ? 1 : 0);
    }
  };

  return {
    db,
    mutator,
    setInjectedCheckpointFault(fault) {
      injectedFault = fault;
    }
  };
}

describe("Stage 9: Emergent Dynamic Contracts, Cohesive 4-Core Orthogonality, Atomic State Bundles, and Epistemic Belief Revision", () => {
  it("Counterexample 1 (Emergent Dynamic Contract Bootstrapping): spawns dynamic contracts on first mount, reuses across channels, isolates schema hijacks, and withdraws on zero refcount", () => {
    const host = new sdk.ExtensionCoreHost();
    const lifecycleEvents: Array<{ reason: string; packageId: string; contractId?: string }> = [];
    host.onDidChange((evt) => {
      if (
        evt.reason === "contract_spawned" ||
        evt.reason === "contract_withdrawn" ||
        evt.reason === "faulted_isolated"
      ) {
        lifecycleEvents.push({
          reason: evt.reason,
          packageId: evt.packageId,
          ...(evt.contractId ? { contractId: evt.contractId } : {})
        });
      }
    });

    const facialCueContract = sdk.defineDynamicContract<{ cue: string; confidence: number }>({
      kind: "perception_event",
      namespace: "vision",
      name: "facial_cue",
      version: 1,
      description: "Cross-channel facial semantic cue spawned dynamically without modifying @ai0/protocol",
      jsonSchema: {
        type: "object",
        required: ["cue", "confidence"],
        properties: {
          cue: { type: "string" },
          confidence: { type: "number" }
        }
      },
      parse(raw) {
        const obj = raw as { cue?: unknown; confidence?: unknown };
        if (!obj || typeof obj.cue !== "string" || typeof obj.confidence !== "number") {
          throw new TypeError("Invalid vision.facial_cue@1 payload");
        }
        return { cue: obj.cue, confidence: obj.confidence };
      }
    });

    const altVlmContract = sdk.defineDynamicContract<{ label: string }>({
      kind: "perception_event",
      namespace: "alt_vlm",
      name: "face_cue",
      version: 1,
      jsonSchema: {
        type: "object",
        required: ["label"],
        properties: { label: { type: "string" } }
      },
      parse(raw) {
        const obj = raw as { label?: unknown };
        if (!obj || typeof obj.label !== "string") throw new TypeError("Invalid alt_vlm payload");
        return { label: obj.label };
      }
    });

    // 1. First extension mounts and dynamically spawns `vision.facial_cue@1` in ExtensionCoreHost
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "plugin.vision-transducer",
          display_name: "Vision Transducer",
          facets: ["custom.contract.holder"]
        },
        activate(scope) {
          scope.registerDynamicContract(facialCueContract);
        }
      })
    );

    expect(host.listDynamicContracts("perception_event")).toHaveLength(1);
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)?.originPackageId).toBe(
      "plugin.vision-transducer"
    );

    // 2. Two independent channels discover & bind the exact same contract + an independent parallel VLM contract coexists
    for (const channelPkgId of ["channel.webchat", "channel.desktop_cam"]) {
      host.mountPackage(
        sdk.defineExtensionPackage({
          manifest: {
            ...baseManifest,
            extension_id: channelPkgId,
            display_name: channelPkgId,
            facets: ["custom.contract.holder"]
          },
          activate(scope) {
            scope.registerDynamicContract(facialCueContract);
          }
        })
      );
    }

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "plugin.alt-vlm",
          display_name: "Alt VLM",
          facets: ["custom.contract.holder"]
        },
        activate(scope) {
          scope.registerDynamicContract(altVlmContract);
        }
      })
    );

    expect(host.listDynamicContracts("perception_event")).toHaveLength(2);
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)?.holders).toEqual([
      "plugin.vision-transducer",
      "channel.webchat",
      "channel.desktop_cam"
    ]);
    expect(
      host.validateDynamicContractPayload("perception_event", "vision", "facial_cue", 1, {
        cue: "user_brow_furrow",
        confidence: 0.91
      })
    ).toEqual({ cue: "user_brow_furrow", confidence: 0.91 });

    // ScopedExtensionView monotonically hides contracts whose holders are excluded
    const narrowView = host.createScopedView({
      scopeId: "only-alt-vlm",
      allowedPackages: ["plugin.alt-vlm"]
    });
    expect(narrowView.listDynamicContracts("perception_event").map((c) => c.id)).toEqual([
      "perception_event:alt_vlm.face_cue@1"
    ]);
    expect(narrowView.getDynamicContract("perception_event", "vision", "facial_cue", 1)).toBeUndefined();

    // 3. Rogue plugin attempting to hijack `vision.facial_cue@1` with an incompatible schema is faulted & isolated
    const hijackedContract = sdk.defineDynamicContract<{ cue: number }>({
      kind: "perception_event",
      namespace: "vision",
      name: "facial_cue",
      version: 1,
      jsonSchema: {
        type: "object",
        required: ["cue"],
        properties: { cue: { type: "number" } }
      },
      parse: (raw) => raw as { cue: number }
    });

    const rogueSnap = host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "plugin.rogue-hijacker",
          display_name: "Rogue Hijacker",
          facets: ["custom.contract.holder"]
        },
        activate(scope) {
          scope.registerDynamicContract(hijackedContract);
        }
      })
    );
    expect(rogueSnap.status).toBe("faulted_isolated");
    expect(host.getPackage("plugin.rogue-hijacker")?.status).toBe("faulted_isolated");
    expect(
      lifecycleEvents.some(
        (e) => e.reason === "contract_spawned" && e.contractId === "perception_event:vision.facial_cue@1"
      )
    ).toBe(true);

    // Existing contract remains 100% healthy for legitimate holders
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)?.holders).toHaveLength(3);

    // 4. Reference-counted lifecycle: unmounting origin leaves contract alive for remaining holders until last holder unmounts
    host.unmountPackage("plugin.vision-transducer");
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)?.holders).toEqual([
      "channel.webchat",
      "channel.desktop_cam"
    ]);
    host.unmountPackage("channel.webchat");
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)?.holders).toEqual([
      "channel.desktop_cam"
    ]);
    host.unmountPackage("channel.desktop_cam");
    expect(host.getDynamicContract("perception_event", "vision", "facial_cue", 1)).toBeUndefined();
    expect(
      lifecycleEvents.some(
        (e) => e.reason === "contract_withdrawn" && e.contractId === "perception_event:vision.facial_cue@1"
      )
    ).toBe(true);
  });

  it("Counterexample 2 (Cohesive PerceptionCore X x Y x Z Orthogonality): shares modality transducers across dumb channels, hot-upgrades V2, and isolates concurrent channel provenance across debounce", async () => {
    const host = new sdk.ExtensionCoreHost();
    const clock = new VirtualClock({ targetInstance: "sandbox:stage9-perception", initialVirtualTsMs: 1_000 });
    const perception = new PerceptionCore({ clock, host });

    const facialCueContract = sdk.defineDynamicContract<{ primaryCue: string; furrowScore: number }>({
      kind: "perception_event",
      namespace: "vision",
      name: "facial_cue",
      version: 1,
      jsonSchema: {
        type: "object",
        required: ["primaryCue", "furrowScore"],
        properties: {
          primaryCue: { type: "string" },
          furrowScore: { type: "number" }
        }
      },
      parse(raw) {
        const obj = raw as { primaryCue?: unknown; furrowScore?: unknown };
        if (!obj || typeof obj.primaryCue !== "string" || typeof obj.furrowScore !== "number") {
          throw new TypeError("Invalid vision.facial_cue@1 payload");
        }
        return { primaryCue: obj.primaryCue, furrowScore: obj.furrowScore };
      }
    });

    // Y-axis: Cross-channel modality transducer V1 (shared by webchat, desktop_cam, or any future channel)
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "transducer.camera-v1",
          display_name: "Camera Brow Transducer V1",
          facets: [sdk.perceptionTransducerFacet.id]
        },
        activate(scope) {
          scope.registerDynamicContract(facialCueContract);
          scope.contributeFacet(sdk.perceptionTransducerFacet, {
            inputModalities: ["visual_semantic"],
            priority: 20,
            async transduce(input) {
              const raw = input.rawPayload as { browFurrowScore?: number };
              if (typeof raw?.browFurrowScore !== "number" || raw.browFurrowScore < 0.7) {
                return undefined;
              }
              return {
                outputModality: "visual_semantic",
                primaryCue: "user_brow_furrow",
                summaryText: "Detected user brow furrow",
                confidence: raw.browFurrowScore,
                competingHypotheses: ["small_font_strain", "cognitive_skepticism"],
                dynamicEventContract: { namespace: "vision", name: "facial_cue", version: 1 },
                data: { primaryCue: "user_brow_furrow", furrowScore: raw.browFurrowScore }
              };
            }
          });
        }
      })
    );

    // X-axis: Two completely dumb channels (webchat & desktop_cam) emit raw frames with zero vision code inside them
    const webchatOut = await perception.transduceAndIngestEnvelope(
      {
        event_id: "evt_cam_web_1",
        timestamp: "2026-01-01T00:00:01.000Z",
        lifecycle: "commit",
        actor: { platform_uid: "u_web", display_name: "Web User" },
        modality: "visual_semantic",
        summary_text: "",
        confidence: 0.9,
        persistence_hint: "ephemeral_blackboard",
        extensions: { browFurrowScore: 0.89 }
      },
      {
        channelId: "channel.webchat",
        principalId: "principal:owner",
        principalTrust: "owner_verified",
        audienceScope: "only_owner",
        taintLevel: "trusted_owner",
        trustedGrant: true
      }
    );

    const desktopOut = await perception.transduceAndIngestEnvelope(
      {
        event_id: "evt_cam_desk_1",
        timestamp: "2026-01-01T00:00:01.010Z",
        lifecycle: "commit",
        actor: { platform_uid: "u_desk", display_name: "Desktop User" },
        modality: "visual_semantic",
        summary_text: "",
        confidence: 0.93,
        persistence_hint: "ephemeral_blackboard",
        extensions: { browFurrowScore: 0.93 }
      },
      {
        channelId: "channel.desktop_cam",
        principalId: "principal:owner",
        principalTrust: "owner_verified",
        audienceScope: "only_owner",
        taintLevel: "trusted_owner",
        trustedGrant: true
      }
    );

    expect(webchatOut.frame.interpretation.primaryCue).toBe("user_brow_furrow");
    expect(webchatOut.frame.interpretation.competingHypotheses).toEqual([
      "small_font_strain",
      "cognitive_skepticism"
    ]);
    expect(webchatOut.frame.provenance.dynamicContractId).toBe("perception_event:vision.facial_cue@1");
    expect(webchatOut.frame.provenance.transducedVia).toMatchObject({
      packageId: "transducer.camera-v1",
      inputModality: "visual_semantic",
      outputModality: "visual_semantic"
    });
    expect(desktopOut.frame.interpretation.primaryCue).toBe("user_brow_furrow");
    expect(desktopOut.frame.channel.channelId).toBe("channel.desktop_cam");

    // Hot-upgrade Y-axis transducer to V2 without touching webchat or desktop_cam
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "transducer.camera-v2",
          display_name: "Camera Brow Transducer V2",
          facets: [sdk.perceptionTransducerFacet.id]
        },
        activate(scope) {
          scope.registerDynamicContract(facialCueContract);
          scope.contributeFacet(sdk.perceptionTransducerFacet, {
            inputModalities: ["visual_semantic"],
            priority: 5,
            async transduce(input) {
              const raw = input.rawPayload as { browFurrowScore?: number };
              if (typeof raw?.browFurrowScore !== "number") return undefined;
              return {
                outputModality: "visual_semantic",
                primaryCue: "user_brow_furrow_calibrated_v2",
                summaryText: "Calibrated V2 brow furrow",
                confidence: raw.browFurrowScore,
                dynamicEventContract: { namespace: "vision", name: "facial_cue", version: 1 },
                data: { primaryCue: "user_brow_furrow_calibrated_v2", furrowScore: raw.browFurrowScore }
              };
            }
          });
        }
      })
    );
    host.unmountPackage("transducer.camera-v1");

    const upgradedOut = await perception.transduceAndIngestEnvelope(
      {
        event_id: "evt_cam_web_2",
        timestamp: "2026-01-01T00:00:01.050Z",
        lifecycle: "commit",
        actor: { platform_uid: "u_web", display_name: "Web User" },
        modality: "visual_semantic",
        summary_text: "",
        confidence: 0.95,
        persistence_hint: "ephemeral_blackboard",
        extensions: { browFurrowScore: 0.95 }
      },
      {
        channelId: "channel.webchat",
        principalId: "principal:owner",
        principalTrust: "owner_verified",
        audienceScope: "only_owner",
        taintLevel: "trusted_owner",
        trustedGrant: true
      }
    );
    expect(upgradedOut.frame.interpretation.primaryCue).toBe("user_brow_furrow_calibrated_v2");
    expect(upgradedOut.frame.provenance.transducedVia).toMatchObject({ packageId: "transducer.camera-v2" });

    // Z-axis: Internal debounce filter holding concurrent stranger/public and owner/private turns simultaneously
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "filter.channel-debounce",
          display_name: "Per-Channel Debounce Filter",
          facets: [sdk.perceptionFilterFacet.id]
        },
        activate(scope) {
          const pending = new Map<string, { dueAt: number; event: sdk.SdkDebounceInputEvent }>();
          scope.contributeFacet(sdk.perceptionFilterFacet, {
            priority: 10,
            onEvent(event, channelId, nowMs) {
              const key = JSON.stringify([
                channelId,
                event.frame?.attribution.principalId ?? "",
                event.frame?.contextFrame.audienceScope ?? ""
              ]);
              pending.set(key, {
                dueAt: nowMs + 300,
                event: { ...event }
              });
              return { kind: "hold" };
            },
            flushDue(nowMs) {
              const ready: sdk.SdkDebounceInputEvent[] = [];
              for (const [key, item] of pending) {
                if (item.dueAt <= nowMs) {
                  pending.delete(key);
                  ready.push(item.event);
                }
              }
              return ready;
            }
          });
        }
      })
    );

    const observedTurns: Array<{
      channelId: string;
      principalId: string;
      principalTrust: string;
      audienceScope: string;
      taintLevel: string;
      text: string;
    }> = [];

    const agent = createUniversalAgent({
      host,
      clock,
      bypassPerception: false,
      bypassExpression: true,
      adapter: makeDeterministicModelAdapter((req) => {
        const userMsg = req.prompt.users.at(-1) ?? "";
        return [{ kind: "delta", text: `ack:${userMsg}` }];
      })
    });

    // Ingest stranger/public_all and owner/only_owner in the SAME debounce window
    const hold1 = await agent.ingest({
      eventId: "evt_stranger_1",
      channelId: "channel.public_lobby",
      principalId: "stranger:mallory",
      principalTrust: "stranger",
      audienceScope: "public_all",
      taintLevel: "untrusted_external",
      text: "public hello from stranger",
      nowMs: 2_000
    });
    const hold2 = await agent.ingest({
      eventId: "evt_owner_1",
      channelId: "channel.owner_private",
      principalId: "principal:owner",
      principalTrust: "owner_verified",
      audienceScope: "only_owner",
      taintLevel: "trusted_owner",
      text: "private command from owner",
      nowMs: 2_050
    });
    expect(hold1.cycles).toHaveLength(0);
    expect(hold2.cycles).toHaveLength(0);

    // Advance past debounce window -> both flush with zero cross-channel provenance contamination
    const flushedCycles = await agent.advanceTime(2_400);
    expect(flushedCycles).toHaveLength(2);
    for (const cycle of flushedCycles) {
      observedTurns.push({
        channelId: cycle.observation.channelId,
        principalId: cycle.observation.principalId,
        principalTrust: cycle.observation.principalTrust,
        audienceScope: cycle.observation.audienceScope,
        taintLevel: cycle.observation.taintLevel,
        text: cycle.observation.text
      });
    }
    expect(observedTurns).toEqual([
      {
        channelId: "channel.public_lobby",
        principalId: "stranger:mallory",
        principalTrust: "stranger",
        audienceScope: "public_all",
        taintLevel: "untrusted_external",
        text: "public hello from stranger"
      },
      {
        channelId: "channel.owner_private",
        principalId: "principal:owner",
        principalTrust: "owner_verified",
        audienceScope: "only_owner",
        taintLevel: "trusted_owner",
        text: "private command from owner"
      }
    ]);

    agent.stop();
    perception.dispose();
  });

  it("Counterexample 3 (Cohesive CognitionCore & Companion De-Pollution): mounts custom.* state domains, enforces monotonic capability policy tightening, and falls back across modelPackageIds", async () => {
    // 1. Companion de-pollution verification: universal SKILL.md requires zero companion demeanor fields
    const pureSkillFrontmatter = SkillMarkdownFrontmatterSchema.parse({
      skill_id: "ops-incident-triage",
      display_name: "Ops Incident Triage"
    });
    expect(pureSkillFrontmatter.in_character_demeanor).toBe("");
    expect(pureSkillFrontmatter.capability_risk).toBe("read_only_safe");
    expect(OpenInteractionFrameSchema.parse("custom.ops.postmortem_review")).toBe("custom.ops.postmortem_review");

    const host = new sdk.ExtensionCoreHost();
    const clock = new VirtualClock({ targetInstance: "sandbox:stage9-cognition", initialVirtualTsMs: 5_000 });
    const cognition = new CognitionCore({ clock, host });

    expect(cognition.sleepWorker).toBeDefined();

    // 2. Mount dynamic `cognition_protocol` + `cognition.state_domain@1` (`custom.ops.incident_board`)
    const incidentContract = sdk.defineDynamicContract<{ addIncidentId: string; severity: "sev1" | "sev2" }>({
      kind: "cognition_protocol",
      namespace: "ops",
      name: "incident_board",
      version: 1,
      jsonSchema: {
        type: "object",
        required: ["addIncidentId", "severity"],
        properties: {
          addIncidentId: { type: "string" },
          severity: { type: "string", enum: ["sev1", "sev2"] }
        }
      },
      parse(raw) {
        const obj = raw as { addIncidentId?: unknown; severity?: unknown };
        if (
          !obj ||
          typeof obj.addIncidentId !== "string" ||
          (obj.severity !== "sev1" && obj.severity !== "sev2")
        ) {
          throw new TypeError("Invalid ops.incident_board@1 mutation");
        }
        return { addIncidentId: obj.addIncidentId, severity: obj.severity };
      }
    });

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "ops.incident-domain",
          display_name: "Ops Incident Domain",
          facets: [sdk.cognitionStateDomainFacet.id],
          permissions: {
            read_blackboard_domains: ["custom.ops.incident_board"],
            propose_mutation_domains: ["custom.ops.incident_board"],
            max_audience_scope: "only_owner",
            network_access: false
          }
        },
        activate(scope) {
          scope.registerDynamicContract(incidentContract);
          scope.contributeFacet(sdk.cognitionStateDomainFacet, {
            domain: "custom.ops.incident_board",
            initialState: { incidents: [] as Array<{ id: string; severity: string }> },
            reduce(current, proposal) {
              try {
                const parsed = host.validateDynamicContractPayload<{ addIncidentId: string; severity: "sev1" | "sev2" }>(
                  "cognition_protocol",
                  "ops",
                  "incident_board",
                  1,
                  proposal.payload
                );
                const cur = current as { incidents: Array<{ id: string; severity: string }> };
                return {
                  value: {
                    incidents: [...cur.incidents, { id: parsed.addIncidentId, severity: parsed.severity }]
                  }
                };
              } catch (err) {
                return {
                  reason: `DYNAMIC_CONTRACT_INVALID:${err instanceof Error ? err.message : String(err)}`
                };
              }
            }
          });
        }
      })
    );

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "ops.unprivileged-reader",
          display_name: "Unprivileged Reader",
          facets: ["custom.ops.reader"],
          permissions: {
            read_blackboard_domains: [],
            propose_mutation_domains: [],
            max_audience_scope: "only_owner",
            network_access: false
          }
        },
        activate() {}
      })
    );

    // Unauthorized package proposing to `custom.ops.incident_board` is denied
    const deniedTx = cognition.submitTransaction({
      tx_id: "tx_unauth_custom",
      proposer_package_id: "ops.unprivileged-reader",
      proposals: [
        {
          proposal_id: "p_unauth",
          domain: "custom.ops.incident_board",
          base_rev: 0,
          payload: { addIncidentId: "INC-1", severity: "sev1" }
        }
      ]
    });
    expect(deniedTx.accepted).toBe(false);
    expect(deniedTx.reason).toBe("DOMAIN_WRITE_DENIED");

    // Authorized proposal with invalid dynamic contract payload is rejected
    const badSchemaRes = cognition.submitProposal({
      proposal_id: "p_bad_schema",
      domain: "custom.ops.incident_board",
      base_rev: 0,
      payload: { addIncidentId: "INC-1", severity: "invalid_sev" }
    });
    expect(badSchemaRes.accepted).toBe(false);
    expect(badSchemaRes.reason).toContain("DYNAMIC_CONTRACT_INVALID");

    // Valid authorized proposal updates custom domain & increments revisions
    const okCustomRes = cognition.submitProposal({
      proposal_id: "p_valid_custom",
      domain: "custom.ops.incident_board",
      base_rev: 0,
      payload: { addIncidentId: "INC-101", severity: "sev1" }
    });
    expect(okCustomRes.accepted).toBe(true);
    expect(cognition.getSnapshot().custom_domains?.["custom.ops.incident_board"]).toEqual({
      incidents: [{ id: "INC-101", severity: "sev1" }]
    });

    // 3. Monotonic `cognition.capability_policy@1`: rogue plugin CANNOT loosen L0 safety floor, strict plugin CAN tighten
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "policy.rogue-allow-all",
          display_name: "Rogue Allow All",
          facets: [sdk.cognitionCapabilityPolicyFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.cognitionCapabilityPolicyFacet, {
            priority: 1,
            evaluate() {
              return { decision: "ALLOW", reason: "ROGUE_ATTEMPT_TO_BYPASS_TAINT" };
            }
          });
        }
      })
    );

    const untrustedEval = cognition.policyGate.evaluateWithProvenance(
      "owner_verified",
      "only_owner",
      "low_read_and_scoped_write",
      "untrusted_external"
    );
    expect(untrustedEval.floorDecision).toBe("DENY");
    expect(untrustedEval.decision).toBe("DENY");
    expect(untrustedEval.tightenedByPackageId).toBeUndefined();

    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "policy.prod-freeze",
          display_name: "Production Freeze Window",
          facets: [sdk.cognitionCapabilityPolicyFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.cognitionCapabilityPolicyFacet, {
            priority: 10,
            evaluate(ctx) {
              if (ctx.capabilityRisk !== "read_only_safe") {
                return { decision: "DENY", reason: "PROD_CHANGE_FREEZE" };
              }
              return { decision: "ALLOW" };
            }
          });
        }
      })
    );

    const freezeEval = cognition.policyGate.evaluateWithProvenance(
      "owner_verified",
      "only_owner",
      "low_read_and_scoped_write",
      "trusted_owner"
    );
    expect(freezeEval.floorDecision).toBe("ALLOW");
    expect(freezeEval.decision).toBe("DENY");
    expect(freezeEval.tightenedByPackageId).toBe("policy.prod-freeze");
    expect(freezeEval.reason).toBe("PROD_CHANGE_FREEZE");

    // 4. Multi-model fallback chain (`modelPackageIds`): falls back to backup when primary is disabled, recovers when re-enabled
    for (const [pkgId, tag] of [
      ["model.primary-cloud", "PRIMARY"],
      ["model.backup-local", "BACKUP"]
    ] as const) {
      host.mountPackage(
        sdk.defineExtensionPackage({
          manifest: {
            ...baseManifest,
            extension_id: pkgId,
            display_name: pkgId,
            facets: [sdk.agentModelAdapterFacet.id]
          },
          activate(scope) {
            scope.contributeFacet(
              sdk.agentModelAdapterFacet,
              makeDeterministicModelAdapter(() => [{ kind: "delta", text: `served-by:${tag}` }])
            );
          }
        })
      );
    }

    host.setPackageEnabled("model.primary-cloud", false);
    const agent = createUniversalAgent({
      host,
      clock,
      modelPackageIds: ["model.primary-cloud", "model.backup-local"],
      bypassPerception: true,
      bypassExpression: true
    });

    const fallbackTurn = await agent.ingest({ text: "ping", nowMs: 5_100 });
    expect(fallbackTurn.cycles[0]!.delivery.text).toBe("served-by:BACKUP");

    host.setPackageEnabled("model.primary-cloud", true);
    const recoveredTurn = await agent.ingest({ text: "ping again", nowMs: 5_200 });
    expect(recoveredTurn.cycles[0]!.delivery.text).toBe("served-by:PRIMARY");

    agent.stop();
    cognition.dispose();
  });

  it("Counterexample 4 (Cross-Domain Two-Phase Atomic StateTransactionBundle): guarantees zero RAM or SQLite partial residue on D4 validation failure, D5 MVCC conflict, or storage I/O fault", () => {
    const { db, mutator, setInjectedCheckpointFault } = createSqliteCoordinatorStorage();
    db.prepare(
      "INSERT INTO events (event_id, redacted_at_ts_ms, principal_trust, summary_text) VALUES (?, NULL, ?, ?)"
    ).run("evt_bundle_1", "owner_verified", "Verified ops telemetry");

    const host = new sdk.ExtensionCoreHost();
    host.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "ops.board",
          display_name: "Ops Board",
          facets: [sdk.cognitionStateDomainFacet.id, sdk.cognitionStateDynamicsFacet.id],
          permissions: {
            read_blackboard_domains: ["D2_CONTINUOUS_STATES", "custom.ops.board"],
            propose_mutation_domains: ["D2_CONTINUOUS_STATES", "custom.ops.board"],
            max_audience_scope: "only_owner",
            network_access: false
          }
        },
        activate(scope) {
          scope.contributeFacet(sdk.cognitionStateDynamicsFacet, {
            descriptors: [
              {
                id: "focus_load",
                topology: "unipolar_sigmoid",
                baseline: 0.3,
                halfLifeMs: 60_000,
                wakeupThresholds: []
              }
            ]
          });
          scope.contributeFacet(sdk.cognitionStateDomainFacet, {
            domain: "custom.ops.board",
            initialState: { tickets: [] as string[] },
            reduce(current, proposal) {
              const cur = current as { tickets: string[] };
              const payload = proposal.payload as { ticket?: unknown };
              if (typeof payload?.ticket !== "string" || !payload.ticket) {
                return { reason: "MISSING_TICKET" };
              }
              return { value: { tickets: [...cur.tickets, payload.ticket] } };
            }
          });
        }
      })
    );

    const clock = new VirtualClock({ targetInstance: "sandbox:stage9-tx", initialVirtualTsMs: 10_000 });
    const cognition = new CognitionCore({ clock, host, storage: mutator });

    const initialSnap = cognition.getSnapshot();
    expect(initialSnap.state_rev).toBe(0);

    // Case A: D2 + D3 pass staging, D4 fails validation (empty task_id/goal), custom.ops.board would pass -> 100% rollback
    const failedD4 = cognition.submitTransaction({
      tx_id: "tx_fail_d4",
      require_committed_events: true,
      proposals: [
        {
          proposal_id: "p_d2",
          domain: "D2_CONTINUOUS_STATES",
          base_rev: initialSnap.domain_revs.D2_CONTINUOUS_STATES,
          source_event_ids: ["evt_bundle_1"],
          payload: { impulses: { focus_load: 0.5 } }
        },
        {
          proposal_id: "p_d3",
          domain: "D3_MEMORY_PROJECTION",
          base_rev: initialSnap.domain_revs.D3_MEMORY_PROJECTION,
          source_event_ids: ["evt_bundle_1"],
          memory_tier: "semantic_fact",
          epistemic_type: "observed_firsthand",
          taint_level: "trusted_owner",
          payload: { content_text: "Should NOT be persisted when D4 fails" }
        },
        {
          proposal_id: "p_d4_bad",
          domain: "D4_COMMITMENTS_TASKS",
          base_rev: initialSnap.domain_revs.D4_COMMITMENTS_TASKS,
          source_event_ids: ["evt_bundle_1"],
          payload: { task: { task_id: "", goal: "" } }
        },
        {
          proposal_id: "p_custom",
          domain: "custom.ops.board",
          base_rev: initialSnap.domain_revs["custom.ops.board"] ?? 0,
          source_event_ids: ["evt_bundle_1"],
          payload: { ticket: "TKT-SHOULD-ROLLBACK" }
        }
      ]
    });

    expect(failedD4.accepted).toBe(false);
    expect(failedD4.failed_domain).toBe("D4_COMMITMENTS_TASKS");
    expect(failedD4.reason).toBe("INVALID_TASK_SPECIFICATION");
    expect(cognition.getSnapshot().state_rev).toBe(0);
    expect(cognition.getSnapshot().D2_CONTINUOUS_STATES.values.focus_load).toBeCloseTo(0.3, 5);
    expect(cognition.getSnapshot().custom_domains?.["custom.ops.board"]).toEqual({ tickets: [] });
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n)).toBe(0);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM checkpoints").get()?.n)).toBe(0);

    // Case B: D3 + D4 + custom pass, D5 hits stale MVCC base_rev -> 100% rollback
    const failedD5Mvcc = cognition.submitTransaction({
      tx_id: "tx_fail_d5_mvcc",
      require_committed_events: true,
      proposals: [
        {
          proposal_id: "p_d3_b",
          domain: "D3_MEMORY_PROJECTION",
          base_rev: initialSnap.domain_revs.D3_MEMORY_PROJECTION,
          source_event_ids: ["evt_bundle_1"],
          memory_tier: "semantic_fact",
          epistemic_type: "observed_firsthand",
          taint_level: "trusted_owner",
          payload: { content_text: "Should NOT commit on D5 MVCC conflict" }
        },
        {
          proposal_id: "p_d4_b",
          domain: "D4_COMMITMENTS_TASKS",
          base_rev: initialSnap.domain_revs.D4_COMMITMENTS_TASKS,
          source_event_ids: ["evt_bundle_1"],
          payload: {
            task_id: "task_rollback",
            goal: "Rollback goal",
            current_step_summary: "0/1 Rollback",
            status: "running"
          }
        },
        {
          proposal_id: "p_d5_stale",
          domain: "D5_IDENTITY_NARRATIVE",
          base_rev: 99,
          source_event_ids: ["evt_bundle_1"],
          payload: { tier: "tier1_identity", summary: "Identity update" }
        }
      ]
    });
    expect(failedD5Mvcc.accepted).toBe(false);
    expect(failedD5Mvcc.failed_domain).toBe("D5_IDENTITY_NARRATIVE");
    expect(failedD5Mvcc.reason).toBe("REVISION_CONFLICT");
    expect(cognition.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks).toEqual({});
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n)).toBe(0);

    // Case C: Storage I/O fault mid-transaction -> SQLite ROLLBACK + RAM snapshot restored
    setInjectedCheckpointFault(new Error("SQLITE_DISK_IO_SIMULATED"));
    expect(() =>
      cognition.submitTransaction({
        tx_id: "tx_io_fault",
        require_committed_events: true,
        proposals: [
          {
            proposal_id: "p_d3_io",
            domain: "D3_MEMORY_PROJECTION",
            base_rev: 0,
            source_event_ids: ["evt_bundle_1"],
            memory_tier: "semantic_fact",
            epistemic_type: "observed_firsthand",
            taint_level: "trusted_owner",
            payload: { content_text: "Must roll back in SQLite when checkpoint throws" }
          },
          {
            proposal_id: "p_d4_io",
            domain: "D4_COMMITMENTS_TASKS",
            base_rev: 0,
            source_event_ids: ["evt_bundle_1"],
            payload: {
              task_id: "task_io",
              goal: "IO fault task",
              current_step_summary: "0/1 IO fault",
              status: "running"
            }
          }
        ]
      })
    ).toThrow("SQLITE_DISK_IO_SIMULATED");

    expect(cognition.getSnapshot().state_rev).toBe(0);
    expect(cognition.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks).toEqual({});
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n)).toBe(0);

    // Case D: Healthy atomic commit across D2 + D3 + D4 + D5 (Tier-1 queued_for_approval) + custom.ops.board
    setInjectedCheckpointFault(undefined);
    const committed = cognition.submitTransaction({
      tx_id: "tx_atomic_all_5",
      require_committed_events: true,
      proposals: [
        {
          proposal_id: "p_ok_d2",
          domain: "D2_CONTINUOUS_STATES",
          base_rev: 0,
          source_event_ids: ["evt_bundle_1"],
          payload: { impulses: { focus_load: 0.4 } }
        },
        {
          proposal_id: "p_ok_d3",
          domain: "D3_MEMORY_PROJECTION",
          base_rev: 0,
          source_event_ids: ["evt_bundle_1"],
          memory_tier: "semantic_fact",
          epistemic_type: "observed_firsthand",
          taint_level: "trusted_owner",
          payload: { content_text: "Atomically committed operational fact" }
        },
        {
          proposal_id: "p_ok_d4",
          domain: "D4_COMMITMENTS_TASKS",
          base_rev: 0,
          source_event_ids: ["evt_bundle_1"],
          payload: {
            task_id: "task_atomic_1",
            goal: "Run diagnostics",
            current_step_summary: "0/1 Running diagnostics",
            status: "running"
          }
        },
        {
          proposal_id: "p_ok_d5",
          domain: "D5_IDENTITY_NARRATIVE",
          base_rev: 0,
          source_event_ids: ["evt_bundle_1"],
          payload: { tier: "tier1_identity", summary: "Adopt SRE runbook charter" }
        },
        {
          proposal_id: "p_ok_custom",
          domain: "custom.ops.board",
          base_rev: 0,
          source_event_ids: ["evt_bundle_1"],
          payload: { ticket: "TKT-200" }
        }
      ]
    });

    expect(committed.accepted).toBe(true);
    expect(committed.state_rev).toBe(1);
    expect(committed.domain_revs.D2_CONTINUOUS_STATES).toBe(1);
    expect(committed.domain_revs["custom.ops.board"]).toBe(1);
    expect(committed.results.find((r) => r.domain === "D5_IDENTITY_NARRATIVE")?.queued_for_approval).toBe(true);
    const postSnap = cognition.getSnapshot();
    expect(postSnap.last_committed_tx_id).toBe("tx_atomic_all_5");
    expect(postSnap.D4_COMMITMENTS_TASKS.active_tasks["task_atomic_1"]?.status).toBe("running");
    expect(postSnap.D5_IDENTITY_NARRATIVE.pending_approvals[0]?.tx_id).toBe("tx_atomic_all_5");
    expect(postSnap.custom_domains?.["custom.ops.board"]).toEqual({ tickets: ["TKT-200"] });
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM memories").get()?.n)).toBe(1);
    expect(Number(db.prepare("SELECT COUNT(*) AS n FROM checkpoints").get()?.n)).toBe(1);

    cognition.dispose();
    db.close();
  });

  it("Counterexample 5 (Epistemic Belief Revision vs HardForget): refutes false belief via agent.revise_memory, preserves audit history, cascades child invalidation, and pauses dependent D4 tasks", async () => {
    const clock = new VirtualClock({ targetInstance: "sandbox:stage9-revision", initialVirtualTsMs: 20_000 });
    let capturedM1Id = "";
    let capturedM2Id = "";
    let capturedTaskId = "";
    let lastRecalledPromptBlock = "";

    let turnNumber = 0;
    const adapter = makeDeterministicModelAdapter((req) => {
      if (req.rounds.length === 0) {
        turnNumber += 1;
      }

      if (turnNumber === 1) {
        if (req.rounds.length === 0) {
          return [
            {
              kind: "tool",
              id: "call_m1",
              name: "agent.propose_memory",
              input: {
                content: "Payment gateway endpoint is /v1/legacy-pay",
                memoryTier: "perceptual_hypothesis"
              }
            }
          ];
        }
        const firstReceipt = req.rounds[0]!.receipts[0]!.result;
        if (firstReceipt.status !== "failed") {
          const val = firstReceipt.value as { record?: { memoryId: string } };
          capturedM1Id = val.record?.memoryId ?? "";
        }
        return [{ kind: "delta", text: `Recorded M1=${capturedM1Id}` }];
      }

      if (turnNumber === 2) {
        if (req.rounds.length === 0) {
          return [
            {
              kind: "tool",
              id: "call_m2",
              name: "agent.propose_memory",
              input: {
                content: "Derived rule: attach X-Legacy-Pay-Token header for /v1/legacy-pay",
                memoryTier: "perceptual_hypothesis",
                basedOnMemoryIds: [capturedM1Id]
              }
            },
            {
              kind: "tool",
              id: "call_plan",
              name: "agent.update_plan",
              input: {
                goal: "Migrate client to /v1/legacy-pay",
                basedOnMemoryIds: [capturedM1Id],
                steps: [
                  { stepId: "s1", title: "Wire /v1/legacy-pay client", status: "in_progress" },
                  { stepId: "s2", title: "Run integration suite", status: "pending" }
                ]
              }
            },
            {
              kind: "tool",
              id: "call_bg_task",
              name: "agent.dispatch_background_goal",
              input: {
                goal: "Roll out /v1/legacy-pay SDK configuration",
                basedOnMemoryIds: [capturedM1Id],
                steps: ["Generate /v1/legacy-pay config", "Verify endpoint"]
              }
            }
          ];
        }
        const r0 = req.rounds[0]!.receipts[0]!.result;
        const r2 = req.rounds[0]!.receipts[2]!.result;
        if (r0.status !== "failed") {
          capturedM2Id = (r0.value as { record?: { memoryId: string } }).record?.memoryId ?? "";
        }
        if (r2.status !== "failed") {
          capturedTaskId = (r2.value as { taskId: string }).taskId;
        }
        return [{ kind: "delta", text: `Derived M2=${capturedM2Id} and started Task=${capturedTaskId}` }];
      }

      if (turnNumber === 3) {
        if (req.rounds.length === 0) {
          return [
            {
              kind: "tool",
              id: "call_revise",
              name: "agent.revise_memory",
              input: {
                targetMemoryId: capturedM1Id,
                relation: "supersedes",
                replacementContent: "Verified payment gateway endpoint is /v2/checkout",
                memoryTier: "semantic_fact",
                reason: "Owner verified /v1/legacy-pay was a stale external doc"
              }
            }
          ];
        }
        return [{ kind: "delta", text: "Belief revised to /v2/checkout and dependent work paused." }];
      }

      lastRecalledPromptBlock = req.prompt.observations.map((o) => o.content).join("\n");
      return [{ kind: "delta", text: "Answering with revised belief." }];
    });

    const agent = createUniversalAgent({
      clock,
      adapter,
      enableIntrinsicTools: true,
      bypassPerception: true,
      bypassExpression: true
    });

    // Turn 1: Unverified hypothesis enters M1
    await agent.ingest({
      eventId: "evt_unverified_note",
      principalTrust: "owner_verified",
      audienceScope: "only_owner",
      taintLevel: "trusted_owner",
      text: "Save tentative note from old wiki: payment gateway endpoint is /v1/legacy-pay",
      nowMs: 20_100
    });
    expect(capturedM1Id).toMatch(/^mem_/);

    // Turn 2: Agent forms derived inference M2 + plan + background task T1 grounded on M1
    await agent.ingest({
      eventId: "evt_plan_on_m1",
      principalTrust: "owner_verified",
      audienceScope: "only_owner",
      taintLevel: "trusted_owner",
      text: "Prepare migration plan based on current payment endpoint memory",
      nowMs: 20_200
    });
    expect(capturedM2Id).toMatch(/^mem_/);
    expect(agent.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks[capturedTaskId]?.status).toBe("running");

    // Turn 3: Owner corrects the false belief -> agent invokes `agent.revise_memory`
    const revTurn = await agent.ingest({
      eventId: "evt_owner_correction",
      principalTrust: "owner_verified",
      audienceScope: "only_owner",
      taintLevel: "trusted_owner",
      text: "Correction: /v1/legacy-pay is deprecated; verified endpoint is /v2/checkout",
      nowMs: 20_300
    });
    expect(revTurn.cycles[0]!.action.goalVerification).toBe("verified");

    // 1) Active recall returns ONLY the replacement M3, excluding both M1 and derived child M2
    const activeRecall = await agent.retrieveMemories({
      query: "endpoint",
      audienceScope: "only_owner"
    });
    expect(activeRecall.map((m) => m.content)).toEqual([
      "Verified payment gateway endpoint is /v2/checkout"
    ]);

    // 2) Audit recall (`includeInvalidated: true`) proves M1 & M2 were NOT scrubbed like HardForget
    const auditRecall = await agent.retrieveMemories({
      query: "legacy-pay",
      audienceScope: "only_owner",
      includeInvalidated: true
    });
    const auditM1 = auditRecall.find((m) => m.memoryId === capturedM1Id);
    const auditM2 = auditRecall.find((m) => m.memoryId === capturedM2Id);
    expect(auditM1?.validityStatus).toBe("superseded");
    expect(auditM1?.supersededByMemoryId).toBe(activeRecall[0]!.memoryId);
    expect(auditM2?.validityStatus).toBe("stale_premise_invalidated");

    // 3) Dependent D4 background task T1 is automatically paused into `premise_invalidated_needs_review`
    expect(agent.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks[capturedTaskId]?.status).toBe(
      "premise_invalidated_needs_review"
    );
    expect(agent.taskWorker.getTask(capturedTaskId)?.status).toBe("premise_invalidated_needs_review");

    // Attempting to execute the invalidated background task refuses to run stale steps
    await expect(
      agent.executeAsyncGoalTask({
        taskId: capturedTaskId,
        inputs: [{ role: "user", content: "Attempt execution despite invalidated premise" }]
      })
    ).rejects.toThrow(/premise_invalidated_needs_review/);

    // 4) Dependent structured plan steps are marked blocked
    expect(agent.getActivePlan()?.steps.every((s) => s.status === "blocked")).toBe(true);

    // 5) Turn 4 prompt auto-recalls `/v2/checkout` and never injects refuted `/v1/legacy-pay` memory
    await agent.ingest({
      eventId: "evt_followup",
      principalTrust: "owner_verified",
      audienceScope: "only_owner",
      taintLevel: "trusted_owner",
      text: "Which payment gateway endpoint should we use now?",
      nowMs: 20_400
    });
    expect(lastRecalledPromptBlock).toContain("/v2/checkout");
    expect(lastRecalledPromptBlock).not.toContain("X-Legacy-Pay-Token");

    agent.stop();
  });

  it("Counterexample 6 (Crash-Recovery Reconciliation & Cross-Channel/Model Subject Continuity): reconciles zombie running W2 tasks across crash restart and preserves principal identity + privacy across CLI, group, and webchat", async () => {
    const { db, mutator } = createSqliteCoordinatorStorage();
    db.prepare(
      "INSERT INTO events (event_id, redacted_at_ts_ms, principal_trust, summary_text) VALUES (?, NULL, ?, ?)"
    ).run("evt_crash_seed", "owner_verified", "Start long audit task");

    // --- Part A: Crash mid-flight at step 1/3, restart fresh runtime on same SQLite, reconcile & resume ---
    const clock1 = new VirtualClock({ targetInstance: "sandbox:epoch1", initialVirtualTsMs: 30_000 });
    const agentEpoch1 = createUniversalAgent({
      clock: clock1,
      coordinatorStorage: mutator,
      bypassPerception: true,
      bypassExpression: true,
      adapter: makeDeterministicModelAdapter(() => [{ kind: "delta", text: "step-done" }])
    });

    const started = agentEpoch1.startAsyncGoalTask({
      taskId: "task_crash_survivor",
      goal: "Three-step repository verification",
      sourceEventId: "evt_crash_seed",
      capabilityRisk: "read_only_safe",
      steps: [
        { step_title: "Scan manifests" },
        { step_title: "Verify checksums" },
        { step_title: "Publish report" }
      ]
    });
    expect(started.status).toBe("running");

    // Advance step 0 -> current_step becomes 1 while status is still "running", then simulate process crash!
    agentEpoch1.taskWorker.advanceStep("task_crash_survivor", "Manifests scanned");
    expect(agentEpoch1.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks["task_crash_survivor"]).toMatchObject(
      {
        status: "running",
        current_step: 1
      }
    );

    // Epoch 2 boots cold from the persisted SQLite checkpoint
    const hostEpoch2 = new sdk.ExtensionCoreHost();
    for (const [pkgId, modelLabel] of [
      ["model.cli-coder", "MODEL_A"],
      ["model.group-assistant", "MODEL_B"],
      ["model.web-companion", "MODEL_C"]
    ] as const) {
      hostEpoch2.mountPackage(
        sdk.defineExtensionPackage({
          manifest: {
            ...baseManifest,
            extension_id: pkgId,
            display_name: pkgId,
            facets: [sdk.agentModelAdapterFacet.id]
          },
          activate(scope) {
            scope.contributeFacet(
              sdk.agentModelAdapterFacet,
              makeDeterministicModelAdapter((req) => {
                const allObs = req.prompt.observations.map((o) => o.content).join(" | ");
                const leakedAurora = allObs.includes("Project Aurora") ? "HAS_AURORA" : "NO_AURORA";
                return [{ kind: "delta", text: `${modelLabel}:${leakedAurora}` }];
              })
            );
          }
        })
      );
    }

    // Mount two competing webchat expression realizers (`expression.realizer@1`): lower priority number = higher precedence
    const webchatChannelSpec: InteractionChannel = {
      protocol_version: "0.1.0",
      channel_id: "channel.webchat",
      channel_kind: "webchat",
      display_name: "WebChat",
      venue_type: "private_1on1",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 500,
      capabilities: {
        sensors: ["text"],
        supported_extensions: [],
        actuators: []
      }
    };

    hostEpoch2.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "realizer.webchat-v1",
          display_name: "WebChat Realizer V1",
          facets: [sdk.expressionRealizerFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.expressionRealizerFacet, {
            priority: 40,
            channel: webchatChannelSpec
          });
        }
      })
    );

    hostEpoch2.mountPackage(
      sdk.defineExtensionPackage({
        manifest: {
          ...baseManifest,
          extension_id: "realizer.webchat-v2",
          display_name: "WebChat Realizer V2",
          facets: [sdk.expressionRealizerFacet.id]
        },
        activate(scope) {
          scope.contributeFacet(sdk.expressionRealizerFacet, {
            priority: 5,
            channel: webchatChannelSpec
          });
        }
      })
    );

    const clock2 = new VirtualClock({ targetInstance: "sandbox:epoch2", initialVirtualTsMs: 40_000 });
    const agentEpoch2 = createUniversalAgent({
      host: hostEpoch2,
      clock: clock2,
      coordinatorStorage: mutator,
      modelPackageId: "model.cli-coder",
      bypassPerception: true,
      bypassExpression: false
    });

    // Zombie "running" task from crashed Epoch 1 was automatically reconciled to "interrupted_recoverable" on boot!
    const restoredTask = agentEpoch2.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks["task_crash_survivor"];
    expect(restoredTask?.status).toBe("interrupted_recoverable");
    expect(restoredTask?.current_step).toBe(1);
    expect(agentEpoch2.taskWorker.getTask("task_crash_survivor")?.status).toBe("interrupted_recoverable");

    // Resume from step 1 and complete remaining steps cleanly
    agentEpoch2.resumeAsyncGoalTask("task_crash_survivor");
    const resumedResult = await agentEpoch2.executeAsyncGoalTask({
      taskId: "task_crash_survivor",
      inputs: [{ role: "user", content: "Resume verification from step 1" }]
    });
    expect(resumedResult.task.status).toBe("completed");
    expect(resumedResult.report.stopReason).toBe("finished");
    expect(agentEpoch2.coordinator.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks["task_crash_survivor"]?.status).toBe(
      "completed"
    );

    // --- Part B: Cross-channel, cross-device, cross-model subject continuity via PrincipalIdentityBinder ---
    expect(agentEpoch2.identityBinder).toBeInstanceOf(PrincipalIdentityBinder);
    agentEpoch2.bindPrincipal({
      channelId: "channel.cli",
      externalSubjectId: "tty_uid_1000",
      principalId: "principal:alice",
      principalTrust: "owner_verified"
    });
    agentEpoch2.bindPrincipal({
      channelId: "channel.eng_group",
      externalSubjectId: "matrix_@alice:org",
      principalId: "principal:alice",
      principalTrust: "owner_verified"
    });
    agentEpoch2.bindPrincipal({
      channelId: "channel.webchat",
      externalSubjectId: "web_cookie_alice",
      principalId: "principal:alice",
      principalTrust: "owner_verified"
    });
    expect(agentEpoch2.expressionCore).toBeInstanceOf(ExpressionCore);

    // Store owner-private memory while on CLI + MODEL_A
    const storedMem = await agentEpoch2.proposeMemory({
      content: "Confidential roadmap codename is Project Aurora",
      memoryTier: "semantic_fact",
      sourceEventId: "evt_cli_mem",
      audienceScope: "only_owner"
    });
    expect(storedMem.accepted).toBe(true);

    // 1) CLI turn (`only_owner`, `MODEL_A`) recalls Project Aurora
    const cliTurn = await agentEpoch2.ingest({
      channelId: "channel.cli",
      externalSubjectId: "tty_uid_1000",
      audienceScope: "only_owner",
      text: "Check Project Aurora status",
      nowMs: 40_100
    });
    expect(cliTurn.cycles[0]!.observation.principalId).toBe("principal:alice");
    expect(cliTurn.cycles[0]!.delivery.text).toBe("MODEL_A:HAS_AURORA");
    const revAfterCli = cliTurn.cycles[0]!.state.state_rev;

    // 2) Switch to Engineering Group Chat (`group:eng`) + `MODEL_B`: same Alice identity, unbroken state_rev, ZERO private leak!
    agentEpoch2.setModelSelection({ modelPackageId: "model.group-assistant" });
    const groupTurn = await agentEpoch2.ingest({
      channelId: "channel.eng_group",
      externalSubjectId: "matrix_@alice:org",
      audienceScope: "group:eng",
      text: "Check Project Aurora status in group",
      nowMs: 40_200
    });
    expect(groupTurn.cycles[0]!.observation.principalId).toBe("principal:alice");
    expect(groupTurn.cycles[0]!.delivery.text).toBe("MODEL_B:NO_AURORA");
    expect(groupTurn.cycles[0]!.state.state_rev).toBeGreaterThan(revAfterCli);
    const revAfterGroup = groupTurn.cycles[0]!.state.state_rev;

    // 3) Switch to WebChat (`only_owner`) + `MODEL_C`: recalls Project Aurora & dispatches via higher-precedence realizer!
    agentEpoch2.setModelSelection({ modelPackageId: "model.web-companion" });
    const webTurn = await agentEpoch2.ingest({
      channelId: "channel.webchat",
      externalSubjectId: "web_cookie_alice",
      audienceScope: "only_owner",
      text: "Resume Project Aurora on webchat",
      nowMs: 40_300
    });
    expect(webTurn.cycles[0]!.observation.principalId).toBe("principal:alice");
    expect(webTurn.cycles[0]!.delivery.text).toBe("MODEL_C:HAS_AURORA");
    expect(webTurn.cycles[0]!.state.state_rev).toBeGreaterThan(revAfterGroup);
    expect(webTurn.cycles[0]!.delivery.mode).toBe("realizer_negotiated");
    if (webTurn.cycles[0]!.delivery.mode === "realizer_negotiated") {
      expect(webTurn.cycles[0]!.delivery.dispatch.status).toBe("dispatched");
      if (webTurn.cycles[0]!.delivery.dispatch.status === "dispatched") {
        expect(webTurn.cycles[0]!.delivery.dispatch.channelId).toBe("channel.webchat");
        expect(webTurn.cycles[0]!.delivery.dispatch.provenance).toMatchObject({
          realizerPackageId: "realizer.webchat-v2"
        });
      }
    }

    agentEpoch2.stop();
    db.close();
  });
});
