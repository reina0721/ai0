import type { ReactElement } from "react";
import { StatusBadge, RippleButton } from "../primitives/index.js";

export type LineageNode = {
  id: string;
  label: string;
  parentIds?: string[];
  sealed?: boolean;
};

export type LineageDagGraphCanvasProps = {
  nodes: LineageNode[];
  selectedId?: string;
  hardForgetId?: string;
  onSelect?: (id: string) => void;
  onHardForget?: (id: string) => void;
  onTopicSeal?: (id: string) => void;
};

const cascadeTables = ["memories", "memories_vec", "memory_lineage_edges", "event_log", "turn_decision_traces"];

export function LineageDagGraphCanvas({
  nodes,
  selectedId,
  hardForgetId,
  onSelect,
  onHardForget,
  onTopicSeal
}: LineageDagGraphCanvasProps): ReactElement {
  const width = Math.max(360, nodes.length * 136);

  return (
    <section
      className="ai0-lineage-dag-canvas"
      aria-label="Memory lineage graph"
      style={{
        display: "grid",
        gap: "10px",
        padding: "12px",
        borderBottom: "var(--ai0-border-subtle)",
        background: "var(--ai0-surface-inset)"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div>
          <strong>Memory Lineage DAG & Cascade Radius</strong>
          <div style={{ fontSize: "12px", color: "var(--ai0-on-surface-muted)" }}>
            Topological targeted micro-reprojection follows every 5-table Hard Forget cascade.
          </div>
        </div>
        <StatusBadge tone="danger">5-Table Blast Radius</StatusBadge>
      </div>
      <div className="ai0-lineage-viewport">
      <svg
        viewBox={`0 0 ${width} 170`}
        role="group"
        aria-label="记忆血缘图谱"
        style={{
          width: "100%",
          minWidth: width,
          height: "170px",
          borderRadius: "10px",
          border: "var(--ai0-border-subtle)",
          background: "var(--ai0-surface-workspace)"
        }}
      >
        {nodes.flatMap((node, index) =>
          (node.parentIds ?? []).map((parentId) => {
            const parentIndex = nodes.findIndex((item) => item.id === parentId);
            return parentIndex < 0 ? null : (
              <line
                key={JSON.stringify([parentId, node.id])}
                x1={parentIndex * 136 + 64}
                y1={56}
                x2={index * 136 + 64}
                y2={116}
                stroke="var(--ai0-accent)"
                strokeWidth="1.5"
                opacity="0.55"
              />
            );
          })
        )}
        {nodes.map((node, index) => {
          const active = node.id === selectedId || node.id === hardForgetId;
          const y = index % 2 ? 108 : 24;
          return (
            <g
              key={node.id}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={node.label}
              aria-pressed={onSelect ? active : undefined}
              style={{ cursor: onSelect ? "pointer" : undefined }}
              onClick={() => onSelect?.(node.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect?.(node.id);
              }}
            >
              <rect
                x={index * 136 + 10}
                y={y}
                width="108"
                height="40"
                rx="9"
                fill={active ? "var(--ai0-accent-tint)" : "var(--ai0-surface-container-high)"}
                stroke={node.sealed ? "#8B5CF6" : active ? "var(--ai0-accent)" : "var(--ai0-on-surface-muted)"}
              />
              <text
                x={index * 136 + 64}
                y={y + 24}
                textAnchor="middle"
                fill="var(--ai0-on-surface)"
                fontSize="11"
              >
                {node.sealed ? "◈ " : ""}
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
          paddingTop: "8px",
          borderTop: "var(--ai0-border-subtle)"
        }}
      >
        <span style={{ fontSize: "11px", color: "var(--ai0-on-surface-muted)" }}>
          Cascade: {cascadeTables.join(" → ")} + redaction_ledger.json
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          {hardForgetId ? (
            <RippleButton onClick={() => onHardForget?.(hardForgetId)}>
              Hard Forget (5-Table Erase)
            </RippleButton>
          ) : null}
          {selectedId ? (
            <RippleButton onClick={() => onTopicSeal?.(selectedId)}>
              Topic Seal (Trauma Guard)
            </RippleButton>
          ) : null}
        </div>
      </div>
    </section>
  );
}
