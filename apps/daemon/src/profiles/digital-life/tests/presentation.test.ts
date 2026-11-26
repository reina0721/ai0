const style = { syncAnchor: "on_utterance_start", attentionBehavior: "glancing" } as const;
import { describe, expect, it } from "vitest";
import { EXT_EMBODIED_V1_KEY, ExtEmbodiedV1Schema, HandshakeManifestSchema } from "@ai0/protocol";
import { RealizerVocabularyNegotiator } from "@ai0/expression-core";
import { renderEmbodiedPresentation } from "../presentation.js";

describe("@ai0/expression-core intent negotiation & four-state grounding", () => {
  it.each([
    { surface: null, publicExtensions: [EXT_EMBODIED_V1_KEY], lampExtensions: [EXT_EMBODIED_V1_KEY] },
    { surface: null, publicExtensions: [], lampExtensions: [] },
    { surface: undefined, publicExtensions: [], lampExtensions: [] }
  ])("negotiates quiet non-verbal cues and falls back to text for surface=$surface, extensions=$publicExtensions",
    ({ surface, publicExtensions, lampExtensions }) => {
    const negotiator = new RealizerVocabularyNegotiator(undefined, style, renderEmbodiedPresentation);
    const publicChannel = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      channel_id: "channel.public.stream",
      channel_kind: "webchat",
      display_name: "Public Stream",
      venue_type: "public_livestream",
      current_audience: { scope: "public_all", member_count: 40 },
      latency_budget_ms: 800,
      capabilities: {
        ...(surface === undefined ? {} : { embodiment_surface: surface }),
        expression_vocabulary: { expression_tags: ["smile"] },
        sensors: ["text"],
        supported_extensions: publicExtensions,
        actuators: []
      },
      auth_token: "tok"
    });
    negotiator.mount(publicChannel);

    const held = negotiator.negotiate({
      intentId: "int_priv_1",
      correlationEventId: "evt_1",
      intent: "communicate",
      utterance: "Private reminder about your clinic appointment.",
      deliveryConstraints: { audienceScope: "only_owner" }
    });
    expect(held).toEqual({ status: "held_pending_compliant_channel", envelope: null });

    const textOnly = negotiator.negotiate({
      intentId: "int_text_fallback",
      correlationEventId: "evt_1",
      intent: "communicate",
      utterance: "Hello!",
      expressiveStance: { semanticCue: "smile" },
      deliveryConstraints: { audienceScope: "public_all" }
    });
    expect(textOnly.envelope).toMatchObject({ action_type: "speak", fallback_text: "Hello!", extensions: {} });
    expect(textOnly.envelope?.extensions[EXT_EMBODIED_V1_KEY]).toBeUndefined();
    expect(textOnly.envelope?.expressive_stance).toBeUndefined();

    const privateLamp = HandshakeManifestSchema.parse({
      protocol_version: "0.1.0",
      channel_id: "channel.private.lamp",
      channel_kind: "hardware_iot",
      display_name: "Desk Lamp",
      venue_type: "local_ambient",
      current_audience: { scope: "only_owner", member_count: 1 },
      latency_budget_ms: 150,
      capabilities: {
        embodiment_surface: { surface_id: "lamp", supported_tokens: [
          { token: "led.pulse_amber", semanticAction: "gentle_nudge", kind: "nonverbal", quiet: true, latencyMs: 60 }
        ] },
        expression_vocabulary: { expression_tags: ["warm_glow"] },
        sensors: [],
        supported_extensions: lampExtensions,
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

    const neutral = new RealizerVocabularyNegotiator();
    neutral.mount(privateLamp);
    const neutralIntent = { intentId: "plain", correlationEventId: "source", intent: "communicate" as const,
      attentionTarget: "interlocutor", utterance: "hello", deliveryConstraints: { audienceScope: "only_owner" as const } };
    expect(neutral.negotiate(neutralIntent).envelope?.extensions).toEqual({});
    expect(negotiator.negotiate(neutralIntent).envelope?.extensions[EXT_EMBODIED_V1_KEY])
      .toMatchObject({ sync_anchor: "on_utterance_start", attention: { behavior: "glancing" } });

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
    expect(dispatched.channelId).toBe("channel.private.lamp");
    expect(dispatched.envelope.actuator_invocation?.actuator_id).toBe("led.pulse_amber");
    const embodied = ExtEmbodiedV1Schema.parse(dispatched.envelope.extensions[EXT_EMBODIED_V1_KEY]);
    expect(embodied.keyframes).toEqual([
      { sync_anchor: "on_utterance_start", expression: { tag: "led.pulse_amber", intensity: 0.6 } }
    ]);
  });

});
