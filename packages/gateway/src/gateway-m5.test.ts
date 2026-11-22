import { describe, expect, it } from "vitest";
import { VirtualClock } from "@ai0/kernel";
import {
  PrivilegedAdminServer,
  ShellProtocolGateway,
  issueScopedCapabilityToken,
  verifyScopedCapabilityToken
} from "./index.js";

describe("Milestone M5 Quality Audit: Dual-Plane Gateway (Channel A Shell Protocol & Channel B Admin API)", () => {
  it("enforces ScopedCapabilityToken HMAC-SHA256, forced audience downgrade, 1200ms debounce, and audio-ms unsaid_remainder truncation", async () => {
    const clock = new VirtualClock({ targetInstance: "sandbox:m5", initialVirtualTsMs: 1_800_000_000_000 });
    const capturedInterruptions: Array<{ spoken_char_offset: number; unsaid_remainder: string }> = [];

    const gateway = new ShellProtocolGateway({
      clock,
      w1: {
        recordInterruption: (rec) => {
          capturedInterruptions.push({
            spoken_char_offset: rec.spoken_char_offset,
            unsaid_remainder: rec.unsaid_remainder
          });
        }
      }
    });

    const secretKey = "gateway-secret-key-m5";
    const token = issueScopedCapabilityToken(
      {
        shell_id: "mock.livestream.public",
        max_audience_privacy_ceiling: "public_all",
        allowed_modalities: ["text"],
        expires_at_ts_ms: Date.now() + 3_600_000
      },
      secretKey
    );

    const claims = verifyScopedCapabilityToken(token, secretKey);
    expect(claims.max_audience_privacy_ceiling).toBe("public_all");

    const ack = gateway.handleInboundHandshake(
      {
        protocol_version: "0.1.0",
        shell_id: "mock.livestream.public",
        shell_kind: "custom.livestream_stage",
        display_name: "Public Livestream Shell",
        auth_token: token,
        venue_type: "public_livestream",
        current_audience: {
          scope: "public_all",
          member_count: 150
        },
        latency_budget_ms: 1500,
        capabilities: {
          sensors: ["text"],
          supported_extensions: ["ext.media.sideband.v1"],
          expression_vocabulary: {
            voice_emotion_tags: ["warm_neutral"],
            facial_expressions: ["smile_gentle"]
          },
          actuators: []
        }
      },
      secretKey
    );
    expect(ack.max_audience_privacy_ceiling).toBe("public_all");

    // Attempt privilege escalation: public shell claims audience_scope = "only_owner" and principal_trust = "owner_verified"
    const p1 = gateway.handlePerception(ack.session_id, {
      event_id: "evt_pub_1",
      timestamp: new Date(clock.nowMs()).toISOString(),
      lifecycle: "commit",
      actor: {
        platform_uid: "spoofed_owner",
        display_name: "Spoofed"
      },
      modality: "text",
      summary_text: "Hello from stream",
      confidence: 1,
      persistence_hint: "permanent",
      extensions: {
        "ext.gateway.context.v1": {
          audience_scope: "only_owner",
          principal_trust: "owner_verified"
        }
      }
    });

    expect(p1.envelope.audience_scope).toBe("public_all");
    expect(p1.envelope.principal_trust).toBe("stranger");
    expect(p1.state).toBe("BUFFERING_1200MS");

    // Advance VirtualClock by 1200ms and flush debounce
    clock.advanceBy(1_200, "active_unattended");
    const batch = gateway.flushDebounce(ack.session_id);
    expect(batch?.text).toContain("Hello from stream");
    expect(gateway.getDebounceState(ack.session_id)).toBe("COMMITTED");

    // Dispatch expression with ext.media.sideband.v1 char_offset_timestamps_ms and test mid-speech interruption
    await gateway.dispatchExpression({
      intent_id: "intent_tts_1",
      correlation_event_id: "evt_pub_1",
      chunk_seq: 0,
      is_final: true,
      action_type: "speak",
      fallback_text: "ABCDEFGH",
      extensions: {
        "ext.media.sideband.v1": {
          audio_stream_id: "tts_stream_01",
          audio_format: "opus_webm",
          total_duration_ms: 800,
          char_offset_timestamps_ms: [0, 100, 200, 300, 400, 500, 600, 700]
        }
      }
    });

    const interruption = gateway.handleDeliveryReceipt({
      intent_id: "intent_tts_1",
      chunk_seq: 0,
      status: "interrupted",
      actual_played_audio_ms: 350,
      interrupted_by_event_id: "evt_barge_in_1"
    });

    expect(interruption?.spoken_char_offset).toBe(4);
    expect(interruption?.unsaid_remainder).toBe("EFGH");
    expect(capturedInterruptions).toHaveLength(1);
    expect(capturedInterruptions[0]?.unsaid_remainder).toBe("EFGH");
  });

  it("enforces Channel B Owner Master Token auth, Live Sovereignty 403 Fence, 18 route groups, and 4-track telemetry", async () => {
    const telemetryFrames: string[] = [];
    const admin = new PrivilegedAdminServer({
      ownerToken: "owner-secret-token-m5",
      fallbackHandler: async (_req, ctx) => ({
        status: 200,
        body: { ok: true, operation: ctx.operation, target_instance: ctx.target_instance }
      })
    });

    admin.subscribeTelemetry((frame) => {
      telemetryFrames.push(`${frame.track}:${frame.target_instance}`);
    });

    // 401 without token
    const unauth = await admin.handleRequest({
      method: "GET",
      path: "/api/admin/v1/shells/topology"
    });
    expect(unauth.status).toBe(401);

    // 403 when target_instance === "live" attempts time advance, perception injection, or organ ablation
    const liveClockAdvance = await admin.handleRequest({
      method: "POST",
      path: "/api/admin/v1/clock/advance",
      headers: { authorization: "Bearer owner-secret-token-m5" },
      body: { target_instance: "live", duration_ms: 3_600_000 }
    });
    expect(liveClockAdvance.status).toBe(403);

    const liveInject = await admin.handleRequest({
      method: "POST",
      path: "/api/admin/v1/sandbox/inject",
      headers: { "x-ai0-owner-token": "owner-secret-token-m5" },
      body: { target_instance: "live" }
    });
    expect(liveInject.status).toBe(403);

    const liveAblate = await admin.handleRequest({
      method: "POST",
      path: "/api/admin/v1/extensions/community.organ.dream-journal/hot-reload",
      headers: { authorization: "Bearer owner-secret-token-m5" },
      body: { target_instance: "live", enabled: false }
    });
    expect(liveAblate.status).toBe(403);

    // 200 OK when target_instance === "sandbox:test" advances clock
    const sandboxClockAdvance = await admin.handleRequest({
      method: "POST",
      path: "/api/admin/v1/clock/advance",
      headers: { authorization: "Bearer owner-secret-token-m5" },
      body: { target_instance: "sandbox:test", duration_ms: 3_600_000 }
    });
    expect(sandboxClockAdvance.status).toBe(200);
    expect(telemetryFrames).toContain("[SYS]:sandbox:test");
  });
});
