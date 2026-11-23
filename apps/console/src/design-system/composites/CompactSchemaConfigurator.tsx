import type { ReactElement } from "react";
import { CompactInput, SegmentedPill } from "../primitives/index.js";

export type SchemaTier = "visual" | "compact" | "code";
export type CompactSchemaValue = { name: string; summary: string; source: string };

export type CompactSchemaConfiguratorProps = {
  tier: SchemaTier;
  value: CompactSchemaValue;
  code: string;
  onTierChange: (tier: SchemaTier) => void;
  onChange: (value: CompactSchemaValue) => void;
  onCodeChange: (code: string) => void;
};

const tiers = [
  { value: "visual", label: "Tier V1 · Visual" },
  { value: "compact", label: "Tier V2 · Compact" },
  { value: "code", label: "Tier V3 · JSON/YAML" },
] as const;

export function CompactSchemaConfigurator({ tier, value, code, onTierChange, onChange, onCodeChange }: CompactSchemaConfiguratorProps): ReactElement {
  const set = (key: keyof CompactSchemaValue, next: string) => onChange({ ...value, [key]: next });
  return (
    <section style={{ background: "var(--ai0-surface-main-card)", border: "var(--ai0-border-subtle)", borderRadius: "14px", padding: "16px", display: "grid", gap: "14px" }}>
      <header><strong>Schema configurator</strong><p style={{ margin: "4px 0 0", color: "var(--ai0-on-surface-muted)" }}>Move from an approachable model to authoritative source code.</p></header>
      <SegmentedPill value={tier} options={tiers} onChange={onTierChange} />
      {tier === "visual" && <div style={{ padding: "18px", border: "1px dashed color-mix(in oklch, var(--ai0-accent), transparent 76%)", borderRadius: "10px", color: "var(--ai0-on-surface-muted)" }}>Visual field map · {value.name || "Untitled schema"}</div>}
      {tier === "compact" && <div style={{ display: "grid", gap: "8px" }}><CompactInput value={value.name} placeholder="Schema name" onInput={(next) => set("name", next)} /><CompactInput value={value.summary} placeholder="Short description" onInput={(next) => set("summary", next)} /><CompactInput value={value.source} placeholder="Source binding" onInput={(next) => set("source", next)} /></div>}
      {tier === "code" && <CompactInput multiline rows={8} value={code} onInput={onCodeChange}
        ariaLabel="Authoritative JSON or YAML" inputClassName="font-mono" />}
      <small style={{ color: "var(--ai0-on-surface-muted)" }}>Tier V3 is the source of truth; lower tiers are safe projections.</small>
    </section>
  );
}
