import { useState, type KeyboardEvent, type ReactElement } from "react";

import { RippleButton } from "../primitives/index.js";
import { CONSOLE_ROUTES_30 } from "../../router/routes.js";

export interface CommandPaletteExtensionItem {
  id: string;
  label: string;
  description?: string;
  path?: string;
  keywords?: readonly string[];
  onSelect?: () => void;
}

export interface CommandPaletteModalProps {
  open: boolean;
  query?: string;
  extensionItems?: readonly CommandPaletteExtensionItem[];
  onQueryChange?: (query: string) => void;
  onNavigate?: (path: string) => void;
  onClose?: () => void;
}

export interface CommandPaletteShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutEvent): boolean {
  return event.key.toLowerCase() === "k" && Boolean(event.ctrlKey || event.metaKey);
}

export function CommandPaletteModal(props: CommandPaletteModalProps): ReactElement {
  const [localQuery, setLocalQuery] = useState("");
  if (!props.open) return <span hidden data-command-palette-state="closed" />;

  const activeQuery = props.onQueryChange ? (props.query ?? "") : localQuery;
  const query = activeQuery.trim().toLocaleLowerCase();
  const routeItems = CONSOLE_ROUTES_30.map((route) => ({
    id: route.id,
    label: route.label,
    description: route.path,
    path: route.defaultConcretePath ?? route.path,
    keywords: route.keywords,
    group: "route" as const
  }));
  const extensionItems = (props.extensionItems ?? []).map((item) => ({
    ...item,
    group: "extension" as const
  }));
  const results = [...routeItems, ...extensionItems]
    .filter((item) => {
      if (!query) return true;
      return [item.label, item.description, ...(item.keywords ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query));
    })
    .slice(0, 20);

  const select = (item: (typeof results)[number]): void => {
    if (item.path) props.onNavigate?.(item.path);
    if (item.group === "extension") item.onSelect?.();
    setLocalQuery("");
    props.onClose?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose?.();
    }
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      select(results[0]);
    }
  };

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Global command palette"
      className="ai0-command-palette ai0-command-palette-modal"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose?.();
      }}
      style={{
        position: "fixed",
        zIndex: 60,
        inset: 0,
        display: "grid",
        placeItems: "start center",
        paddingTop: "12vh",
        background: "color-mix(in oklch, var(--ai0-surface-frame-base), transparent 24%)"
      }}
    >
      <article
        style={{
          width: "min(680px, calc(100vw - 32px))",
          maxHeight: "68vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "var(--ai0-border-subtle)",
          borderRadius: "14px",
          background: "var(--ai0-surface-main-card)"
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px" }}>
          <input
            autoFocus
            value={activeQuery}
            placeholder="Search routes and extensions…"
            aria-label="Command search"
            onChange={(event) => {
              const next = event.currentTarget.value;
              setLocalQuery(next);
              props.onQueryChange?.(next);
            }}
            style={{ flex: 1, height: "32px" }}
          />
          <RippleButton ariaLabel="Close command palette" onClick={props.onClose}>
            Esc
          </RippleButton>
        </header>
        <div role="listbox" aria-label="Commands" style={{ overflowY: "auto", padding: "0 8px 8px" }}>
          {results.length === 0 ? (
            <p>No matching commands.</p>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                data-command-id={item.id}
                onClick={() => select(item)}
                style={{
                  width: "100%",
                  minHeight: "42px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  textAlign: "left",
                  border: 0,
                  borderBottom: "var(--ai0-border-subtle)",
                  color: "var(--ai0-on-surface)",
                  background: "transparent",
                  cursor: "pointer"
                }}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small style={{ display: "block" }}>{item.description}</small>
                </span>
                <span>{item.group}</span>
              </button>
            ))
          )}
        </div>
      </article>
    </section>
  );
}
