import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleMode } from "../api/client.js";
import {
  createWebChatApi, isFinishedChatRun, spokenCharOffset, WebChatHttpError,
  type WebChatHistoryTurn, type WebChatReceipt, type WebChatRun, type WebChatStageEvent, type WebChatStatus, type WebChatStreamChunk
} from "./api.js";

export interface ChatTurn {
  key: string;
  requestId?: string;
  eventId?: string;
  traceId?: string;
  timestamp: string;
  userText: string;
  assistantText: string;
  status: WebChatStatus;
  provider?: WebChatRun["provider"];
  receipt?: WebChatReceipt;
  stages?: readonly WebChatStageEvent[];
  unconfirmed?: boolean;
}

interface ActiveRun {
  readonly requestId: string;
  readonly stream: AbortController;
  readonly controls: AbortController;
  text: string;
  displayed: number;
  ready: boolean;
  stopping: boolean;
  confirming: boolean;
  stages: WebChatStageEvent[];
}

function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function newRun(requestId: string): ActiveRun {
  return {
    requestId, stream: new AbortController(), controls: new AbortController(),
    text: "", displayed: 0, ready: false, stopping: false, confirming: false, stages: []
  };
}

function fromHistory(turn: WebChatHistoryTurn): ChatTurn {
  return {
    ...turn,
    key: turn.requestId ?? turn.eventId,
    status: turn.receipt?.status ?? "completed",
    unconfirmed: Boolean(turn.requestId && !turn.receipt)
  };
}

function mergeHistory(history: readonly ChatTurn[], current: readonly ChatTurn[]): ChatTurn[] {
  const merged = [...history];
  for (const turn of current) {
    const index = merged.findIndex((item) => item.key === turn.key || (turn.eventId && item.eventId === turn.eventId));
    if (index === -1) merged.push(turn);
    else merged[index] = { ...merged[index]!, ...turn };
  }
  return merged;
}

function readHiddenTurns(storageKey: string): string[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(data) ? data.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function useWebChatSession(ownerToken: string, mode: ConsoleMode, soulId: string, visible: boolean) {
  const api = useMemo(() => createWebChatApi(ownerToken, mode), [ownerToken, mode]);
  const targetInstance = mode === "sandbox" ? "sandbox:console" : "live";
  const storageKey = `ai0:webchat:hidden:${soulId}:${targetInstance}`;
  const active = useRef<ActiveRun | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [hiddenTurns, setHiddenTurns] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyRequest, setHistoryRequest] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const visibleTurns = useMemo(() => {
    const hidden = new Set(hiddenTurns);
    return turns.filter((turn) => !hidden.has(turn.key) && (!turn.eventId || !hidden.has(turn.eventId)));
  }, [hiddenTurns, turns]);

  useEffect(() => setHiddenTurns(readHiddenTurns(storageKey)), [storageKey]);

  useEffect(() => () => {
    const run = active.current;
    active.current = null;
    run?.stream.abort();
    run?.controls.abort();
  }, []);

  const updateTurn = useCallback((run: ActiveRun, patch: Partial<ChatTurn>) => {
    setTurns((current) => current.map((turn) => turn.requestId === run.requestId ? { ...turn, ...patch } : turn));
  }, []);

  const acceptStatus = useCallback((run: ActiveRun, result: WebChatRun) => {
    if (active.current !== run || result.requestId !== run.requestId || result.targetInstance !== targetInstance) return;
    const finished = isFinishedChatRun(result.status);
    const text = result.text ?? run.text;
    run.text = result.status === "interrupted" && result.receipt
      ? Array.from(text).slice(0, result.receipt.spokenCharOffset).join("")
      : text;
    run.ready ||= result.deliveryFinished === true;
    updateTurn(run, {
      ...(result.eventId ? { eventId: result.eventId } : {}),
      ...(result.traceId ? { traceId: result.traceId } : {}),
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.receipt ? { receipt: result.receipt } : {}),
      assistantText: run.text,
      status: result.status,
      unconfirmed: false
    });
    if (finished) {
      active.current = null;
      setRunning(false);
      setStopping(false);
      setNeedsRecovery(false);
      setNotice(result.status === "failed" ? "本次回复生成失败。" : null);
      run.stream.abort();
    }
  }, [targetInstance, updateTurn]);

  const recover = useCallback(async (run: ActiveRun) => {
    if (active.current !== run) return;
    setNeedsRecovery(false);
    try {
      const result = await api.status(run.requestId, run.controls.signal);
      if (result.targetInstance === targetInstance && result.requestId === run.requestId && result.deliveryFinished) {
        run.confirming = false;
      }
      acceptStatus(run, result);
      if (active.current !== run) return;
      if (result.targetInstance === targetInstance && result.requestId === run.requestId && run.ready) {
        setNotice(null);
      } else {
        setNotice("正在等待原请求的结果。可再次核对状态。");
        setNeedsRecovery(true);
      }
    } catch (error) {
      if (active.current !== run) return;
      if (error instanceof WebChatHttpError && error.status === 404) {
        acceptStatus(run, { requestId: run.requestId, targetInstance, status: "failed" });
        setNotice("未找到本次请求的回执。可从消息中取回原文，再决定是否发送。");
      } else {
        setNotice("暂时无法核对本次请求。连接恢复后可重新查询。");
        setNeedsRecovery(true);
      }
    }
  }, [acceptStatus, api, targetInstance]);

  useEffect(() => {
    if (!ownerToken || !visible) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(false);
    void api.history(controller.signal).then(({ turns: history }) => {
      if (controller.signal.aborted) return;
      const targetHistory = history.filter((turn) => turn.targetInstance === targetInstance);
      setTurns((current) => mergeHistory(targetHistory.map(fromHistory), current));
      const latest = targetHistory.at(-1);
      if (!active.current && latest?.requestId && !latest.receipt && !readHiddenTurns(storageKey).includes(latest.eventId)) {
        const run = newRun(latest.requestId);
        active.current = run;
        setRunning(true);
        void recover(run);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setHistoryError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => controller.abort();
  }, [api, historyRequest, ownerToken, recover, storageKey, targetInstance, visible]);

  const reportDisplayed = useCallback((requestId: string | undefined, text: string, isVisible: boolean) => {
    const run = active.current;
    if (!run || run.requestId !== requestId || !isVisible) return;
    run.displayed = spokenCharOffset(text);
    if (!run.ready || run.confirming || run.stopping || text !== run.text) return;
    run.confirming = true;
    void api.receipt(run.requestId, run.displayed, run.controls.signal)
      .then((result) => acceptStatus(run, result))
      .catch(() => {
        if (active.current !== run) return;
        setNotice("回复已显示，回执尚未确认。");
        setNeedsRecovery(true);
      });
  }, [acceptStatus, api]);

  const send = useCallback(async (draft: string) => {
    const text = draft.trim();
    if (!text || !ownerToken || active.current) return;
    const run = newRun(newRequestId());
    active.current = run;
    setNotice(null);
    setNeedsRecovery(false);
    setRunning(true);
    setTurns((current) => [...current, {
      key: run.requestId,
      requestId: run.requestId,
      timestamp: new Date().toISOString(),
      userText: text,
      assistantText: "",
      status: "accepted"
    }]);

    let reader: ReadableStreamDefaultReader<WebChatStreamChunk> | undefined;
    try {
      reader = (await api.open(run.requestId, text, run.stream.signal)).getReader();
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        if (active.current !== run) return;
        const chunk = next.value;
        if (chunk.type === "data-turn") {
          acceptStatus(run, chunk.data);
        } else if (chunk.type === "data-turn-stage") {
          const stage = chunk.data;
          run.stages = [...run.stages.filter((item) => item.stage !== stage.stage), stage];
          updateTurn(run, { stages: run.stages });
        } else if (chunk.type === "text-delta" && !run.stopping) {
          run.text += chunk.delta;
          updateTurn(run, { assistantText: run.text, status: "delivering" });
        } else if (chunk.type === "error") {
          throw new Error(chunk.errorText);
        }
      }
    } catch {
      if (active.current !== run) return;
    } finally {
      reader?.releaseLock();
    }
    if (active.current === run && !run.stopping && !run.ready) await recover(run);
  }, [acceptStatus, api, ownerToken, recover, updateTurn]);

  const stop = useCallback(async () => {
    const run = active.current;
    if (!run || run.stopping || run.confirming) return;
    run.stopping = true;
    setStopping(true);
    setNeedsRecovery(false);
    try {
      acceptStatus(run, await api.stop(run.requestId, run.displayed, run.controls.signal));
    } catch {
      if (active.current === run) {
        run.stopping = false;
        setStopping(false);
        await recover(run);
      }
    }
  }, [acceptStatus, api, recover]);

  const checkStatus = useCallback(async () => {
    const run = active.current;
    if (!run) return;
    await recover(run);
  }, [recover]);

  function saveHidden(next: string[]) {
    setHiddenTurns(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
  }

  function clearView() {
    saveHidden([...new Set([...hiddenTurns, ...turns.flatMap((turn) => turn.eventId ? [turn.key, turn.eventId] : [turn.key])])].slice(-1000));
    setNotice(null);
  }

  return {
    turns: visibleTurns,
    hasHiddenHistory: hiddenTurns.length > 0,
    historyLoading,
    historyError,
    retryHistory: () => setHistoryRequest((request) => request + 1),
    clearView,
    restoreHistory: () => saveHidden([]),
    running,
    stopping,
    notice,
    needsRecovery,
    send,
    stop,
    checkStatus,
    reportDisplayed
  };
}
