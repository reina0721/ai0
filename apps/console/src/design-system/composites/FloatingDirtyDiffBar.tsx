import type { ReactElement } from "react";
import { StatusBadge, RippleButton } from "../primitives/index.js";

export interface FloatingDirtyDiffBarProps {
  diffCount: number;
  summary?: string;
  applying?: boolean;
  expectedRevision?: number;
  onDiscard?: () => void;
  onApply?: () => void;
  className?: string;
}

/** Sticky outlet footer for an explicit, reviewable state transition. */
export function FloatingDirtyDiffBar(props: FloatingDirtyDiffBarProps): ReactElement | null {
  if (props.diffCount < 1) return null;
  const noun = props.diffCount === 1 ? "change" : "changes";
  return <section aria-label="Unsaved changes" className={`ai0-floating-dirty-diff-bar${props.className ? ` ${props.className}` : ""}`}
    style={{ minHeight: "40px", display: "flex", alignItems: "center", gap: "8px", padding: "4px 8px",
      background: "color-mix(in oklch, var(--ai0-surface-container-high), var(--ai0-accent-tint) 14%)" }}>
    <StatusBadge tone="warning">{props.diffCount} unsaved {noun}</StatusBadge>
    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {props.summary ?? "Review the pending configuration diff before applying it."}
    </span>
    {props.expectedRevision === undefined ? null : <small>rev {props.expectedRevision}</small>}
    <RippleButton onClick={props.onDiscard} disabled={props.applying}>Discard</RippleButton>
    <RippleButton onClick={props.onApply} loading={props.applying}>Apply</RippleButton>
  </section>;
}
