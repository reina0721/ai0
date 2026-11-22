import type { ReactElement } from "react";
import { StatusBadge, TonalSlider } from "../primitives/index.js";

export type DebounceGateState = "IDLE" | "BUFFERING_1200MS" | "COMMITTED";
export type CoverageBucketState = "fresh" | "warming" | "expiring" | "absent";
export interface SensoryCoverageBucket {
  id: string;
  label: string;
  state: CoverageBucketState;
  ttlMs: number;
}
export interface ThalamicGateDebounceTunerProps {
  state?: DebounceGateState;
  debounceMs?: number;
  elapsedMs?: number;
  buckets?: readonly SensoryCoverageBucket[];
  habituationGamma?: number;
  onHabituationGammaChange?: (gamma: number) => void;
}

const STATES: readonly DebounceGateState[] = ["IDLE", "BUFFERING_1200MS", "COMMITTED"];
const DEFAULT_BUCKETS: readonly SensoryCoverageBucket[] = [
  { id: "text", label: "Text", state: "fresh", ttlMs: 4_000 },
  { id: "typing", label: "Typing", state: "warming", ttlMs: 1_200 },
  { id: "vad", label: "Voice activity", state: "expiring", ttlMs: 340 },
  { id: "focus", label: "Window focus", state: "absent", ttlMs: 0 }
];

export function ThalamicGateDebounceTuner(props: ThalamicGateDebounceTunerProps): ReactElement {
  const state = props.state ?? "BUFFERING_1200MS";
  const debounceMs = props.debounceMs ?? 1_200;
  const elapsed = Math.min(debounceMs, Math.max(0, props.elapsedMs ?? 760));
  const gamma = Math.min(0.99, Math.max(0.1, props.habituationGamma ?? 0.82));
  const points = Array.from({ length: 7 }, (_, index) =>
    `${index * 20},${36 - Math.pow(gamma, index) * 30}`).join(" ");
  return <section className="ai0-thalamic-gate-tuner" aria-label="Thalamic gate debounce tuner"
    style={{ display: "grid", gap: "12px", padding: "12px" }}>
    <header><strong>Thalamic Gate · {debounceMs}ms debounce</strong>
      <small style={{ display: "block" }}>VirtualClock-driven multi-turn aggregation</small></header>
    <div className="ai0-debounce-state-strip" style={{ display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
      {STATES.map((item, index) => <div key={item} data-active={item === state} style={{ padding: "9px",
        border: "var(--ai0-border-subtle)", background: item === state ? "var(--ai0-accent-tint)" : undefined }}>
        <StatusBadge tone={item === state ? "info" : "neutral"}>{index + 1}</StatusBadge>
        <strong style={{ marginLeft: "6px" }}>{item}</strong>
        {index < 2 ? <span aria-hidden="true" style={{ float: "right" }}>→</span> : null}
      </div>)}
    </div>
    <div role="progressbar" aria-valuemin={0} aria-valuemax={debounceMs} aria-valuenow={elapsed}
      style={{ height: "6px", background: "var(--ai0-surface-container-low)" }}>
      <span style={{ display: "block", width: `${elapsed / debounceMs * 100}%`, height: "100%",
        background: "var(--ai0-accent)" }} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
      {(props.buckets ?? DEFAULT_BUCKETS).slice(0, 4).map((bucket) => <article key={bucket.id} data-state={bucket.state}
        style={{ padding: "8px", border: "var(--ai0-border-subtle)" }}>
        <strong>{bucket.label}</strong><small style={{ display: "block" }}>{bucket.state}</small>
        <StatusBadge tone={bucket.state === "fresh" ? "success" : bucket.state === "absent" ? "danger" : "warning"}>
          TTL {bucket.ttlMs}ms</StatusBadge>
      </article>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "12px", alignItems: "center" }}>
      <TonalSlider label={<span>Habituation decay γ<sub>hab</sub></span>} value={gamma}
        min={0.1} max={0.99} step={0.01} onInput={props.onHabituationGammaChange} />
      <svg viewBox="0 0 120 40" role="img" aria-label={`Habituation decay curve gamma ${gamma}`}>
        <polyline points={points} fill="none" stroke="var(--ai0-accent)" strokeWidth="2" />
        <path d="M0 36H120" stroke="var(--ai0-border-color)" />
      </svg>
    </div>
  </section>;
}
