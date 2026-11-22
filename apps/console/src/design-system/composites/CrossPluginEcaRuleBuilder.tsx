import type { ReactElement } from "react";
import { CompactInput, CompactSelect } from "../primitives/index.js";

export type EcaRuleDraft = {
  when: string;
  condition: string;
  then: string;
};

export type CrossPluginEcaRuleBuilderProps = {
  value: EcaRuleDraft;
  pluginOptions: readonly { value: string; label: string }[];
  onChange: (value: EcaRuleDraft) => void;
  onSave?: () => void;
};

const update = (value: EcaRuleDraft, key: keyof EcaRuleDraft, next: string): EcaRuleDraft => ({ ...value, [key]: next });

export function CrossPluginEcaRuleBuilder({ value, pluginOptions, onChange, onSave }: CrossPluginEcaRuleBuilderProps): ReactElement {
  const stage = (index: string, label: string, help: string, field: keyof EcaRuleDraft) => (
    <div style={{ display: "grid", gap: "6px", padding: "12px", borderLeft: "2px solid var(--ai0-accent)", background: "var(--ai0-surface-container-low)" }}>
      <span style={{ color: "var(--ai0-accent)", fontSize: "11px", letterSpacing: "0.08em" }}>{index}</span>
      <strong>{label}</strong><small style={{ color: "var(--ai0-on-surface-muted)" }}>{help}</small>
      <CompactInput value={value[field]} placeholder={`${label} expression`} onInput={(next) => onChange(update(value, field, next))} />
    </div>
  );

  return (
    <section style={{ background: "var(--ai0-surface-main-card)", border: "var(--ai0-border-subtle)", borderRadius: "14px", padding: "16px", display: "grid", gap: "14px" }}>
      <header><strong>Cross-plugin ECA rule</strong><p style={{ margin: "4px 0 0", color: "var(--ai0-on-surface-muted)" }}>Generate a reviewable <code>.flow.yaml</code> automation.</p></header>
      <CompactSelect value={value.when} options={pluginOptions} onChange={(next) => onChange(update(value, "when", next))} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "1px", background: "var(--ai0-surface-container-high)" }}>
        {stage("WHEN", "When", "An emitted plugin event", "when")}
        {stage("IF", "If", "A scoped guard passes", "condition")}
        {stage("THEN", "Then", "A capability-approved action", "then")}
      </div>
      <button type="button" onClick={onSave} style={{ justifySelf: "end", border: 0, borderRadius: "8px", padding: "8px 12px", background: "var(--ai0-accent)", color: "var(--ai0-surface-main-card)" }}>Save .flow.yaml</button>
    </section>
  );
}
