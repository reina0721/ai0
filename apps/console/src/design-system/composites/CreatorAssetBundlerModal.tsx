import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useId, type ReactElement } from "react";
import { JellySwitch, RippleButton } from "../primitives/index.js";

export type PrivacyScrubItem = { id: string; label: string; detail: string; checked: boolean };

export type CreatorAssetBundlerModalProps = {
  open: boolean;
  items: readonly PrivacyScrubItem[];
  onItemChange: (id: string, checked: boolean) => void;
  onClose: () => void;
  onExport: () => void;
};

export function CreatorAssetBundlerModal({ open, items, onItemChange, onClose, onExport }: CreatorAssetBundlerModalProps): ReactElement {
  const titleId = useId();
  const complete = items.length === 5 && items.every((item) => item.checked);
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>Bundle creator assets</DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 1 }}>
        <small>Export a portable <code>.ai0pack</code>.</small>
        {items.slice(0, 5).map((item) => (
          <div key={item.id} style={{ padding: "10px", border: "var(--ai0-border-subtle)", borderRadius: "9px" }}>
            <JellySwitch checked={item.checked} label={item.label} onChange={(checked) => onItemChange(item.id, checked)} />
            <div style={{ paddingLeft: "2px", color: "var(--ai0-on-surface-muted)", fontSize: "12px" }}>{item.detail}</div>
          </div>
        ))}
        <small style={{ color: complete ? "var(--ai0-accent-ink)" : "var(--ai0-on-surface-muted)" }}>
          {complete ? "5 privacy checks complete" : "Complete all 5 privacy checks"}
        </small>
      </DialogContent>
      <DialogActions>
        <RippleButton variant="ghost" onClick={onClose}>Close</RippleButton>
        <RippleButton variant="primary" disabled={!complete} onClick={onExport}>Export .ai0pack</RippleButton>
      </DialogActions>
    </Dialog>
  );
}
