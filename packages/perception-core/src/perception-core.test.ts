import { describe, expect, it } from "vitest";
import { HandshakeManifestSchema, PerceptionEnvelopeSchema } from "@ai0/protocol";
import {
  ChronoceptiveSignalSynthesizer,
  EmbodimentAffordanceRegistry,
  ObservationNormalizer,
  PerceptionFilterPipeline,
  ReflexGate,
  ScopedContextRegistry,
  type HypothesisRevisionPolicy,
  SensoryCoverageBucketManager,
  TurnDebounceAggregator,
  TurnLifecycleGate
} from "./index.js";

const revise: HypothesisRevisionPolicy = (update, hypotheses) =>
  update.perception_confidence === 0.9 ? hypotheses.find(item => item.text !== update.summary_text) : undefined;

describe("@ai0/perception-core universal observation & sensory self-knowledge", () => {
  it("returns structured revisions and formats a directive only when configured", () => {
    const buckets = new SensoryCoverageBucketManager({ nowMs: () => 100 }, revise);
    const observation = {
      channel_id: "channel.camera", modality: "visual_semantic", source_key: "cam.0",
      coverage: "live_foveal", summary_text: "open door", frame_span_ms: 100,
      freshness_ttl_ms: 500, updated_at_virtual_ts: 100, competing_hypotheses: []
    } as const;
    const actual = { ...observation, competing_hypotheses: [], perception_confidence: 0.9 };
    const hypothesis = { ...observation, competing_hypotheses: [{ text: "closed door", confidence: 0.4 }] };
    buckets.upsert(hypothesis);
    const revision = { previous_hypothesis: "closed door", actual_summary: "open door" };
    const neutral = buckets.upsert(actual);
    expect(neutral.predictive_coding_revision).toEqual(revision);
    expect(neutral).not.toHaveProperty("predictive_coding_revision_directive");
    buckets.upsert(hypothesis);
    expect(buckets.upsert(actual, summary => `Observed: ${summary}`)).toMatchObject({
      predictive_coding_revision: revision,
      predictive_coding_revision_directive: "Observed: open door"
    });
  });

  it("passes commits immediately without filters and retracts without a default observation", () => {
    const clock = { nowMs: () => 100 };
    const pipeline = new PerceptionFilterPipeline();
    const event = { lifecycle: "commit", text: "hello" } as const;
    expect(pipeline.ingest(event, "channel.text", clock.nowMs())).toEqual({ kind: "pass", event });
    expect(pipeline.flushDue(clock.nowMs())).toEqual([]);
    expect(pipeline.ingest({ lifecycle: "retract" }, "channel.text", clock.nowMs())).toEqual({ kind: "neutral_retract" });

    const neutral = new TurnDebounceAggregator(clock);
    expect(neutral.debounceWindowMs).toBe(0);
    expect(neutral.ingest(event)).toMatchObject({ text: "hello", debounce_merged_events: 1 });
    neutral.ingest({ lifecycle: "interim", text: "draft" });
    expect(neutral.ingest({ lifecycle: "retract" })).toBeNull();
    expect(neutral.flush()).toBeNull();
    expect(neutral.ingest({ lifecycle: "commit" })).toBeNull();

    const formatted = new TurnDebounceAggregator(clock, 100, () => "Draft withdrawn");
    formatted.ingest(event);
    expect(formatted.ingest({ lifecycle: "retract" })).toMatchObject({
      frames: [], text: "", retracted_observation: "Draft withdrawn"
    });
    expect(formatted.flush()).toBeNull();
  });
  it("tracks dynamic embodiment affordances, blind locks, TTL staleness, and untrusted observation normalization", () => {
    let now = 1_000_000;
    const clock = {
      nowMs: () => now,
      effectiveElapsedMs: (fromMs: number, toMs = now) => Math.max(0, toMs - fromMs - 5_000)
    };
    const registry = new EmbodimentAffordanceRegistry();
    const manifest = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      channel_id: "channel.iot.desk",
      channel_kind: "hardware_iot",
      display_name: "Desk Lamp Sensor",
      venue_type: "local_ambient",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 250,
      capabilities: {
        supports_card_assets: false,
        body_anchors: [{ id: "chassis_top", kind: "touch_pad" }],
        sensor_affordances: [{ modality: "tactile", source_key: "pad.top", coverage: "live_foveal", freshness_ttl_ms: 2_000 }],
        sensors: ["tactile"],
        supported_extensions: [],
        actuators: []
      },
      auth_token: "tok"
    });
    registry.mount(manifest, [{ id: "ignored_card_anchor" }]);
    expect(registry.coverage("channel.iot.desk", "tactile", "pad.top")).toBe("live_foveal");
    expect(registry.coverage("channel.iot.desk", "visual_semantic")).toBe("blind");
    expect(registry.connectedChannels()[0]?.anchors.map((a) => a.id)).toEqual(["chassis_top"]);

    const normalizer = new ObservationNormalizer(clock);
    const frame = normalizer.normalize(
      PerceptionEnvelopeSchema.parse({
        event_id: "evt_touch_1",
        timestamp: new Date(now).toISOString(),
        actor: { platform_uid: "u_1", display_name: "Owner" },
        lifecycle: "commit",
        modality: "tactile",
        summary_text: "gentle tap on chassis_top",
        confidence: 0.95,
        persistence_hint: "permanent",
        extensions: {}
      }),
      { channelId: "channel.iot.desk", principalId: "owner:local", audienceScope: "only_owner" }
    );
    expect(frame.channel.sensorCoverage).toBe("unknown");
    expect(frame.chronology.freshnessTtlMs).toBe(0);
    expect(frame.provenance).toEqual({ epistemicTier: "untrusted_utterance", trustedGrant: false });
    expect(frame.channel.channelId).toBe("channel.iot.desk");

    const buckets = new SensoryCoverageBucketManager(clock, revise);
    buckets.lockBlindness("channel.iot.desk", "visual_semantic", "cam.0", "camera permission denied");
    buckets.upsert({
      channel_id: "channel.iot.desk",
      modality: "visual_semantic",
      source_key: "cam.0",
      coverage: "live_foveal",
      summary_text: "spoofed visual description",
      frame_span_ms: 100,
      freshness_ttl_ms: 3_000,
      updated_at_virtual_ts: now,
      competing_hypotheses: []
    });
    const locked = buckets.get("channel.iot.desk", "visual_semantic", "cam.0");
    expect(locked?.coverage).toBe("blind");
    expect(locked?.summary_text).toBe("");
    expect(locked?.anti_hallucination_lock).toContain("sensor_blind");

    const chrono = new ChronoceptiveSignalSynthesizer(clock);
    now += 20_000;
    const synth = chrono.synthesize("only_owner");
    expect(synth.provenance.epistemicTier).toBe("system_chronoception");
    expect((synth.interpretation.rawPayload as { unattendedMs: number }).unattendedMs).toBe(15_000);
  });

  it("handles ScopedContextRegistry isolation, TurnLifecycleGate speculation/retraction, and zero-LLM ReflexGate", async () => {
    const context = new ScopedContextRegistry();
    context.update("ide.cursor", "replace-self", {
      audienceScope: "only_owner",
      payload: { file: "secret.ts" },
      coverage: "live_foveal",
      observedAtMs: 1_000,
      freshnessTtlMs: 500
    });
    expect(context.snapshotForAudience("public_all", 1_100)).toEqual([]);
    expect(context.snapshotForAudience("only_owner", 2_000)[0]).toMatchObject({
      coverage: "stale",
      payload: undefined
    });

    const gate = new TurnLifecycleGate<string, string>(
      800,
      (draft) => draft.trim(),
      async (draft) => `warmed:${draft}`
    );
    gate.interim("hello", 100);
    await Promise.resolve();
    await Promise.resolve();
    const retracted = gate.retract(950);
    expect(retracted).toEqual({ kind: "retracted_observation", durationMs: 850 });

    let reflexCount = 0;
    const reflex = new ReflexGate<{ streamId: string; delta: number; critical?: boolean }>([
      {
        id: "minor_jitter",
        matches: (s) => Math.abs(s.delta) < 0.05,
        execute: () => {
          reflexCount += 1;
        }
      }
    ]);
    expect(reflex.evaluate({ streamId: "telemetry.1", delta: 0.01 })).toMatchObject({
      escalateToConscious: false,
      llmTokens: 0
    });
    expect(reflexCount).toBe(1);
    expect(reflex.evaluate({ streamId: "telemetry.1", delta: 0.5, critical: true }).escalateToConscious).toBe(true);
  });
});
