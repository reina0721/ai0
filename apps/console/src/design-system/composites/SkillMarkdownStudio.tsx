import type { ChangeEvent, ReactElement } from "react";

export interface SkillMarkdownStudioProps {
  frontmatter: string;
  promptTemplate: string;
  permissions: readonly string[];
  precheckState: "idle" | "passed" | "blocked";
  dryRunState: "idle" | "running" | "complete";
  onFrontmatterChange: (value: string) => void;
  onPromptTemplateChange: (value: string) => void;
  onPrecheck: () => void;
  onDryRun: () => void;
}

export function SkillMarkdownStudio({
  frontmatter, promptTemplate, permissions, precheckState, dryRunState,
  onFrontmatterChange, onPromptTemplateChange, onPrecheck, onDryRun,
}: SkillMarkdownStudioProps): ReactElement {
  const canDryRun = precheckState === "passed";
  return (
    <section className="rounded-lg border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_16%,transparent)] bg-[var(--ai0-surface-main-card)] p-5">
      <header><p className="text-xs text-[var(--ai0-on-surface)] opacity-65">Online SKILL.md authoring</p><h2 className="mt-1 text-base font-semibold text-[var(--ai0-on-surface)]">Skill Markdown Studio</h2></header>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--ai0-on-surface)]">Frontmatter
          <textarea value={frontmatter} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onFrontmatterChange(event.currentTarget.value)} className="mt-2 h-40 w-full resize-none rounded-md border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_18%,transparent)] bg-[var(--ai0-surface-container-low)] p-3 font-mono text-xs text-[var(--ai0-on-surface)]" />
        </label>
        <label className="text-sm font-medium text-[var(--ai0-on-surface)]">Prompt template
          <textarea value={promptTemplate} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptTemplateChange(event.currentTarget.value)} className="mt-2 h-40 w-full resize-none rounded-md border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_18%,transparent)] bg-[var(--ai0-surface-container-low)] p-3 font-mono text-xs text-[var(--ai0-on-surface)]" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-[color:color-mix(in_oklch,var(--ai0-on-surface)_12%,transparent)] py-3">
        <span className="text-xs text-[var(--ai0-on-surface)] opacity-70">3D permission pre-check: {permissions.join(" · ") || "no permissions requested"}</span>
        <span className="rounded-full bg-[color:color-mix(in_oklch,var(--ai0-accent)_14%,var(--ai0-surface-main-card))] px-2 py-1 text-xs text-[var(--ai0-on-surface)]">{precheckState}</span>
      </div>
      <footer className="mt-4 flex gap-3"><button type="button" onClick={onPrecheck} className="rounded-md border border-[color:color-mix(in_oklch,var(--ai0-accent)_48%,transparent)] px-3 py-2 text-sm text-[var(--ai0-on-surface)]">Run pre-check</button><button type="button" disabled={!canDryRun} onClick={onDryRun} className="rounded-md bg-[var(--ai0-accent)] px-3 py-2 text-sm font-medium text-[var(--ai0-surface-main-card)] disabled:opacity-40">Dry-run sandbox · {dryRunState}</button></footer>
    </section>
  );
}
