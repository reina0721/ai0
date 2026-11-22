import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import type { ReactElement } from "react";

import { StatusBadge, RippleButton } from "../primitives/index.js";

export interface TelemetryMetric {
  id: string;
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn" | "danger";
}

export type OnboardingStep = 1 | 2 | 3;
export interface FirstBootOnboardingModalProps {
  open: boolean;
  step: OnboardingStep;
  onStepChange?: (step: OnboardingStep) => void;
  onComplete?: () => void;
  onDismiss?: () => void;
}

const ONBOARDING_STEPS = [
  { title: "Connect a model", detail: "Configure a provider and run a latency ping." },
  { title: "Create a .soul", detail: "Distill a character card or choose the clean template." },
  { title: "Test a Shell", detail: "Handshake with WebChat and verify expression delivery." }
] as const;

export function FirstBootOnboardingModal(
  props: FirstBootOnboardingModalProps
): ReactElement {
  const current = ONBOARDING_STEPS[props.step - 1] ?? ONBOARDING_STEPS[0];
  const previous = Math.max(1, props.step - 1) as OnboardingStep;
  const next = Math.min(3, props.step + 1) as OnboardingStep;
  return (
    <Dialog
      open={props.open}
      onClose={props.onDismiss}
      aria-label="First boot onboarding"
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { className: "ai0-first-boot-onboarding" } }}
    >
      <DialogContent sx={{ p: 2 }}>
        <header style={{ display: "flex", justifyContent: "space-between" }}>
          <span>First boot · Step {props.step}/3</span>
          <RippleButton size="sm" variant="ghost" ariaLabel="Dismiss onboarding" onClick={props.onDismiss}>
            ×
          </RippleButton>
        </header>
        <ol
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "6px",
            padding: 0,
            listStyle: "none"
          }}
        >
          {ONBOARDING_STEPS.map((step, index) => (
            <li key={step.title} data-active={index + 1 === props.step}>
              <StatusBadge tone={index + 1 <= props.step ? "success" : "neutral"}>{index + 1}</StatusBadge>
              <span>{step.title}</span>
            </li>
          ))}
        </ol>
        <h2>{current.title}</h2>
        <p>{current.detail}</p>
        <footer style={{ display: "flex", justifyContent: "flex-end", gap: "7px" }}>
          <RippleButton
            disabled={props.step === 1}
            onClick={() => props.onStepChange?.(previous)}
          >
            Back
          </RippleButton>
          {props.step < 3 ? (
            <RippleButton onClick={() => props.onStepChange?.(next)}>Next</RippleButton>
          ) : (
            <RippleButton onClick={props.onComplete}>Finish</RippleButton>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export interface TelemetryMetricStripProps {
  metrics: readonly TelemetryMetric[];
  connected?: boolean;
  updatedAt?: string;
  onboarding?: FirstBootOnboardingModalProps;
  className?: string;
}

export function TelemetryMetricStrip(props: TelemetryMetricStripProps): ReactElement {
  const badgeTone = (tone: TelemetryMetric["tone"]) =>
    tone === "good" ? "success" : tone === "warn" ? "warning" : tone ?? "neutral";
  return (
    <div className={`ai0-telemetry-metric-strip-host${props.className ? ` ${props.className}` : ""}`}>
      <section
        aria-label="Live telemetry metrics"
        className="ai0-telemetry-metric-strip"
        style={{
          minHeight: "40px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 8px",
          overflowX: "auto",
          borderBottom: "var(--ai0-border-subtle)"
        }}
      >
        <StatusBadge tone={props.connected === false ? "danger" : "live"}>
          {props.connected === false ? "Disconnected" : "Live telemetry"}
        </StatusBadge>
        {props.metrics.map((metric) => (
          <span
            key={metric.id}
            data-metric-id={metric.id}
            style={{ display: "inline-flex", gap: "5px", whiteSpace: "nowrap" }}
          >
            <small>{metric.label}</small>
            <StatusBadge tone={badgeTone(metric.tone)}>{metric.value}</StatusBadge>
          </span>
        ))}
        {props.updatedAt ? <time style={{ marginLeft: "auto" }}>{props.updatedAt}</time> : null}
      </section>
      {props.onboarding ? <FirstBootOnboardingModal {...props.onboarding} /> : null}
    </div>
  );
}
