import type { ReactElement } from "react";
import { RippleButton } from "../primitives/RippleButton.js";
export interface NarrativeSnapshot {
  autobiography: string
  persona: string
}

export interface DualColumnNarrativeApprovalProps {
  proposalId: string
  title: string
  before: NarrativeSnapshot
  after: NarrativeSnapshot
  rationale: string
  status?: 'pending' | 'approved' | 'rejected'
  onApprove?: (proposalId: string) => void
  onReject?: (proposalId: string) => void
}

export function DualColumnNarrativeApproval({
  proposalId,
  title,
  before,
  after,
  rationale,
  status = 'pending',
  onApprove,
  onReject,
}: DualColumnNarrativeApprovalProps): ReactElement {
  const pending = status === 'pending'
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div><p className="text-xs font-medium uppercase tracking-widest text-slate-500">W3 narrative proposal</p><h3 className="mt-1 font-semibold text-slate-900">{title}</h3></div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'approved' ? 'bg-emerald-50 text-emerald-700' : status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{status}</span>
      </header>
      <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
        <NarrativeColumn label="Before" snapshot={before} />
        <NarrativeColumn label="After" snapshot={after} emphasized />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4">
        <p className="max-w-xl text-sm text-slate-600">{rationale}</p>
        <div className="flex gap-2">
          <RippleButton disabled={!pending} onClick={() => onReject?.(proposalId)}>Reject</RippleButton>
          <RippleButton variant="primary" disabled={!pending} onClick={() => onApprove?.(proposalId)}>Approve evolution</RippleButton>
        </div>
      </footer>
    </section>
  )
}

function NarrativeColumn({ label, snapshot, emphasized = false }: { label: string; snapshot: NarrativeSnapshot; emphasized?: boolean }): ReactElement {
  return <div className={`p-4 ${emphasized ? 'bg-indigo-50/40' : ''}`}><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p><dl className="mt-3 space-y-3 text-sm"><div><dt className="font-medium text-slate-700">Autobiography</dt><dd className="mt-1 text-slate-600">{snapshot.autobiography}</dd></div><div><dt className="font-medium text-slate-700">Persona</dt><dd className="mt-1 text-slate-600">{snapshot.persona}</dd></div></dl></div>
}
