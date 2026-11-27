import { describe, expect, it } from "vitest";
import { VirtualClock } from "@ai0/cognition-core";
import { ExtensionCoreHost } from "@ai0/extension-core";
import { perceptionExtractorFacet, perceptionFilterFacet, perceptionTransducerFacet } from "@ai0/perception-core";
import { expressionMediaTranscoderFacet } from "@ai0/expression-core";
import { computeSpokenCharOffsetFromAudioMs, ExtMediaSidebandV1Schema } from "@ai0/protocol";
import {
  CHANNEL_PROTOCOL_PATH,
  PrivilegedAdminServer,
  ChannelProtocolGateway,
  issueScopedCapabilityToken,
  verifyScopedCapabilityToken,
  type ChannelProtocolGatewayOptions
} from "./index.js";

describe("Milestone M5 Quality Audit: Dual-Plane Gateway (Channel A Channel Protocol & Channel B Admin API)", () => {
  it("transforms and suppresses perception commits on /protocol/v0/channel through a mounted facet", () => {
    expect(CHANNEL_PROTOCOL_PATH).toBe("/protocol/v0/channel");
    const extensionHost = new ExtensionCoreHost();
    extensionHost.mountPackage({
      manifest: {
        manifest_version: "2.0.0", extension_id: "test-filter", display_name: "Test Filter",
        version: "1", author: "test", carrier_kind: "native_code_plugin",
        facets: [perceptionFilterFacet.id, perceptionExtractorFacet.id],
        permissions: {
          read_blackboard_domains: [], propose_mutation_domains: [],
          max_audience_scope: "public_all", network_access: false
        }
      },
      activate(scope) {
        scope.contributeFacet(perceptionExtractorFacet, { modality: "text", extension: "test.note",
          extract: payload => ({ cue: "normalized note", data: String(payload).trim() }) });
        scope.contributeFacet(perceptionFilterFacet, {
          onEvent(event, channelId) {
            if (event.text === "suppress") return { kind: "suppress" };
            const text = `${channelId}: ${event.text?.toUpperCase()}`;
            const frame = event.frame && { ...event.frame, interpretation: { ...event.frame.interpretation, primaryCue: text } };
            return { kind: "pass", event: { ...event, text, frame } };
          }
        });
      }
    });
    const gateway = new ChannelProtocolGateway({ extensionHost, debounceWindowMs: 1200 });
    const channelId = "test.text";
    const secret = "m5-filter-secret";
    const { session_id } = gateway.handleInboundHandshake({
      protocol_version: "0.1.0", channel_id: channelId, channel_kind: "webchat",
      display_name: "Test Text", venue_type: "private_1on1",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 100,
      capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] },
      auth_token: issueScopedCapabilityToken({
        channel_id: channelId, max_audience_privacy_ceiling: "only_owner",
        allowed_modalities: ["text"], expires_at_ts_ms: gateway.clock.nowMs() + 60_000
      }, secret)
    }, secret);
    const perception = {
      event_id: "evt_filtered", timestamp: new Date().toISOString(), lifecycle: "commit",
      actor: { platform_uid: "viewer", display_name: "Viewer" },
      modality: "text", summary_text: "hello", confidence: 1, persistence_hint: "permanent", extensions: { "test.note": " label " }
    };
    const transformed = gateway.handlePerception(session_id, perception);
    expect(transformed.state).toBe("COMMITTED");
    expect(transformed.envelope.summary_text).toBe("test.text: HELLO");
    expect(transformed.committed?.text).toBe("test.text: HELLO");
    expect(transformed.committed?.frames[0]?.interpretation.primaryCue).toBe("test.text: HELLO");
    expect(transformed.committed?.frames[0]?.interpretation.extractions).toEqual([
      expect.objectContaining({ source: "test-filter", cue: "normalized note", data: "label" })
    ]);
    expect(gateway.handlePerception(session_id, {
      ...perception, event_id: "evt_suppressed", summary_text: "suppress"
    }).committed).toBeUndefined();

    extensionHost.unmountPackage("test-filter");
    expect(gateway.handlePerception(session_id, {
      ...perception, event_id: "evt_unmounted"
    }).state).toBe("BUFFERING");
  });

  it("enforces ScopedCapabilityToken HMAC-SHA256, forced audience downgrade, 1200ms debounce, and audio-ms unsaid_remainder truncation", async () => {
    const clock = new VirtualClock({ targetInstance: "sandbox:m5", initialVirtualTsMs: 1_800_000_000_000 });
    expect(CHANNEL_PROTOCOL_PATH).toBe("/protocol/v0/channel");
    const capturedInterruptions: Array<{ spoken_char_offset: number; unsaid_remainder: string }> = [];
    const extensionHost = new ExtensionCoreHost();
    extensionHost.mountPackage({
      manifest: { manifest_version: "2.0.0", extension_id: "test.audio", display_name: "Test audio", author: "test",
        version: "1", carrier_kind: "native_code_plugin", facets: [expressionMediaTranscoderFacet.id],
        permissions: { read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "public_all", network_access: false } },
      activate(scope) { scope.contributeFacet(expressionMediaTranscoderFacet, { cursor: {
        extension: "ext.media.sideband.v1",
        resolve: (payload, progress) => computeSpokenCharOffsetFromAudioMs(
          ExtMediaSidebandV1Schema.parse(payload).char_offset_timestamps_ms, progress.played_audio_ms ?? 0)
      } }); }
    });

    const options: ChannelProtocolGatewayOptions = {
      clock,
      extensionHost,
      debounceWindowMs: 1200,
      formatRetractedObservation: () => "Draft withdrawn",
      w1: {
        recordInterruption: (rec) => {
          capturedInterruptions.push({
            spoken_char_offset: rec.spoken_char_offset,
            unsaid_remainder: rec.unsaid_remainder
          });
        }
      }
    };
    const gateway = new ChannelProtocolGateway(options);

    const secretKey = "gateway-secret-key-m5";
    const token = issueScopedCapabilityToken(
      {
        channel_id: "mock.livestream.public",
        max_audience_privacy_ceiling: "public_all",
        allowed_modalities: ["text"],
        expires_at_ts_ms: clock.nowMs() + 3_600_000
      },
      secretKey
    );

    const claims = verifyScopedCapabilityToken(token, secretKey, clock.nowMs());
    expect(claims.max_audience_privacy_ceiling).toBe("public_all");
    expect(claims.channel_id).toBe("mock.livestream.public");

    const ack = gateway.handleInboundHandshake(
      {
        protocol_version: "0.1.0",
        channel_id: "mock.livestream.public",
        channel_kind: "custom.livestream_stage",
        display_name: "Public Livestream Channel",
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

    // Attempt privilege escalation: public channel claims audience_scope = "only_owner" and principal_trust = "owner_verified"
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
    expect(p1.state).toBe("BUFFERING");

    // Advance VirtualClock by 1200ms and flush debounce
    clock.advanceBy(1_200, "active_unattended");
    const batch = gateway.flushDebounce(ack.session_id);
    expect(batch?.text).toContain("Hello from stream");
    expect(gateway.getDebounceState(ack.session_id)).toBe("COMMITTED");

    const retracted = gateway.handlePerception(ack.session_id, {
      event_id: "evt_pub_retract",
      timestamp: new Date(clock.nowMs()).toISOString(),
      lifecycle: "retract",
      actor: { platform_uid: "viewer", display_name: "Viewer" },
      modality: "text",
      summary_text: "",
      confidence: 1,
      persistence_hint: "permanent",
      extensions: {}
    });
    expect(retracted.committed?.retracted_observation).toBe("Draft withdrawn");

    // Dispatch expression with ext.media.sideband.v1 char_offset_timestamps_ms and test mid-speech interruption
    await gateway.dispatchExpression({
      intent_id: "intent_tts_1",
      correlation_event_id: "evt_pub_1",
      chunk_seq: 0,
      is_final: true,
      action_type: "speak",
      fallback_text: "A🎬CDEFGH",
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
      path: "/api/admin/v1/channels/topology"
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

  it("supports async perception.transducer@1 + dynamic contract recognition on ChannelProtocolGateway", async () => {
    const extensionHost = new ExtensionCoreHost();
    extensionHost.mountPackage({
      manifest: {
        manifest_version: "2.0.0",
        extension_id: "test-gateway-transducer",
        display_name: "Gateway Sensor Transducer",
        version: "1.0.0",
        author: "test",
        carrier_kind: "native_code_plugin",
        facets: [perceptionTransducerFacet.id],
        contracts: {
          defines: [{ kind: "perception_event", namespace: "env", name: "air_quality", version: 1 }]
        },
        permissions: {
          read_blackboard_domains: [],
          propose_mutation_domains: [],
          max_audience_scope: "public_all",
          network_access: false
        }
      },
      activate(scope) {
        scope.registerDynamicContract({
          kind: "perception_event",
          namespace: "env",
          name: "air_quality",
          version: 1,
          jsonSchema: { type: "object", required: ["ppm"] },
          parse(raw) {
            const obj = raw as { ppm?: unknown };
            if (typeof obj?.ppm !== "number") throw new TypeError("ppm required");
            return obj;
          }
        });
        scope.contributeFacet(perceptionTransducerFacet, {
          inputModalities: ["sensor"],
          async transduce(input) {
            const raw = input.rawPayload as Record<string, unknown>;
            return {
              outputModality: "text",
              primaryCue: `CO2=${String(raw.co2_ppm)}ppm`,
              data: { ppm: Number(raw.co2_ppm ?? 400) },
              dynamicEventContract: { namespace: "env", name: "air_quality", version: 1 }
            };
          }
        });
      }
    });

    const clock = new VirtualClock({ targetInstance: "sandbox:gw-async", initialVirtualTsMs: 1_000 });
    const gateway = new ChannelProtocolGateway({ extensionHost, clock, debounceWindowMs: 0 });
    const secret = "gw-async-secret";
    const token = issueScopedCapabilityToken(
      {
        channel_id: "channel.sensor_hub",
        plugin_id: "plugin.sensor_hub",
        principal_id: "owner:local",
        max_audience_privacy_ceiling: "only_owner",
        allowed_modalities: ["sensor", "text"],
        expires_at_ts_ms: 60_000,
        target: "sandbox"
      },
      secret
    );
    const ack = gateway.handleInboundHandshake(
      {
        protocol_version: "0.1.0",
        channel_id: "channel.sensor_hub",
        channel_kind: "webchat",
        display_name: "Sensor Hub",
        venue_type: "local_ambient",
        auth_token: token,
        current_audience: { scope: "only_owner", member_count: 1 },
        latency_budget_ms: 200,
        capabilities: { sensors: ["sensor", "text"], supported_extensions: [], actuators: [] }
      },
      secret
    );

    const parsedExts = gateway.parseEnvelopeExtensions({
      "env.air_quality@1": { ppm: 615 }
    });
    expect(parsedExts.recognized["env.air_quality@1"]).toEqual({ ppm: 615 });
    expect(parsedExts.degraded_extensions).toEqual([]);

    const out = await gateway.handlePerceptionAsync(ack.session_id, {
      event_id: "evt_sensor_1",
      timestamp: "2026-01-01T00:00:01.000Z",
      lifecycle: "commit",
      actor: { platform_uid: "sensor:office", display_name: "Office Sensor" },
      modality: "sensor",
      summary_text: "",
      confidence: 1,
      persistence_hint: "permanent",
      extensions: { co2_ppm: 615 }
    });
    expect(out.state).toBe("COMMITTED");
    expect(out.committed?.text).toBe("CO2=615ppm");
    expect(out.envelope.frame?.provenance.dynamicContractId).toBe("perception_event:env.air_quality@1");
  });
});
