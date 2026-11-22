import ButtonBase from "@mui/material/ButtonBase";
import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";

import { RippleButton } from "../primitives/RippleButton.js";

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
          <ButtonBase
            key={pack.id}
            type="button"
            aria-pressed={pack.id === selectedId}
            sx={{ width: "100%", justifyContent: "space-between", px: 1, py: 0.75, textAlign: "left",
              background: pack.id === selectedId ? "var(--ai0-accent-tint)" : undefined }}
            onClick={() => onSelect?.(pack.id)}
          >
            <span className="font-medium text-slate-800">{pack.name}</span>
            <span className="text-xs text-slate-500">
              {pack.documents} docs · {pack.mounted ? "mounted" : "unmounted"}
            </span>
          </ButtonBase>
        ))}
      </div>
      <div className="mt-3 block text-xs font-semibold text-slate-700">
        Pre-unmount gist card <span className="font-normal text-slate-400">{gist.length}/150</span>
        <TextField
          multiline
          minRows={2}
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 150, "aria-label": "Pre-unmount gist card" } }}
          value={gist}
          placeholder="What must survive this unmount?"
          onChange={(event) => onGistChange?.(event.currentTarget.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <RippleButton size="sm"
          disabled={!selected || !validGist}
          onClick={() => selected && onExtractGistCardsBeforeUnmount?.(selected.id)}
        >
          extractGistCardsBeforeUnmount
        </RippleButton>
        <RippleButton size="sm" variant="danger"
          disabled={!selected || !validGist || !selected.mounted}
          onClick={() => selected && onUnmount?.(selected.id)}
        >
          Unmount pack
        </RippleButton>
      </div>
    </section>
  );
}
