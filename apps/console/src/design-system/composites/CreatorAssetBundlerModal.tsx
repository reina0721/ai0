import type { ReactElement } from "react";
import { JellySwitch } from "../primitives/index.js";

export type PrivacyScrubItem = { id: string; label: string; detail: string; checked: boolean };

export type CreatorAssetBundlerModalProps = {
  open: boolean;
  items: readonly PrivacyScrubItem[];
  onItemChange: (id: string, checked: boolean) => void;
  onClose: () => void;
  onExport: () => void;
};

export function CreatorAssetBundlerModal({ open, items, onItemChange, onClose, onExport }: CreatorAssetBundlerModalProps): ReactElement {
  if (!open) return <span aria-hidden="true" style={{ display: "none" }} />;
  const complete = items.length === 5 && items.every((item) => item.checked);
  return (
    <div role="dialog" aria-modal="true" aria-label="Export creator asset bundle" style={{ background: "color-mix(in oklch, var(--ai0-surface-main-card), transparent 4%)", border: "var(--ai0-border-subtle)", borderRadius: "16px", padding: "18px", maxWidth: "520px", display: "grid", gap: "14px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><div><strong>Bundle creator assets</strong><p style={{ margin: "4px 0 0", color: "var(--ai0-on-surface-muted)" }}>Export a portable <code>.ai0pack</code>.</p></div><button type="button" onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--ai0-on-surface)" }}>Close</button></header>
      <div style={{ display: "grid", gap: "8px" }}>
        {items.slice(0, 5).map((item) => (
          <div style={{ padding: "10px", border: "var(--ai0-border-subtle)", borderRadius: "9px" }}>
            <JellySwitch checked={item.checked} label={item.label} onChange={(checked) => onItemChange(item.id, checked)} />
            <div style={{ paddingLeft: "2px", color: "var(--ai0-on-surface-muted)", fontSize: "12px" }}>{item.detail}</div>
          </div>
        ))}
      </div>
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><small style={{ color: complete ? "var(--ai0-accent)" : "var(--ai0-on-surface-muted)" }}>{complete ? "5 privacy checks complete" : "Complete all 5 privacy checks"}</small><button type="button" disabled={!complete} onClick={onExport} style={{ border: 0, borderRadius: "8px", padding: "8px 12px", background: "var(--ai0-accent)", color: "var(--ai0-surface-main-card)", opacity: complete ? 1 : 0.45 }}>Export .ai0pack</button></footer>
    </div>
  );
}
