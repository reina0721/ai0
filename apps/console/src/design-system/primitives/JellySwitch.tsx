import Switch from "@mui/material/Switch";
import { useState, type ReactElement, type ReactNode } from "react";
import { dataAttributes } from "./dom-props.js";

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
  const [localChange, setLocalChange] = useState<{ initial: boolean; checked: boolean }>();
  const checked = props.onChange || localChange?.initial !== props.checked ? props.checked : localChange.checked;
  return (
    <label className={"ai0-switch " + (props.className ?? "")} data-name={props.name}>
      <Switch
        className="ai0-material-switch"
        size="small"
        disabled={props.disabled}
        checked={checked}
        id={props.id}
        name={props.name}
        onChange={(event) => {
          const next = event.target.checked;
          setLocalChange({ initial: props.checked, checked: next });
          props.onChange?.(next);
        }}
        slotProps={{ input: {
          ...dataAttributes(props),
          role: "switch",
          "aria-label": props.ariaLabel ?? (typeof props.label === "string" ? props.label : "切换")
        } }}
      />
      {props.label === undefined ? null : <span className="ai0-switch__label">{props.label}</span>}
    </label>
  );
}
