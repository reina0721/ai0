import type { ReactElement } from "react";
import { TonalSlider, JellySwitch } from "../primitives/index.js";

export type CognitiveHook = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
};

export type CognitiveOrganHookBenchProps = {
  hooks: readonly CognitiveHook[];
  slotQuota: number;
  ablationEnabled: boolean;
  onHookChange: (id: string, enabled: boolean) => void;
  onQuotaChange: (quota: number) => void;
  onAblationChange: (enabled: boolean) => void;
};

const frame = {
  background: "var(--ai0-surface-main-card)",
  border: "var(--ai0-border-subtle)",
  color: "var(--ai0-on-surface)",
};

export function CognitiveOrganHookBench({
  hooks,
  slotQuota,
  ablationEnabled,
  onHookChange,
  onQuotaChange,
  onAblationChange,
}: CognitiveOrganHookBenchProps): ReactElement {
  return (
    <section style={{ ...frame, borderRadius: "14px", padding: "16px", display: "grid", gap: "14px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <strong>3-hook cognitive organ bench</strong>
          <p style={{ margin: "4px 0 0", color: "var(--ai0-on-surface-muted)" }}>
            Attach bounded organs before a model turn.
          </p>
        </div>
        <span style={{ color: "var(--ai0-accent)", fontSize: "12px" }}>sandboxed</span>
      </header>
      <div style={{ display: "grid", gap: "8px" }}>
        {hooks.slice(0, 3).map((hook) => (
          <div style={{ ...frame, borderRadius: "10px", padding: "10px", display: "flex", justifyContent: "space-between", gap: "12px" }}>
            <div><strong>{hook.label}</strong><div style={{ color: "var(--ai0-on-surface-muted)", fontSize: "12px" }}>{hook.description}</div></div>
            <JellySwitch checked={hook.enabled} onChange={(enabled) => onHookChange(hook.id, enabled)} />
          </div>
        ))}
      </div>
      <TonalSlider label="Slot token quota" value={slotQuota} min={128} max={4096} step={128} unit="tokens" onInput={onQuotaChange} />
      <div style={{ borderTop: "var(--ai0-border-subtle)", paddingTop: "12px" }}>
        <JellySwitch checked={ablationEnabled} label="Ablation mode — omit enabled hooks in the sandbox" onChange={onAblationChange} />
      </div>
    </section>
  );
}
