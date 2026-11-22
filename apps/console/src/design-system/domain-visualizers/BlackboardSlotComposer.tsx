import type { ReactElement } from "react";
import { StatusBadge, SegmentedPill } from "../primitives/index.js";

export type BlackboardTier = "Tier-V1" | "Tier-V2" | "Tier-V3";
export interface BlackboardSlot {
  id: string;
  label: string;
  tokenCount: number;
  quotaTokens?: number;
  priority: number;
  summary?: string;
}
export interface BlackboardSlotComposerProps {
  slots: readonly BlackboardSlot[];
  tier: BlackboardTier;
  selectedSlotId?: string;
  tokenBudget?: number;
  socialMaskDamperPercent?: number;
  onTierChange?: (tier: BlackboardTier) => void;
  onSelectSlot?: (slotId: string) => void;
  onReorder?: (draggedSlotId: string, beforeSlotId: string) => void;
}
interface SlotDragEvent {
  preventDefault(): void;
  dataTransfer?: { setData(type: string, value: string): void; getData(type: string): string };
}

const TIERS = (["Tier-V1", "Tier-V2", "Tier-V3"] as const)
  .map((value) => ({ value, label: value }));

export function BlackboardSlotComposer(props: BlackboardSlotComposerProps): ReactElement {
  const slots = props.slots.slice(0, 5);
  const budget = props.tokenBudget ?? 2_500;
  const used = slots.reduce((total, slot) => total + slot.tokenCount, 0);
  const selected = slots.find(({ id }) => id === props.selectedSlotId) ?? slots[0];
  return <section className="ai0-blackboard-composer" aria-label="Blackboard slot composer"
    style={{ display: "grid", gap: "10px", padding: "12px" }}>
    <header style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div><strong>Blackboard Slot Composer</strong><small style={{ display: "block" }}>
        &lt;2500 Token · five-slot working context</small></div>
      <StatusBadge tone="info">{used}/{budget}</StatusBadge>
      <StatusBadge tone="warning">Social Mask Damper {props.socialMaskDamperPercent ?? 70}%</StatusBadge>
      <SegmentedPill value={props.tier} options={TIERS} ariaLabel="Memory tier"
        onChange={props.onTierChange} />
    </header>
    <div role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={used}
      className="ai0-blackboard-composer__quota" style={{ height: "22px", display: "flex",
        overflow: "hidden", borderRadius: "11px", background: "var(--ai0-surface-container-low)" }}>
      {slots.map((slot) => <button type="button" title={`${slot.label}: ${slot.tokenCount} tokens`}
        aria-label={`${slot.label}, ${slot.tokenCount} tokens`} onClick={() => props.onSelectSlot?.(slot.id)}
        style={{ width: `${Math.max(4, slot.tokenCount / budget * 100)}%`, border: 0,
          borderRight: "var(--ai0-border-subtle)", background: "var(--ai0-accent-tint)" }} />)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(230px, 0.9fr) 1.1fr",
      border: "var(--ai0-border-subtle)" }}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {slots.map((slot) => <li draggable data-selected={slot.id === selected?.id}
          onDragStart={(event: SlotDragEvent) => event.dataTransfer?.setData("text/slot-id", slot.id)}
          onDragOver={(event: SlotDragEvent) => event.preventDefault()}
          onDrop={(event: SlotDragEvent) => props.onReorder?.(
            event.dataTransfer?.getData("text/slot-id") ?? "", slot.id)}
          style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: "7px",
            padding: "8px", borderBottom: "var(--ai0-border-subtle)", cursor: "grab" }}>
          <span aria-hidden="true">⠿</span><button type="button" onClick={() => props.onSelectSlot?.(slot.id)}
            style={{ textAlign: "left" }}>{slot.label}</button>
          <StatusBadge tone="neutral">P{slot.priority} · {slot.tokenCount}</StatusBadge>
        </li>)}
      </ol>
      <article style={{ padding: "12px", borderLeft: "var(--ai0-border-subtle)" }}>
        <small>PRIORITY SLOT INSPECTOR</small>
        <h3>{selected?.label ?? "No slot selected"}</h3>
        <p>{selected?.summary ?? "Select a slot to inspect its compiled context contribution."}</p>
        <code>{selected ? `${selected.tokenCount}/${selected.quotaTokens ?? budget} tokens` : "empty"}</code>
      </article>
    </div>
  </section>;
}
