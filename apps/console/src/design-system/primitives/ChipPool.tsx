import Chip from "@mui/material/Chip";
import type { ReactElement, ReactNode } from "react";

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type ChipItem = string | {
  id: string;
  label: ReactNode;
  tone?: ChipTone;
  disabled?: boolean;
};

export interface ChipPoolProps {
  chips: readonly ChipItem[];
  selectedIds?: readonly string[];
  multi?: boolean;
  ariaLabel?: string;
  className?: string;
  onToggle?: (id: string) => void;
}

function chipFields(chip: ChipItem): {
  id: string; label: ReactNode; tone: ChipTone; disabled: boolean;
} {
  return typeof chip === "string"
    ? { id: chip, label: chip, tone: "neutral", disabled: false }
    : {
        id: chip.id,
        label: chip.label,
        tone: chip.tone ?? "neutral",
        disabled: chip.disabled ?? false
      };
}

export function ChipPool(props: ChipPoolProps): ReactElement {
  const selected = new Set(props.selectedIds ?? []);
  return (
    <div
      role="group"
      aria-label={props.ariaLabel ?? "Chip choices"}
      data-multi={props.multi ?? true}
      className={`ai0-chip-pool${props.className ? ` ${props.className}` : ""}`}
    >
      {props.chips.map((rawChip) => {
        const chip = chipFields(rawChip);
        const active = selected.has(chip.id);
        return (
          <Chip
            key={chip.id}
            size="small"
            label={chip.label}
            aria-pressed={active}
            disabled={chip.disabled}
            data-chip-id={chip.id}
            data-tone={chip.tone}
            className={`ai0-chip-pool__chip${active ? " is-selected" : ""}`}
            onClick={props.onToggle ? () => props.onToggle?.(chip.id) : undefined}
          />
        );
      })}
    </div>
  );
}
