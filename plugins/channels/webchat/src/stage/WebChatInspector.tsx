import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import useMediaQuery from "@mui/material/useMediaQuery";
import { X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";

import type { WebChatStatus } from "./api.js";
import { ProcessDetails } from "./WebChatProcess.js";
import type { ChatTurn } from "./useWebChatSession.js";

const STATUS_LABELS: Record<WebChatStatus, string> = {
  accepted: "已接收", generating: "生成中", delivering: "传送中", completed: "已完成",
  interrupted: "已打断", cancelled: "已取消", failed: "回复失败"
};

interface WebChatInspectorProps {
  id: string;
  open: boolean;
  turn?: ChatTurn;
  onClose: () => void;
}

export function WebChatInspector(props: WebChatInspectorProps) {
  const { id, open, turn, onClose } = props;
  const mobile = useMediaQuery("(max-width: 900px)");
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open && !mobile) panel.current?.focus({ preventScroll: true });
  }, [mobile, open]);

  if (!open) return null;

  const rendered = turn?.receipt?.spokenCharOffset;
  const provider = turn?.process?.provider ?? turn?.provider;
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
              <div><b>{status}</b>{provider ? <code>{provider.name} · {provider.model}</code> : null}</div>
              <p>{turn.userText}</p>
              {turn.traceId ? <code>{turn.traceId}</code> : null}
            </section>
            <ProcessDetails turn={turn} />
            {typeof rendered === "number" ? (
              <section className="ai0-chat-inspector__section">
                <h3>送达回执</h3>
                <p>{turn.status === "interrupted" ? "已打断 · " : ""}已显示 {rendered} 字</p>
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
