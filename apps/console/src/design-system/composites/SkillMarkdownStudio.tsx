import type { ReactElement } from "react";

import { CompactInput, RippleButton } from "../primitives/index.js";

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
    <section className="rounded-lg border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_16%,transparent)] bg-[var(--ai0-surface-workspace)] p-5">
      <header><p className="text-xs text-[var(--ai0-on-surface)] opacity-65">Online SKILL.md authoring</p><h2 className="mt-1 text-base font-semibold text-[var(--ai0-on-surface)]">Skill Markdown Studio</h2></header>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-[var(--ai0-on-surface)]">Frontmatter
          <CompactInput multiline rows={7} value={frontmatter} onInput={onFrontmatterChange}
            ariaLabel="Frontmatter" className="mt-2" inputClassName="font-mono" />
        </label>
        <label className="text-sm font-medium text-[var(--ai0-on-surface)]">Prompt template
          <CompactInput multiline rows={7} value={promptTemplate} onInput={onPromptTemplateChange}
            ariaLabel="Prompt template" className="mt-2" inputClassName="font-mono" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-[color:color-mix(in_oklch,var(--ai0-on-surface)_12%,transparent)] py-3">
        <span className="text-xs text-[var(--ai0-on-surface)] opacity-70">3D permission pre-check: {permissions.join(" · ") || "no permissions requested"}</span>
        <span className="rounded-full bg-[color:color-mix(in_oklch,var(--ai0-accent)_14%,var(--ai0-surface-workspace))] px-2 py-1 text-xs text-[var(--ai0-on-surface)]">{precheckState}</span>
      </div>
      <footer className="mt-4 flex gap-3">
        <RippleButton onClick={onPrecheck}>Run pre-check</RippleButton>
        <RippleButton variant="primary" disabled={!canDryRun} onClick={onDryRun}>Dry-run sandbox · {dryRunState}</RippleButton>
      </footer>
    </section>
  );
}
