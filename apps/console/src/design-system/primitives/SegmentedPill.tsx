import type { CSSProperties, ReactElement, ReactNode } from "react";

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

export function SegmentedPill<Value extends string = string>(
  props: SegmentedPillProps<Value>
): ReactElement {
  const count = Math.max(1, props.options.length);
  const selectedIndex = Math.max(0, props.options.findIndex(({ value }) => value === props.value));
  const sliderStyle: CSSProperties = {
    width: `calc((100% - 6px) / ${count})`,
    transform: `translateX(${selectedIndex * 100}%)`
  };
  const pillStyle = { "--ai0-segment-count": count } as CSSProperties;

  return (
    <div
      role="radiogroup"
      aria-label={props.ariaLabel ?? "Choose an option"}
      data-count={count}
      className={`ai0-segmented-pill${props.className ? ` ${props.className}` : ""}`}
      style={pillStyle}
    >
      <span className="ai0-segmented-pill-slider" style={sliderStyle} aria-hidden="true" />
      {props.options.map((option) => {
        const active = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            data-value={option.value}
            className={`ai0-segmented-pill__option${active ? " is-active" : ""}`}
            onClick={() => props.onChange?.(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
