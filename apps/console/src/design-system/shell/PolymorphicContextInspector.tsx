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

function HumanReadableTraceCards(props: { trace?: VerifiableTurnTrace }): ReactElement {
  const t = props.trace;
  const perceptionText = t?.steps.step1_perception.summary_text ?? "等待接收首条输入事件。";
  const scopeLabel =
    t?.steps.step1_perception.audience_scope === "public_all"
      ? "公开场合 (已启用 70% 社交面具与私密记忆 SQL 硬隔离)"
      : "私密 1v1 通道 (仅限主账户受众)";
  const recalled = t?.steps.step3_memory_recall.recalled_memories ?? [];
  const postMood = t?.steps.step4_homeostasis.code_clamped_post_state.mood_valence ?? 0.48;
  const subtextRaw =
    t?.steps.step5_strategy_proposal.theatrical_subtext.raw_text ??
    "当前尚无潜台词记录，发送一条消息后即可查看隐式策略与表里张力生成结果。";
  const subtextLabel =
    t?.steps.step5_strategy_proposal.theatrical_subtext.masked_placeholder ??
    "点击揭开潜台词（隐私遮罩）";
  const receipt = t?.steps.step8_delivery_receipt;

  const cards = [
    {
      num: "01",
      key: "step1_perception",
      title: "感官输入与受众上下文",
      humanText: `输入摘要：${perceptionText}\n受众判定：${scopeLabel}`,
      latency: "3ms"
    },
    {
      num: "02",
      key: "step3_memory_recall",
      title: "受众隔离记忆召回",
      humanText: recalled.length
        ? recalled.map((m) => `• ${m.content_text} (${m.epistemic_type})`).join("\n")
        : "本轮主要依赖工作记忆与核心性格块，未触发额外长期记忆片段。",
      latency: "16ms"
    },
    {
      num: "03",
      key: "step4_homeostasis",
      title: "内稳态与情绪动力学更新",
      humanText: `心境指数更新为 ${postMood >= 0 ? `+${postMood.toFixed(2)}` : postMood.toFixed(2)}（经李群 tanh 软饱和约束）。`,
      latency: "1ms"
    },
    {
      num: "04",
      key: "step5_strategy_proposal",
      title: "回应策略与表里潜台词",
      humanText: `决策策略：${t?.steps.step5_strategy_proposal.chosen_strategy ?? "自然回应"}`,
      latency: "210ms",
      isSubtext: true
    },
    {
      num: "05",
      key: "step8_delivery_receipt",
      title: "输出回执与打断腹稿状态",
      humanText:
        receipt?.status === "interrupted"
          ? `输出至第 ${receipt.spoken_char_offset} 字时触发打断，未说完文本已转入腹稿槽位。`
          : `完整送达（${receipt?.spoken_char_offset ?? 0} 字），已同步写入事件流。`,
      latency: "4ms"
    }
  ];

  return (
    <ol className="ai0-context-inspector__trace-steps" style={{ height: "calc(100% - 44px)" }}>
      {cards.map((card) => (
        <li key={card.key} data-step={card.key} className="ai0-trace-step-card">
          <div className="ai0-trace-step-card__head" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <span className="ai0-trace-step-card__num">{card.num}</span>
              <span>{card.title}</span>
            </span>
            <span className="ai0-badge" data-tone="info">{card.latency}</span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--ai0-on-surface-muted)", whiteSpace: "pre-wrap" }}>
            {card.humanText}
          </p>
          {card.isSubtext ? (
            <SpoilerMask revealed={false} label={subtextLabel}>
              <span data-subtext-raw="true">{subtextRaw}</span>
            </SpoilerMask>
          ) : null}
        </li>
      ))}
      <li key="raw-json" className="ai0-trace-step-card">
        <details>
          <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 580, color: "var(--ai0-accent)" }}>
            查看原始 8 步追踪 JSON 与 SQL 隔离证明
          </summary>
          <pre className="ai0-code-box" style={{ marginTop: "8px", maxHeight: "220px", overflowY: "auto" }}>
            {JSON.stringify(t ?? { status: "ready" }, null, 2)}
          </pre>
        </details>
      </li>
    </ol>
  );
}

export function PolymorphicContextInspector(
  props: PolymorphicContextInspectorProps
): ReactElement {
  if (props.mode === "mini") {
    return (
      <aside
        data-mode="mini"
        className={`ai0-polymorphic-context-inspector${props.className ? ` ${props.className}` : ""}`}
        style={{ width: "0px", overflow: "hidden", display: "none" }}
      >
        <button type="button" title="Open trace inspector" onClick={() => props.onModeChange?.("trace")}>
          Trace
        </button>
        <button type="button" title="Open sandbox comparison" onClick={() => props.onModeChange?.("sandbox-diff")}>
          A/B
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-mode={props.mode}
      className={`ai0-polymorphic-context-inspector${props.className ? ` ${props.className}` : ""}`}
      style={{
        width: props.mode === "sandbox-diff" ? "490px" : "356px",
        height: "calc(100% - 10px)",
        margin: "0 12px 10px 0",
        minHeight: 0,
        flexShrink: 0,
        overflow: "hidden",
        border: "var(--ai0-border-subtle)",
        borderRadius: "16px",
        color: "var(--ai0-on-surface)",
        background: "var(--ai0-surface-main-card)",
        boxShadow: "var(--ai0-shadow-glow)"
      }}
    >
      <header
        style={{
          height: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          borderBottom: "var(--ai0-border-subtle)",
          background: "var(--ai0-surface-main-card)"
        }}
      >
        <strong style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "13px" }}>
          {renderConsoleIcon(props.mode === "trace" ? "inspector" : "sandbox", 15)}
          <span>{props.mode === "trace" ? "思维链路与潜台词追踪" : "沙盒 A/B 对照"}</span>
        </strong>
        <RippleButton
          variant="ghost"
          size="sm"
          className="ai0-inspector-close-btn"
          ariaLabel="Collapse inspector"
          style={{ width: "26px", padding: 0 }}
          onClick={() => props.onModeChange?.("mini")}
        >
          {renderConsoleIcon("close", 14)}
        </RippleButton>
      </header>
      {props.mode === "trace" ? (
        <HumanReadableTraceCards trace={props.trace} />
      ) : (
        <div
          className="ai0-context-inspector__diff"
          style={{
            height: "calc(100% - 44px)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            overflow: "hidden"
          }}
        >
          <section style={{ overflow: "auto", borderRight: "var(--ai0-border-subtle)", padding: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--ai0-success)" }}>
              基线状态 (Baseline)
            </div>
            <HumanReadableTraceCards trace={props.baselineTrace ?? props.trace} />
          </section>
          <section style={{ overflow: "auto", padding: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "var(--ai0-warning)" }}>
              沙盒对照 (Sandbox)
            </div>
            <HumanReadableTraceCards trace={props.sandboxTrace ?? props.trace} />
          </section>
        </div>
      )}
    </aside>
  );
}
