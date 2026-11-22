import type { ReactElement } from "react";
export interface AffectSample {
  readonly hour: number;
  readonly circadian: number;
  readonly fastAffect: number;
  readonly slowAffect: number;
}

export interface BioRhythmAffectCurveCanvasProps {
  readonly samples: readonly AffectSample[];
  readonly currentHour?: number;
  readonly onHourSelect?: (hour: number) => void;
}

const lineFor = (samples: readonly AffectSample[], key: keyof Omit<AffectSample, "hour">) => samples.map((sample, index) => `${index ? "L" : "M"}${12 + sample.hour * 11} ${106 - sample[key] * 42}`).join(" ");

export function BioRhythmAffectCurveCanvas({ samples, currentHour, onHourSelect }: BioRhythmAffectCurveCanvasProps): ReactElement {
  const markerX = currentHour === undefined ? undefined : 12 + currentHour * 11;
  return <section style={{ display: "grid", gap: 12, padding: 16, border: "var(--ai0-border-subtle)", borderRadius: 14, background: "var(--ai0-surface-workspace)" }}>
    <header><strong>Bio-rhythm & affect curves</strong><div style={{ fontSize: 12, opacity: 0.68 }}>24-hour circadian baseline coupled to fast and slow affect states.</div></header>
    <svg viewBox="0 0 288 124" role="img" aria-label="Circadian and affect curves" style={{ width: "100%", overflow: "visible", background: "var(--ai0-surface-inset)", borderRadius: 8 }}>
      {[26, 66, 106].map((y) => <path d={`M12 ${y}H276`} stroke="color-mix(in oklch, var(--ai0-accent), transparent 86%)" strokeWidth="1" />)}
      <path d={lineFor(samples, "circadian")} fill="none" stroke="var(--ai0-accent)" strokeWidth="2.4" />
      <path d={lineFor(samples, "fastAffect")} fill="none" stroke="#f59e0b" strokeWidth="1.7" />
      <path d={lineFor(samples, "slowAffect")} fill="none" stroke="#8b5cf6" strokeWidth="1.7" strokeDasharray="4 3" />
      {markerX !== undefined && <path d={`M${markerX} 12V112`} stroke="var(--ai0-accent)" strokeDasharray="3 3" opacity=".45" />}
      {samples.map((sample) => <circle cx={12 + sample.hour * 11} cy="112" r="5" fill="transparent" onClick={() => onHourSelect?.(sample.hour)} style={{ cursor: onHourSelect ? "pointer" : "default" }} />)}
    </svg>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}><span>● Circadian</span><span style={{ color: "#f59e0b" }}>● Fast affect</span><span style={{ color: "#8b5cf6" }}>● Slow affect</span><span style={{ marginLeft: "auto", opacity: 0.68 }}>{currentHour === undefined ? "Select a time" : `${currentHour}:00 selected`}</span></div>
  </section>;
}
