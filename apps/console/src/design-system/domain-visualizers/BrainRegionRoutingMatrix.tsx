import ButtonBase from "@mui/material/ButtonBase";
import type { ReactElement } from "react";
export type BrainRegionId = "executive" | "narrative" | "somatic" | "social" | "dream";

export interface BrainRegionRoutingMatrixProps {
  metabolicLoad?: number;
  selectedRegion?: BrainRegionId;
  onSelectRegion?: (region: BrainRegionId) => void;
}

const regions: Array<{ id: BrainRegionId; name: string; model: string; job: string; reserve: string }> = [
  { id: "executive", name: "Executive cortex", model: "reasoner-xl", job: "planning", reserve: "L2" },
  { id: "narrative", name: "Narrative loom", model: "story-8b", job: "voice", reserve: "L1" },
  { id: "somatic", name: "Somatic sentinel", model: "signal-mini", job: "interoception", reserve: "L0" },
  { id: "social", name: "Social mirror", model: "empathy-14b", job: "repair", reserve: "L1" },
  { id: "dream", name: "Dream compiler", model: "sleeper-7b", job: "consolidation", reserve: "L2" },
];

export function BrainRegionRoutingMatrix({
  metabolicLoad = 42,
  selectedRegion = "executive",
  onSelectRegion,
}: BrainRegionRoutingMatrixProps): ReactElement {
  const drowsy = metabolicLoad < 25;
  const radar = "75,14 134,54 112,122 38,122 16,54";
  const values = "75,29 119,60 103,108 47,104 29,61";
  return <section style={{ display: "grid", gap: "14px", color: "var(--ai0-on-surface)" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
      <div><strong>Five-region routing</strong><div style={{ color: "var(--ai0-on-surface-muted)", fontSize: "12px" }}>Heterogeneous minds with a protected crisis lane</div></div>
      <span style={{ border: "var(--ai0-border-subtle)", borderRadius: "999px", padding: "5px 9px", background: "var(--ai0-surface-container-high)", fontSize: "12px" }}>🔒 5% L0 crisis reserve</span>
    </header>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 152px", border: "var(--ai0-border-subtle)", background: "var(--ai0-surface-main-card)" }}>
      <div>{regions.map((region) => <ButtonBase key={region.id} aria-pressed={region.id === selectedRegion}
        onClick={() => onSelectRegion?.(region.id)} style={{ width: "100%", display: "grid", gridTemplateColumns: "1.1fr 1fr .8fr auto", gap: "10px", textAlign: "left", padding: "10px 12px", border: "0", borderBottom: "var(--ai0-border-subtle)", color: "var(--ai0-on-surface)", background: region.id === selectedRegion ? "var(--ai0-accent-tint)" : "transparent" }}>
        <span><strong>{region.name}</strong><small style={{ display: "block", color: "var(--ai0-on-surface-muted)" }}>{region.job}</small></span><span>{region.model}</span><span style={{ color: "var(--ai0-on-surface-muted)" }}>{region.reserve} reserve</span><span style={{ color: "var(--ai0-accent)" }}>route</span>
      </ButtonBase>)}</div>
      <aside style={{ display: "grid", placeItems: "center", padding: "10px", borderLeft: "var(--ai0-border-subtle)", background: "var(--ai0-surface-container-low)" }}>
        <svg viewBox="0 0 150 140" role="img" aria-label="Five axis Voice Drift Radar"><polygon points={radar} fill="none" stroke="color-mix(in oklch, var(--ai0-accent), transparent 76%)" /><polygon points={values} fill="color-mix(in oklch, var(--ai0-accent) 24%, transparent)" stroke="var(--ai0-accent)" /><text x="75" y="10" textAnchor="middle" fill="var(--ai0-on-surface-muted)" fontSize="9">warmth</text><text x="138" y="56" fill="var(--ai0-on-surface-muted)" fontSize="9">clarity</text><text x="112" y="134" fill="var(--ai0-on-surface-muted)" fontSize="9">pace</text><text x="4" y="134" fill="var(--ai0-on-surface-muted)" fontSize="9">depth</text><text x="0" y="56" fill="var(--ai0-on-surface-muted)" fontSize="9">play</text></svg>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "11px", color: "var(--ai0-on-surface-muted)" }}><span style={{ width: "21px", height: "21px", borderRadius: "50%", border: drowsy ? "3px solid var(--ai0-accent)" : "3px solid color-mix(in oklch, var(--ai0-accent), transparent 76%)", boxSizing: "border-box" }} />{metabolicLoad}% metabolic {drowsy ? "· drowsy downgrade" : "· stable"}</div>
      </aside>
    </div>
  </section>;
}
