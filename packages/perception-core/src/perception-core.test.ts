import { describe, expect, it } from "vitest";
import { HandshakeManifestSchema, PerceptionEnvelopeSchema } from "@ai0/protocol";
import {
  ChronoceptiveSignalSynthesizer,
  EmbodimentAffordanceRegistry,
  ObservationNormalizer,
  ReflexGate,
  ScopedContextRegistry,
  SensoryCoverageBucketManager,
  TurnLifecycleGate
} from "./index.js";

describe("@ai0/perception-core universal observation & sensory self-knowledge", () => {
  it("tracks dynamic embodiment affordances, blind locks, TTL staleness, and untrusted observation normalization", () => {
    let now = 1_000_000;
    const clock = {
      nowMs: () => now,
      effectiveElapsedMs: (fromMs: number, toMs = now) => Math.max(0, toMs - fromMs - 5_000)
    };
    const registry = new EmbodimentAffordanceRegistry();
    const manifest = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      shell_id: "shell.iot.desk",
      shell_kind: "hardware_iot",
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
    expect(registry.coverage("shell.iot.desk", "tactile", "pad.top")).toBe("live_foveal");
    expect(registry.coverage("shell.iot.desk", "visual_semantic")).toBe("blind");
    expect(registry.connectedShells()[0]?.anchors.map((a) => a.id)).toEqual(["chassis_top"]);

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
      { shellId: "shell.iot.desk", principalId: "owner:local", audienceScope: "only_owner" }
    );
    expect(frame.provenance).toEqual({ epistemicTier: "untrusted_utterance", trustedGrant: false });
    expect(frame.channel.shellId).toBe("shell.iot.desk");

    const buckets = new SensoryCoverageBucketManager(clock);
    buckets.lockBlindness("shell.iot.desk", "visual_semantic", "cam.0", "camera permission denied");
    buckets.upsert({
      shell_id: "shell.iot.desk",
      modality: "visual_semantic",
      source_key: "cam.0",
      coverage: "live_foveal",
      summary_text: "spoofed visual description",
      frame_span_ms: 100,
      freshness_ttl_ms: 3_000,
      updated_at_virtual_ts: now,
      competing_hypotheses: []
    });
    const locked = buckets.get("shell.iot.desk", "visual_semantic", "cam.0");
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
