import type { ReactElement, ReactNode } from "react";

export type HoverTooltipPosition = "top" | "right" | "bottom" | "left";

export interface HoverTooltipProps {
  children?: ReactNode;
  content: ReactNode;
  id?: string;
  field?: string;
  formula?: string;
  position?: HoverTooltipPosition;
  className?: string;
}

function stableTooltipId(props: HoverTooltipProps): string {
  const source = `${props.field ?? ""}:${String(props.content)}:${props.formula ?? ""}`;
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `ai0-tooltip-${(hash >>> 0).toString(36)}`;
}

export function HoverTooltip(props: HoverTooltipProps): ReactElement {
  const id = props.id ?? stableTooltipId(props);
  const position = props.position ?? "top";
  return (
    <span
      className={`ai0-tooltip${props.className ? ` ${props.className}` : ""}`}
      data-position={position}
    >
      <span className="ai0-tooltip__trigger" tabIndex={0} aria-describedby={id}>
        {props.children}
      </span>
      <span id={id} role="tooltip" className="ai0-tooltip__bubble" data-position={position}>
        {props.field ? <strong className="ai0-tooltip__field">{props.field}</strong> : null}
        <span className="ai0-tooltip__content">{props.content}</span>
        {props.formula ? <code className="ai0-tooltip__formula">{props.formula}</code> : null}
      </span>
    </span>
  );
}
