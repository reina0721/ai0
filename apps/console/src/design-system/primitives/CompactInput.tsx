import InputBase from "@mui/material/InputBase";
import { useId, type CSSProperties, type ChangeEvent, type KeyboardEvent, type ReactElement } from "react";
import { dataAttributes } from "./dom-props.js";

export interface CompactInputEvent {
  currentTarget: { value: string };
}

export interface CompactInputProps {
  id?: string;
  value?: string | number;
  defaultValue?: string | number;
  type?: "text" | "number" | "password" | "search" | "url";
  multiline?: boolean;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  name?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  ariaDescribedBy?: string;
  unit?: string;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onInput?: (value: string, event: CompactInputEvent) => void;
  onChange?: (value: string, event: CompactInputEvent) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function CompactInput(props: CompactInputProps): ReactElement {
  const generatedId = useId();
  const errorId = props.error ? (props.id ?? generatedId) + "-error" : undefined;
  const controlled = Boolean(props.onInput || props.onChange) && props.value !== undefined;
  const wrapperClass = props.multiline ? "ai0-textarea-wrap" : "ai0-compact-input";
  const fieldClass = props.multiline ? "ai0-textarea-field" : "ai0-compact-input__field";
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const value = event.currentTarget.value;
    props.onInput?.(value, event);
    props.onChange?.(value, event);
  };

  return (
    <div data-invalid={Boolean(props.error)} className={wrapperClass + " " + (props.className ?? "")} style={props.style}>
      <InputBase
        fullWidth
        autoFocus={props.autoFocus}
        required={props.required}
        multiline={props.multiline}
        rows={props.multiline ? (props.rows ?? 3) : undefined}
        id={props.id}
        name={props.name}
        type={props.type ?? "text"}
        disabled={props.disabled}
        readOnly={props.readOnly || (!props.onInput && !props.onChange && props.value !== undefined)}
        error={Boolean(props.error)}
        placeholder={props.placeholder}
        value={controlled || props.value !== undefined ? props.value : undefined}
        defaultValue={props.value === undefined ? props.defaultValue : undefined}
        onChange={handleChange}
        endAdornment={props.unit ? <span className="ai0-compact-input__unit">{props.unit}</span> : undefined}
        inputProps={{
          ...dataAttributes(props),
          className: fieldClass + " " + (props.inputClassName ?? ""),
          "aria-label": props.ariaLabel,
          "aria-describedby": [props.ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined,
          maxLength: props.maxLength,
          "aria-invalid": Boolean(props.error),
          min: props.min,
          max: props.max,
          step: props.step,
          onKeyDown: props.onKeyDown
        }}
      />
      {props.error ? <span role="alert" className="ai0-compact-input__error" id={errorId}>{props.error}</span> : null}
    </div>
  );
}
