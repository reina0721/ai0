import { composerActions, type ComposerCommand } from "../contracts.js";
import {
  ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive,
  ThreadPrimitive, useAui, useAuiState, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike
} from "@assistant-ui/react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import TextareaAutosize from "@mui/material/TextareaAutosize";
import Tooltip from "@mui/material/Tooltip";
import type { Ai0ChannelStageHostBridge, Ai0ChannelStageHostState, Ai0StageMode } from "@ai0/sdk";
import {
  ArrowDown, ArrowDownToLine, ArrowUpRight, Copy, Lock, PanelRight, Search, Send, Sparkles, Square, SquarePen, X
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type RefObject
} from "react";

import { isFinishedChatRun } from "./api.js";
import { useWebChatSession, type ChatTurn } from "./useWebChatSession.js";
import { ProcessPanel, STAGE_LABELS, UsageBar } from "./WebChatProcess.js";
import { WebChatInspector } from "./WebChatInspector.js";
import { WebChatMarkdown } from "./WebChatMarkdown.js";

const PROMPTS = [
  { title: "认识一下", text: "介绍一下你自己。" },
  { title: "梳理工作", text: "帮我梳理今天的工作重点。" },
  { title: "探索能力", text: "我们可以一起做些什么？" }
] as const;

const formatTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

function displayTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? formatTime.format(date) : timestamp;
}

function toMessages(turn: ChatTurn): ThreadMessageLike[] {
  const createdAt = new Date(turn.timestamp);
  const timestamp = Number.isFinite(createdAt.getTime()) ? { createdAt } : {};
  const metadata = { custom: { turn } };
  return [
    { id: `${turn.key}:u`, role: "user", content: turn.userText, metadata, ...timestamp },
    {
      id: `${turn.key}:a`, role: "assistant", content: turn.assistantText, metadata, ...timestamp,
      status: !isFinishedChatRun(turn.status) ? { type: "running" }
        : turn.status === "completed" ? { type: "complete", reason: "stop" }
        : { type: "incomplete", reason: turn.status === "failed" ? "error" : "cancelled" }
    }
  ];
}

const convertMessage = (message: ThreadMessageLike) => message;

function matchesQuery(turn: ChatTurn, query: string): boolean {
  return [turn.userText, turn.assistantText, turn.traceId].some((value) => value?.toLocaleLowerCase().includes(query));
}

function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function useBrowserOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

interface MessageWorkspace {
  name: string;
  visible: boolean;
  query: string;
  inspectTurn: (key: string, trigger: HTMLElement) => void;
  restoreText: (text: string) => void;
  showToast: (message: string) => void;
  reportDisplayed: ReturnType<typeof useWebChatSession>["reportDisplayed"];
}

const MessageWorkspaceContext = createContext<MessageWorkspace | null>(null);

function MessageRow() {
  const scope = useContext(MessageWorkspaceContext);
  const message = useAuiState((state) => state.message);
  const reduceMotion = useReducedMotion();
  const turn = message.metadata.custom.turn as ChatTurn | undefined;
  const isUser = message.role === "user";
  const text = message.content.map((part) => part.type === "text" ? part.text : "").join("");
  const visible = scope?.visible ?? false;
  const reportDisplayed = scope?.reportDisplayed;
  const query = scope?.query ?? "";
  const shown = Boolean(turn && (!query || !isFinishedChatRun(turn.status) || matchesQuery(turn, query)));

  useEffect(() => {
    if (!isUser && turn && shown) reportDisplayed?.(turn.requestId, text, visible);
  }, [isUser, reportDisplayed, shown, text, turn, visible]);

  if (!turn || !scope || !shown) return null;
  const pending = !isFinishedChatRun(turn.status);
  const canReuse = isUser && ["interrupted", "cancelled", "failed"].includes(turn.status);
  const hasDetails = !isUser && !pending && Boolean(turn.traceId || turn.process?.stages.length);

  return (
    <MessagePrimitive.Root asChild>
      <m.article
        className={`ai0-chat-message${isUser ? " is-user" : " is-assistant"}`}
        data-message-role={message.role}
        data-message-status={turn.status}
        data-message-turn-id={turn.requestId ?? turn.eventId}
        initial={reduceMotion ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
      >
        <div className="ai0-chat-message__body">
          <div className="ai0-chat-message__meta">
            {!isUser ? <span className="ai0-chat-message__avatar" aria-hidden="true"><Sparkles size={13} /></span> : null}
            <strong>{isUser ? "我" : scope.name}</strong>
            <time dateTime={turn.timestamp}>{displayTime(turn.timestamp)}</time>
          </div>
          {!isUser && <ProcessPanel turn={turn} pending={pending} />}
          {isUser ? <p className="ai0-chat-message__user-text">{text}</p>
            : text ? <WebChatMarkdown text={text} streaming={pending} onToast={scope.showToast} />
            : pending ? <span className="ai0-chat-message__pending" aria-hidden="true"><i /><i /><i /></span>
            : null}
          {!isUser && turn.sources?.filter(s=>text.includes("[K"+s.marker+"]")).map(s=>(
            <details key={s.chunkId}><summary>[K{s.marker}] {s.title} · {s.location}</summary><blockquote>{s.excerpt}</blockquote></details>
          ))}
          {!isUser && turn.status === "held_pending_compliant_channel" ? <small className="ai0-chat-message__result">等待符合交付条件的渠道</small> : null}
          {!isUser && (turn.status === "interrupted" || turn.status === "cancelled" || turn.status === "failed") ? (
            <small className="ai0-chat-message__result">
              {turn.status === "interrupted" ? "回复已打断" : turn.status === "failed" ? "未完成回复" : "已取消请求"}
            </small>
          ) : null}
          {!isUser && turn.unconfirmed ? <small className="ai0-chat-message__result">送达待确认</small> : null}
          <div className="ai0-chat-message__actions">
            {text && !pending ? (
              <Tooltip describeChild title={<span>复制消息</span>}>
                <ActionBarPrimitive.Copy asChild aria-label="复制消息">
                  <IconButton className="ai0-chat-icon-action" size="small"><Copy size={14} aria-hidden="true" /></IconButton>
                </ActionBarPrimitive.Copy>
              </Tooltip>
            ) : null}
            {hasDetails ? (
              <Tooltip describeChild title={<span>查看本轮详情</span>}>
                <IconButton className="ai0-chat-icon-action" size="small" aria-label="查看本轮详情"
                  onClick={(event) => scope.inspectTurn(turn.key, event.currentTarget)}>
                  <PanelRight size={14} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            ) : null}
            {canReuse ? (
              <Button className="ai0-chat-text-action" onClick={() => scope.restoreText(turn.userText)}>取回原文</Button>
            ) : null}
          </div>
        </div>
      </m.article>
    </MessagePrimitive.Root>
  );
}

function Welcome({ inputRef }: { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const aui = useAui();
  const hasDraft = useAuiState((state) => state.composer.text.length > 0);
  return (
    <div className="ai0-chat-welcome">
      <div className="ai0-chat-welcome__mark" aria-hidden="true"><Sparkles size={26} /></div>
      <h2>开始对话</h2>
      {!hasDraft ? (
        <div className="ai0-chat-welcome__prompts" aria-label="开场建议">
          {PROMPTS.map((prompt) => (
            <Button key={prompt.title} variant="outlined" endIcon={<ArrowUpRight size={13} aria-hidden="true" />} onClick={() => {
              if (!aui.composer().getState().text) aui.composer().setText(prompt.text);
              inputRef.current?.focus();
            }}>
              {prompt.title}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}


function ContributedActions({ host }: { host: Ai0ChannelStageHostBridge }) {
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  useEffect(() => host.contributions?.define(composerActions, command => {
    setCommands(current => [...current, command]);
    return () => setCommands(current => current.filter(item => item !== command));
  }), [host]);
  return <>{commands.map((command, index) => <Button key={index} onClick={command.run}>{command.label}</Button>)}</>;
}

function WebChatThread({ mode, visible, host, hostState, soulId }: {
  mode: Ai0StageMode;
  visible: boolean;
  host: Ai0ChannelStageHostBridge;
  hostState: Ai0ChannelStageHostState;
  soulId: string;
}) {
  const name = hostState.personaName || "数字生命";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const session = useWebChatSession(
    hostState.protocolBasePath,
    host.channelId,
    hostState.authToken,
    mode,
    soulId,
    visible
  );
  const pageVisible = usePageVisible();
  const online = useBrowserOnline();
  const reduceMotion = useReducedMotion();
  const offline = !online || Boolean(hostState.error);
  const connected = Boolean(hostState.authToken && hostState.connected && online && !offline);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [inspection, setInspection] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const inspectorId = useId();
  const query = search.trim().toLocaleLowerCase();
  const latestTurn = session.turns.at(-1);
  const inspectedTurn = inspection === "latest" ? latestTurn : session.turns.find((turn) => turn.key === inspection);
  const currentStage = latestTurn?.process?.stages.at(-1)?.stage;
  const inspectTurn = useCallback((key: string, trigger: HTMLElement) => {
    inspectorTrigger.current = trigger;
    setInspection(key);
  }, []);
  const closeInspector = useCallback(() => {
    setInspection(null);
    const trigger = inspectorTrigger.current;
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }, []);
  const messageCache = useMemo(() => new WeakMap<ChatTurn, ThreadMessageLike[]>(), []);
  const messages = useMemo(() => session.turns.flatMap((turn) => {
    const existing = messageCache.get(turn);
    if (existing) return existing;
    const next = toMessages(turn);
    messageCache.set(turn, next);
    return next;
  }), [messageCache, session.turns]);
  const onNew = useCallback(async (message: AppendMessage) => {
    setSearch("");
    setSearchOpen(false);
    await session.send(message.content.map((part) => part.type === "text" ? part.text : "").join(""));
  }, [session.send]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: session.running,
    isSendDisabled: !connected || !visible,
    onNew,
    onCancel: session.stop
  });
  // Keep a tab-local draft when the host disposes the target's plugin scope.
  useEffect(() => {
    if (!soulId) return;
    const key = JSON.stringify(["ai0.webchat.draft", soulId, host.channelId, mode]);
    const composer = runtime.thread.composer;
    const previous = sessionStorage.getItem(key);
    if (previous) composer.setText(previous);
    return composer.subscribe(() => {
      const text = composer.getState().text;
      if (text) sessionStorage.setItem(key, text);
      else sessionStorage.removeItem(key);
    });
  }, [soulId, host.channelId, mode, runtime]);
  const restoreText = useCallback((text: string) => {
    const composer = runtime.thread.composer;
    const draft = composer.getState().text;
    if (draft !== text && !draft.endsWith(`\n\n${text}`)) {
      composer.setText(draft ? `${draft}\n\n${text}` : text);
    }
    inputRef.current?.focus();
  }, [runtime]);
  const showToast = useCallback((message: string) => host.showToast(message), [host]);
  const scope = useMemo<MessageWorkspace>(() => ({
    name, visible: visible && pageVisible, query, inspectTurn, restoreText, showToast, reportDisplayed: session.reportDisplayed
  }), [inspectTurn, name, pageVisible, query, restoreText, showToast, session.reportDisplayed, visible]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    setSearch("");
    searchButton.current?.focus();
  }

  const matches = query ? session.turns.filter((turn) => matchesQuery(turn, query)).length : undefined;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MessageWorkspaceContext.Provider value={scope}>
        <ThreadPrimitive.Root className="ai0-chat-thread" data-webchat-target={mode}>
          <header className="ai0-chat-header">
            <div className="ai0-chat-heading">
              <div className="ai0-chat-heading__mark" aria-hidden="true"><Sparkles size={20} /></div>
              <div>
                <h1>{name}</h1>
                <div className="ai0-chat-heading__meta">
                  <span><Lock size={12} aria-hidden="true" /> {mode === "sandbox" ? "沙盒对话" : "私密对话"}</span>
                  <span className="ai0-chat-connection" data-state={offline ? "offline" : connected ? "online" : "connecting"}>
                    <i aria-hidden="true" />{offline ? "连接中断" : connected ? "已连接" : "连接中"}
                  </span>
                </div>
              </div>
            </div>
            <div className="ai0-chat-header__actions">
              <Tooltip describeChild title={<span>搜索对话</span>}>
                <IconButton ref={searchButton} className="ai0-chat-icon-action" size="small" aria-label="搜索对话"
                  aria-expanded={searchOpen} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>
                  <Search size={16} aria-hidden="true" />
                </IconButton>
              </Tooltip>
              <Tooltip describeChild title={<span>清空当前视图，可恢复已有记录</span>}>
                <span className="ai0-chat-action-anchor">
                  <Button className="ai0-chat-header-action" aria-label="清空当前显示"
                    disabled={session.running || session.turns.length === 0} data-clear-webchat="true"
                    onClick={() => {
                      session.clearView();
                      setInspection(null);
                      setSearch("");
                      setSearchOpen(false);
                      inputRef.current?.focus();
                    }}>
                    <SquarePen size={15} aria-hidden="true" /><span className="ai0-chat-action-label">清空视图</span>
                  </Button>
                </span>
              </Tooltip>
              <Tooltip describeChild title={<span>会话详情</span>}>
                <Button className="ai0-chat-header-action" aria-label="会话详情"
                  aria-expanded={inspection !== null} aria-controls={inspection ? inspectorId : undefined}
                  onClick={(event) => inspection ? closeInspector() : inspectTurn("latest", event.currentTarget)}>
                  <PanelRight size={15} aria-hidden="true" /><span className="ai0-chat-action-label">会话详情</span>
                </Button>
              </Tooltip>
            </div>
          </header>

          {searchOpen ? (
            <div className="ai0-chat-search">
              <Search aria-hidden="true" size={15} />
              <InputBase className="ai0-chat-search-field" inputRef={searchRef} placeholder="搜索对话内容或轨迹编号" value={search}
                slotProps={{ input: { "aria-label": "搜索此会话的记录" } }} onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) closeSearch(); }} />
              {matches !== undefined ? <output>{matches} 轮</output> : null}
              <Tooltip describeChild title={<span>关闭搜索</span>}>
                <IconButton className="ai0-chat-icon-action" onClick={closeSearch} size="small" aria-label="关闭搜索"><X size={15} /></IconButton>
              </Tooltip>
            </div>
          ) : null}

          {offline ? (
            <div className="ai0-chat-notice" role="status">
              <span>暂时无法连接。草稿仍可编辑。</span>
              {online ? <Button variant="outlined" onClick={() => host.retryConnection()}>重新连接</Button> : null}
            </div>
          ) : session.historyError ? (
            <div className="ai0-chat-notice" role="status">
              <span>历史记录暂不可用。</span>
              <Button variant="outlined" onClick={session.retryHistory}>重新读取</Button>
            </div>
          ) : null}

          <div className="ai0-chat-body" data-inspecting={inspection !== null}>
            <div className="ai0-chat-conversation">
              <ThreadPrimitive.Viewport className="ai0-chat-viewport" aria-label="对话记录" role="region" tabIndex={0}>
                <div className="ai0-chat-transcript">
                  {!session.turns.length && (session.historyLoading || (hostState.loading && !offline)) ? (
                    <div className="ai0-chat-loading" role="status">正在读取对话记录…</div>
                  ) : !session.turns.length && !query ? <Welcome inputRef={inputRef} /> : null}
                  {matches === 0 ? <p className="ai0-chat-empty">没有匹配的对话。</p> : null}
                  <ThreadPrimitive.Messages>{() => <MessageRow />}</ThreadPrimitive.Messages>
                </div>
              </ThreadPrimitive.Viewport>

              <footer className="ai0-chat-footer">
                <Tooltip describeChild title={<span>跳到最新消息</span>}>
                  <ThreadPrimitive.ScrollToBottom asChild behavior={reduceMotion ? "instant" : "smooth"} aria-label="跳到最新消息">
                    <IconButton className="ai0-chat-jump" size="small"><ArrowDown size={15} aria-hidden="true" /></IconButton>
                  </ThreadPrimitive.ScrollToBottom>
                </Tooltip>
                {session.running ? (
                  <div className="ai0-chat-activity" role="status">
                    <span className="ai0-chat-activity__dot" aria-hidden="true" />
                    {currentStage ? STAGE_LABELS[currentStage] : latestTurn?.unconfirmed ? "核对送达" : "准备回复"}
                  </div>
                ) : null}
                {session.notice ? (
                  <div className="ai0-chat-notice" role="status">
                    <span>{session.notice}</span>
                    {session.needsRecovery ? <Button variant="outlined" onClick={() => void session.checkStatus()}>核对状态</Button> : null}
                  </div>
                ) : null}
                {session.hasHiddenHistory && !session.running ? (
                  <div className="ai0-chat-history-toggle">
                    <Button variant="outlined" startIcon={<ArrowDownToLine size={14} aria-hidden="true" />} onClick={session.restoreHistory}>恢复对话显示</Button>
                  </div>
                ) : null}
                <ComposerPrimitive.Root className="ai0-chat-composer">
                  {visible && <ContributedActions host={host} />}
                  <ComposerPrimitive.Input
                    asChild
                    ref={inputRef}
                    placeholder={`发消息给 ${name}…`}
                    aria-label="输入聊天消息"
                    submitMode="enter"
                    unstable_insertNewlineOnTouchEnter
                    cancelOnEscape={false}
                    addAttachmentOnPaste={false}
                    maxLength={12000}
                  >
                    <TextareaAutosize className="ai0-chat-composer__input" minRows={1} maxRows={7} />
                  </ComposerPrimitive.Input>
                  {session.running ? (
                    <ComposerPrimitive.Cancel asChild data-webchat-interrupt="true" disabled={session.stopping}>
                      <Button variant="outlined" className="ai0-chat-composer__button is-stop" startIcon={<Square size={14} aria-hidden="true" />}>
                        {session.stopping ? "正在停止" : "停止"}
                      </Button>
                    </ComposerPrimitive.Cancel>
                  ) : (
                    <ComposerPrimitive.Send asChild data-webchat-send="true">
                      <Button variant="contained" className="ai0-chat-composer__button" startIcon={<Send size={14} aria-hidden="true" />}>发送</Button>
                    </ComposerPrimitive.Send>
                  )}
                </ComposerPrimitive.Root>
                <UsageBar key={latestTurn?.key ?? "empty"} turn={latestTurn} />
                <small className="ai0-chat-key-hint">Enter 发送 · Shift + Enter 换行</small>
              </footer>
            </div>
            <WebChatInspector
              id={inspectorId}
              open={visible && inspection !== null}
              turn={inspectedTurn}
              onClose={closeInspector}
            />
          </div>
        </ThreadPrimitive.Root>
      </MessageWorkspaceContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export function WebChatWorkspace({ host, hostState }: {
  host: Ai0ChannelStageHostBridge;
  hostState: Ai0ChannelStageHostState;
}) {
  const [lease, setLease] = useState("");
  const { authToken, protocolBasePath } = hostState;
  useEffect(() => {
    if (!authToken) return;
    let active = true;
    let sessionId = "";
    let timer: ReturnType<typeof setTimeout>;
    const base = protocolBasePath + "/connections";
    const headers = { authorization: "Bearer " + authToken, "content-type": "application/json" };
    const close = (id: string) => fetch(base + "/" + id, { method: "DELETE", headers, keepalive: true }).catch(() => {});
    const maintain = async () => {
      try {
        if (sessionId) {
          const renewed = await fetch(base + "/" + sessionId, { method: "PATCH", headers, body: "{}" });
          if (!renewed.ok) throw new Error("Lease expired");
        } else {
          const response = await fetch(base, { method: "POST", headers, body: JSON.stringify({
            protocol_version: "0.1.0", channel_id: host.channelId, channel_kind: "webchat", display_name: "WebChat",
            venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 },
            latency_budget_ms: 1200, capabilities: { sensors: ["text"], supported_extensions: [],
              expression_vocabulary: {}, actuators: [] }
          }) });
          if (!response.ok) throw new Error("Handshake refused");
          sessionId = (await response.json()).session_id;
          if (!active) { await close(sessionId); return; }
        }
        if (active) setLease(authToken);
      } catch {
        if (active) setLease("");
        sessionId = "";
      }
      if (active) timer = setTimeout(() => void maintain(), sessionId ? 15000 : 3000);
    };
    void maintain();
    return () => { active = false; clearTimeout(timer); if (sessionId) void close(sessionId); };
  }, [authToken, protocolBasePath, host]);
  const mode = hostState.mode;
  const soulId = hostState.soulId;
  const [identity, setIdentity] = useState({ soulId, revision: 0 });
  const [visited, setVisited] = useState<readonly Ai0StageMode[]>([mode]);

  if (soulId && identity.soulId !== soulId) {
    setIdentity({ soulId, revision: identity.revision + (identity.soulId ? 1 : 0) });
  }

  useEffect(() => {
    setVisited((values) => values.includes(mode) ? values : [...values, mode]);
  }, [mode]);

  return (
    <section className="mounted-channel-stage-host ai0-webchat" data-channel-plugin-id={host.extensionId} aria-label="WebChat 会话">
      {(["live", "sandbox"] as const).filter((target) => target === mode || visited.includes(target)).map((target) => (
        <div key={`${identity.revision}:${target}`} className="ai0-chat-workspace" hidden={target !== mode}>
          <WebChatThread
            mode={target}
            visible={target === mode}
            host={host}
            hostState={{ ...hostState, connected: Boolean(lease && lease === authToken) }}
            soulId={identity.soulId || "unawakened"}
          />
        </div>
      ))}
    </section>
  );
}
