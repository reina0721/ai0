import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CoordinatorStorageMutator,
  HONEST_FORGETFULNESS_DIRECTIVE,
  HYPOTHESIS_PROMPT_PREFIX,
  HardForgetEngine,
  HybridMemoryRetriever,
  SoulArchiveManager,
  TABOO_AVOIDANCE_DIRECTIVE,
  executeHardForget,
  executeTopicSeal,
  extractGistCardsBeforeUnmount,
  initializeSoulDirectory,
  previewHardForgetRadius,
  readSoulArchiveConfig
} from "./index.js";

const tempDirs: string[] = [];

function createTestSoulArchive() {
  const dir = mkdtempSync(join(tmpdir(), "ai0-m2-audit-"));
  tempDirs.push(dir);
  const soulPath = join(dir, "audit.soul");
  const layout = initializeSoulDirectory(soulPath, {
    createdAt: "2026-11-22T00:00:00.000Z"
  });
  const storage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);
  return { dir, soulPath, layout, storage };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Milestone M2 Quality Audit: HybridMemoryRetriever, HardForgetEngine & SoulArchiveManager", () => {
  it("enforces SQL-level Audience Guard zero-leakage, Ebbinghaus decay, cooldown, hypothesis prefix, and calibrated ignorance", () => {
    const { storage } = createTestSoulArchive();
    try {
      const baseTs = 1_800_000_000_000;
      storage.appendEvent({
        event_id: "evt_sec_1",
        wall_ts_ms: baseTs,
        virtual_ts_ms: baseTs,
        source_channel_id: "builtin.webchat",
        principal_id: "owner",
        principal_trust: "owner_verified",
        venue_type: "private_1on1",
        audience_scope: "only_owner",
        event_category: "perception_committed",
        modality: "text",
        summary_text: "I am secretly moving to Seattle next month.",
        payload_json: "{}",
        state_rev_after: 1,
        active_modules_mask: 1
      });

      storage.insertMemoryWithLineage(
        {
          memory_id: "mem_secret_seattle",
          memory_tier: "episodic_experience",
          epistemic_type: "observed_firsthand",
          attributed_principal: "owner",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          content_text: "Owner is secretly moving to Seattle next month.",
          emotional_valence: 0.6,
          base_importance: 0.9,
          stability_half_life: 168,
          recall_count: 2,
          created_virtual_ts: baseTs,
          last_recalled_ts: baseTs,
          valid_from_virtual_ts: baseTs,
          created_at_rev: 1
        },
        [{ parent_type: "event", parent_id: "evt_sec_1" }]
      );

      storage.insertMemoryWithLineage(
        {
          memory_id: "mem_public_hobby",
          memory_tier: "semantic_fact",
          epistemic_type: "inferred_hypothesis",
          attributed_principal: "owner",
          visibility_scope: "public_all",
          taint_level: "trusted_owner",
          content_text: "Owner seems to enjoy rhythm games and Seattle coffee.",
          emotional_valence: 0.2,
          base_importance: 0.7,
          stability_half_life: 168,
          recall_count: 0,
          created_virtual_ts: baseTs,
          last_recalled_ts: baseTs,
          valid_from_virtual_ts: baseTs,
          expires_virtual_ts: baseTs + 48 * 3_600_000,
          created_at_rev: 1
        },
        [{ parent_type: "event", parent_id: "evt_sec_1" }]
      );

      const retriever = new HybridMemoryRetriever(storage.asReadOnlyView());

      // 1. Public livestream query: must NEVER return only_owner memory
      const publicResult = retriever.retrieve({
        query_text: "moving to Seattle next month",
        audience_scope: "public_all",
        principal_trust: "stranger",
        current_virtual_ts: baseTs + 3_600_000
      });
      expect(publicResult.sql_audience_filter_enforced).toContain(
        "visibility_scope = 'public_all'"
      );
      expect(
        publicResult.recalled_memories.some(
          (m) => m.memory_id === "mem_secret_seattle"
        )
      ).toBe(false);
      expect(publicResult.recalled_memories[0]?.memory_id).toBe(
        "mem_public_hobby"
      );
      expect(publicResult.recalled_memories[0]?.formatted_prompt_text).toContain(
        HYPOTHESIS_PROMPT_PREFIX
      );

      // 2. Owner private query: can recall only_owner memory, and verify Ebbinghaus decay + cooldown
      const ownerFresh = retriever.retrieve({
        query_text: "moving to Seattle next month",
        audience_scope: "only_owner",
        principal_trust: "owner_verified",
        current_virtual_ts: baseTs + 2 * 3_600_000
      });
      const seattleFresh = ownerFresh.recalled_memories.find(
        (m) => m.memory_id === "mem_secret_seattle"
      );
      expect(seattleFresh).toBeDefined();

      const ownerWithCooldown = retriever.retrieve({
        query_text: "moving to Seattle next month",
        audience_scope: "only_owner",
        principal_trust: "owner_verified",
        current_virtual_ts: baseTs + 2 * 3_600_000,
        recentlyRecalledIds: ["mem_secret_seattle"]
      });
      const seattleCooled = ownerWithCooldown.recalled_memories.find(
        (m) => m.memory_id === "mem_secret_seattle"
      );
      expect(seattleCooled!.score).toBeLessThan(seattleFresh!.score);

      // 3. Calibrated ignorance when theta_confident is high
      const strictRetriever = new HybridMemoryRetriever(
        storage.asReadOnlyView(),
        { theta_confident: 0.999 }
      );
      const lowConfidence = strictRetriever.retrieve({
        query_text: "completely unrelated quantum physics topic",
        audience_scope: "public_all",
        principal_trust: "stranger",
        current_virtual_ts: baseTs + 100 * 3_600_000
      });
      expect(lowConfidence.calibrated_ignorance_triggered).toBe(true);
      expect(lowConfidence.honest_forgetfulness_directive).toBe(
        HONEST_FORGETFULNESS_DIRECTIVE
      );
    } finally {
      storage.close();
    }
  });

  it("supports Built-in Hybrid RAG (Dense + FTS5 BM25 + Reranker) and extractGistCardsBeforeUnmount", () => {
    const { storage } = createTestSoulArchive();
    try {
      const now = 1_800_000_000_000;
      storage.insertKnowledgeChunk({
        chunk_id: "chk_anime_01",
        collection_id: "kb.anime.lore",
        document_name: "world_guide.md",
        chunk_index: 0,
        content_text:
          "The Astral Lighthouse of Astral Harbor guides cyber-life travelers home during winter storms.",
        created_at_ts_ms: now
      });
      storage.insertKnowledgeChunk({
        chunk_id: "chk_anime_02",
        collection_id: "kb.anime.lore",
        document_name: "world_guide.md",
        chunk_index: 1,
        content_text:
          "Unrelated cooking recipe for strawberry cake in the town bakery.",
        created_at_ts_ms: now
      });
      storage.incrementKnowledgeCitation("chk_anime_01", now + 1000);

      const retriever = new HybridMemoryRetriever(storage);
      const slices = retriever.retrieveHybridKnowledgeRag(
        "Astral Harbor Astral Lighthouse",
        {
          collection_id: "kb.anime.lore",
          reranker: (_q, items) => items
        }
      );
      expect(slices.length).toBeGreaterThan(0);
      expect(slices[0]?.chunk_id).toBe("chk_anime_01");
      expect(slices[0]?.taint_level).toBe("untrusted_external");

      const gists = extractGistCardsBeforeUnmount(
        storage,
        "kb.anime.lore",
        now + 2000,
        2
      );
      expect(gists).toHaveLength(1);
      expect(gists[0]?.memory_tier).toBe("kb_crystallized_gist");
      expect(gists[0]?.content_text.length).toBeLessThan(150);
      const lineage = storage.getMemoryLineage(gists[0]!.memory_id);
      expect(lineage).toContainEqual(
        expect.objectContaining({
          parent_type: "knowledge_chunk",
          parent_id: "chk_anime_01",
          relation_type: "crystallized_from"
        })
      );
    } finally {
      storage.close();
    }
  });

  it("executes 5-table Hard Forget with topological micro-reprojection and Topic Seal", async () => {
    const { storage, soulPath } = createTestSoulArchive();
    try {
      const ts = 1_800_000_000_000;
      // evt_101: sensitive Seattle address
      storage.appendEvent({
        event_id: "evt_101",
        wall_ts_ms: ts,
        virtual_ts_ms: ts,
        source_channel_id: "builtin.webchat",
        principal_id: "owner",
        principal_trust: "owner_verified",
        venue_type: "private_1on1",
        audience_scope: "only_owner",
        event_category: "perception_committed",
        modality: "text",
        summary_text: "My secret address is 742 Seattle Pine Street.",
        payload_json: JSON.stringify({ text: "742 Seattle Pine Street" }),
        state_rev_after: 1,
        active_modules_mask: 1
      });
      // evt_102: innocent hotpot preference
      storage.appendEvent({
        event_id: "evt_102",
        wall_ts_ms: ts + 1000,
        virtual_ts_ms: ts + 1000,
        source_channel_id: "builtin.webchat",
        principal_id: "owner",
        principal_trust: "owner_verified",
        venue_type: "private_1on1",
        audience_scope: "only_owner",
        event_category: "perception_committed",
        modality: "text",
        summary_text: "I really love eating spicy Sichuan hotpot on rainy nights.",
        payload_json: JSON.stringify({ text: "spicy Sichuan hotpot" }),
        state_rev_after: 2,
        active_modules_mask: 1
      });

      // mem_pure_secret depends ONLY on evt_101 -> should be hard-deleted
      storage.insertMemoryWithLineage(
        {
          memory_id: "mem_pure_secret",
          memory_tier: "semantic_fact",
          epistemic_type: "observed_firsthand",
          attributed_principal: "owner",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          content_text: "Owner lives at 742 Seattle Pine Street.",
          created_virtual_ts: ts,
          last_recalled_ts: ts,
          valid_from_virtual_ts: ts,
          created_at_rev: 2
        },
        [{ parent_type: "event", parent_id: "evt_101" }]
      );

      // mem_mixed_A depends on BOTH evt_101 and evt_102 -> should be micro-reprojected from evt_102!
      storage.insertMemoryWithLineage(
        {
          memory_id: "mem_mixed_A",
          memory_tier: "episodic_experience",
          epistemic_type: "observed_firsthand",
          attributed_principal: "owner",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          content_text:
            "That evening we talked about moving to 742 Seattle Pine Street and eating spicy Sichuan hotpot.",
          created_virtual_ts: ts + 1000,
          last_recalled_ts: ts + 1000,
          valid_from_virtual_ts: ts + 1000,
          created_at_rev: 2
        },
        [
          { parent_type: "event", parent_id: "evt_101" },
          { parent_type: "event", parent_id: "evt_102" }
        ]
      );

      // mem_child_B depends on mem_mixed_A -> should be topologically reprojected after mem_mixed_A!
      storage.insertMemoryWithLineage(
        {
          memory_id: "mem_child_B",
          memory_tier: "semantic_fact",
          epistemic_type: "observed_firsthand",
          attributed_principal: "owner",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          content_text:
            "High-level summary: Owner resides in Seattle Pine Street and enjoys spicy Sichuan hotpot.",
          created_virtual_ts: ts + 2000,
          last_recalled_ts: ts + 2000,
          valid_from_virtual_ts: ts + 2000,
          created_at_rev: 2
        },
        [{ parent_type: "memory", parent_id: "mem_mixed_A" }]
      );

      // Commitment, checkpoint, and decision trace referencing evt_101
      storage.upsertCommitment({
        commitment_id: "cmt_seattle",
        commitment_kind: "user_upcoming_event",
        visibility_scope: "only_owner",
        description: "Ask about unpacking at 742 Seattle Pine Street",
        trigger_type: "at_virtual_ts",
        trigger_virtual_ts: ts + 86_400_000,
        status: "pending",
        source_event_id: "evt_101"
      });
      storage.saveCheckpoint({
        state_rev: 2,
        virtual_ts_ms: ts + 2000,
        caused_by_event_id: "evt_101",
        continuous_states_json: JSON.stringify({
          instant_valence: 0.4,
          instant_arousal: 0.2,
          mood_baseline_val: 0.2,
          circadian_energy: 0.8,
          metabolic_energy: 0.9,
          drive_social_longing: 0.1,
          drive_curiosity: 0.5
        }),
        state_attributions_json: JSON.stringify({
          mood_attribution: "Excited about My secret address is 742 Seattle Pine Street.",
          mood_attr_scope: "only_owner"
        }),
        relationship_json: "{}",
        user_model_json: "{}",
        working_memory_json: JSON.stringify({
          last_turn: "My secret address is 742 Seattle Pine Street."
        }),
        hibernation_intervals_json: "[]"
      });
      const attribution = { sourceEventIds: ["evt_101"], audienceScope: "only_owner", text: "Referenced event" };
      const continuous = { values: { review_count: 0.7, unaffected: 0.3 }, attributions: { review_count: attribution } };
      storage.saveCheckpoint({
        state_rev: 3, virtual_ts_ms: ts + 2000, caused_by_event_id: "evt_101",
        continuous_states_json: JSON.stringify(continuous.values), state_attributions_json: JSON.stringify(continuous.attributions),
        relationship_json: "{}", user_model_json: "{}", hibernation_intervals_json: "[]",
        working_memory_json: JSON.stringify({ format: "ai0.coordinator.v2", snapshot: {
          D1_WORKING_TURN: { recent_turns: [{ event_id: "evt_101", text: "private" }], unsaid_remainder: "private" },
          D2_CONTINUOUS_STATES: continuous, D5_IDENTITY_NARRATIVE: { pending_approvals: [], active_tensions: [] }
        } })
      });
      storage.saveTurnDecisionTrace({
        trace_id: "trc_101",
        target_instance: "live",
        turn_event_id: "evt_101",
        virtual_ts_ms: ts,
        state_rev_before: 1,
        state_rev_after: 2,
        steps: {
          step1_perception: {
            event_id: "evt_101",
            principal: "owner_verified",
            venue_type: "private_1on1",
            audience_scope: "only_owner",
            modality: "text",
            summary_text: "My secret address is 742 Seattle Pine Street."
          },
          step2_gate_safety: {
            l0_sb243_crisis_check: "PASS",
            salience_score: 0.9,
            debounce_merged_events: 1,
            recognized_intent: "share_secret"
          },
          step3_memory_recall: {
            sql_audience_filter_enforced: "visibility_scope IN ('only_owner')",
            recalled_memories: []
          },
          step4_homeostasis: {
            pre_state: { mood_valence: 0.2 },
            llm_proposed_impulse: { warmth: "+small" },
            code_clamped_post_state: { mood_valence: 0.4 }
          },
          step5_strategy_proposal: {
            chosen_strategy: "keep_secret",
            interaction_frame: "serious_factual",
            model_reported_rationale: {
              authority_badge: "MODEL_SELF_REPORT_UNVERIFIED",
              text: "Note the Seattle address."
            },
            theatrical_subtext: {
              spoiler_mask_level: "shy",
              drives_embodied_channel: true,
              masked_placeholder: "hidden",
              raw_text: "secret"
            }
          },
          step6_tool_auth: {
            prospective_commitment_registered: null,
            external_tool_invoked: null,
            auth_decision: "ALLOW"
          },
          step7_emitted_intent: {
            intent_id: "int_101",
            action_type: "speak",
            fallback_text: "I will remember 742 Seattle Pine Street!",
            chunks_count: 1,
            extensions_attached: []
          },
          step8_delivery_receipt: {
            status: "completed",
            spoken_char_offset: 40,
            degraded_extensions: []
          }
        }
      });

      const related = storage.getDecisionTraceByEvent("evt_101")!;
      related.trace_id = "trc_102";
      related.turn_event_id = related.steps.step1_perception.event_id = "evt_102";
      related.steps.step3_memory_recall.recalled_memories.push({
        memory_id: "mem_pure_secret", memory_tier: "semantic_fact", epistemic_type: "observed_firsthand",
        visibility_scope: "only_owner", taint_level: "trusted_owner", score: 1,
        content_text: "sensitive memory", source_event_ids: ["evt_101"]
      });
      storage.saveTurnDecisionTrace(related);
      const process = { stages: [], reasoning: "sensitive memory" };
      storage.saveChannelRunProcess("evt_101", process);
      storage.saveChannelRunProcess("evt_102", process);

      // Preview impact radius before mutating
      const preview = previewHardForgetRadius(storage, {
        target_event_ids: ["evt_101"]
      });
      expect(preview.root_event_ids).toEqual(["evt_101"]);
      expect(preview.hard_deleted_memory_ids).toContain("mem_pure_secret");
      expect(preview.reprojected_memory_ids).toEqual([
        "mem_mixed_A",
        "mem_child_B"
      ]);

      // Execute Hard Forget
      const result = await executeHardForget(storage, {
        target_event_ids: ["evt_101"],
        soulDirPath: soulPath,
        redactedAtTsMs: ts + 5000,
        virtualTsMs: ts + 5000
      });
      expect(result.dry_run_preview).toBe(false);
      expect(storage.getChannelRunProcess("evt_101")).toBeUndefined();
      expect(storage.getChannelRunProcess("evt_102")).toBeUndefined();
      storage.saveChannelRunProcess("evt_102", process);
      expect(storage.getChannelRunProcess("evt_102")).toBeUndefined();

      // Verify 5-table scrubbing & micro-reprojection
      const redactedEvt = storage.getEventById("evt_101");
      expect(redactedEvt?.summary_text).toBe("[REDACTED_BY_OWNER]");
      expect(redactedEvt?.payload_json).toBe("{}");
      expect(redactedEvt?.redacted_at_ts_ms).toBe(ts + 5000);

      const remainingMemories = storage.queryMemoriesWithAudienceGuard({
        audience_scope: "only_owner",
        principal_trust: "owner_verified"
      });
      expect(
        remainingMemories.some((m) => m.memory_id === "mem_pure_secret")
      ).toBe(false);
      for (const mem of remainingMemories) {
        expect(mem.content_text).not.toContain("Seattle");
      }
      const reprojectedA = remainingMemories.find(
        (m) => m.memory_id === "mem_mixed_A"
      );
      expect(reprojectedA?.content_text).toContain("hotpot");

      const scrubbedTrace = storage.getDecisionTraceByEvent("evt_101");
      expect(scrubbedTrace?.steps.step1_perception.summary_text).toBe(
        "[REDACTED_BY_FORGET]"
      );
      expect(scrubbedTrace?.steps.step7_emitted_intent.fallback_text).toBe(
        "[REDACTED_BY_FORGET]"
      );

      expect(storage.listCommitments()).toHaveLength(0);
      const checkpoint = storage.getLatestCheckpoint();
      expect(checkpoint?.working_memory_json).not.toContain("Seattle");
      expect(checkpoint?.state_attributions_json).not.toContain("Seattle");
      expect(JSON.parse(checkpoint!.state_attributions_json)).toEqual({});
      expect(JSON.parse(checkpoint!.continuous_states_json)).toEqual({ unaffected: 0.3 });
      expect(JSON.parse(checkpoint!.working_memory_json).snapshot.D1_WORKING_TURN).toEqual({
        recent_turns: [], unsaid_remainder: null
      });

      // Topic Seal
      const sealResult = await executeTopicSeal(storage, {
        topic_description: "Avoid talking about former relocation plans",
        created_virtual_ts: ts + 6000,
        created_at_rev: 3
      });
      expect(sealResult.topic_seal_memory_id).toBeTruthy();
      const retriever = new HybridMemoryRetriever(storage);
      const sealCheck = retriever.retrieve({
        query_text: "Avoid talking about former relocation plans",
        audience_scope: "only_owner",
        principal_trust: "owner_verified",
        current_virtual_ts: ts + 7000
      });
      expect(sealCheck.triggered_taboo_seals.length).toBeGreaterThan(0);
      expect(sealCheck.triggered_taboo_seals[0]?.avoidance_directive).toBe(
        TABOO_AVOIDANCE_DIRECTIVE
      );
    } finally {
      storage.close();
    }
  });

  it("replays redaction_ledger.json automatically on snapshot rollback so forgotten secrets never resurrect, and isolates sandbox forks", async () => {
    const { storage, soulPath } = createTestSoulArchive();
    const ts = 1_800_000_000_000;
    storage.appendEvent({
      event_id: "evt_snap_secret",
      wall_ts_ms: ts,
      virtual_ts_ms: ts,
      source_channel_id: "builtin.webchat",
      principal_id: "owner",
      principal_trust: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      event_category: "perception_committed",
      modality: "text",
      summary_text: "Secret move to Seattle before snapshot.",
      payload_json: "{}",
      state_rev_after: 1,
      active_modules_mask: 1
    });
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_snap_secret",
        memory_tier: "episodic_experience",
        epistemic_type: "observed_firsthand",
        attributed_principal: "owner",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        content_text: "Owner is moving to Seattle.",
        created_virtual_ts: ts,
        last_recalled_ts: ts,
        valid_from_virtual_ts: ts,
        created_at_rev: 1
      },
      [{ parent_type: "event", parent_id: "evt_snap_secret" }]
    );
    storage.close();

    const manager = new SoulArchiveManager(soulPath);
    // 1. Create snapshot BEFORE forgetting
    manager.createSnapshot("snap_before_forget");

    // 2. Re-open and execute Hard Forget
    const liveStorage = new CoordinatorStorageMutator(
      manager.layout.soulCoreDatabasePath
    );
    await new HardForgetEngine(liveStorage).execute({
      target_event_ids: ["evt_snap_secret"],
      soulDirPath: soulPath,
      redactedAtTsMs: ts + 2000,
      virtualTsMs: ts + 2000
    });
    liveStorage.close();

    // 3. Rollback to snap_before_forget
    const restoredStorage = await manager.rollbackToSnapshot(
      "snap_before_forget",
      "meta_reconciled",
      ts + 5000
    );
    try {
      const ledger = readSoulArchiveConfig(soulPath).redactionLedger;
      expect(
        ledger.some((e) => e.target_event_ids.includes("evt_snap_secret"))
      ).toBe(true);

      const evtAfterRollback = restoredStorage.getEventById("evt_snap_secret");
      expect(evtAfterRollback?.summary_text).toBe("[REDACTED_BY_OWNER]");
      expect(evtAfterRollback?.summary_text).not.toContain("Seattle");

      const memoriesAfterRollback =
        restoredStorage.queryMemoriesWithAudienceGuard({
          audience_scope: "only_owner",
          principal_trust: "owner_verified"
        });
      expect(
        memoriesAfterRollback.some((m) => m.content_text.includes("Seattle"))
      ).toBe(false);

      // 4. Fork sandbox instance and verify isolation
      const sandbox = manager.forkSandboxInstance("fork_01");
      try {
        expect(sandbox.target_instance).toBe("sandbox:fork_01");
        sandbox.storage.appendEvent({
          event_id: "evt_sandbox_only",
          wall_ts_ms: ts + 9000,
          virtual_ts_ms: ts + 9000,
          source_channel_id: "mock.channel",
          principal_id: "owner",
          principal_trust: "owner_verified",
          venue_type: "private_1on1",
          audience_scope: "only_owner",
          event_category: "perception_committed",
          modality: "text",
          summary_text: "Sandbox only mutation",
          payload_json: "{}",
          state_rev_after: 10,
          active_modules_mask: 1
        });
        expect(restoredStorage.getEventById("evt_sandbox_only")).toBeUndefined();
      } finally {
        sandbox.storage.close();
      }
    } finally {
      restoredStorage.close();
    }
  });
});
