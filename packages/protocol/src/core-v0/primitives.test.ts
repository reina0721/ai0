import { describe, expect, it } from "vitest";
import {
  EXT_AFFECT_V1_KEY,
  EXT_EMBODIED_V1_KEY,
  EXT_MEDIA_SIDEBAND_V1_KEY,
  EXT_PERCEPTION_V1_KEY,
  EXT_RHYTHM_V1_KEY,
  ExtAffectV1Schema,
  ExtEmbodiedV1Schema,
  ExtMediaSidebandV1Schema,
  ExtPerceptionV1Schema,
  ExtRhythmV1Schema,
  parseKnownExtensions
} from "../extensions/standard-v1.js";
import {
  ControlSignalSchema,
  DeliveryReceiptSchema,
  ExpressionEnvelopeSchema,
  HandshakeAckSchema,
  HandshakeManifestSchema,
  PerceptionEnvelopeSchema,
  ProtocolRpcMessageSchema,
  SensorModalitySchema,
  ShellKindSchema,
  computeSpokenCharOffsetFromAudioMs
} from "./primitives.js";

const handshakeManifest = {
  protocol_version: "0.1.0",
  shell_id: "community.avatar.desktop",
  shell_kind: "custom.live2d_avatar",
  display_name: "Desktop avatar",
  venue_type: "private_1on1",
  current_audience: {
    scope: "group:household.main",
    member_count: 2,
    description: "Household room"
  },
  latency_budget_ms: 600,
  capabilities: {
    sensors: ["text", "custom.depth_camera"],
    supported_extensions: [
      EXT_AFFECT_V1_KEY,
      EXT_RHYTHM_V1_KEY,
      EXT_EMBODIED_V1_KEY
    ],
    expression_vocabulary: {
      facial_expressions: ["soft_smile"],
      gesture_intents: ["tilt_head_curious"],
      voice_emotion_tags: ["warm_comfort"]
    },
    actuators: [
      {
        actuator_id: "desktop.take_authorized_snapshot",
        description: "Takes a snapshot after local consent",
        parameters_json_schema: { type: "object" },
        requires_local_user_consent: true
      }
    ]
  },
  auth_token: "scoped-token"
};

const perceptionEnvelope = {
  event_id: "01JTESTEVENT",
  timestamp: "2026-11-22T00:00:00.000Z",
  actor: {
    platform_uid: "owner-1",
    display_name: "Owner"
  },
  lifecycle: "commit",
  modality: "custom.depth_camera",
  summary_text: "The owner waved.",
  confidence: 0.95,
  sustained_ms: 450,
  persistence_hint: "ephemeral_blackboard",
  extensions: {}
};

const expressionEnvelope = {
  intent_id: "01JTESTINTENT",
  correlation_event_id: "01JTESTEVENT",
  chunk_seq: 0,
  is_final: true,
  action_type: "speak",
  fallback_text: "Hello!",
  extensions: {}
};

const deliveryReceipt = {
  intent_id: "01JTESTINTENT",
  chunk_seq: 0,
  status: "interrupted",
  spoken_char_offset: 4,
  played_audio_ms: 420,
  interrupted_by_event_id: "01JNEWINPUT",
  degraded_extensions: ["ext.unknown.v1"]
};

const controlSignal = {
  signal_type: "focus_shifted",
  active_focus_shell_id: "community.avatar.desktop",
  payload: { reason: "window-activated" }
};

const standardExtensions = {
  [EXT_PERCEPTION_V1_KEY]: {
    source_key: "camera.main",
    coverage: "live_foveal",
    frame_span_ms: 100,
    freshness_ttl_ms: 1_000,
    competing_hypotheses: [
      { summary_text: "The owner waved.", confidence: 0.8 }
    ]
  },
  [EXT_AFFECT_V1_KEY]: {
    label: "warm",
    vad: { valence: 0.8, arousal: 0.4, dominance: 0.5 }
  },
  [EXT_RHYTHM_V1_KEY]: {
    pre_delay_ms: 100,
    typing_indicator_ms: 300,
    pause_after_ms: 250,
    prosody: {
      speed_rate: 0.9,
      pitch_shift: 0.1,
      vocal_effort: "soft"
    }
  },
  [EXT_EMBODIED_V1_KEY]: {
    sync_anchor: "pre_speech",
    gaze: { target: "user_eyes", behavior: "glancing" },
    facial: { expression: "soft_smile", intensity: 0.7, blush_level: 0.2 },
    gesture: {
      category: "head_motion",
      intent: "tilt_head_curious",
      fallback_intent: "nod_gentle"
    },
    linger_ms: 300,
    keyframes: [
      {
        sync_anchor: "on_substring:Hello",
        facial: { expression: "bright_smile", intensity: 1 }
      }
    ]
  },
  [EXT_MEDIA_SIDEBAND_V1_KEY]: {
    audio_stream_id: "audio-1",
    audio_format: "opus_webm",
    total_duration_ms: 1_200,
    char_offset_timestamps_ms: [0, 150, 300, 500, 700, 900],
    viseme_frames: [{ offset_ms: 0, viseme: "sil", weight: 1 }]
  }
};

describe("Protocol v0 primitives", () => {
  it("validates the handshake manifest and acknowledgement", () => {
    expect(HandshakeManifestSchema.parse(handshakeManifest)).toMatchObject({
      protocol_version: "0.1.0",
      shell_kind: "custom.live2d_avatar"
    });

    expect(
      HandshakeAckSchema.parse({
        session_id: "session-1",
        accepted_version: "0.1.0",
        enforced_venue_type: "private_1on1",
        max_audience_privacy_ceiling: "only_owner",
        entity_nature: "artificial_intelligence_digital_life",
        server_virtual_ts_ms: 12_345
      })
    ).toMatchObject({ session_id: "session-1" });
  });

  it("validates a perception envelope", () => {
    expect(PerceptionEnvelopeSchema.parse(perceptionEnvelope)).toMatchObject({
      lifecycle: "commit",
      modality: "custom.depth_camera"
    });
    expect(
      PerceptionEnvelopeSchema.safeParse({
        ...perceptionEnvelope,
        confidence: 1.1
      }).success
    ).toBe(false);
  });

  it("validates an expression envelope", () => {
    expect(ExpressionEnvelopeSchema.parse(expressionEnvelope)).toMatchObject({
      action_type: "speak",
      fallback_text: "Hello!"
    });
  });

  it("validates a delivery receipt", () => {
    expect(DeliveryReceiptSchema.parse(deliveryReceipt)).toMatchObject({
      status: "interrupted",
      spoken_char_offset: 4,
      played_audio_ms: 420
    });
  });

  it("validates a control signal", () => {
    expect(ControlSignalSchema.parse(controlSignal)).toMatchObject({
      signal_type: "focus_shifted"
    });
  });

  it("accepts well-known and open custom shell kinds and sensor modalities", () => {
    expect(ShellKindSchema.parse("webchat")).toBe("webchat");
    expect(ShellKindSchema.parse("custom.community.avatar")).toBe(
      "custom.community.avatar"
    );
    expect(SensorModalitySchema.parse("audio_transcript")).toBe(
      "audio_transcript"
    );
    expect(SensorModalitySchema.parse("custom.depth_camera")).toBe(
      "custom.depth_camera"
    );
    expect(ShellKindSchema.safeParse("unknown").success).toBe(false);
    expect(SensorModalitySchema.safeParse("custom.").success).toBe(false);
  });
});

describe("standard extension namespaces", () => {
  it("validates all five standard extensions", () => {
    expect(
      ExtPerceptionV1Schema.safeParse(
        standardExtensions[EXT_PERCEPTION_V1_KEY]
      ).success
    ).toBe(true);
    expect(
      ExtAffectV1Schema.safeParse(standardExtensions[EXT_AFFECT_V1_KEY]).success
    ).toBe(true);
    expect(
      ExtRhythmV1Schema.safeParse(standardExtensions[EXT_RHYTHM_V1_KEY]).success
    ).toBe(true);
    expect(
      ExtEmbodiedV1Schema.safeParse(
        standardExtensions[EXT_EMBODIED_V1_KEY]
      ).success
    ).toBe(true);
    expect(
      ExtMediaSidebandV1Schema.safeParse(
        standardExtensions[EXT_MEDIA_SIDEBAND_V1_KEY]
      ).success
    ).toBe(true);
  });

  it("recognizes supported extensions and gracefully reports unknown ones", () => {
    const result = parseKnownExtensions({
      ...standardExtensions,
      "ext.community.sparkles.v1": { intensity: 0.8 }
    });

    expect(Object.keys(result.recognized)).toEqual(
      Object.keys(standardExtensions)
    );
    expect(result.degraded_extensions).toEqual([
      "ext.community.sparkles.v1"
    ]);
  });

  it("degrades known extensions that the receiver does not support", () => {
    const result = parseKnownExtensions(standardExtensions, [
      EXT_AFFECT_V1_KEY,
      EXT_RHYTHM_V1_KEY
    ]);

    expect(Object.keys(result.recognized)).toEqual([
      EXT_AFFECT_V1_KEY,
      EXT_RHYTHM_V1_KEY
    ]);
    expect(result.degraded_extensions).toEqual([
      EXT_PERCEPTION_V1_KEY,
      EXT_EMBODIED_V1_KEY,
      EXT_MEDIA_SIDEBAND_V1_KEY
    ]);
  });
});

describe("JSON-RPC 2.0 protocol frames", () => {
  it("validates method-specific requests and notifications", () => {
    expect(
      ProtocolRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: "request-1",
        method: "ai0.handshake",
        params: handshakeManifest
      }).success
    ).toBe(true);
    expect(
      ProtocolRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        method: "ai0.perception",
        params: perceptionEnvelope
      }).success
    ).toBe(true);
    expect(
      ProtocolRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: 2,
        method: "ai0.expression",
        params: perceptionEnvelope
      }).success
    ).toBe(false);
  });

  it("validates success and error responses", () => {
    expect(
      ProtocolRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: "request-1",
        result: {
          session_id: "session-1",
          accepted_version: "0.1.0"
        }
      }).success
    ).toBe(true);
    expect(
      ProtocolRpcMessageSchema.safeParse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32_600,
          message: "Invalid request",
          data: { reason: "malformed frame" }
        }
      }).success
    ).toBe(true);
  });
});

describe("computeSpokenCharOffsetFromAudioMs", () => {
  const timestamps = [100, 250, 400, 700];

  it("returns zero at 0ms and clamps negative playback times", () => {
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, 0)).toBe(0);
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, -50)).toBe(0);
  });

  it("includes characters exactly on timestamp boundaries", () => {
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, 100)).toBe(1);
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, 400)).toBe(3);
    expect(computeSpokenCharOffsetFromAudioMs([0, 100], 0)).toBe(1);
  });

  it("returns the preceding offset between timestamp boundaries", () => {
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, 325)).toBe(2);
  });

  it("returns the array length after the final timestamp", () => {
    expect(computeSpokenCharOffsetFromAudioMs(timestamps, 10_000)).toBe(4);
  });

  it("returns zero for an empty timestamp array", () => {
    expect(computeSpokenCharOffsetFromAudioMs([], 500)).toBe(0);
  });
});
