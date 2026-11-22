import type { FormEvent, ReactElement } from "react";

export type KnowledgePack = { id: string; name: string; mounted: boolean; documents: number };

export type KnowledgeUnmountGistWizardProps = {
  packs: KnowledgePack[];
  selectedId?: string;
  gist: string;
  onSelect?: (id: string) => void;
  onGistChange?: (value: string) => void;
  onExtractGistCardsBeforeUnmount?: (id: string) => void;
  onUnmount?: (id: string) => void;
};

export function KnowledgeUnmountGistWizard({
  packs,
  selectedId,
  gist,
  onSelect,
  onGistChange,
  onExtractGistCardsBeforeUnmount,
  onUnmount
}: KnowledgeUnmountGistWizardProps): ReactElement {
  const selected = packs.find((pack) => pack.id === selectedId);
  const validGist = gist.length > 0 && gist.length <= 150;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Knowledge pack unmount wizard">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-900">Hybrid RAG packs</p>
        <p className="text-xs text-slate-500">Preserve a compact, reviewable gist before unmounting a pack.</p>
      </div>
      <div className="divide-y divide-slate-100 border-y border-slate-100">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={`flex w-full items-center justify-between px-1 py-2 text-left text-sm ${pack.id === selectedId ? "bg-sky-50" : ""}`}
            onClick={() => onSelect?.(pack.id)}
          >
            <span className="font-medium text-slate-800">{pack.name}</span>
            <span className="text-xs text-slate-500">
              {pack.documents} docs · {pack.mounted ? "mounted" : "unmounted"}
            </span>
          </button>
        ))}
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-700">
        Pre-unmount gist card <span className="font-normal text-slate-400">{gist.length}/150</span>
        <textarea
          className="mt-1 min-h-16 w-full rounded-md border border-slate-200 p-2 text-sm"
          maxLength={150}
          value={gist}
          placeholder="What must survive this unmount?"
          onChange={(event: FormEvent<HTMLTextAreaElement>) => onGistChange?.(event.currentTarget.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-40"
          disabled={!selected || !validGist}
          onClick={() => selected && onExtractGistCardsBeforeUnmount?.(selected.id)}
        >
          extractGistCardsBeforeUnmount
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          disabled={!selected || !validGist || !selected.mounted}
          onClick={() => selected && onUnmount?.(selected.id)}
        >
          Unmount pack
        </button>
      </div>
    </section>
  );
}
