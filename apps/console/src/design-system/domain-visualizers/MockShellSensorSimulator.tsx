import type { ReactElement } from "react";
import {
  computeSpokenCharOffsetFromAudioMs,
  type ControlSignal,
  type DeliveryReceipt,
  type HandshakeManifest,
  type PerceptionEnvelope
} from "@ai0/protocol";

import { RippleButton } from "../primitives/RippleButton.js";
import { StatusBadge } from "../primitives/StatusBadge.js";

export interface MockShellSensorSimulatorProps {
  shellId?: string;
  draftText?: string;
  expressionText?: string;
  alignmentMs?: readonly number[];
  playedAudioMs?: number;
  onHandshake?: (manifest: HandshakeManifest) => void;
  onPerception?: (envelope: PerceptionEnvelope) => void;
  onBargeIn?: (event: { receipt: DeliveryReceipt; control: ControlSignal }) => void;
}

export function MockShellSensorSimulator(props: MockShellSensorSimulatorProps): ReactElement {
  const shellId = props.shellId ?? "mock.protocol-v0.shell";
  const text = props.draftText ?? "A simulated sensory event arrived.";
  const utterance = props.expressionText ?? "Streaming speech that can be interrupted.";
  const alignment = props.alignmentMs ?? Array.from({ length: Array.from(utterance).length }, (_, index) => index * 52);
  const playedMs = props.playedAudioMs ?? 420;
  const handshake = (): void => props.onHandshake?.({
    protocol_version: "0.1.0", shell_id: shellId, shell_kind: "custom.mock_simulator", display_name: "Mock Shell",
    venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 }, latency_budget_ms: 1_200,
    capabilities: { sensors: ["text", "typing_activity"], supported_extensions: [], expression_vocabulary: {}, actuators: [] }, auth_token: "simulated"
  } as HandshakeManifest);
  const inject = (): void => props.onPerception?.({
    event_id: `mock-${Date.now()}`, timestamp: new Date().toISOString(), actor: { platform_uid: "simulator", display_name: "Mock Shell" },
    lifecycle: "commit", modality: "text", summary_text: text, confidence: 1, persistence_hint: "ephemeral_blackboard", extensions: {}
  } as PerceptionEnvelope);
  const interrupt = (): void => {
    const offset = computeSpokenCharOffsetFromAudioMs(alignment, playedMs);
    const receipt = { intent_id: "mock-intent", chunk_seq: 0, status: "interrupted", spoken_char_offset: offset, played_audio_ms: playedMs } as DeliveryReceipt;
    const control = { signal_type: "barge_in_cancel", target_intent_id: "mock-intent", payload: { spoken_char_offset: offset, unsaid_remainder: Array.from(utterance).slice(offset).join("") } } as ControlSignal;
    props.onBargeIn?.({ receipt, control });
  };

  return <section className="mock-shell-sensor-simulator" aria-label="Mock shell sensor simulator">
    <header><div><strong>Protocol v0 simulator</strong><span>{shellId}</span></div><StatusBadge tone="sandbox">Sandbox only</StatusBadge></header>
    <p>Handshake and inject a committed perception without mounting a real shell.</p>
    <div className="mock-shell-sensor-simulator__actions">
      <RippleButton onClick={handshake}>Send ai0.handshake</RippleButton>
      <RippleButton onClick={inject}>Inject perception</RippleButton>
    </div>
    <div className="mock-shell-sensor-simulator__barge-in">
      <span>Speech cursor: {playedMs}ms · character {computeSpokenCharOffsetFromAudioMs(alignment, playedMs)}</span>
      <RippleButton onClick={interrupt}>Barge-in interrupt</RippleButton>
    </div>
  </section>;
}
