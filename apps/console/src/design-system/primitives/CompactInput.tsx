import type { CSSProperties, ChangeEvent, KeyboardEvent, ReactElement } from "react";

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
  const errorId = props.error && props.name ? `${props.name}-error` : undefined;
  const dataAttrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-")) dataAttrs[key] = value as string | number | boolean | undefined;
  }

  const isControlled = Boolean(props.onInput || props.onChange) && props.value !== undefined;
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const val = event.currentTarget.value;
    props.onInput?.(val, event);
    props.onChange?.(val, event);
  };

  if (props.multiline) {
    return (
      <div
        data-invalid={props.error ? "true" : undefined}
        className={`ai0-textarea-wrap${props.className ? ` ${props.className}` : ""}`}
        style={props.style}
      >
        <textarea
          {...dataAttrs}
          id={props.id}
          className={`ai0-textarea-field${props.inputClassName ? ` ${props.inputClassName}` : ""}`}
          name={props.name}
          rows={props.rows ?? 3}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly={props.readOnly}
          aria-label={props.ariaLabel}
          aria-invalid={Boolean(props.error)}
          aria-describedby={errorId}
          value={isControlled ? String(props.value ?? "") : undefined}
          defaultValue={!isControlled ? String(props.value ?? props.defaultValue ?? "") : undefined}
          onChange={handleChange}
          onKeyDown={props.onKeyDown}
        />
        <span className="ai0-textarea-wrap__ink-bar" aria-hidden="true" />
      </div>
    );
  }

  return (
    <label
      data-invalid={props.error ? "true" : undefined}
      className={`ai0-compact-input${props.className ? ` ${props.className}` : ""}`}
      style={{ height: "32px", ...props.style }}
    >
      <input
        {...dataAttrs}
        id={props.id}
        className={`ai0-compact-input__field${props.inputClassName ? ` ${props.inputClassName}` : ""}`}
        type={props.type ?? "text"}
        name={props.name}
        value={isControlled ? props.value : undefined}
        defaultValue={!isControlled ? (props.value ?? props.defaultValue) : undefined}
        min={props.min}
        max={props.max}
        step={props.step}
        placeholder={props.placeholder}
        disabled={props.disabled}
        readOnly={props.readOnly}
        aria-label={props.ariaLabel}
        aria-invalid={Boolean(props.error)}
        aria-describedby={errorId}
        onChange={handleChange}
        onKeyDown={props.onKeyDown}
      />
      {props.unit ? <span className="ai0-compact-input__unit">{props.unit}</span> : null}
      <span className="ai0-compact-input__ink-bar" aria-hidden="true" />
      {props.error ? (
        <span id={errorId} role="alert" className="ai0-compact-input__error">
          {props.error}
        </span>
      ) : null}
    </label>
  );
}
