import Tooltip from "@mui/material/Tooltip";
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
  interactiveChild?: boolean;
}

export function HoverTooltip(props: HoverTooltipProps): ReactElement {
  return (
    <Tooltip
      id={props.id}
      placement={props.position ?? "top"}
      describeChild
      title={<>
        {props.field ? <strong className="ai0-tooltip__field">{props.field}</strong> : null}
        <span className="ai0-tooltip__content">{props.content}</span>
        {props.formula ? <code className="ai0-tooltip__formula">{props.formula}</code> : null}
      </>}
    >
      <span className={"ai0-tooltip " + (props.className ?? "")} tabIndex={props.interactiveChild ? undefined : 0}>{props.children}</span>
    </Tooltip>
  );
}
