import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AdminOperation, AdminRouteHandler, AdminTelemetryFrame, AdminTelemetryTrack
} from "@ai0/gateway";
import {
  bundlePrivacyScrubbedCreatorAsset, computeSecondOrderCoupledAffect,
  distillSillyTavernCard, GOLDEN_REGRESSION_SCENARIO_V1, runScenarioPlaybook,
  simulateLorebookActivation, type AuthoritativeStateCoordinator,
  type BlackboardCompiler, type BlackboardPolicy, type BrainRegion,
  type BrainRegionRouter, type InteractionOpportunityPool,
  type PolymorphicExtensionHost, type SensoryCoverageBucketManager,
  type SensoryCoverageUpdate, type VerifiableTurnTrace as CoordinatorTrace,
  type VirtualClock, type W1FastDialogueWorker
} from "@ai0/kernel";
import type { AudienceScope, SensorModality, VenueType } from "@ai0/protocol";
import {
  extractGistCardsBeforeUnmount, type CoordinatorStorageMutator,
  type HardForgetEngine, type SoulArchiveManager
} from "@ai0/storage";

type Json = Record<string, unknown>;
export interface CircadianAnchor { hour: number; energy: number }
export interface ActiveShellSession {
  session_id: string; shell_id: string; venue_type: VenueType;
  audience_scope: AudienceScope; modality: SensorModality; last_active_ts_ms: number;
}
export interface DaemonMutableState {
  virtualOffsetHours: number; debounceWindowMs: number; circadianAnchors: CircadianAnchor[];
  activeShellSessions: Map<string, ActiveShellSession>;
  telemetryFrames: AdminTelemetryFrame[]; sandboxForks: Map<string, CoordinatorStorageMutator>;
}
export interface DaemonHandlerContext {
  soulDir: string; storage: CoordinatorStorageMutator; sandboxStorage: CoordinatorStorageMutator;
  hardForgetEngine: HardForgetEngine; sandboxHardForgetEngine: HardForgetEngine;
  soulArchiveManager: SoulArchiveManager; virtualClock: VirtualClock; sandboxClock: VirtualClock;
  coordinator: AuthoritativeStateCoordinator; sandboxCoordinator: AuthoritativeStateCoordinator;
  blackboardCompiler: BlackboardCompiler; sandboxBlackboardCompiler: BlackboardCompiler;
  brainRegionRouter: BrainRegionRouter; extensionHost: PolymorphicExtensionHost;
  sandboxExtensionHost: PolymorphicExtensionHost; sensoryCoverage: SensoryCoverageBucketManager;
  opportunityPool: InteractionOpportunityPool; sandboxW1: W1FastDialogueWorker;
  coordinatorTraces: CoordinatorTrace[]; state: DaemonMutableState;
  emitTelemetry(track: AdminTelemetryTrack, payload: unknown,
    target?: "live" | `sandbox:${string}`, timestampMs?: number): void;
  replaceLiveStorage?(storage: CoordinatorStorageMutator): void;
}

const REGIONS: BrainRegion[] = ["W1_fast_dialogue", "W2_agency_planner",
  "W3_sleep_curiosity", "W4_multimodal", "L0_crisis_classifier"];
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bodyOf = (value: unknown): Json => isRecord(value) ? value : {};
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string") : [];
const finite = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const rows = (storage: CoordinatorStorageMutator, sql: string): Json[] =>
  storage.sqlite.prepare(sql).all() as unknown as Json[];

function selected(runtime: DaemonHandlerContext, target: "live" | `sandbox:${string}`) {
  const sandbox = target !== "live";
  return { storage: sandbox ? runtime.sandboxStorage : runtime.storage,
    engine: sandbox ? runtime.sandboxHardForgetEngine : runtime.hardForgetEngine,
    clock: sandbox ? runtime.sandboxClock : runtime.virtualClock,
    coordinator: sandbox ? runtime.sandboxCoordinator : runtime.coordinator,
    compiler: sandbox ? runtime.sandboxBlackboardCompiler : runtime.blackboardCompiler,
    extensions: sandbox ? runtime.sandboxExtensionHost : runtime.extensionHost };
}

export async function readRedactionLedgerCount(soulDir: string): Promise<number> {
  try {
    const value: unknown = JSON.parse(await readFile(join(soulDir, "state", "redaction_ledger.json"), "utf8"));
    return Array.isArray(value) ? value.length : isRecord(value) && Array.isArray(value.entries)
      ? value.entries.length : 0;
  } catch { return 0; }
}

function circadianAt(hour: number, anchors: CircadianAnchor[]): number {
  const ordered = [...anchors].sort((a, b) => a.hour - b.hour);
  if (!ordered.length) return 1;
  const extended = [{ ...ordered.at(-1)!, hour: ordered.at(-1)!.hour - 24 }, ...ordered,
    { ...ordered[0]!, hour: ordered[0]!.hour + 24 }];
  const right = extended.findIndex((item) => item.hour >= hour);
  const a = extended[Math.max(0, right - 1)]!, b = extended[Math.max(1, right)]!;
  return a.energy + (b.energy - a.energy) * ((hour - a.hour) / Math.max(1, b.hour - a.hour));
}

export function buildHomeostasisSamples(
  snapshot: ReturnType<AuthoritativeStateCoordinator["getSnapshot"]>, anchors: CircadianAnchor[]
) {
  const affect = snapshot.D2_HOMEOSTASIS_AFFECT;
  return Array.from({ length: 24 }, (_, hour) => {
    const ode = computeSecondOrderCoupledAffect({ v_instant_0: affect.instant_valence,
      v_mood_0: affect.mood_baseline_val, v_base: 0,
      effective_elapsed_ms: hour * 3_600_000 });
    return { hour, circadian: circadianAt(hour, anchors), fastAffect: ode.instant_valence,
      slowAffect: ode.mood_baseline_val };
  });
}

function gateView(runtime: DaemonHandlerContext) {
  return { debounce_window_ms: runtime.state.debounceWindowMs,
    opportunity_pool: runtime.opportunityPool.list(), sensory_coverage: runtime.sensoryCoverage.list() };
}

export function createRealAdminHandlers(
  runtime: DaemonHandlerContext
): Partial<Record<AdminOperation, AdminRouteHandler>> {
  return {
    "blackboard.compilePreview": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      const source = isRecord(body.policy) ? body.policy : body;
      const policy: BlackboardPolicy = {
        max_total_tokens: finite(source.max_total_tokens, 2_200),
        tier0_safety_invariants: String(source.tier0_safety_invariants ??
          "Tier 0 SB 243: honest companion, privacy boundaries, and zero exit-guilt."),
        ...(isRecord(source.slots) ? { slots: source.slots as BlackboardPolicy["slots"] } : {}),
        ...(typeof source.memory_projection_text === "string"
          ? { memory_projection_text: source.memory_projection_text } : {}),
        ...(typeof source.narrative_self_text === "string"
          ? { narrative_self_text: source.narrative_self_text } : {})
      };
      const audience = body.audience_scope === "only_owner" ? "only_owner" : "public_all";
      return backend.compiler.compile(backend.coordinator.getSnapshot(), policy, audience);
    },
    "shells.topology": (_request, context) => ({
      active_sessions: [...runtime.state.activeShellSessions.values()],
      shell_extensions: selected(runtime, context.target_instance).extensions.listExtensions()
        .filter((item) => item.buses.includes("ext.shell")),
      sensory_coverage: runtime.sensoryCoverage.list()
    }),
    "shells.thalamicGate": (request) => {
      const body = bodyOf(request.body);
      if (request.method !== "GET") {
        if (body.debounce_window_ms !== undefined)
          runtime.state.debounceWindowMs = Math.max(0, finite(body.debounce_window_ms, 1_200));
        if (isRecord(body.opportunity)) runtime.opportunityPool.add(body.opportunity as never);
        if (typeof body.opportunity_id === "string" && typeof body.lifecycle === "string")
          runtime.opportunityPool.transition(body.opportunity_id, body.lifecycle as never);
        if (isRecord(body.sensory_coverage))
          runtime.sensoryCoverage.upsert(body.sensory_coverage as unknown as SensoryCoverageUpdate);
      }
      return gateView(runtime);
    },
    "soul.distill": (request) => {
      const body = bodyOf(request.body);
      return distillSillyTavernCard(bodyOf(body.card ?? body));
    },
    "soul.lorebooks.simulate": (request) => {
      const body = bodyOf(request.body), entries = Array.isArray(body.entries) ? body.entries : [];
      return { activated_entries: simulateLorebookActivation(entries as never[], String(body.utterance ?? "")) };
    },
    "soul.homeostasis": (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      let mutation: unknown;
      if (request.method === "PATCH" && context.target_instance !== "live") {
        const snapshot = backend.coordinator.getSnapshot();
        mutation = backend.coordinator.submitProposal({ proposal_id: `admin:affect:${backend.clock.nowMs()}`,
          domain: "D2_HOMEOSTASIS_AFFECT", base_rev: snapshot.domain_revs.D2_HOMEOSTASIS_AFFECT,
          payload: bodyOf(body.impulse ?? body) });
      } else if (request.method === "PATCH" && Array.isArray(body.circadian_anchors)) {
        runtime.state.circadianAnchors = body.circadian_anchors.filter(isRecord).map((item) => ({
          hour: Math.max(0, Math.min(23, finite(item.hour, 0))),
          energy: Math.max(0, Math.min(1, finite(item.energy, 1))) }));
      }
      const snapshot = backend.coordinator.getSnapshot();
      return { current: snapshot.D2_HOMEOSTASIS_AFFECT,
        samples: buildHomeostasisSamples(snapshot, runtime.state.circadianAnchors),
        circadian_anchors: runtime.state.circadianAnchors, mutation };
    },
    "memory.lineage": async (_request, context) => {
      const storage = selected(runtime, context.target_instance).storage;
      const memories = rows(storage, "SELECT * FROM memories ORDER BY created_virtual_ts DESC");
      const events = rows(storage, "SELECT * FROM event_log ORDER BY event_seq DESC");
      return { nodes: [...memories.map((node) => ({ node_type: "memory", ...node })),
        ...events.map((node) => ({ node_type: "event", ...node }))],
        edges: rows(storage, "SELECT * FROM memory_lineage_edges ORDER BY child_memory_id, parent_id"),
        redaction_ledger_count: context.target_instance === "live"
          ? await readRedactionLedgerCount(runtime.soulDir) : 0 };
    },
    "memory.hardForget": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance), now = backend.clock.nowMs();
      return backend.engine.execute({ target_event_ids: strings(body.target_event_ids),
        target_memory_ids: strings(body.target_memory_ids), virtualTsMs: now, redactedAtTsMs: now,
        ...(context.target_instance === "live" ? { soulDirPath: runtime.soulDir } : {}) });
    },
    "memory.topicSeal": async (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance), now = backend.clock.nowMs();
      return backend.engine.executeTopicSeal({ topic_description: String(body.topic_description ?? ""),
        target_event_ids: strings(body.target_event_ids), target_memory_ids: strings(body.target_memory_ids),
        virtualTsMs: now, redactedAtTsMs: now, created_virtual_ts: now,
        ...(context.target_instance === "live" ? { soulDirPath: runtime.soulDir } : {}) });
    },
    "memory.knowledge.unmountGist": (request, context) => {
      const body = bodyOf(request.body), backend = selected(runtime, context.target_instance);
      const cards = extractGistCardsBeforeUnmount(backend.storage, String(body.collection_id ?? ""),
        backend.clock.nowMs(), backend.coordinator.getSnapshot().state_rev);
      return { gist_cards: cards.map((card) => ({ gist_id: card.memory_id,
        summary_under_150_chars: [...card.content_text].slice(0, 149).join("") })) };
    },
    "memory.relationship.releaseKnot": (request, context) => {
      const body = bodyOf(request.body), coordinator = selected(runtime, context.target_instance).coordinator;
      const before = coordinator.getSnapshot();
      const tensionId = typeof body.tension_id === "string" ? body.tension_id
        : before.D5_IDENTITY_NARRATIVE.active_tensions.find((item) => !item.resolved)?.id;
      const released = tensionId ? coordinator.releaseTensionByOwnerSovereignty(tensionId) : false;
      const snapshot = coordinator.getSnapshot();
      const audit = coordinator.submitProposal({ proposal_id: `one_click_release_knot:${Date.now()}`,
        domain: "D5_IDENTITY_NARRATIVE", base_rev: snapshot.domain_revs.D5_IDENTITY_NARRATIVE,
        payload: { operation: "one_click_release_knot", tension_id: tensionId ?? null } });
      return { released, tension_id: tensionId ?? null, audit };
    },
    "models.routing": (request, context) => {
      const body = bodyOf(request.body), affect = selected(runtime, context.target_instance).coordinator
        .getSnapshot().D2_HOMEOSTASIS_AFFECT;
      const metabolic = finite(body.metabolic_energy, affect.metabolic_energy);
      const circadian = finite(body.circadian_energy, affect.circadian_energy);
      return { regions: REGIONS.map((region) => ({ region,
        config: runtime.brainRegionRouter.getRegionConfig(region),
        route: runtime.brainRegionRouter.routeForRegion(region, metabolic, circadian) })),
        voice_drift: runtime.brainRegionRouter.evaluateVoiceDriftRadar(
          strings(body.baseline_samples), strings(body.candidate_samples)) };
    },
    "extensions.manage": (request, context) => {
      const body = bodyOf(request.body), host = selected(runtime, context.target_instance).extensions;
      if (request.method !== "GET" && typeof body.extension_id === "string" && typeof body.enabled === "boolean") {
        if (context.target_instance === "live") return { status: 403,
          body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
        host.setOrganEnabled(body.extension_id, body.enabled);
      }
      return { extensions: host.listExtensions() };
    },
    "extensions.hotReload": (request, context) => {
      const body = bodyOf(request.body), id = context.params.extensionId;
      const rev = selected(runtime, context.target_instance).extensions.hotReloadExtension(
        id ?? "", bodyOf(body.config), finite(body.expected_rev, 0));
      return { extension_id: id, rev };
    },
    "extensions.bundleExport": (request) => {
      const bundle = bundlePrivacyScrubbedCreatorAsset(bodyOf(request.body).asset ?? request.body);
      return { filename: bundle.filename, sha256: bundle.sha256, excluded_keys: bundle.excluded_keys };
    },
    "runtime.traces": (request, context) => {
      const storage = selected(runtime, context.target_instance).storage;
      return { traces: storage.listDecisionTraces(finite(bodyOf(request.body).limit, 100)),
        telemetry_frames: runtime.coordinatorTraces.flatMap((trace) => trace.telemetry).slice(-400),
        admin_frames: runtime.state.telemetryFrames.slice(-200) };
    },
    "clock.advance": (request) => {
      const body = bodyOf(request.body), duration = body.duration_ms !== undefined
        ? finite(body.duration_ms, 0) : finite(body.hours, 0) * 3_600_000;
      const virtual_ts_ms = runtime.sandboxClock.advanceBy(duration,
        body.mode === "hibernation" ? "hibernation" : "active_unattended");
      runtime.state.virtualOffsetHours = (virtual_ts_ms - runtime.virtualClock.nowMs()) / 3_600_000;
      return { virtual_ts_ms, virtual_offset_hours: runtime.state.virtualOffsetHours };
    },
    "sandbox.fork": (request) => {
      const body = bodyOf(request.body), forkId = String(body.fork_id ?? body.fork_label ?? `console-${Date.now()}`);
      const fork = runtime.soulArchiveManager.forkSandboxInstance(forkId, {
        ...(typeof body.target_dir === "string" ? { targetDir: body.target_dir } : {}),
        ...(typeof body.source_snapshot_id === "string" ? { snapshotId: body.source_snapshot_id } : {}) });
      runtime.state.sandboxForks.set(fork.target_instance, fork.storage);
      return { target_instance: fork.target_instance, soul_dir: fork.soulDirPath };
    },
    "sandbox.inject": async (request, context) => {
      const body = bodyOf(request.body), perception = bodyOf(body.perception ?? body);
      const text = String(perception.summary_text ?? perception.text ?? ""), now = runtime.sandboxClock.nowMs();
      const eventId = String(perception.event_id ?? `evt_sandbox_${now}_${runtime.state.telemetryFrames.length}`);
      const venue = (perception.venue_type ?? "private_1on1") as VenueType;
      const audience = (perception.audience_scope ?? "only_owner") as AudienceScope;
      const modality = (perception.modality ?? "text") as SensorModality;
      runtime.sandboxStorage.appendEvent({ event_id: eventId, wall_ts_ms: Date.now(), virtual_ts_ms: now,
        source_shell_id: String(perception.shell_id ?? "builtin.webchat.default"), principal_id: "sandbox:operator",
        principal_trust: audience === "only_owner" ? "owner_verified" : "stranger", venue_type: venue,
        audience_scope: audience, event_category: "perception_committed", modality, summary_text: text,
        payload_json: JSON.stringify(perception), state_rev_after: runtime.sandboxCoordinator.getSnapshot().state_rev,
        active_modules_mask: 31 });
      runtime.emitTelemetry("[EVENT]", { event_id: eventId, summary_text: text }, context.target_instance, now);
      return runtime.sandboxW1.runTurnAsync({ event_id: eventId,
        principal: audience === "only_owner" ? "owner_verified" : "stranger",
        venue_type: venue, audience_scope: audience, modality, summary_text: text });
    },
    "sandbox.scenarios.run": () => runScenarioPlaybook(GOLDEN_REGRESSION_SCENARIO_V1),
    "system.snapshots.rollback": async (request) => {
      const body = bodyOf(request.body);
      const safety = runtime.soulArchiveManager.createSnapshot(`pre-rollback-${Date.now()}`);
      const snapshotId = String(body.snapshot_id ?? safety.id);
      runtime.storage.close();
      const restored = await runtime.soulArchiveManager.rollbackToSnapshot(snapshotId,
        body.mode === "dream_bridge" || body.mode === "meta_reconciled" ? body.mode : "silent_hard",
        runtime.virtualClock.nowMs());
      runtime.replaceLiveStorage?.(restored);
      return { rolled_back_to: snapshotId, safety_snapshot: safety,
        pragma_status: restored.getTablePragmaStatus() };
    },
    "system.safetySb243": (request, context) => {
      const body = bodyOf(request.body), storage = selected(runtime, context.target_instance).storage;
      const incremented = request.method === "POST" && body.increment_crisis_referral === true
        ? storage.incrementSb243CrisisCount(String(body.year_month ?? new Date().toISOString().slice(0, 7)))
        : undefined;
      return { metrics: storage.getSb243Metrics(), pragma_status: storage.getTablePragmaStatus(), incremented };
    }
  } satisfies Partial<Record<AdminOperation, AdminRouteHandler>>;
}
