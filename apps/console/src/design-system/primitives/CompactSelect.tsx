import type { CSSProperties, ChangeEvent, ReactElement } from "react";

import { renderConsoleIcon } from "../tokens/index.js";

export interface CompactSelectOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export interface CompactSelectChangeEvent {
  currentTarget: { value: string };
}

export interface CompactSelectProps<Value extends string = string> {
  id?: string;
  value?: Value;
  defaultValue?: Value;
  options: readonly CompactSelectOption<Value>[];
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  selectClassName?: string;
  style?: CSSProperties;
  onChange?: (value: Value, event: CompactSelectChangeEvent) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function CompactSelect<Value extends string = string>(
  props: CompactSelectProps<Value>
): ReactElement {
  const dataAttrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-")) dataAttrs[key] = value as string | number | boolean | undefined;
  }

  const isControlled = Boolean(props.onChange) && props.value !== undefined;
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    props.onChange?.(event.currentTarget.value as Value, event);
  };

  return (
    <label
      className={`ai0-select${props.className ? ` ${props.className}` : ""}`}
      style={{ height: "32px", ...props.style }}
    >
      <select
        {...dataAttrs}
        id={props.id}
        className={`ai0-select__field${props.selectClassName ? ` ${props.selectClassName}` : ""}`}
        name={props.name}
        value={isControlled ? props.value : undefined}
        defaultValue={!isControlled ? (props.value ?? props.defaultValue ?? "") : undefined}
        disabled={props.disabled}
        aria-label={props.ariaLabel ?? props.name ?? "Select"}
        onChange={handleChange}
      >
        {props.placeholder ? (
          <option value="" disabled>
            {props.placeholder}
          </option>
        ) : null}
        {props.options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            data-hint={option.hint}
          >
            {option.label}
          </option>
        ))}
      </select>
      <span className="ai0-select__chevron" aria-hidden="true">
        {renderConsoleIcon("chevron-down", 14)}
      </span>
      <span className="ai0-select__ink-bar" aria-hidden="true" />
    </label>
  );
}
