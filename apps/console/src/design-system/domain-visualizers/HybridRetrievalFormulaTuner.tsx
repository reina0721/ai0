import Slider from "@mui/material/Slider";
import type { ReactElement } from "react";

import { CompactInput } from "../primitives/CompactInput.js";

export type HybridRetrievalFormulaTunerProps = {
  audienceSql: string;
  retention: number;
  confidenceThreshold: number;
  elapsedDays: number;
  onAudienceSqlChange?: (value: string) => void;
  onRetentionChange?: (value: number) => void;
  onConfidenceThresholdChange?: (value: number) => void;
};

export function HybridRetrievalFormulaTuner({
  audienceSql,
  retention,
  confidenceThreshold,
  elapsedDays,
  onAudienceSqlChange,
  onRetentionChange,
  onConfidenceThresholdChange
}: HybridRetrievalFormulaTunerProps): ReactElement {
  const recall = Math.exp((-elapsedDays * (1 - retention)) / 7);
  const honestIgnorance = recall < confidenceThreshold;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Hybrid retrieval formula tuner">
      <div className="mb-4">
        <p className="text-sm font-semibold text-slate-900">Hybrid retrieval tuner</p>
        <p className="text-xs text-slate-500">Filter the audience before ranking memories by decay.</p>
      </div>
      <div className="block text-xs font-semibold text-[var(--ai0-on-surface)]">
        Stage 1 · SQL audience hard filter
        <CompactInput ariaLabel="SQL audience hard filter" className="mt-1" inputClassName="font-mono"
          multiline rows={2} value={audienceSql} onInput={onAudienceSqlChange} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="text-xs font-semibold text-[var(--ai0-on-surface)]">
          Retention mᵢ: {retention.toFixed(2)}
          <Slider
            className="mt-2 w-full"
            aria-label="Retention"
            size="small"
            min={0.1}
            max={1}
            step={0.05}
            value={retention}
            onChange={(_, next) => { if (typeof next === "number") onRetentionChange?.(next); }}
          />
        </div>
        <div className="text-xs font-semibold text-[var(--ai0-on-surface)]">
          θconfident: {confidenceThreshold.toFixed(2)}
          <Slider
            className="mt-2 w-full"
            aria-label="Confidence threshold"
            size="small"
            min={0.1}
            max={0.95}
            step={0.05}
            value={confidenceThreshold}
            onChange={(_, next) => { if (typeof next === "number") onConfidenceThresholdChange?.(next); }}
          />
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-mono text-slate-800">R(mᵢ, t) = e^(−t(1−mᵢ)/7) = {recall.toFixed(3)}</p>
        <p className={honestIgnorance ? "mt-1 font-medium text-amber-700" : "mt-1 font-medium text-emerald-700"}>
          {honestIgnorance ? "Honest ignorance: below confidence threshold." : "Eligible for Stage 2 retrieval."}
        </p>
      </div>
    </section>
  );
}
