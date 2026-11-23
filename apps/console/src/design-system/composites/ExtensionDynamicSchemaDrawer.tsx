import type { ReactElement } from "react";

import { CompactInput, JellySwitch, RippleButton } from "../primitives/index.js";

export type ExtensionSchemaField = {
  key: string;
  label: string;
  description?: string;
  kind: "text" | "number" | "toggle";
  value: string | number | boolean;
};

export interface ExtensionDynamicSchemaDrawerProps {
  extensionName: string;
  fields: readonly ExtensionSchemaField[];
  open: boolean;
  onClose: () => void;
  onFieldChange: (key: string, value: string | number | boolean) => void;
  onHotReload: () => void;
}

export function ExtensionDynamicSchemaDrawer({
  extensionName, fields, open, onClose, onFieldChange, onHotReload,
}: ExtensionDynamicSchemaDrawerProps): ReactElement | null {
  if (!open) return null;

  return (
    <aside className="w-full max-w-md border-l border-[color:color-mix(in_oklch,var(--ai0-on-surface)_18%,transparent)] bg-[var(--ai0-surface-main-card)] p-5 shadow-[-18px_0_48px_color-mix(in_oklch,var(--ai0-on-surface)_10%,transparent)]">
      <header className="flex items-start justify-between gap-4 border-b border-[color:color-mix(in_oklch,var(--ai0-on-surface)_14%,transparent)] pb-4">
        <div><p className="text-xs text-[var(--ai0-on-surface)] opacity-65">config_schema.json</p><h2 className="mt-1 text-base font-semibold text-[var(--ai0-on-surface)]">{extensionName}</h2></div>
        <RippleButton size="sm" variant="ghost" onClick={onClose}>Close</RippleButton>
      </header>
      <div className="divide-y divide-[color:color-mix(in_oklch,var(--ai0-on-surface)_12%,transparent)]">
        {fields.map((field) => (
          <div className="block py-4" key={field.key}>
            <span className="block text-sm font-medium text-[var(--ai0-on-surface)]">{field.label}</span>
            {field.description && <span className="mt-1 block text-xs text-[var(--ai0-on-surface)] opacity-65">{field.description}</span>}
            {field.kind === "toggle" ? (
              <JellySwitch ariaLabel={field.label} checked={Boolean(field.value)}
                onChange={(checked) => onFieldChange(field.key, checked)} className="mt-3" />
            ) : (
              <CompactInput type={field.kind} ariaLabel={field.label} value={String(field.value)} className="mt-3"
                onInput={(value) => onFieldChange(field.key, field.kind === "number" ? Number(value) : value)} />
            )}
          </div>
        ))}
      </div>
      <RippleButton variant="primary" onClick={onHotReload} className="mt-5 w-full">Hot-reload this extension</RippleButton>
    </aside>
  );
}
