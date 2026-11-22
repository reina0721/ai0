import type { CSSProperties, ReactElement } from "react";
import {
  computeSpokenCharOffsetFromAudioMs,
  type EmbodiedKeyframe,
  type ExtMediaSidebandV1
} from "@ai0/protocol";

import { StatusBadge } from "../primitives/StatusBadge.js";
import { TonalSlider } from "../primitives/TonalSlider.js";

export interface EmbodiedKeyframeTimelineProps {
  keyframes: readonly EmbodiedKeyframe[];
  mediaSideband?: ExtMediaSidebandV1;
  playedAudioMs?: number;
  onScrub?: (audioMs: number, spokenCharOffset: number) => void;
}

const cue = (keyframe: EmbodiedKeyframe): string => [
  keyframe.gaze && `gaze:${keyframe.gaze.target}`,
  keyframe.facial && `face:${keyframe.facial.expression}`,
  keyframe.gesture && `gesture:${keyframe.gesture.intent}`
].filter(Boolean).join(" · ") || "neutral hold";

export function EmbodiedKeyframeTimeline(props: EmbodiedKeyframeTimelineProps): ReactElement {
  const sideband = props.mediaSideband;
  const duration = sideband?.total_duration_ms ?? 1_000;
  const audioMs = Math.max(0, Math.min(props.playedAudioMs ?? 0, duration));
  const spokenOffset = sideband
    ? computeSpokenCharOffsetFromAudioMs(sideband.char_offset_timestamps_ms, audioMs) : 0;
  const frames = props.keyframes.slice(0, 3);

  return <section className="embodied-keyframe-timeline" aria-label="Embodied expression timeline">
    <header className="embodied-keyframe-timeline__header">
      <div><strong>ext.embodied.v1</strong><span>Three-keyframe expression plan</span></div>
      <StatusBadge tone="info">{`${audioMs}ms → char ${spokenOffset}`}</StatusBadge>
    </header>
    <ol className="embodied-keyframe-timeline__rail" style={{ "--keyframe-count": frames.length } as CSSProperties}>
      {frames.map((frame, index) => <li key={index} className="embodied-keyframe-timeline__frame">
        <span className="embodied-keyframe-timeline__node">{index + 1}</span>
        <strong>{frame.sync_anchor}</strong><small>{cue(frame)}</small>
        <small>{frame.linger_ms ? `${frame.linger_ms}ms linger` : "sync cue"}</small>
      </li>)}
    </ol>
    <div className="embodied-keyframe-timeline__scrubber">
      <TonalSlider value={audioMs} min={0} max={duration} unit="ms" label="Audio alignment"
        onInput={(next) => props.onScrub?.(next, sideband
          ? computeSpokenCharOffsetFromAudioMs(sideband.char_offset_timestamps_ms, next) : 0)} />
      <span>ext.media.sideband.v1 · {sideband?.audio_stream_id ?? "no audio stream"}</span>
    </div>
  </section>;
}
