import { describe, expect, it } from "vitest";
import { CoordinatorStorageMutator } from "../src/index.js";

describe("CoordinatorStorageMutator epistemic belief revision and cross-channel principal bindings", () => {
  it("preserves falsified memory text for audit while cascading lineage invalidation and cancelling dependent commitments", () => {
    const storage = new CoordinatorStorageMutator(":memory:");

    storage.appendEvent({
      event_id: "evt_false_source",
      wall_ts_ms: 1_000,
      virtual_ts_ms: 1_000,
      source_channel_id: "channel.webchat",
      principal_id: "owner:local",
      principal_trust: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      event_category: "perception_committed",
      modality: "text",
      summary_text: " external rumor: release freeze starts Thursday ",
      payload_json: "{}",
      state_rev_after: 1,
      active_modules_mask: 1
    });

    storage.appendEvent({
      event_id: "evt_verified_correction",
      wall_ts_ms: 2_000,
      virtual_ts_ms: 2_000,
      source_channel_id: "channel.cli",
      principal_id: "owner:local",
      principal_trust: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      event_category: "perception_committed",
      modality: "text",
      summary_text: "verified correction: release freeze starts Monday",
      payload_json: "{}",
      state_rev_after: 2,
      active_modules_mask: 1
    });

    // Root false belief M1
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_m1_false",
        memory_tier: "semantic_fact",
        epistemic_type: "reported_hearsay",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "untrusted_external",
        content_text: "Release freeze starts Thursday",
        created_virtual_ts: 1_000,
        last_recalled_ts: 1_000,
        valid_from_virtual_ts: 1_000,
        created_at_rev: 1
      },
      [{ parent_type: "event", parent_id: "evt_false_source", relation_type: "derived_from" }]
    );

    // Child inference M2 derived from M1
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_m2_derived",
        memory_tier: "episodic_experience",
        epistemic_type: "inferred_hypothesis",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "untrusted_external",
        content_text: "Send Thursday freeze reminder to release channel",
        created_virtual_ts: 1_100,
        last_recalled_ts: 1_100,
        valid_from_virtual_ts: 1_100,
        created_at_rev: 1
      },
      [{ parent_type: "memory", parent_id: "mem_m1_false", relation_type: "derived_from" }]
    );

    // Pending commitment grounded in the same false source event
    storage.upsertCommitment({
      commitment_id: "cmt_thursday_notice",
      commitment_kind: "agent_promise",
      visibility_scope: "only_owner",
      taint_level: "untrusted_external",
      description: "Remind team on Thursday morning",
      trigger_type: "at_virtual_ts",
      trigger_virtual_ts: 5_000,
      status: "pending",
      source_event_id: "evt_false_source"
    });

    // Execute epistemic belief revision (supersedes M1 with M3)
    const revResult = storage.reviseBeliefLineage({
      target_memory_id: "mem_m1_false",
      relation: "supersedes",
      replacement_memory: {
        memory_id: "mem_m3_corrected",
        content_text: "Release freeze starts Monday",
        memory_tier: "semantic_fact",
        epistemic_type: "observed_firsthand",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        attributed_principal: "owner:local",
        source_event_ids: ["evt_verified_correction"]
      },
      virtual_ts_ms: 2_000,
      state_rev: 3,
      cancel_dependent_commitments: true
    });

    expect(revResult.target_updated).toBe(true);
    expect(revResult.invalidated_memory_ids).toEqual(["mem_m1_false", "mem_m2_derived"]);
    expect(revResult.affected_commitment_ids).toEqual(["cmt_thursday_notice"]);

    // Active audience-guarded recall returns ONLY M3 (neither M1 nor derived M2)
    const activeMemories = storage.queryMemoriesWithAudienceGuard({
      audience_scope: "only_owner",
      principal_trust: "owner_verified",
      query_text: "Release freeze",
      current_virtual_ts: 2_500
    });
    expect(activeMemories.map((m) => m.memory_id)).toEqual(["mem_m3_corrected"]);

    // Audit inspection proves M1 and M2 retain their original content_text (NOT privacy-wiped) with retired status
    const retiredM1 = storage.getMemoryRecord("mem_m1_false");
    const retiredM2 = storage.getMemoryRecord("mem_m2_derived");
    expect(retiredM1?.content_text).toBe("Release freeze starts Thursday");
    expect(retiredM1?.grounding_status).toBe("disputed_retired");
    expect(retiredM1?.invalidated_at_ts).toBe(2_000);
    expect(retiredM2?.content_text).toBe("Send Thursday freeze reminder to release channel");
    expect(retiredM2?.grounding_status).toBe("disputed_retired");
    expect(retiredM2?.invalidated_at_ts).toBe(2_000);

    // Lineage records `supersedes` edge from M3 -> M1
    const m3Lineage = storage.getMemoryLineage("mem_m3_corrected");
    expect(m3Lineage).toContainEqual({
      child_memory_id: "mem_m3_corrected",
      parent_type: "memory",
      parent_id: "mem_m1_false",
      relation_type: "supersedes"
    });

    // Dependent commitment was cancelled
    expect(storage.listCommitments("cancelled").map((c) => c.commitment_id)).toEqual([
      "cmt_thursday_notice"
    ]);

    // Cross-channel principal binding persistence
    storage.bindChannelPrincipal("channel.webchat", "sess_abc", "principal:alice");
    storage.bindChannelPrincipal("channel.cli", "uid_1000", "principal:alice");
    expect(storage.resolveChannelPrincipal("channel.webchat", "sess_abc")).toBe("principal:alice");
    expect(storage.resolveChannelPrincipal("channel.cli", "uid_1000")).toBe("principal:alice");

    // Multi-premise `any_of` + `min_premise_count` lineage policy & tool execution idempotency persistence
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_ep_a",
        memory_tier: "episodic_experience",
        epistemic_type: "observed_firsthand",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        content_text: "Supporting episode A",
        created_virtual_ts: 3_000,
        last_recalled_ts: 3_000,
        valid_from_virtual_ts: 3_000,
        created_at_rev: 4
      },
      [{ parent_type: "event", parent_id: "evt_verified_correction", relation_type: "derived_from" }]
    );
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_ep_b",
        memory_tier: "episodic_experience",
        epistemic_type: "observed_firsthand",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        content_text: "Supporting episode B",
        created_virtual_ts: 3_100,
        last_recalled_ts: 3_100,
        valid_from_virtual_ts: 3_100,
        created_at_rev: 5
      },
      [{ parent_type: "event", parent_id: "evt_verified_correction", relation_type: "derived_from" }]
    );
    storage.insertMemoryWithLineage(
      {
        memory_id: "mem_cryst_habit",
        memory_tier: "semantic_fact",
        epistemic_type: "inferred_hypothesis",
        attributed_principal: "owner:local",
        visibility_scope: "only_owner",
        taint_level: "trusted_owner",
        content_text: "Crystallized habit backed by any_of(A, B)",
        created_virtual_ts: 3_200,
        last_recalled_ts: 3_200,
        valid_from_virtual_ts: 3_200,
        created_at_rev: 6,
        premise_quantifier: "any_of",
        min_premise_count: 1
      },
      [
        { parent_type: "memory", parent_id: "mem_ep_a", relation_type: "crystallized_from" },
        { parent_type: "memory", parent_id: "mem_ep_b", relation_type: "crystallized_from" }
      ]
    );

    const revEpA = storage.reviseBeliefLineage({
      target_memory_id: "mem_ep_a",
      relation: "contradicts",
      virtual_ts_ms: 4_000,
      state_rev: 7
    });
    expect(revEpA.invalidated_memory_ids).toEqual(["mem_ep_a"]);
    expect(storage.getMemoryRecord("mem_cryst_habit")?.invalidated_at_ts).toBeNull();

    const revEpB = storage.reviseBeliefLineage({
      target_memory_id: "mem_ep_b",
      relation: "contradicts",
      virtual_ts_ms: 4_500,
      state_rev: 8
    });
    expect(revEpB.invalidated_memory_ids).toEqual(["mem_ep_b", "mem_cryst_habit"]);
    expect(storage.getMemoryRecord("mem_cryst_habit")?.grounding_status).toBe("disputed_retired");

    storage.saveToolExecutionIdempotency({
      idempotency_key: "w2_task:t1::billing.charge::1a2b",
      scope_id: "w2_task:t1",
      tool_name: "billing.charge",
      input_hash: "1a2b",
      result_json: JSON.stringify({ status: "verified", value: { ok: true } }),
      recorded_at_step: 0,
      created_virtual_ts: 5_000
    });
    expect(storage.getToolExecutionIdempotency("w2_task:t1::billing.charge::1a2b")?.tool_name).toBe("billing.charge");
    expect(storage.listToolExecutionIdempotencyByScope("w2_task:t1")).toHaveLength(1);

    storage.close();
  });
});
