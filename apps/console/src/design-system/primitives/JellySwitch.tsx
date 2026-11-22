import { useEffect, useState, type ReactElement, type ReactNode } from "react";

export interface JellySwitchProps {
  id?: string;
  checked: boolean;
  label?: ReactNode;
  name?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  onChange?: (checked: boolean) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function JellySwitch(props: JellySwitchProps): ReactElement {
  const [localChecked, setLocalChecked] = useState(props.checked);

  useEffect(() => {
    setLocalChecked(props.checked);
  }, [props.checked]);

  const checked = props.onChange ? props.checked : localChecked;
  const stateClass = checked ? " is-checked" : "";
  const disabledClass = props.disabled ? " is-disabled" : "";
  const dataAttrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-")) dataAttrs[key] = value as string | number | boolean | undefined;
  }

  const toggle = (): void => {
    if (props.disabled) return;
    const next = !checked;
    setLocalChecked(next);
    props.onChange?.(next);
  };

  return (
    <span
      data-name={props.name}
      className={`ai0-switch${stateClass}${disabledClass}${props.className ? ` ${props.className}` : ""}`}
      onClick={toggle}
    >
      <button
        {...dataAttrs}
        id={props.id}
        type="button"
        role="switch"
        className="ai0-switch__control"
        aria-checked={checked ? "true" : "false"}
        aria-label={props.ariaLabel ?? (typeof props.label === "string" ? props.label : "Toggle")}
        disabled={props.disabled}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="ai0-switch-thumb" aria-hidden="true" />
      </button>
      {props.label === undefined ? null : (
        <span className="ai0-switch__label">{props.label}</span>
      )}
    </span>
  );
}
