import type { ReactElement } from "react";
import { TonalSlider, JellySwitch } from "../primitives/index.js";

export interface LorebookActivation {
  readonly id: string;
  readonly title: string;
  readonly depth: 0 | 1 | 2 | 3;
  readonly tokenCost: number;
  readonly matched: boolean;
}

export interface LorebookActivationSimulatorProps {
  readonly activations: readonly LorebookActivation[];
  readonly tokenBudget: number;
  readonly onTokenBudgetChange: (budget: number) => void;
  readonly onActivationChange: (id: string, matched: boolean) => void;
}

export function LorebookActivationSimulator({ activations, tokenBudget, onTokenBudgetChange, onActivationChange }: LorebookActivationSimulatorProps): ReactElement {
  const activeTokens = activations.filter((item) => item.matched).reduce((total, item) => total + item.tokenCost, 0);
  const safeTokens = Math.max(0, tokenBudget - activeTokens);
  return <section style={{ display: "grid", gap: 14, padding: 16, border: "var(--ai0-border-subtle)", borderRadius: 14, background: "var(--ai0-surface-main-card)" }}>
    <header><strong>Lorebook activation simulator</strong><div style={{ fontSize: 12, opacity: 0.68 }}>Recursive depth is capped at three hops.</div></header>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: 10, borderRadius: 9, background: "var(--ai0-surface-container-low)" }}>
      <TonalSlider label="Token budget" value={tokenBudget} min={0} max={4096} step={16} unit="tok" onInput={(budget) => onTokenBudgetChange(budget)} />
      <div style={{ textAlign: "right", fontSize: 12 }}><strong>{activeTokens}</strong> active · <span style={{ color: safeTokens ? "inherit" : "var(--ai0-danger)" }}>{safeTokens} spare</span></div>
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      {activations.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 9, alignItems: "center", padding: "8px 10px", marginLeft: item.depth * 16, borderLeft: `2px solid ${item.matched ? "var(--ai0-accent)" : "var(--ai0-border-subtle)"}`, background: "var(--ai0-surface-container-low)" }}>
        <JellySwitch checked={item.matched} label={`Activate ${item.title}`} onChange={(matched) => onActivationChange(item.id, matched)} />
        <span><strong style={{ fontSize: 13 }}>{item.title}</strong><small style={{ display: "block", opacity: 0.62 }}>depth {item.depth} recursive match</small></span>
        <span style={{ fontSize: 12 }}>{item.tokenCost} tok</span>
      </div>)}
    </div>
    <footer style={{ fontSize: 12, color: activeTokens > tokenBudget ? "var(--ai0-danger)" : "inherit" }}>{activeTokens > tokenBudget ? "Budget exceeded: lower activation or raise the ceiling." : "Within budget: activated entries can flow into the prompt."}</footer>
  </section>;
}
