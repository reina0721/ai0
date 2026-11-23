import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { VerifiableTurnTrace } from "@ai0/protocol";
import type { Ai0ShellStageHostBridge, Ai0ShellStageHostState, Ai0StageMode } from "@ai0/sdk";
import { X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import { isFinishedChatRun, type WebChatStage, type WebChatStatus } from "./api.js";
import type { ChatTurn } from "./useWebChatSession.js";

export const STAGE_LABELS: Record<WebChatStage, string> = {
  accepted: "接收请求", gate: "检查安全条件", recall: "检索记忆", blackboard: "整理上下文",
  generating: "生成回复", committed: "保存本轮记录", delivering: "传送回复"
};

const STATUS_LABELS: Record<WebChatStatus, string> = {
  accepted: "已接收", generating: "生成中", delivering: "传送中", completed: "已完成",
  interrupted: "已打断", cancelled: "已取消", failed: "回复失败"
};

interface WebChatInspectorProps {
  id: string;
  open: boolean;
  mode: Ai0StageMode;
  turn?: ChatTurn;
  host: Ai0ShellStageHostBridge;
  hostState: Ai0ShellStageHostState;
  onClose: () => void;
}

function useTurnTrace({ open, turn, mode, host, hostState }: WebChatInspectorProps) {
  const target = mode === "sandbox" ? "sandbox:console" : "live";
  const traceId = turn?.traceId;
  const requestId = turn?.requestId;
  const finished = Boolean(turn && isFinishedChatRun(turn.status) && !turn.unconfirmed);
  const [retry, setRetry] = useState(0);
  const [resolved, setResolved] = useState<{ key: string; trace?: VerifiableTurnTrace }>();
  const lookupKey = `${target}:${traceId ?? ""}:${retry}`;

  const snapshotTrace = !requestId && hostState.targetInstance === target
    ? hostState.recentTraces?.find(
        (entry) => entry.trace_id === traceId && entry.steps.step1_perception.audience_scope === "only_owner"
      )
    : undefined;

  useEffect(() => {
    if (!open) {
      setResolved(undefined);
      return;
    }
    if (!finished || !traceId || snapshotTrace || !hostState.authToken) return;
    const controller = new AbortController();
    void host.fetchTurnTrace({ requestId, traceId, mode, signal: controller.signal })
      .then((trace) => {
        if (controller.signal.aborted) return;
        const matched = trace && trace.target_instance === target
          && trace.steps.step1_perception.audience_scope === "only_owner"
          ? trace
          : undefined;
        setResolved({ key: lookupKey, trace: matched });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolved({ key: lookupKey });
      });
    return () => controller.abort();
  }, [finished, host, hostState.authToken, lookupKey, mode, open, requestId, snapshotTrace, target, traceId]);

  const result = resolved?.key === lookupKey ? resolved : undefined;
  return {
    trace: snapshotTrace ?? result?.trace,
    loading: open && finished && Boolean(traceId) && Boolean(hostState.authToken) && !snapshotTrace && !result,
    error: open && finished && Boolean(traceId) && !snapshotTrace && (!hostState.authToken || (result && !result.trace)),
    retry: () => setRetry((revision) => revision + 1)
  };
}

export function WebChatInspector(props: WebChatInspectorProps) {
  const { id, open, turn, onClose } = props;
  const mobile = useMediaQuery("(max-width: 900px)");
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  const panel = useRef<HTMLElement>(null);
  const { trace, loading, error, retry } = useTurnTrace(props);

  useEffect(() => {
    if (open && !mobile) panel.current?.focus({ preventScroll: true });
  }, [mobile, open]);

  if (!open) return null;

  const receipt = trace?.steps.step8_delivery_receipt;
  const memories = trace?.steps.step3_memory_recall.recalled_memories;
  const rendered = turn?.receipt?.spokenCharOffset ?? receipt?.spoken_char_offset;
  const status = turn ? (turn.unconfirmed ? "回执待确认" : STATUS_LABELS[turn.status]) : undefined;

  const content = (
    <aside
      id={id}
      ref={panel}
      className="ai0-chat-inspector"
      aria-labelledby={labelId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (!mobile && event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="ai0-chat-inspector__header">
        <h2 id={labelId}>会话详情</h2>
        <IconButton className="ai0-chat-icon-action" size="small" aria-label="关闭会话详情" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="ai0-chat-inspector__body">
        {turn ? (
          <>
            <section className="ai0-chat-inspector__summary">
              <div><b>{status}</b>{turn.provider ? <code>{turn.provider.name} · {turn.provider.model}</code> : null}</div>
              <p>{turn.userText}</p>
              {turn.traceId ? <code>{turn.traceId}</code> : null}
            </section>
            {turn.stages?.length ? (
              <section className="ai0-chat-inspector__section">
                <h3>处理阶段 <span>累计耗时</span></h3>
                <ol className="ai0-chat-inspector__stages" aria-label="从接收请求开始的累计耗时">
                  {turn.stages.map(({ stage, elapsedMs }) => (
                    <li key={stage}><span>{STAGE_LABELS[stage]}</span><code>{Math.round(elapsedMs)} ms</code></li>
                  ))}
                </ol>
              </section>
            ) : null}
            {typeof rendered === "number" ? (
              <section className="ai0-chat-inspector__section">
                <h3>送达回执</h3>
                <p>{turn.status === "interrupted" ? "已打断 · " : ""}已显示 {rendered} 字</p>
              </section>
            ) : null}
            {loading || error ? (
              <p className="ai0-chat-inspector__state" role="status">
                {loading ? "正在读取本轮追踪…" : "暂时无法读取本轮追踪。"}
                {error ? <Button size="small" onClick={retry}>重试</Button> : null}
              </p>
            ) : null}
            {memories ? (
              <section className="ai0-chat-inspector__section">
                <h3>记忆来源 <span>{memories.length}</span></h3>
                {!memories.length ? <p>本轮未召回长期记忆。</p> : (
                  <ul className="ai0-chat-inspector__sources">
                    {memories.map((memory) => (
                      <li key={memory.memory_id}><p>{memory.content_text}</p><code>{memory.memory_id}</code></li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        ) : <p className="ai0-chat-inspector__state">开始对话后，这里会显示本轮处理阶段与送达记录。</p>}
      </div>
    </aside>
  );

  return mobile ? (
    <Drawer
      open
      anchor="right"
      onClose={onClose}
      transitionDuration={reduceMotion ? 0 : 190}
      slotProps={{ paper: { className: "ai0-chat-inspector-drawer", "aria-labelledby": labelId } }}
    >{content}</Drawer>
  ) : content;
}
