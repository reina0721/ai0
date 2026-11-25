import { describe, expect, it } from "vitest";
import { HandshakeManifestSchema } from "@ai0/protocol";
import { GroundingReceiptTracker, RealizerVocabularyNegotiator } from "./index.js";

describe("@ai0/expression-core intent negotiation & four-state grounding", () => {
  it("holds private communicative intents when only public shells are connected and negotiates quiet non-verbal cues", () => {
    const negotiator = new RealizerVocabularyNegotiator();
    const publicShell = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      shell_id: "shell.public.stream",
      shell_kind: "webchat",
      display_name: "Public Stream",
      venue_type: "public_livestream",
      current_audience: { scope: "public_all", member_count: 40 },
      latency_budget_ms: 800,
      capabilities: {
        sensors: ["text"],
        supported_extensions: ["ext.embodied.v1"],
        actuators: []
      },
      auth_token: "tok"
    });
    negotiator.mount(publicShell);

    const held = negotiator.negotiate({
      intentId: "int_priv_1",
      correlationEventId: "evt_1",
      intent: "communicate",
      utterance: "Private reminder about your clinic appointment.",
      deliveryConstraints: { audienceScope: "only_owner" }
    });
    expect(held).toEqual({ status: "held_pending_compliant_shell", envelope: null });

    const privateLamp = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      shell_id: "shell.private.lamp",
      shell_kind: "hardware_iot",
      display_name: "Desk Lamp",
      venue_type: "local_ambient",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 150,
      capabilities: {
        realizer_affordances: [
          { token: "led.pulse_amber", semanticAction: "gentle_nudge", kind: "nonverbal", quiet: true, latencyMs: 60 }
        ],
        expression_vocabulary: { expression_tags: ["warm_glow"] },
        sensors: [],
        supported_extensions: ["ext.embodied.v1"],
        actuators: [
          {
            actuator_id: "led.pulse_amber",
            description: "Pulse warm amber LED",
            parameters_json_schema: {},
            requires_local_user_consent: false
          }
        ]
      },
      auth_token: "tok"
    });
    negotiator.mount(privateLamp);

    const dispatched = negotiator.negotiate({
      intentId: "int_quiet_1",
      correlationEventId: "evt_2",
      intent: "actuate",
      attentionTarget: "interlocutor",
      expressiveStance: { semanticCue: "warm_glow", intensity: 0.6 },
      actuationHint: { semanticAction: "gentle_nudge", arguments: { cycles: 2 } },
      deliveryConstraints: { audienceScope: "only_owner", requireNonVerbalQuiet: true, maxLatencyMs: 200 }
    });
    expect(dispatched.status).toBe("dispatched");
    if (dispatched.status !== "dispatched") throw new Error("expected dispatched");
    expect(dispatched.shellId).toBe("shell.private.lamp");
    expect(dispatched.envelope.actuator_invocation?.actuator_id).toBe("led.pulse_amber");
  });

  it("tracks 4-stage grounding truth and recovers exact unsaid_remainder across silenced + done dual boundaries", () => {
    const tracker = new GroundingReceiptTracker();
    tracker.recordGenerated({
      intent_id: "int_stream_1",
      correlation_event_id: "evt_10",
      chunk_seq: 0,
      is_final: false,
      action_type: "speak",
      fallback_text: "第一段话已经说完，",
      extensions: {}
    });
    tracker.recordGenerated({
      intent_id: "int_stream_1",
      correlation_event_id: "evt_10",
      chunk_seq: 1,
      is_final: true,
      action_type: "speak",
      fallback_text: "第二段话说到一半被打断了",
      extensions: {}
    });
    expect(tracker.stage("int_stream_1", 0)).toBe("generated_unpresented");

    tracker.receive({
      intent_id: "int_stream_1",
      chunk_seq: 0,
      status: "completed",
      spoken_char_offset: 9
    });
    expect(tracker.stage("int_stream_1", 0)).toBe("physically_presented");
    expect(tracker.acknowledgeInterlocutor("int_stream_1", 0, "evt_user_reply_11")).toBe(true);
    expect(tracker.stage("int_stream_1", 0)).toBe("interlocutor_grounded");

    // Boundary 1: silenced freezes spoken offset at 4 chars ("第二段话"), does not settle yet
    expect(
      tracker.receive({
        intent_id: "int_stream_1",
        chunk_seq: 1,
        status: "playing",
        interruption_boundary: "silenced",
        spoken_char_offset: 4,
        interrupted_by_event_id: "evt_barge_in"
      })
    ).toBeUndefined();

    // Late in-flight progress after silenced must NOT advance presented offset past 4
    const settled = tracker.receive({
      intent_id: "int_stream_1",
      chunk_seq: 1,
      status: "interrupted",
      interruption_boundary: "done",
      spoken_char_offset: 9
    });
    expect(settled).toEqual({
      intent_id: "int_stream_1",
      chunk_seq: 1,
      spoken_char_offset: 4,
      unsaid_remainder: "说到一半被打断了",
      interrupted_by_event_id: "evt_barge_in"
    });
  });
});
