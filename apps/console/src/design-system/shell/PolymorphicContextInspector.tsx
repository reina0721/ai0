import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import type { ReactElement } from "react";
import type { VerifiableTurnTrace } from "@ai0/protocol";

import { RippleButton, SpoilerMask } from "../primitives/index.js";
import { renderConsoleIcon } from "../tokens/index.js";

export type ContextInspectorMode = "mini" | "trace" | "sandbox-diff";

export interface PolymorphicContextInspectorProps {
  mode: ContextInspectorMode;
  trace?: VerifiableTurnTrace;
  baselineTrace?: VerifiableTurnTrace;
  sandboxTrace?: VerifiableTurnTrace;
  className?: string;
  onModeChange?: (mode: ContextInspectorMode) => void;
}

const receiptLabels: Record<string, string> = {
  rendered: "已渲染", playing: "播放中", completed: "完整送达",
  interrupted: "已中断", degraded: "降级送达", failed: "送达失败"
};

function TraceSections({ trace }: { trace?: VerifiableTurnTrace }): ReactElement {
  if (!trace) return <p className="ai0-inspector-empty">暂无可用追踪。下一轮交互后可查看运行记录。</p>;
  const { step1_perception: input, step2_gate_safety: gate, step3_memory_recall: memory,
    step4_homeostasis: affect, step5_strategy_proposal: strategy, step6_tool_auth: tool,
    step7_emitted_intent: intent, step8_delivery_receipt: receipt } = trace.steps;
  const mood = affect.code_clamped_post_state.mood_valence;
  const cards = [
    { label: "输入与受众", body: <><p>{input.summary_text}</p><code>{input.audience_scope} · {input.venue_type}</code></> },
    { label: "感官门控", body: <p>{gate.recognized_intent} · {gate.l0_sb243_crisis_check} · 合并 {gate.debounce_merged_events} 项</p> },
    { label: "记忆召回", body: <>
      <p>{memory.recalled_memories.length ? "本轮召回 " + memory.recalled_memories.length + " 项记忆。" : "本轮未召回长期记忆。"}</p>
      {memory.recalled_memories.length ? <ul>{memory.recalled_memories.map((item) => <li key={item.memory_id}>{item.content_text}</li>)}</ul> : null}
    </> },
    { label: "状态更新", body: <p>rev {trace.state_rev_before} → {trace.state_rev_after}{typeof mood === "number" ? " · 心境 " + mood.toFixed(2) : ""}</p> },
    { label: "回应策略", body: <>
      <p>{strategy.chosen_strategy}</p>
      {strategy.theatrical_subtext?.raw_text ? <SpoilerMask label={strategy.theatrical_subtext.masked_placeholder}>{strategy.theatrical_subtext.raw_text}</SpoilerMask> : null}
    </> },
    { label: "工具授权", body: <p>{tool.external_tool_invoked?.tool_id ?? "本轮未调用外部工具"} · {tool.auth_decision}</p> },
    { label: "输出意图", body: <p>{intent.action_type} · {intent.extensions_attached.join("、") || "无表现扩展"}</p> },
    { label: "送达回执", body: <p>{receipt ? (receiptLabels[receipt.status] ?? receipt.status) + " · " + receipt.spoken_char_offset + " 字" : "尚未收到送达回执。"}</p> }
  ];
  return (
    <section className="ai0-inspector-trace">
      <code className="ai0-inspector-trace-id">{trace.trace_id}</code>
      {cards.map(({ label, body }, index) => (
        <Accordion key={label} disableGutters elevation={0} square defaultExpanded={index < 1}>
          <AccordionSummary expandIcon={renderConsoleIcon("chevron-down", 14)}>
            <span className="ai0-trace-step-card__num">{String(index + 1).padStart(2, "0")}</span>{label}
          </AccordionSummary>
          <AccordionDetails>{body}</AccordionDetails>
        </Accordion>
      ))}
    </section>
  );
}

export function PolymorphicContextInspector(props: PolymorphicContextInspectorProps): ReactElement {
  if (props.mode === "mini") return <aside hidden data-mode="mini" />;
  return (
    <aside data-mode={props.mode} className={"ai0-polymorphic-context-inspector ai0-inspector-surface " + (props.className ?? "")}>
      <header className="ai0-drawer-title">
        <h2>{props.mode === "trace" ? "运行追踪" : "沙盒 A/B 对照"}</h2>
        <RippleButton variant="ghost" size="sm" ariaLabel="关闭运行检视" className="ai0-icon-button" onClick={() => props.onModeChange?.("mini")}>
          {renderConsoleIcon("close", 14)}
        </RippleButton>
      </header>
      {props.mode === "trace" ? <TraceSections trace={props.trace} /> : (
        <div className="ai0-context-inspector__diff">
          <section><h3>LIVE</h3><TraceSections trace={props.baselineTrace} /></section>
          <section><h3>SANDBOX</h3><TraceSections trace={props.sandboxTrace} /></section>
        </div>
      )}
    </aside>
  );
}
