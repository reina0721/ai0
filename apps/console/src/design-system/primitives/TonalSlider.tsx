import Slider from "@mui/material/Slider";
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { dataAttributes } from "./dom-props.js";

export interface TonalSliderInputEvent {
  currentTarget: { value: string };
}

export interface TonalSliderProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  onInput?: (value: number, event: TonalSliderInputEvent) => void;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function TonalSlider(props: TonalSliderProps): ReactElement {
  const labelId = useId();
  const [localChange, setLocalChange] = useState<{ initial: number; value: number }>();
  const value = props.onInput || localChange?.initial !== props.value ? props.value : localChange.value;
  const display = String(value) + (props.unit ?? "");
  return (
    <div className={"ai0-slider " + (props.className ?? "")} data-unit={props.unit}>
      <div className="ai0-slider__head">
        <span className="ai0-slider__label" id={labelId}>{props.label}</span>
        <output className="ai0-slider__value">{display}</output>
      </div>
      <Slider
        {...dataAttributes(props)}
        className="ai0-material-slider"
        size="small"
        disabled={props.disabled}
        min={props.min ?? 0}
        max={props.max ?? 100}
        step={props.step ?? 1}
        value={value}
        aria-labelledby={props.label !== undefined ? labelId : undefined}
        aria-label={props.label === undefined ? "调整数值" : undefined}
        getAriaValueText={(next) => String(next) + (props.unit ?? "")}
        slotProps={{ input: { id: props.id } }}
        onChange={(_, next) => {
          if (typeof next !== "number") return;
          setLocalChange({ initial: props.value, value: next });
          props.onInput?.(next, { currentTarget: { value: String(next) } });
        }}
      />
    </div>
  );
}
