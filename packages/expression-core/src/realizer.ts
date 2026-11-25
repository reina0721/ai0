import { EXT_EMBODIED_V1_KEY, type CommunicativeIntentEnvelope, type ExpressionEnvelope,
  type ExpressionVocabulary, type HandshakeManifest, type NegotiatedIntentDispatch } from "@ai0/protocol";

export class RealizerVocabularyNegotiator {
  private readonly shells = new Map<string, HandshakeManifest>();
  private readonly media = new Map<string, ExpressionVocabulary>();

  mount(shell: HandshakeManifest) { this.shells.set(shell.shell_id, structuredClone(shell)); }
  hasShell(shellId: string): boolean { return this.shells.has(shellId); }
  unmount(shellId: string) { this.shells.delete(shellId); this.media.delete(shellId); }
  mountMediaVocabulary(shellId: string, vocabulary: ExpressionVocabulary) {
    this.media.set(shellId, structuredClone(vocabulary));
  }

  negotiate(intent: CommunicativeIntentEnvelope, preferredShellId?: string): NegotiatedIntentDispatch {
    const constraints = intent.deliveryConstraints;
    for (const shell of this.shells.values()) {
      if (preferredShellId !== undefined && preferredShellId !== shell.shell_id) continue;
      if (shell.current_audience.scope !== constraints.audienceScope ||
          (constraints.maxLatencyMs !== undefined && shell.latency_budget_ms > constraints.maxLatencyMs)) continue;
      const caps = shell.capabilities;
      const affordance = caps.realizer_affordances?.find(value =>
        value.semanticAction === (intent.actuationHint?.semanticAction ?? intent.intent)
        && (!constraints.requireNonVerbalQuiet || (value.kind === "nonverbal" && value.quiet))
        && (constraints.maxLatencyMs === undefined || (value.latencyMs ?? shell.latency_budget_ms) <= constraints.maxLatencyMs));
      if (constraints.requireNonVerbalQuiet && !affordance && intent.intent !== "explicit_silence") continue;
      const actuatorId = affordance?.token ?? intent.actuationHint?.semanticAction;
      if (intent.intent === "actuate" && !caps.actuators.some(actuator => actuator.actuator_id === actuatorId)) continue;
      const vocabulary = caps.expression_vocabulary;
      const media = this.media.get(shell.shell_id);
      const stance = intent.expressiveStance;
      const tag = stance?.semanticCue;
      const expression = tag && [vocabulary?.expression_tags, vocabulary?.facial_expressions, media?.expression_tags]
        .some(tags => tags?.includes(tag)) ? { tag, intensity: stance?.intensity ?? 1 } : undefined;
      const gesture = stance?.gestureIntent;
      const haptic = stance?.hapticCue;
      const supportsEmbodied = caps.supported_extensions.includes(EXT_EMBODIED_V1_KEY);
      if (constraints.requireNonVerbalQuiet && intent.intent === "communicate" && !affordance) continue;
      const envelope: ExpressionEnvelope = {
        intent_id: intent.intentId, correlation_event_id: intent.correlationEventId, chunk_seq: 0, is_final: true,
        action_type: intent.intent === "communicate" ? (constraints.requireNonVerbalQuiet ? "explicit_silence" : "speak")
          : intent.intent === "actuate" ? "invoke_actuator" : intent.intent,
        fallback_text: intent.intent === "communicate" && !constraints.requireNonVerbalQuiet ? intent.utterance ?? "" : "",
        attention_target: intent.attentionTarget, observation_request: intent.observationRequest,
        delivery_constraints: constraints, expressive_stance: stance,
        ...(intent.intent === "actuate" && actuatorId ? { actuator_invocation: {
          actuator_id: actuatorId, arguments: intent.actuationHint?.arguments ?? {}
        } } : {}),
        extensions: supportsEmbodied ? { [EXT_EMBODIED_V1_KEY]: {
          sync_anchor: "pre_speech",
          ...(intent.attentionTarget ? { attention: { target: intent.attentionTarget, behavior: "locked" } } : {}),
          ...(expression ? { expression } : {}),
          ...(gesture && (vocabulary?.gesture_intents?.includes(gesture) || media?.gesture_intents?.includes(gesture))
            ? { gesture: { category: "semantic", intent: gesture } } : {}),
          ...(haptic && (vocabulary?.haptic_cues?.includes(haptic) || media?.haptic_cues?.includes(haptic))
            ? { haptic: { cue_tag: haptic } } : {})
        } } : {}
      };
      return { status: "dispatched", shellId: shell.shell_id, envelope };
    }
    return { status: "held_pending_compliant_shell", envelope: null };
  }
}
