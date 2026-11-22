import InputBase from "@mui/material/InputBase";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import useMediaQuery from "@mui/material/useMediaQuery";
import { ChevronDown } from "lucide-react";
import { useId, useState, type CSSProperties, type ReactElement } from "react";
import { dataAttributes } from "./dom-props.js";

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
  labelId?: string;
  className?: string;
  selectClassName?: string;
  style?: CSSProperties;
  onChange?: (value: Value, event: CompactSelectChangeEvent) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function CompactSelect<Value extends string = string>(props: CompactSelectProps<Value>): ReactElement {
  const generatedId = useId();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const controlled = props.value !== undefined && Boolean(props.onChange);
  const [uncontrolledValue, setUncontrolledValue] = useState<Value | undefined>(() => props.value ?? props.defaultValue);
  const firstEnabled = props.options.find((option) => !option.disabled);
  const showPlaceholder = Boolean(props.placeholder) && !props.options.some((option) => option.value === "");
  const value = (controlled ? props.value : uncontrolledValue) ?? (showPlaceholder ? "" : firstEnabled?.value ?? "");
  const selectedOption = props.options.find((option) => option.value === value);
  const unavailableValue = value !== "" && !selectedOption;
  const disabled = Boolean(props.disabled) || !firstEnabled;
  const ariaLabel = props.labelId ? undefined : (props.ariaLabel ?? props.name);

  return (
    <div className={"ai0-select " + (props.className ?? "")} data-disabled={disabled} style={props.style}>
      <Select<Value | "">
        fullWidth
        displayEmpty
        variant="standard"
        disabled={disabled}
        readOnly={disabled}
        name={props.name}
        labelId={props.labelId}
        IconComponent={ChevronDown}
        input={<InputBase />}
        SelectDisplayProps={{
          ...dataAttributes(props),
          id: props.id ?? generatedId,
          className: "ai0-select__field " + (props.selectClassName ?? ""),
          "aria-label": ariaLabel
        }}
        MenuProps={{
          id: `${props.id ?? generatedId}-menu`,
          marginThreshold: 12,
          transitionDuration: reduceMotion ? 0 : 160,
          slotProps: {
            paper: { className: "ai0-select__menu" },
            list: { className: "ai0-select__options", "aria-label": ariaLabel }
          }
        }}
        value={value}
        renderValue={() => selectedOption?.label ?? (
          <span className="ai0-select__placeholder">{unavailableValue ? value : (props.placeholder ?? (firstEnabled ? "请选择" : "无可选项"))}</span>
        )}
        onChange={(event) => {
          const next = props.options.find((option) => option.value === event.target.value && !option.disabled);
          if (!next) return;
          if (!controlled) setUncontrolledValue(next.value);
          props.onChange?.(next.value, { currentTarget: { value: next.value } });
        }}
      >
        {showPlaceholder ? <MenuItem value="" disabled>{props.placeholder}</MenuItem> : null}
        {unavailableValue ? <MenuItem value={value} disabled>{value}</MenuItem> : null}
        {props.options.map((option) => (
          <MenuItem key={option.value} value={option.value} disabled={option.disabled} data-hint={option.hint}>
            <span className="ai0-select__option-label">{option.label}</span>
            {option.hint ? <span className="ai0-select__option-hint">{option.hint}</span> : null}
          </MenuItem>
        ))}
      </Select>
    </div>
  );
}
