import type { ReactElement } from "react";
export interface RelationshipMilestone {
  id: string
  title: string
  moment: string
  note: string
  completed?: boolean
  conditions: [string, string, string]
}

export interface MilestoneRitualTimelineProps {
  milestones: RelationshipMilestone[]
  activeId?: string
  onSelect?: (milestone: RelationshipMilestone) => void
}

export function MilestoneRitualTimeline({ milestones, activeId, onSelect }: MilestoneRitualTimelineProps): ReactElement {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Organic milestones</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">Ritual timeline</h3>
        </div>
        <span className="text-xs text-slate-500">3 conditions per ritual</span>
      </div>
      <ol className="mt-5 space-y-1">
        {milestones.map((milestone, index) => {
          const selected = milestone.id === activeId
          return (
            <li className="grid grid-cols-[20px_1fr] gap-3" key={milestone.id}>
              <div className="flex flex-col items-center"><span className={`mt-1.5 h-3 w-3 rounded-full ring-4 ${milestone.completed ? 'bg-emerald-500 ring-emerald-50' : 'bg-slate-300 ring-slate-100'}`} />{index < milestones.length - 1 && <span className="min-h-16 w-px flex-1 bg-slate-200" />}</div>
              <button className={`mb-3 rounded-lg border p-3 text-left ${selected ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 hover:border-slate-200'}`} onClick={() => onSelect?.(milestone)} type="button">
                <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-800">{milestone.title}</span><span className="text-xs text-slate-500">{milestone.moment}</span></div>
                <p className="mt-1 text-sm text-slate-600">{milestone.note}</p>
                <ul className="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                  {milestone.conditions.map((condition) => <li className="rounded bg-white px-2 py-1" key={condition}>✓ {condition}</li>)}
                </ul>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
