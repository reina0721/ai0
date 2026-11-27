import { describe, expect, it } from "vitest";
import { ExtensionCoreHost } from "@ai0/extension-core";
import {
  accumulateAffectValenceAbelian,
  accumulateDriveSigmoidAbelian,
  AuthoritativeStateCoordinator,
  BlackboardCompiler,
  cognitionContextContributorFacet,
  cognitionStateDynamicsFacet,
  computeSensoryHabituation,
  ContinuousSessionTimer,
  ContinuousStateMetaEngine,
  evaluateAiIdentityDisclosure,
  evaluateCrisisGuard,
  evaluateExitFrictionAndMinorGuard,
  LiveInstanceClockTamperForbiddenError,
  MetabolicRegionRouter,
  ThreeDimensionalPolicyEngine,
  VirtualClock,
  W2AgencyTaskWorker,
  W3SleepReflectionWorker,
  type ReadableCognitiveSnapshot,
  type ReadOnlyCognitiveSnapshot
} from "../index.js";

describe("@ai0/cognition-core universal cognitive sub-core", () => {
  it("restores saved continuous states only for explicitly mounted descriptors and clears them on unload", () => {
    const host = new ExtensionCoreHost();
    const clock = new VirtualClock({ targetInstance: "sandbox:import", wallNowMs: () => 1000 });
    const storage = { getEventById: () => undefined, saveTurnDecisionTrace: () => {} };
    const original = new AuthoritativeStateCoordinator(clock, storage).getSnapshot();
    const saved: ReadOnlyCognitiveSnapshot = {
      ...original,
      D2_CONTINUOUS_STATES: {
        values: { focus_load: 0.7, unregistered: 0.9 },
        attributions: { focus_load: { text: "saved note", audienceScope: "only_owner", sourceEventIds: [] } }
      }
    };
    const authority = new AuthoritativeStateCoordinator(clock, {
      ...storage,
      loadCoordinatorState: () => saved
    }, host);
    expect(authority.getSnapshot().D2_CONTINUOUS_STATES).toEqual({ values: {}, attributions: {} });

    host.mountPackage({
      manifest: {
        manifest_version: "2.0.0",
        extension_id: "example.dynamics",
        display_name: "Dynamics",
        author: "example",
        version: "1",
        carrier_kind: "native_code_plugin",
        facets: [cognitionStateDynamicsFacet.id],
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "only_owner",
          network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(cognitionStateDynamicsFacet, {
          descriptors: [
            { id: "focus_load", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 100, wakeupThresholds: [] },
            { id: "fresh_metric", topology: "unipolar_sigmoid", baseline: 0.2, halfLifeMs: 100, wakeupThresholds: [] }
          ]
        });
      }
    });
    const mounted = authority.getSnapshot().D2_CONTINUOUS_STATES;
    expect(mounted.values.focus_load).toBeCloseTo(0.7);
    expect(mounted.values.fresh_metric).toBeCloseTo(0.2);
    expect(mounted.values.unregistered).toBeUndefined();
    expect(mounted.attributions.focus_load).toEqual({ text: "saved note", audienceScope: "only_owner", sourceEventIds: [] });
    host.unmountPackage("example.dynamics");
    expect(authority.getSnapshot().D2_CONTINUOUS_STATES).toEqual({ values: {}, attributions: {} });
  });

  it("enforces VirtualClock live tamper lock, hibernation deduction, and Tier-0 safety guards", () => {
    const t0 = 1_800_000_000_000;
    const liveClock = new VirtualClock({ targetInstance: "live", wallNowMs: () => t0 });
    expect(() => liveClock.advanceBy(60_000)).toThrow(LiveInstanceClockTamperForbiddenError);

    const sandboxClock = new VirtualClock({ targetInstance: "sandbox:fork_01", initialVirtualTsMs: t0 });
    const hib = sandboxClock.recordBootAndDetectHibernation(t0 - 10 * 60_000, t0);
    expect(hib?.gap_ms).toBe(10 * 60_000);
    sandboxClock.advanceBy(30 * 60_000, "active_unattended");
    sandboxClock.advanceBy(20 * 60_000, "hibernation");
    expect(sandboxClock.effectiveElapsedMs(t0)).toBe(30 * 60_000);
    expect(computeSensoryHabituation(1.0, 60_000, 0.35)).toBeCloseTo(Math.exp(-0.35), 10);

    const neutral = new ContinuousStateMetaEngine();
    expect(neutral.evolveTo(1000)).toEqual({});
    expect(neutral.solveNextWakeupMs(1000)).toBeNull();

    const crisis = evaluateCrisisGuard("我真的不想活了，太痛苦了", sandboxClock);
    expect(crisis.status).toBe("INTERCEPTED_CRISIS");
    expect(evaluateCrisisGuard("今天天气真不错呀", sandboxClock).status).toBe("PASS");

    const identity = evaluateAiIdentityDisclosure("你在现实中到底是真人还是AI？");
    expect(identity.requires_honest_ai_disclosure).toBe(true);

    const timer = new ContinuousSessionTimer(sandboxClock, "minor_protected", 5 * 3_600_000);
    expect(timer.thresholdMs).toBe(3 * 3_600_000);
    expect(timer.recordInteraction().break_reminder_due).toBe(false);
    for (let i = 0; i < 18; i += 1) {
      sandboxClock.advanceBy(10 * 60_000);
      if (i < 17) expect(timer.recordInteraction().break_reminder_due).toBe(false);
    }
    expect(timer.recordInteraction().break_reminder_due).toBe(true);
    expect(evaluateExitFrictionAndMinorGuard("我要去睡觉了，明天聊", "minor_protected").forced_strategy).toBe("affirm_and_send_off");
  });

  it("enforces Abelian commutativity, 5-Domain MVCC, epistemic/pragmatic/taint firewalls,CommonGround, and Blackboard audience damping", async () => {
    expect(accumulateAffectValenceAbelian(accumulateAffectValenceAbelian(0.25, 0.35), -0.18)).toBeCloseTo(
      accumulateAffectValenceAbelian(accumulateAffectValenceAbelian(0.25, -0.18), 0.35),
      12
    );
    expect(accumulateDriveSigmoidAbelian(accumulateDriveSigmoidAbelian(0.4, 0.3), -0.15)).toBeCloseTo(
      accumulateDriveSigmoidAbelian(accumulateDriveSigmoidAbelian(0.4, -0.15), 0.3),
      12
    );

    const t0 = 1_800_000_000_000;
    const clock = new VirtualClock({ targetInstance: "sandbox:mvcc", initialVirtualTsMs: t0 });
    const events = new Map([
      ["evt_owner_1", { event_id: "evt_owner_1", redacted_at_ts_ms: null, principal_trust: "owner_verified", summary_text: "Clean up logs", generation_depth: 0 }],
      ["evt_deep", { event_id: "evt_deep", redacted_at_ts_ms: null, principal_trust: "owner_verified", summary_text: "Depth 3", generation_depth: 3 }],
      ["evt_redacted_1", { event_id: "evt_redacted_1", redacted_at_ts_ms: t0, principal_trust: "owner_verified" }]
    ]);
    const host = new ExtensionCoreHost();
    host.mountPackage({
      manifest: {
        manifest_version: "2.0.0",
        extension_id: "test.valence",
        display_name: "Valence",
        author: "test",
        version: "1",
        carrier_kind: "native_code_plugin",
        facets: [cognitionStateDynamicsFacet.id],
        permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false }
      },
      activate(scope) {
        scope.contributeFacet(cognitionStateDynamicsFacet, {
          descriptors: [{ id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 1_800_000, wakeupThresholds: [] }]
        });
      }
    });
    const savedProjections: Array<Record<string, unknown>> = [];
    const coordinator = new AuthoritativeStateCoordinator(clock, {
      getEventById: (id) => events.get(id),
      applyMemoryProjection: (m) => savedProjections.push(m),
      saveTurnDecisionTrace: () => {}
    }, host);

    coordinator.submitProposal({
      proposal_id: "prop_d1_1",
      domain: "D1_WORKING_TURN",
      base_rev: 0,
      payload: { append_turn: { role: "assistant", text: "12🎬456789012", event_id: "evt_owner_1" } }
    });
    coordinator.submitProposal({
      proposal_id: "prop_d1_barge",
      domain: "D1_WORKING_TURN",
      base_rev: 1,
      payload: { is_barge_in: true, spoken_char_offset: 7 }
    });
    expect(coordinator.getSnapshot().D1_WORKING_TURN.recent_turns[0]?.text).toBe("12🎬4567");
    expect(coordinator.getSnapshot().D1_WORKING_TURN.unsaid_remainder).toBe("89012");

    expect(coordinator.submitProposal({
      proposal_id: "prop_playful",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      interaction_frame: "playful_banter",
      memory_tier: "semantic_fact",
      epistemic_type: "observed_firsthand",
      source_event_ids: ["evt_owner_1"],
      payload: { content_text: "Playful joke" }
    })).toMatchObject({ accepted: false, reason: "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT" });

    expect(coordinator.submitProposal({
      proposal_id: "prop_redacted",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      memory_tier: "episodic_experience",
      epistemic_type: "observed_firsthand",
      source_event_ids: ["evt_redacted_1"],
      payload: { content_text: "Forgotten content" }
    })).toMatchObject({ accepted: false, reason: "SOURCE_EVENT_REDACTED_OR_MISSING" });

    expect(coordinator.canAutoInvokeSideEffectTool("untrusted_external")).toBe(false);

    // CommonGround state machine: proposed_presented -> mutually_grounded only on owner adoption
    coordinator.submitProposal({
      proposal_id: "prop_cg_1",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      memory_tier: "relational_tacit",
      source_event_ids: ["evt_owner_1"],
      payload: { content_text: "Option A presented" }
    });
    expect(savedProjections[0]?.grounding_status).toBe("proposed_presented");
    coordinator.submitProposal({
      proposal_id: "prop_cg_2",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 1,
      memory_tier: "relational_tacit",
      source_event_ids: ["evt_owner_1"],
      payload: { content_text: "Option A adopted", owner_adoption_evidence_event_id: "evt_owner_1" }
    });
    expect(savedProjections[1]?.grounding_status).toBe("mutually_grounded");

    coordinator.submitProposal({
      proposal_id: "prop_affect",
      domain: "D2_CONTINUOUS_STATES",
      base_rev: 0,
      payload: {
        impulses: { instant_valence: 0.45 },
        attributions: { instant_valence: { text: "Owner shared a private secret", audienceScope: "only_owner", sourceEventIds: [] } }
      }
    });
    const compiler = new BlackboardCompiler(clock, { listEvents: () => [] });
    const publicBoard = await compiler.compile(
      coordinator.getSnapshot(),
      {
        max_total_tokens: 2200,
        tier0_safety_invariants: "Safety Locked",
        narrative_self_text: "<!-- visibility_scope: only_owner -->\nSecret note.\n\n<!-- visibility_scope: public_all -->\nPublic bio."
      },
      "public_all"
    );
    expect(publicBoard.social_mask_active).toBe(true);
    expect(publicBoard.compiled_prompt_text).not.toContain("Secret note");
    expect(publicBoard.compiled_prompt_text).not.toContain("Owner shared a private secret");

    // Policy gate + W2 Agency + W3 Sleep consolidation + MetabolicRegionRouter
    const policy = new ThreeDimensionalPolicyEngine();
    expect(policy.evaluate("owner_verified", "only_owner", "low_read_and_scoped_write")).toBe("ALLOW");
    expect(policy.evaluate("owner_verified", "only_owner", "high_side_effect_privileged")).toBe("REQUIRE_OWNER_CONFIRM");
    expect(policy.evaluate("owner_verified", "only_owner", "low_read_and_scoped_write", "untrusted_external")).toBe("DENY");

    const w2 = new W2AgencyTaskWorker(coordinator, policy, clock, host);
    w2.startTask({
      task_id: "task_1",
      goal: "Scan logs",
      source_event_id: "evt_owner_1",
      principal: "owner_verified",
      audience_scope: "only_owner",
      capability_risk: "low_read_and_scoped_write",
      steps: [{ step_title: "Scan" }, { step_title: "Archive" }]
    });
    w2.advanceStep("task_1", "Scanned 120 files");
    host.mountPackage({
      manifest: {
        manifest_version: "2.0.0",
        extension_id: "test.planning",
        display_name: "Planning",
        version: "1",
        author: "test",
        carrier_kind: "native_code_plugin",
        facets: [cognitionContextContributorFacet.id],
        permissions: { read_blackboard_domains: ["D4_COMMITMENTS_TASKS"], propose_mutation_domains: [], max_audience_scope: "only_owner", network_access: false }
      },
      activate(scope) {
        scope.contributeFacet(cognitionContextContributorFacet, {
          contributeToBlackboard(snapshot: ReadableCognitiveSnapshot) {
            const task = snapshot.D4_COMMITMENTS_TASKS?.active_tasks.task_1;
            return task ? { slot_id: "progress", text: `Current step: ${task.current_step}` } : null;
          }
        });
      }
    });
    expect(await w2.collectPlanningContext("task_1")).toEqual([{ slot_id: "progress", text: "Current step: 1" }]);
    expect("completed_episode_summary" in w2.advanceStep("task_1", "Archived")).toBe(true);

    const w3 = new W3SleepReflectionWorker(coordinator, { listEvents: () => [...events.values()] }, clock);
    expect(w3.runSleepMemoryConsolidation()).toBe(1);

    const router = new MetabolicRegionRouter({
      W1_fast_dialogue: { primary_model_id: "sonnet", fallback_model_id: "haiku" },
      W2_agency_planner: { primary_model_id: "opus", fallback_model_id: "sonnet" },
      W3_sleep_curiosity: { primary_model_id: "pro", fallback_model_id: "flash" },
      W4_multimodal: { primary_model_id: "vision-pro", fallback_model_id: "vision-flash" },
      L0_crisis_classifier: { primary_model_id: "l0-guard", fallback_model_id: "l0-guard" }
    });
    expect(router.routeForRegion("W1_fast_dialogue", 0.04, 0.8).status).toBe("METABOLIC_SLEEP_FUSE");
    expect(router.routeForRegion("L0_crisis_classifier", 0.04, 0.8).status).toBe("READY");
    expect(router.routeForRegion("W1_fast_dialogue", 0.18, 0.8)).toMatchObject({ drowsy_downgraded: true, selected_model_id: "haiku" });
  });
});
