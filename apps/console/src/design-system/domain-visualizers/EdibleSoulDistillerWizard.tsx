import ButtonBase from "@mui/material/ButtonBase";
import type { ReactElement } from "react";
import { CompactInput, RippleButton, SegmentedPill, JellySwitch } from "../primitives/index.js";

export interface SoulDistillerStep {
  readonly label: string;
  readonly summary: string;
}

export interface EdibleSoulDistillerWizardProps {
  readonly steps?: readonly SoulDistillerStep[];
  readonly activeStep: number;
  readonly sourceFormat: "SillyTavern V2" | "SillyTavern V3";
  readonly sourceText: string;
  readonly scrubJailbreak: boolean;
  readonly scrubPua: boolean;
  readonly onStepChange: (step: number) => void;
  readonly onFormatChange: (format: "SillyTavern V2" | "SillyTavern V3") => void;
  readonly onSourceTextChange: (value: string) => void;
  readonly onScrubChange: (kind: "jailbreak" | "pua", enabled: boolean) => void;
  readonly onDistill: () => void;
}

const defaultSteps: readonly SoulDistillerStep[] = [
  { label: "Ingest", summary: "Import card" },
  { label: "Extract", summary: "Find core voice" },
  { label: "Scrub", summary: "Remove pressure" },
  { label: "Distill", summary: "Review soul" },
];

export function EdibleSoulDistillerWizard({
  steps = defaultSteps,
  activeStep,
  sourceFormat,
  sourceText,
  scrubJailbreak,
  scrubPua,
  onStepChange,
  onFormatChange,
  onSourceTextChange,
  onScrubChange,
  onDistill,
}: EdibleSoulDistillerWizardProps): ReactElement {
  return <section style={{ display: "grid", gap: 14, padding: 16, border: "var(--ai0-border-subtle)", borderRadius: 14, background: "var(--ai0-surface-main-card)" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div><strong>Edible Soul Distiller</strong><div style={{ fontSize: 12, opacity: 0.68 }}>Four steps from character card to a bounded persona.</div></div>
      <span style={{ fontSize: 12, color: "var(--ai0-accent)" }}>{activeStep + 1} / {steps.length}</span>
    </header>
    <nav aria-label="Distiller steps" style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6 }}>
      {steps.map((step, index) => <ButtonBase key={step.label} type="button" aria-current={index === activeStep ? "step" : undefined}
        onClick={() => onStepChange(index)} style={{ display: "grid", justifyItems: "start", textAlign: "left", padding: 8, border: "var(--ai0-border-subtle)", borderRadius: 8, background: index === activeStep ? "var(--ai0-accent-tint)" : "var(--ai0-surface-container-low)" }}>
        <strong style={{ fontSize: 12 }}>{index + 1}. {step.label}</strong><div style={{ fontSize: 11, opacity: 0.7 }}>{step.summary}</div>
      </ButtonBase>)}
    </nav>
    <SegmentedPill options={[{ value: "SillyTavern V2", label: "SillyTavern V2" }, { value: "SillyTavern V3", label: "SillyTavern V3" }]} value={sourceFormat} ariaLabel="Character card format" onChange={(value) => onFormatChange(value as EdibleSoulDistillerWizardProps["sourceFormat"])} />
    <CompactInput multiline rows={4} value={sourceText} onInput={onSourceTextChange}
      ariaLabel="Character card" placeholder="Paste a character card…" />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
      <JellySwitch checked={scrubJailbreak} label="Scrub jailbreak instructions" onChange={(enabled) => onScrubChange("jailbreak", enabled)} />
      <JellySwitch checked={scrubPua} label="Scrub PUA pressure patterns" onChange={(enabled) => onScrubChange("pua", enabled)} />
    </div>
    <RippleButton onClick={onDistill}>Distill safe persona</RippleButton>
  </section>;
}
