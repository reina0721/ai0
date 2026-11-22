import type { ReactElement } from "react";
export interface RelationshipTensionCardProps {
  bondName: string
  closeness: number
  tension: number
  hoursSinceRepair: number
  friction: string
  releaseLabel?: string
  onRelease?: () => void
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

export function RelationshipTensionCard({
  bondName,
  closeness,
  tension,
  hoursSinceRepair,
  friction,
  releaseLabel = 'Release Knot / 一键温柔释怀',
  onRelease,
}: RelationshipTensionCardProps): ReactElement {
  const remaining = Math.round(clamp(tension) * Math.pow(0.5, Math.max(0, hoursSinceRepair) / 48))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Relational climate</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{bondName}</h3>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
          {remaining}% active tension
        </span>
      </div>
      <div className="mt-4 space-y-3">
        <Metric label="Bond" value={closeness} tone="bg-emerald-500" />
        <Metric label="Friction" value={tension} tone="bg-amber-500" />
      </div>
      <p className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">{friction}</p>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>Repair half-life ≤ 48h · no leverage, no scorekeeping</span>
        <button className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 font-medium text-white" onClick={onRelease} type="button">
          {releaseLabel}
        </button>
      </div>
    </section>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }): ReactElement {
  const safeValue = clamp(value)
  return (
    <div className="grid grid-cols-[72px_1fr_34px] items-center gap-3 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${safeValue}%` }} /></div>
      <span className="text-right tabular-nums text-slate-500">{safeValue}</span>
    </div>
  )
}
