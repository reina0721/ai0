import type { CSSProperties, PointerEvent, ReactElement, ReactNode } from "react";

export function computePointerRippleGeometry(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { x: number; y: number; radius: number } {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
  return { x, y, radius };
}

export interface RipplePointerEvent {
  clientX: number;
  clientY: number;
  currentTarget: {
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    style?: { setProperty(name: string, value: string): void };
  };
}

export interface RippleButtonProps {
  children?: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "tonal" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  style?: CSSProperties;
  onClick?: () => void;
  onPointerDown?: (event: RipplePointerEvent) => void;
  onRipple?: (geometry: { x: number; y: number; radius: number }) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function RippleButton(props: RippleButtonProps): ReactElement {
  const disabled = props.disabled === true || props.loading === true;
  const dataAttrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-")) dataAttrs[key] = value as string | number | boolean | undefined;
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    const geometry = computePointerRippleGeometry(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    );
    event.currentTarget.style.setProperty("--ai0-ripple-x", `${geometry.x}px`);
    event.currentTarget.style.setProperty("--ai0-ripple-y", `${geometry.y}px`);
    event.currentTarget.style.setProperty("--ai0-ripple-radius", `${geometry.radius}px`);
    props.onRipple?.(geometry);
    props.onPointerDown?.(event);
  };

  return (
    <button
      {...dataAttrs}
      data-variant={props.variant}
      data-size={props.size ?? "md"}
      type={props.type ?? "button"}
      disabled={disabled}
      title={props.title}
      aria-label={props.ariaLabel}
      aria-busy={props.loading || undefined}
      className={`ai0-ripple-btn${props.variant === "primary" ? " is-primary" : ""}${props.className ? ` ${props.className}` : ""}`}
      style={{ height: props.size === "sm" ? "28px" : "32px", ...props.style }}
      onClick={props.onClick}
      onPointerDown={handlePointerDown}
    >
      <span className="ai0-ripple-btn__ripple" aria-hidden="true" />
      <span className="ai0-ripple-btn__content">
        {props.loading ? "处理中…" : props.children}
      </span>
    </button>
  );
}
