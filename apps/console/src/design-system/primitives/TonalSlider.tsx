import { useEffect, useState, type CSSProperties, type ChangeEvent, type ReactElement, type ReactNode } from "react";

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
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const [localValue, setLocalValue] = useState(props.value);

  useEffect(() => {
    setLocalValue(props.value);
  }, [props.value]);

  const current = props.onInput ? props.value : localValue;
  const span = Math.max(max - min, Number.EPSILON);
  const progress = Math.max(0, Math.min(100, ((current - min) / span) * 100));
  const unit = props.unit ?? "";
  const displayValue = `${current}${unit}`;
  const dataAttrs: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-")) dataAttrs[key] = value as string | number | boolean | undefined;
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextVal = Number(event.currentTarget.value);
    setLocalValue(nextVal);
    props.onInput?.(nextVal, event);
  };

  const sliderStyle = { "--ai0-slider-progress": `${progress}%` } as CSSProperties;

  return (
    <div
      className={`ai0-slider${props.className ? ` ${props.className}` : ""}`}
      data-unit={unit}
      style={sliderStyle}
    >
      <div className="ai0-slider__head">
        {props.label !== undefined ? (
          <span className="ai0-slider__label">{props.label}</span>
        ) : (
          <span className="ai0-slider__label" aria-hidden="true" />
        )}
        <output className="ai0-slider__value" aria-live="polite">
          {displayValue}
        </output>
      </div>
      <input
        {...dataAttrs}
        id={props.id}
        className="ai0-slider__control"
        type="range"
        value={current}
        min={min}
        max={max}
        step={step}
        disabled={props.disabled}
        aria-valuetext={displayValue}
        onChange={handleChange}
      />
    </div>
  );
}
