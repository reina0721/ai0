import type { ReactElement } from "react";

export type OpportunityPoolItem = {
  id: string;
  title: string;
  owner: string;
  priority: "critical" | "high" | "normal";
  salience: number;
  status: "queued" | "delegated" | "observing";
};

export type OpportunityPoolBubbleStripProps = {
  opportunities?: OpportunityPoolItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
};

const defaultOpportunities: OpportunityPoolItem[] = [
  { id: "op-71", title: "Reconcile release risk", owner: "Coordinator", priority: "critical", salience: 94, status: "delegated" },
  { id: "op-65", title: "Customer signal sweep", owner: "Scout", priority: "high", salience: 76, status: "queued" },
  { id: "op-44", title: "Policy drift review", owner: "Guardian", priority: "high", salience: 69, status: "observing" },
  { id: "op-39", title: "Memory compaction", owner: "Librarian", priority: "normal", salience: 48, status: "queued" }
];

const priorityTint = (priority: OpportunityPoolItem["priority"]) =>
  priority === "critical"
    ? "color-mix(in oklch, var(--ai0-accent) 82%, var(--ai0-surface-container-high))"
    : priority === "high"
      ? "color-mix(in oklch, var(--ai0-accent) 56%, var(--ai0-surface-container-low))"
      : "var(--ai0-surface-container-high)";

export function OpportunityPoolBubbleStrip({
  opportunities = defaultOpportunities,
  selectedId = opportunities[0]?.id,
  onSelect
}: OpportunityPoolBubbleStripProps): ReactElement {
  return (
    <section
      aria-label="Coordinator opportunity pool"
      style={{ background: "var(--ai0-surface-main-card)", color: "var(--ai0-on-surface)", padding: "16px" }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px" }}>
        <div>
          <strong>Opportunity pool</strong>
          <span style={{ color: "var(--ai0-on-surface-muted)", marginLeft: "8px" }}>agency attention queue</span>
        </div>
        <span style={{ color: "var(--ai0-on-surface-muted)", fontSize: "12px" }}>
          {opportunities.length} live signals
        </span>
      </header>
      <div style={{ display: "flex", gap: "12px", alignItems: "end", overflowX: "auto", paddingBottom: "4px" }}>
        {opportunities.map((opportunity) => {
          const active = opportunity.id === selectedId;
          const diameter = 54 + Math.round(opportunity.salience * 0.34);
          return (
            <button
              key={opportunity.id}
              type="button"
              className="ai0-ripple-btn"
              aria-pressed={active}
              data-opportunity-id={opportunity.id}
              onClick={() => onSelect?.(opportunity.id)}
              style={{
                width: `${diameter}px`,
                minWidth: `${diameter}px`,
                height: `${diameter}px`,
                borderRadius: "999px",
                border: active ? "2px solid var(--ai0-accent)" : "var(--ai0-border-subtle)",
                background: priorityTint(opportunity.priority),
                color: "var(--ai0-on-surface)",
                display: "grid",
                placeItems: "center",
                padding: "8px",
                textAlign: "center",
                cursor: "pointer",
                boxShadow: active
                  ? "0 0 0 4px color-mix(in oklch, var(--ai0-accent), transparent 55%)"
                  : "none"
              }}
            >
              <span style={{ fontSize: "11px", lineHeight: "1.15" }}>
                <b>{opportunity.salience}</b>
                <br />
                {opportunity.owner}
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          borderTop: "var(--ai0-border-subtle)",
          marginTop: "14px",
          paddingTop: "10px",
          color: "var(--ai0-on-surface-muted)",
          fontSize: "12px"
        }}
      >
        {opportunities.find((item) => item.id === selectedId)?.title ?? "No opportunity selected"}
      </div>
    </section>
  );
}
