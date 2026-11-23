import {
  ExtAffectV1Schema,
  ExtRhythmV1Schema,
  type ExpressionEnvelope,
  type PerceptionEnvelope,
  type SensorModality
} from "@ai0/protocol";

import {
  type BargeInResult,
  type WebChatProtocolClient
} from "../client/webchat-protocol-client.js";

export const WEBCHAT_STAGE_ROUTE = "/webchat";

export interface WebChatTranscriptBubble {
  id: string;
  role: "user" | "assistant" | "sensor";
  text: string;
  streaming: boolean;
  intent_id?: string;
}
export interface WebChatCuePill {
  kind: "emotion" | "prosody";
  label: string;
  value: string;
}
export interface UnsaidRemainderBadge {
  label: "Unsaid remainder";
  text: string;
}
export type WebChatQuickSensor = "typing" | "voice_activity" | "window_focus";

export interface WebChatStageViewProps {
  client: WebChatProtocolClient;
  initialTranscript?: readonly WebChatTranscriptBubble[];
  onChange?: (model: WebChatStageViewModel) => void;
}
export interface WebChatStageViewModel {
  readonly routePath: typeof WEBCHAT_STAGE_ROUTE;
  readonly transcript: readonly WebChatTranscriptBubble[];
  readonly streamingExpressionPreview: string;
  readonly cuePills: readonly WebChatCuePill[];
  readonly unsaidRemainderBadge: UnsaidRemainderBadge | null;
  sendMessage(text: string): Promise<PerceptionEnvelope>;
  interrupt(options: { actualPlayedAudioMs: number; spokenCharOffset?: number }): Promise<BargeInResult>;
  triggerSensor(sensor: WebChatQuickSensor): Promise<PerceptionEnvelope>;
  destroy(): void;
}

const SENSOR_EVENTS: Record<WebChatQuickSensor, {
  modality: SensorModality; summary: string; confidence: number; sustained_ms?: number;
}> = {
  typing: { modality: "typing_activity", summary: "Owner is typing", confidence: 1,
    sustained_ms: 1_200 },
  voice_activity: { modality: "vad_activity", summary: "Owner started speaking", confidence: 0.95 },
  window_focus: { modality: "window_focus", summary: "WebChat regained focus", confidence: 1 }
};

function cuePillsFor(chunk: ExpressionEnvelope): WebChatCuePill[] {
  const pills: WebChatCuePill[] = [];
  const affect = ExtAffectV1Schema.safeParse(chunk.extensions["ext.affect.v1"]);
  if (affect.success) pills.push({ kind: "emotion", label: "Emotion", value: affect.data.label });
  const rhythm = ExtRhythmV1Schema.safeParse(chunk.extensions["ext.rhythm.v1"]);
  if (rhythm.success) {
    const prosody = rhythm.data.prosody;
    pills.push({ kind: "prosody", label: "Prosody", value: prosody
      ? `${prosody.vocal_effort} · ${prosody.speed_rate.toFixed(2)}×`
      : `${rhythm.data.pre_delay_ms}ms lead` });
  }
  return pills;
}

export function createWebChatStageViewModel(
  props: WebChatStageViewProps
): WebChatStageViewModel {
  const transcript = (props.initialTranscript ?? []).map((bubble) => ({ ...bubble }));
  let preview = "";
  let cuePills: WebChatCuePill[] = [];
  let unsaidBadge: UnsaidRemainderBadge | null = null;
  let model: WebChatStageViewModel;
  const notify = (): void => props.onChange?.(model);

  const unsubscribe = props.client.onExpression((chunk) => {
    const text = props.client.getExpressionText(chunk.intent_id);
    const id = `expression:${chunk.intent_id}`;
    const existing = transcript.find((bubble) => bubble.id === id);
    if (existing) {
      existing.text = text;
      existing.streaming = !chunk.is_final;
    } else {
      transcript.push({ id, role: "assistant", text, streaming: !chunk.is_final,
        intent_id: chunk.intent_id });
    }
    preview = chunk.is_final ? "" : text;
    cuePills = cuePillsFor(chunk);
    notify();
  });

  model = {
    routePath: WEBCHAT_STAGE_ROUTE,
    get transcript() { return transcript; },
    get streamingExpressionPreview() { return preview; },
    get cuePills() { return cuePills; },
    get unsaidRemainderBadge() { return unsaidBadge; },

    async sendMessage(text: string): Promise<PerceptionEnvelope> {
      const normalized = text.trim();
      if (!normalized) throw new TypeError("WebChat messages must not be empty.");
      transcript.push({ id: `user:${Date.now()}:${transcript.length}`, role: "user",
        text: normalized, streaming: false });
      unsaidBadge = null;
      notify();
      return props.client.commitText(normalized);
    },

    async interrupt(options): Promise<BargeInResult> {
      const result = await props.client.interruptCurrent(options);
      preview = "";
      unsaidBadge = result.unsaid_remainder
        ? { label: "Unsaid remainder", text: result.unsaid_remainder }
        : null;
      for (const bubble of transcript) {
        if (bubble.role === "assistant" && bubble.streaming) bubble.streaming = false;
      }
      notify();
      return result;
    },

    async triggerSensor(sensor): Promise<PerceptionEnvelope> {
      const event = SENSOR_EVENTS[sensor];
      transcript.push({ id: `sensor:${sensor}:${Date.now()}`, role: "sensor",
        text: event.summary, streaming: false });
      notify();
      return props.client.commitPerception({ summary_text: event.summary,
        modality: event.modality, confidence: event.confidence,
        ...(event.sustained_ms === undefined ? {} : { sustained_ms: event.sustained_ms }),
        persistence_hint: "ephemeral_blackboard" });
    },

    destroy(): void { unsubscribe(); }
  };
  return model;
}
