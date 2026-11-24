import ButtonBase from "@mui/material/ButtonBase";
import { useReducedMotion } from "motion/react";
import type { CSSProperties, PointerEvent, ReactElement, ReactNode, Ref } from "react";
import { dataAttributes } from "./dom-props.js";

export interface RippleButtonProps {
  children?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "tonal" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaHasPopup?: "menu" | "dialog";
  autoFocus?: boolean;
  title?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function RippleButton(props: RippleButtonProps): ReactElement {
  const reduced = useReducedMotion();
  return (
    <ButtonBase
      {...dataAttributes(props)}
      ref={props.ref}
      focusRipple
      disableRipple={reduced === true}
      data-variant={props.variant ?? "secondary"}
      data-size={props.size ?? "md"}
      type={props.type ?? "button"}
      disabled={props.disabled || props.loading}
      title={props.title}
      aria-label={props.ariaLabel}
      aria-expanded={props.ariaExpanded}
      aria-controls={props.ariaControls}
      aria-haspopup={props.ariaHasPopup}
      autoFocus={props.autoFocus}
      aria-busy={props.loading || undefined}
      className={"ai0-ripple-btn " + (props.className ?? "")}
      style={props.style}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
    >
      <span className="ai0-ripple-btn__content">{props.loading ? "处理中…" : props.children}</span>
    </ButtonBase>
  );
}
