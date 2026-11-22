import type { ChangeEvent, ReactElement } from "react";

export type BlackboardPermission = "none" | "read" | "propose";

export interface BlackboardDomainPermissionMatrixProps {
  pluginName: string;
  permissions: Readonly<Record<"D1" | "D2" | "D3" | "D4" | "D5", BlackboardPermission>>;
  capabilityToken: string;
  onPermissionChange: (domain: "D1" | "D2" | "D3" | "D4" | "D5", permission: BlackboardPermission) => void;
}

const domains = ["D1", "D2", "D3", "D4", "D5"] as const;
const labels: Record<(typeof domains)[number], string> = { D1: "Identity", D2: "Context", D3: "Soul", D4: "Memory", D5: "Models" };

export function BlackboardDomainPermissionMatrix({
  pluginName, permissions, capabilityToken, onPermissionChange,
}: BlackboardDomainPermissionMatrixProps): ReactElement {
  return (
    <section className="rounded-lg border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_16%,transparent)] bg-[var(--ai0-surface-main-card)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs text-[var(--ai0-on-surface)] opacity-65">Blackboard access</p><h2 className="mt-1 text-base font-semibold text-[var(--ai0-on-surface)]">{pluginName}</h2></div>
        <span className="rounded-full border border-[color:color-mix(in_oklch,var(--ai0-accent)_52%,transparent)] bg-[color:color-mix(in_oklch,var(--ai0-accent)_13%,var(--ai0-surface-main-card))] px-2 py-1 text-xs text-[var(--ai0-on-surface)]">ScopedCapabilityToken · {capabilityToken}</span>
      </header>
      <div className="mt-5 overflow-hidden rounded-md border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_14%,transparent)]">
        {domains.map((domain) => (
          <div key={domain} className="flex items-center justify-between gap-4 border-b border-[color:color-mix(in_oklch,var(--ai0-on-surface)_12%,transparent)] px-3 py-3 last:border-b-0">
            <div><span className="text-sm font-medium text-[var(--ai0-on-surface)]">{domain}</span><span className="ml-2 text-xs text-[var(--ai0-on-surface)] opacity-65">{labels[domain]}</span></div>
            <select value={permissions[domain]} onChange={(event: ChangeEvent<HTMLSelectElement>) => onPermissionChange(domain, event.currentTarget.value as BlackboardPermission)} className="rounded-md border border-[color:color-mix(in_oklch,var(--ai0-on-surface)_18%,transparent)] bg-[var(--ai0-surface-container-low)] px-2 py-1 text-sm text-[var(--ai0-on-surface)]">
              <option value="none">No access</option><option value="read">Read</option><option value="propose">Propose</option>
            </select>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--ai0-on-surface)] opacity-65">Proposals remain reviewable; this token cannot commit domain changes.</p>
    </section>
  );
}
