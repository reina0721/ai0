import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { isFinishedChatRun, type WebChatStage } from "./api.js";
import type { ChatTurn } from "./useWebChatSession.js";

export const STAGE_LABELS: Record<WebChatStage, string> = {
  accepted: "接收请求", gate: "检查安全条件", recall: "检索记忆", blackboard: "整理上下文",
  generating: "生成回复", committed: "保存本轮记录", delivering: "传送回复"
};

const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("zh-CN");
const tokens = (n: number) => n < 1000 ? String(n) : decimal.format(n / 1000) + "k";
const percent = (n: number, total: number) => decimal.format(n / total * 100) + "%";

export function ProcessDetails({ turn }: { turn: ChatTurn }) {
  const { process, sources } = turn;
  return <div className="ai0-chat-process__details">
    {process?.stages.length ? <section className="ai0-chat-inspector__section">
      <h3>处理阶段 <span>累计耗时</span></h3>
      <ol className="ai0-chat-inspector__stages">
        {process.stages.map(({ stage, elapsedMs }) => <li key={stage}>
          <span>{STAGE_LABELS[stage]}</span>{elapsedMs !== undefined && <code>{elapsedMs} ms</code>}
        </li>)}
      </ol>
    </section> : <small>{isFinishedChatRun(turn.status) ? "本轮未记录处理阶段" : "等待处理"}</small>}
    {process?.reasoning && <section className="ai0-chat-inspector__section">
      <h3>模型思考</h3><p className="ai0-chat-process__reasoning">{process.reasoning}</p>
    </section>}
    {process?.memories && <section className="ai0-chat-inspector__section">
      <h3>记忆来源 <span>{process.memories.length}</span></h3>
      {process.memories.length ? <ul>{process.memories.map(memory => <li key={memory.id}>{memory.text}</li>)}</ul>
        : <p>本轮没有可显示的记忆来源。</p>}
    </section>}
    {!!sources?.length && <section className="ai0-chat-inspector__section">
      <h3>知识来源</h3>{sources.map(source => <details key={source.chunkId}>
        <summary>[K{source.marker}] {source.title} · {source.location}</summary><p>{source.excerpt}</p>
      </details>)}
    </section>}
  </div>;
}

export function ProcessPanel({ turn, pending }: { turn: ChatTurn; pending: boolean }) {
  const [manual, setManual] = useState<boolean>();
  const id = useId();
  const expanded = manual ?? pending;
  const elapsed = turn.process?.elapsedMs;
  return <div className="ai0-chat-process">
    <button type="button" className="ai0-chat-process__toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setManual(!expanded)}>
      <ChevronDown size={14} aria-hidden="true" />本轮过程
      {elapsed !== undefined && <small>{elapsed < 1000 ? elapsed + " ms" : decimal.format(elapsed / 1000) + " 秒"}</small>}
    </button>
    {expanded && <div id={id}><ProcessDetails turn={turn} /></div>}
  </div>;
}

export function UsageBar({ turn }: { turn?: ChatTurn }) {
  const provider = turn?.process?.provider ?? turn?.provider;
  const usage = turn?.process?.usage;
  const input = usage?.inputTokens;
  const windowSize = usage?.contextWindow;
  const hits = usage?.cachedInputTokens;
  const local = provider?.name === "deterministic-sandbox" || provider?.name === "local";
  const fallback = !turn || local ? "—"
    : !isFinishedChatRun(turn.status) && !provider ? "统计中"
    : !provider && !usage && !turn.process?.stages.some(stage => stage.elapsedMs !== undefined) ? "未记录" : "未提供";
  const context = input === undefined ? fallback : windowSize
    ? tokens(input) + " / " + tokens(windowSize) + "（" + percent(input, windowSize) + "）" : tokens(input);
  const hitRate = hits === undefined ? fallback : input === undefined || input === 0 ? "未提供" : percent(hits, input);
  const count = (value?: number) => value === undefined ? fallback : integer.format(value);
  return <details className="ai0-chat-usage">
    <summary>{local && <span>本地生成</span>}<span>上下文 {context}</span><span>缓存命中 {hitRate}</span><ChevronDown size={13} aria-hidden="true" /></summary>
    <dl>
      <dt>模型</dt><dd>{local ? "本地生成" : provider?.model ?? fallback}</dd>
      <dt>上下文窗口</dt><dd>{count(windowSize)}</dd>
      <dt>输入 token</dt><dd>{count(input)}</dd><dt>输出 token</dt><dd>{count(usage?.outputTokens)}</dd>
      <dt>缓存命中 token</dt><dd>{count(hits)}</dd>
      {usage?.reasoningTokens !== undefined && <><dt>推理 token</dt><dd>{count(usage.reasoningTokens)}</dd></>}
    </dl>
  </details>;
}
