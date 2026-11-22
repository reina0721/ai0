import Chip from "@mui/material/Chip";
import type { ReactElement, ReactNode } from "react";

export type StatusBadgeTone =
  | "neutral" | "info" | "success" | "warning" | "danger"
  | "live" | "sandbox" | "taint";
export type BadgeTaintLevel =
  | "trusted_owner" | "semi_trusted_friend" | "untrusted_external";

export interface StatusBadgeProps {
  children?: ReactNode;
  tone?: StatusBadgeTone;
  taint?: BadgeTaintLevel;
  icon?: ReactNode;
  title?: string;
  className?: string;
}

const TONE_ICONS: Record<StatusBadgeTone, string> = {
  neutral: "•",
  info: "ⓘ",
  success: "✓",
  warning: "!",
  danger: "×",
  live: "●",
  sandbox: "◇",
  taint: "⌁"
};

export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const taintTone: StatusBadgeTone | undefined = props.taint === "untrusted_external"
    ? "danger" : props.taint ? "taint" : undefined;
  const tone = taintTone ?? props.tone ?? "neutral";
  const icon = props.icon ?? TONE_ICONS[tone];

  return (
    <Chip
      component="span"
      size="small"
      role="status"
      title={props.title}
      data-tone={tone}
      data-taint={props.taint}
      className={`ai0-badge ai0-badge--${tone}${props.className ? ` ${props.className}` : ""}`}
      label={<><span className="ai0-badge__icon" aria-hidden="true">{icon}</span>{props.children}</>}
    />
  );
}
