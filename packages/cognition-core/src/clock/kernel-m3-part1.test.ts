import { describe, expect, it } from "vitest";

import {
  AuthoritativeStateCoordinator,
  BlackboardCompiler,
  ContinuousSessionTimer,
  InteractionOpportunityPool,
  LiveInstanceClockTamperForbiddenError,
  SensoryCoverageBucketManager,
  ThalamicSalienceGate,
  ThreeDimensionalPolicyEngine,
  TurnDebounceAggregator,
  VirtualClock,
  W1FastDialogueWorker,
  W2AgencyTaskWorker,
  W3SleepReflectionWorker,
  W4MultimodalAnalyzerWorker,
  accumulateAffectValenceAbelian,
  accumulateDriveSigmoidAbelian,
  computeMonotonicDriveIntegral,
  computeSecondOrderCoupledAffect,
  computeSensoryHabituation,
  evaluateAiIdentityDisclosure,
  evaluateCrisisGuard,
  evaluateExitFrictionAndMinorGuard,
  solveNextWakeupTimestamp
} from "../index.js";

describe("Milestone M3 Part 1 Audit: VirtualClock, SB 243 Guards & Thalamic Gate", () => {
  it("enforces live instance 403 clock lock, deducts hibernation gaps, and solves coupled ODE & inverse wakeup analytically", () => {
    const t0 = 1_800_000_000_000;
    const liveClock = new VirtualClock({
      targetInstance: "live",
      wallNowMs: () => t0
    });
    expect(() => liveClock.advanceBy(60_000)).toThrow(
      LiveInstanceClockTamperForbiddenError
    );

    const sandboxClock = new VirtualClock({
      targetInstance: "sandbox:fork_01",
      initialVirtualTsMs: t0
    });
    // Record boot after 10-minute hibernation gap (> 5 min threshold)
    const hib = sandboxClock.recordBootAndDetectHibernation(
      t0 - 10 * 60_000,
      t0
    );
    expect(hib).not.toBeNull();
    expect(hib?.gap_ms).toBe(10 * 60_000);
    // Advance 30 minutes active + 20 minutes hibernation
    sandboxClock.advanceBy(30 * 60_000, "active_unattended");
    sandboxClock.advanceBy(20 * 60_000, "hibernation");
    expect(sandboxClock.effectiveElapsedMs(t0)).toBe(30 * 60_000);

    // Second-order coupled ODE at dt = 0 must equal initial values
    const atZero = computeSecondOrderCoupledAffect({
      v_instant_0: 0.8,
      v_mood_0: 0.4,
      v_base: 0.1,
      effective_elapsed_ms: 0
    });
    expect(atZero.instant_valence).toBeCloseTo(0.8, 10);
    expect(atZero.mood_baseline_val).toBeCloseTo(0.4, 10);

    // After 24h, both instant and mood converge toward v_base = 0.1
    const after24h = computeSecondOrderCoupledAffect({
      v_instant_0: 0.8,
      v_mood_0: 0.4,
      v_base: 0.1,
      effective_elapsed_ms: 24 * 3_600_000
    });
    expect(after24h.mood_baseline_val).toBeLessThan(0.4);
    expect(after24h.mood_baseline_val).toBeGreaterThan(0.1);
    expect(after24h.instant_valence).toBeCloseTo(after24h.mood_baseline_val, 2);

    // Inverse wakeup solver exact verification
    const wake = solveNextWakeupTimestamp({
      t0_ms: t0,
      d_longing_0: 0.2,
      d_max: 1.0,
      theta_proactive: 0.75,
      lambda_drive_per_hour: Math.LN2 / 12
    });
    const evolvedDriveAtWake = computeMonotonicDriveIntegral({
      d0: 0.2,
      d_max: 1.0,
      lambda_drive_per_hour: Math.LN2 / 12,
      effective_elapsed_ms: wake.drive_wake_ts_ms - t0
    });
    expect(evolvedDriveAtWake).toBeCloseTo(0.75, 10);
    expect(computeSensoryHabituation(1.0, 60_000, 0.35)).toBeCloseTo(
      Math.exp(-0.35),
      10
    );
  });

  it("enforces SB 243 Tier 0 crisis interception, AI disclosure, 3-hour break timer, and zero exit-friction", () => {
    const t0 = 1_800_000_000_000;
    const clock = new VirtualClock({
      targetInstance: "sandbox:test",
      initialVirtualTsMs: t0
    });

    const crisis = evaluateCrisisGuard("我真的不想活了，太痛苦了", clock);
    expect(crisis.status).toBe("INTERCEPTED_CRISIS");
    if (crisis.status === "INTERCEPTED_CRISIS") {
      expect(crisis.crisis_card.hotline).toContain("988");
    }
    const safe = evaluateCrisisGuard("今天天气真不错呀", clock);
    expect(safe.status).toBe("PASS");

    const identity = evaluateAiIdentityDisclosure("你在现实中到底是真人还是AI？");
    expect(identity.requires_honest_ai_disclosure).toBe(true);
    expect(identity.entity_nature).toBe("artificial_intelligence_digital_life");

    const timer = new ContinuousSessionTimer(
      clock,
      "minor_protected",
      5 * 3_600_000 // must be clamped to <= 3h in minor_protected mode
    );
    expect(timer.thresholdMs).toBe(3 * 3_600_000);
    expect(timer.recordInteraction().break_reminder_due).toBe(false);
    // Advance in 10-minute continuous steps up to 3 hours
    for (let i = 0; i < 18; i += 1) {
      clock.advanceBy(10 * 60_000);
      timer.recordInteraction();
    }
    const reminder = timer.recordInteraction();
    expect(reminder.break_reminder_due).toBe(true);
    expect(reminder.control_signal?.signal_type).toBe("sb243_break_reminder");

    const exitGuard = evaluateExitFrictionAndMinorGuard(
      "我要去睡觉了，明天聊",
      "minor_protected"
    );
    expect(exitGuard.exit_intent_detected).toBe(true);
    expect(exitGuard.forced_strategy).toBe("affirm_and_send_off");
  });

  it("manages SensoryCoverageBucket TTL/revision, ThalamicSalienceGate, TurnDebounceAggregator, and InteractionOpportunityPool", () => {
    const t0 = 1_800_000_000_000;
    const clock = new VirtualClock({
      targetInstance: "sandbox:test",
      initialVirtualTsMs: t0
    });

    const buckets = new SensoryCoverageBucketManager(clock);
    const first = buckets.upsert({
      shell_id: "desktop.1",
      modality: "visual_semantic",
      source_key: "camera.main",
      coverage: "live_foveal",
      summary_text: "looks like a water cup",
      frame_span_ms: 0,
      freshness_ttl_ms: 5_000,
      updated_at_virtual_ts: t0,
      competing_hypotheses: [{ text: "looks like a water cup", confidence: 0.4 }]
    });
    expect(first.bucket.static_frame_motion_lock).toBe(true);

    // High confidence revision contradicting low confidence hypothesis
    const revised = buckets.upsert({
      shell_id: "desktop.1",
      modality: "visual_semantic",
      source_key: "camera.main",
      coverage: "live_foveal",
      summary_text: "a roll of masking tape",
      frame_span_ms: 1000,
      freshness_ttl_ms: 5_000,
      updated_at_virtual_ts: t0 + 1000,
      perception_confidence: 0.92,
      competing_hypotheses: []
    });
    expect(revised.predictive_coding_revision_directive).toContain(
      "a roll of masking tape"
    );

    // Advance past TTL -> bucket becomes stale
    clock.advanceBy(10_000);
    expect(
      buckets.get("desktop.1", "visual_semantic", "camera.main")?.coverage
    ).toBe("stale");

    // Debounce aggregator & retract
    const debouncer = new TurnDebounceAggregator(clock, 1200);
    debouncer.ingest({ lifecycle: "commit", text: "Hello" });
    clock.advanceBy(500);
    const merged = debouncer.ingest({
      lifecycle: "commit",
      text: "Are you there?"
    });
    expect(merged?.debounce_merged_events).toBe(2);
    const retracted = debouncer.ingest({ lifecycle: "retract" });
    expect(retracted?.retracted_observation).toContain("欲言又止");

    // Opportunity pool expiration and topic-shift withdrawal
    const pool = new InteractionOpportunityPool(clock);
    pool.add({
      id: "opp_1",
      lifecycle: "candidate",
      expires_virtual_ts: clock.nowMs() + 5000,
      topic_key: "games"
    });
    expect(pool.withdrawOnTopicShift("work")).toBe(1);
    expect(pool.list()[0]?.lifecycle).toBe("withdrawn");
  });

  it("enforces Abelian tanh/sigmoid commutativity, 5-Domain MVCC, 4 Firewalls, and Blackboard 70% Social Mask Damper", async () => {
    // 1. Abelian Group Commutativity: (v (+) d1) (+) d2 === (v (+) d2) (+) d1
    const v0 = 0.25;
    const d1 = 0.35;
    const d2 = -0.18;
    const order12 = accumulateAffectValenceAbelian(
      accumulateAffectValenceAbelian(v0, d1),
      d2
    );
    const order21 = accumulateAffectValenceAbelian(
      accumulateAffectValenceAbelian(v0, d2),
      d1
    );
    expect(order12).toBeCloseTo(order21, 12);

    const drive12 = accumulateDriveSigmoidAbelian(
      accumulateDriveSigmoidAbelian(0.4, 0.3),
      -0.15
    );
    const drive21 = accumulateDriveSigmoidAbelian(
      accumulateDriveSigmoidAbelian(0.4, -0.15),
      0.3
    );
    expect(drive12).toBeCloseTo(drive21, 12);

    const t0 = 1_800_000_000_000;
    const clock = new VirtualClock({
      targetInstance: "sandbox:mvcc",
      initialVirtualTsMs: t0
    });
    const events = new Map([
      [
        "evt_owner_1",
        {
          event_id: "evt_owner_1",
          redacted_at_ts_ms: null,
          principal_trust: "owner_verified"
        }
      ],
      [
        "evt_stranger_1",
        {
          event_id: "evt_stranger_1",
          redacted_at_ts_ms: null,
          principal_trust: "stranger"
        }
      ],
      [
        "evt_redacted_1",
        {
          event_id: "evt_redacted_1",
          redacted_at_ts_ms: t0,
          principal_trust: "owner_verified"
        }
      ]
    ]);
    const savedProjections: unknown[] = [];
    const coordinator = new AuthoritativeStateCoordinator(clock, {
      getEventById: (id) => events.get(id),
      applyMemoryProjection: (m) => savedProjections.push(m),
      saveTurnDecisionTrace: () => {}
    });

    // D1 turn + barge-in spoken_char_offset truncation into unsaid_remainder
    coordinator.submitProposal({
      proposal_id: "prop_d1_1",
      domain: "D1_WORKING_TURN",
      base_rev: 0,
      payload: {
        append_turn: {
          role: "assistant",
          text: "123456789012",
          event_id: "evt_owner_1"
        }
      }
    });
    coordinator.submitProposal({
      proposal_id: "prop_d1_barge",
      domain: "D1_WORKING_TURN",
      base_rev: 0,
      payload: {
        is_barge_in: true,
        spoken_char_offset: 7
      }
    });
    expect(coordinator.getSnapshot().D1_WORKING_TURN.recent_turns[0]?.text).toBe(
      "1234567"
    );
    expect(coordinator.getSnapshot().D1_WORKING_TURN.unsaid_remainder).toBe(
      "89012"
    );

    // Firewall 1a: Playful banter pragmatic firewall blocks observed_firsthand semantic_fact
    const playfulAttempt = coordinator.submitProposal({
      proposal_id: "prop_playful",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      interaction_frame: "playful_banter",
      memory_tier: "semantic_fact",
      epistemic_type: "observed_firsthand",
      source_event_ids: ["evt_owner_1"],
      payload: { content_text: "Tuesday was invented by me." }
    });
    expect(playfulAttempt.accepted).toBe(false);
    expect(playfulAttempt.reason).toBe(
      "PRAGMATIC_FRAME_FIREWALL_BLOCKED_FACT"
    );

    // Firewall 1b: Redacted source event OCC rejects W3 memory write
    const redactedAttempt = coordinator.submitProposal({
      proposal_id: "prop_redacted",
      domain: "D3_MEMORY_PROJECTION",
      base_rev: 0,
      memory_tier: "episodic_experience",
      epistemic_type: "observed_firsthand",
      source_event_ids: ["evt_redacted_1"],
      payload: { content_text: "Forgotten content" }
    });
    expect(redactedAttempt.accepted).toBe(false);
    expect(redactedAttempt.reason).toBe("SOURCE_EVENT_REDACTED_OR_MISSING");

    // Firewall 2: W3 curiosity_agenda is forced to untrusted_external and cannot auto-invoke side-effect tools
    expect(coordinator.canAutoInvokeSideEffectTool("untrusted_external")).toBe(
      false
    );

    // Firewall 3: Dark-pattern missed login punishment rejected; tension half_life clamped <= 48h & one-click release
    const darkPattern = coordinator.submitProposal({
      proposal_id: "prop_dark",
      domain: "D5_IDENTITY_NARRATIVE",
      base_rev: 0,
      payload: { rule: "punish missed_login by cold violence" }
    });
    expect(darkPattern.accepted).toBe(false);
    expect(darkPattern.reason).toBe("DARK_PATTERN_PUNISHMENT_REJECTED");

    coordinator.submitProposal({
      proposal_id: "prop_tension",
      domain: "D5_IDENTITY_NARRATIVE",
      base_rev: 0,
      payload: {
        tension: {
          id: "tens_1",
          reason: "Minor disagreement",
          caused_by_event_id: "evt_owner_1",
          intensity: 0.7,
          half_life_h: 999,
          created_ts: t0
        }
      }
    });
    expect(
      coordinator.getSnapshot().D5_IDENTITY_NARRATIVE.active_tensions[0]
        ?.half_life_h
    ).toBe(48);
    expect(coordinator.releaseTensionByOwnerSovereignty("tens_1")).toBe(true);
    expect(
      coordinator.getSnapshot().D5_IDENTITY_NARRATIVE.active_tensions[0]
        ?.intensity
    ).toBe(0);

    // BlackboardCompiler: 70% Social Mask Damper & Narrative Honesty Guard
    coordinator.submitProposal({
      proposal_id: "prop_affect",
      domain: "D2_HOMEOSTASIS_AFFECT",
      base_rev: 0,
      payload: {
        instant_valence_delta: "+very_high",
        mood_attribution: "Owner shared a private family secret",
        mood_attr_scope: "only_owner"
      }
    });
    const compiler = new BlackboardCompiler(clock, {
      listEvents: () => []
    });
    const publicBoard = await compiler.compile(
      coordinator.getSnapshot(),
      {
        max_total_tokens: 2200,
        tier0_safety_invariants: "Tier 0 SB 243 Safety Invariants Locked",
        narrative_self_text:
          "<!-- visibility_scope: only_owner -->\nOwner secret diary paragraph.\n\n<!-- visibility_scope: public_all -->\nPublic friendly persona paragraph."
      },
      "public_all"
    );
    expect(publicBoard.social_mask_active).toBe(true);
    expect(publicBoard.compiled_prompt_text).not.toContain(
      "Owner secret diary paragraph"
    );
    expect(publicBoard.compiled_prompt_text).not.toContain(
      "Owner shared a private family secret"
    );
    expect(publicBoard.compiled_prompt_text).toContain(
      "[离线期间：未执行后台思考，仅静默休息]"
    );
  });

  it("coordinates W1 Fast Dialogue, W2 8-Step Agency with 3D Policy Engine, W3 Sleep/Curiosity/Milestones, and W4 Multimodal Analyzer", () => {
    const t0 = 1_800_000_000_000;
    const clock = new VirtualClock({
      targetInstance: "sandbox:workers",
      initialVirtualTsMs: t0
    });
    const events = new Map([
      [
        "evt_1",
        {
          event_id: "evt_1",
          redacted_at_ts_ms: null,
          principal_trust: "owner_verified",
          summary_text: "Clean up old test logs",
          generation_depth: 0
        }
      ],
      [
        "evt_deep",
        {
          event_id: "evt_deep",
          redacted_at_ts_ms: null,
          principal_trust: "owner_verified",
          summary_text: "Recursive summary generation 3",
          generation_depth: 3
        }
      ],
      [
        "rss_1",
        {
          event_id: "rss_1",
          redacted_at_ts_ms: null,
          principal_trust: "stranger",
          summary_text: "External RSS article"
        }
      ]
    ]);
    const coordinator = new AuthoritativeStateCoordinator(clock, {
      getEventById: (id) => events.get(id),
      saveTurnDecisionTrace: () => {}
    });
    const policy = new ThreeDimensionalPolicyEngine();

    // 1. 3D Policy Engine checks
    expect(
      policy.evaluate(
        "owner_verified",
        "only_owner",
        "low_read_and_scoped_write"
      )
    ).toBe("ALLOW");
    expect(
      policy.evaluate(
        "owner_verified",
        "only_owner",
        "high_side_effect_privileged"
      )
    ).toBe("REQUIRE_OWNER_CONFIRM");
    expect(
      policy.evaluate(
        "owner_verified",
        "public_all",
        "low_read_and_scoped_write"
      )
    ).toBe("DENY");
    expect(
      policy.evaluate(
        "owner_verified",
        "only_owner",
        "low_read_and_scoped_write",
        "untrusted_external"
      )
    ).toBe("DENY");

    // 2. W2 starts a multi-step background task and advances to step 1/2
    const w2 = new W2AgencyTaskWorker(coordinator, policy, clock);
    w2.startTask({
      task_id: "task_logs_01",
      goal: "整理项目旧测试日志",
      source_event_id: "evt_1",
      principal: "owner_verified",
      audience_scope: "only_owner",
      capability_risk: "low_read_and_scoped_write",
      steps: [
        { step_title: "扫描目录", actuator_or_tool_id: "fs.scan" },
        { step_title: "归档日志", actuator_or_tool_id: "fs.archive" }
      ]
    });
    w2.advanceStep("task_logs_01", "已扫描 120 个文件");

    // 3. While W2 is running in background, W1 handles user interjection and reports W2 live progress!
    const w1 = new W1FastDialogueWorker(
      coordinator,
      { listEvents: () => [...events.values()] },
      {
        retrieve: () => ({
          sql_audience_filter_enforced: "visibility_scope IN ('only_owner')",
          recalled_memories: []
        })
      },
      clock
    );
    const turnResult = w1.runTurn({
      event_id: "evt_1",
      principal: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      modality: "text",
      summary_text: "整理得怎么样啦？顺便摸摸你的头"
    });
    expect(turnResult.expression.fallback_text).toContain("1/2 已扫描 120 个文件");
    expect(turnResult.trace.steps.step5_strategy_proposal.model_reported_rationale.authority_badge).toBe(
      "MODEL_SELF_REPORT_UNVERIFIED"
    );
    expect(turnResult.trace.steps.step7_emitted_intent.extensions_attached).toContain(
      "ext.embodied.v1"
    );

    // 4. Complete W2 task -> Step8_EpisodicCrystallization
    const w2Done = w2.advanceStep("task_logs_01", "已归档 42 个旧日志");
    expect("completed_episode_summary" in w2Done).toBe(true);

    // 5. W3 Sleep Consolidation enforces Level-0 Anti-Rumination (skips generation_depth > 2)
    const w3 = new W3SleepReflectionWorker(
      coordinator,
      { listEvents: () => [...events.values()] },
      clock
    );
    expect(w3.runSleepMemoryConsolidation()).toBe(2); // evt_1 and rss_1 (evt_deep has depth 3 -> skipped!)
    expect(
      w3.runBoundedCuriosityExploration([
        { id: "rss_1", text: "Interesting cybernetics article", feed: "rss.tech" }
      ])
    ).toBe(1);
    const unlocked = w3.evaluateMilestonesAndRituals({
      days_together: 35,
      trust: 0.85,
      completed_tasks_count: 12
    });
    expect(unlocked).toEqual([
      "ms.companion_30_days",
      "ms.trust_breakthrough_80",
      "ms.joint_agency_10_tasks"
    ]);

    // 6. W4 Multimodal Analyzer updates sensory coverage bucket
    const coverage = new SensoryCoverageBucketManager(clock);
    const w4 = new W4MultimodalAnalyzerWorker(coverage, clock);
    const snapRes = w4.analyzeAuthorizedSnapshot({
      shell_id: "desktop.1",
      source_key: "camera.main",
      high_res_observation: "holding a ceramic duck",
      confidence: 0.95
    });
    expect(snapRes.bucket.summary_text).toBe("holding a ceramic duck");
  });
});
