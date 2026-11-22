import type { ReactElement } from "react";
import {
  createWebChatStageViewModel,
  type WebChatProtocolClient,
  type WebChatQuickSensor,
  type WebChatStageViewModel,
  type WebChatTranscriptBubble
} from "@ai0/plugin-shell-webchat";

import { StatusBadge } from "../primitives/StatusBadge.js";
import { RippleButton } from "../primitives/RippleButton.js";
import { CompactInput, CompactSelect } from "../primitives/index.js";

export interface MountedShellStageHostProps {
  shellPluginId?: string;
  personaName?: string;
  client?: WebChatProtocolClient;
  stageModel?: WebChatStageViewModel;
  initialTranscript?: readonly WebChatTranscriptBubble[];
  draftText?: string;
  actualPlayedAudioMs?: number;
  onStageChange?: (model: WebChatStageViewModel) => void;
}

const SENSOR_LABELS: Record<WebChatQuickSensor, string> = {
  typing: "👋 戳一戳脑袋",
  voice_activity: "🎙️ 语音低频唤醒",
  window_focus: "💻 深夜写代码窗口焦点"
};

export function MountedShellStageHost(props: MountedShellStageHostProps): ReactElement {
  const pluginId = props.shellPluginId ?? "builtin.webchat";
  const personaName = props.personaName ?? "Mio";
  const stage =
    props.stageModel ??
    (props.client
      ? createWebChatStageViewModel({
          client: props.client,
          initialTranscript: props.initialTranscript,
          onChange: props.onStageChange
        })
      : undefined);
  const sensors: WebChatQuickSensor[] = ["typing", "voice_activity", "window_focus"];
  const interrupt = (): void => {
    if (stage) void stage.interrupt({ actualPlayedAudioMs: props.actualPlayedAudioMs ?? 0 });
  };
  const send = (): void => {
    if (stage && props.draftText?.trim()) void stage.sendMessage(props.draftText);
  };
  const transcript = stage?.transcript ?? props.initialTranscript ?? [];

  return (
    <section
      className="mounted-shell-stage-host"
      data-shell-plugin-id={pluginId}
      aria-label="Mounted shell stage"
    >
      <header>
        <div className="mounted-shell-stage-host__persona">
          <div className="mounted-shell-stage-host__avatar" aria-hidden="true">
            ✦
          </div>
          <div>
            <strong style={{ display: "block", fontSize: "13.5px" }}>
              {personaName} · Mounted Shell Stage
            </strong>
            <small style={{ fontFamily: "var(--ai0-font-mono)" }}>
              /shells/stage/{pluginId} · Protocol v0 Zero-Backdoor
            </small>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <CompactSelect
            className="ai0-webchat-venue"
            ariaLabel="Chat venue scope"
            defaultValue="private_1on1|only_owner"
            options={[
              { value: "private_1on1|only_owner", label: "🔒 私密 1v1 · only_owner" },
              { value: "public_livestream|public_all", label: "📡 公开直播间 · public_all (70%面具)" }
            ]}
          />
          <StatusBadge tone="success">WebChat mounted</StatusBadge>
        </div>
      </header>

      <div className="mounted-shell-stage-host__transcript">
        {transcript.length === 0 ? (
          <article className="mounted-shell-stage-host__bubble is-assistant">
            <small>{personaName}</small>
            <span>嗨，你来啦。Protocol v0 通道已经握手就绪，随时可以开始对话或测试中途打断。</span>
          </article>
        ) : (
          transcript.map((bubble) => (
            <article
              key={bubble.id}
              className={`mounted-shell-stage-host__bubble is-${bubble.role}`}
              data-streaming={bubble.streaming}
            >
              <small>{bubble.role === "user" ? "Owner" : personaName}</small>
              <span>{bubble.text}</span>
              {bubble.streaming ? <em>streaming…</em> : null}
            </article>
          ))
        )}
        {stage?.streamingExpressionPreview ? (
          <p className="mounted-shell-stage-host__preview">{stage.streamingExpressionPreview}</p>
        ) : null}
      </div>

      {stage?.cuePills.length ? (
        <div className="mounted-shell-stage-host__cues" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {stage.cuePills.map((cue, idx) => (
            <StatusBadge key={`${cue.label}-${idx}`} tone="info">{`${cue.label}: ${cue.value}`}</StatusBadge>
          ))}
        </div>
      ) : null}

      {stage?.unsaidRemainderBadge ? (
        <p className="mounted-shell-stage-host__remainder">
          {stage.unsaidRemainderBadge.label}: {stage.unsaidRemainderBadge.text}
        </p>
      ) : null}

      <footer style={{ display: "grid", gap: "8px" }}>
        <div className="mounted-shell-stage-host__composer">
          <CompactInput
            type="text"
            className="ai0-webchat-input"
            ariaLabel="消息正文"
            placeholder={`和 ${personaName} 说点什么…（回车发送，支持实时写入 SQLite 与 8 步轨迹）`}
          />
          <RippleButton className="is-primary" data-webchat-send="true" onClick={send}>
            发送消息
          </RippleButton>
          <RippleButton data-webchat-interrupt="true" onClick={interrupt}>
            ⚡ 中途打断
          </RippleButton>
        </div>
        <div className="mounted-shell-stage-host__sensors">
          <small style={{ marginRight: "4px" }}>快捷感官事件：</small>
          {sensors.map((sensor) => (
            <RippleButton
              key={sensor}
              type="button"
              size="sm"
              data-quick-sensor={sensor}
              onClick={() => {
                if (stage) void stage.triggerSensor(sensor);
              }}
            >
              {SENSOR_LABELS[sensor]}
            </RippleButton>
          ))}
        </div>
      </footer>
    </section>
  );
}
