import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { ReactElement, ReactNode } from "react";

export interface SegmentedOption<Value extends string = string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedPillProps<Value extends string = string> {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  ariaLabel?: string;
  className?: string;
  onChange?: (value: Value) => void;
}

export function SegmentedPill<Value extends string = string>(props: SegmentedPillProps<Value>): ReactElement {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={props.value}
      aria-label={props.ariaLabel ?? "选择选项"}
      data-count={props.options.length}
      className={"ai0-segmented-pill ai0-material-segmented " + (props.className ?? "")}
      onChange={(_, next: Value | null) => { if (next !== null) props.onChange?.(next); }}
    >
      {props.options.map((option) => (
        <ToggleButton
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          data-value={option.value}
          className="ai0-segmented-pill__option"
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
