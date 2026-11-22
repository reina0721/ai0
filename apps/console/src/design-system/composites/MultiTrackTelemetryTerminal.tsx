import type { ReactElement } from "react";

export type TelemetryTrack = "EVENT" | "TRACE" | "AGENCY" | "SYS";

export interface TelemetryRow {
  track: TelemetryTrack;
  message: string;
  time: string;
  tone?: "calm" | "warn" | "critical";
}

export interface MultiTrackTelemetryTerminalProps {
  rows?: TelemetryRow[];
  activeTracks?: TelemetryTrack[];
  onTracksChange?: (tracks: TelemetryTrack[]) => void;
}

const tracks: TelemetryTrack[] = ["EVENT", "TRACE", "AGENCY", "SYS"];

const defaultRows: TelemetryRow[] = [
  { time: "09:41:02", track: "EVENT", message: "Ingress accepted: deliberation/request" },
  { time: "09:41:03", track: "TRACE", message: "route.model selected aurora-reasoner" },
  { time: "09:41:04", track: "AGENCY", message: "planner opened bounded tool window" },
  { time: "09:41:05", track: "SYS", message: "reserve healthy · latency 184 ms" }
];

export function MultiTrackTelemetryTerminal({
  rows = defaultRows,
  activeTracks = tracks,
  onTracksChange
}: MultiTrackTelemetryTerminalProps): ReactElement {
  const visible = rows.filter((row) => activeTracks.includes(row.track));
  const toggle = (track: TelemetryTrack) => {
    const next = activeTracks.includes(track)
      ? activeTracks.filter((item) => item !== track)
      : [...activeTracks, track];
    onTracksChange?.(next);
  };

  return (
    <section className="ai0-telemetry-terminal" aria-label="Multi-track telemetry terminal">
      <header className="ai0-telemetry-terminal__header">
        <div>
          <strong>Telemetry terminal</strong>
          <span> streaming</span>
        </div>
        <div className="ai0-telemetry-terminal__filters" data-telemetry-filters="true">
          {tracks.map((track) => (
            <button
              key={track}
              type="button"
              className="ai0-ripple-btn ai0-telemetry-terminal__filter"
              aria-pressed={activeTracks.includes(track)}
              data-track={track}
              onClick={() => toggle(track)}
            >
              {`[${track}]`}
            </button>
          ))}
        </div>
      </header>
      <div className="ai0-telemetry-terminal__stream" role="log" aria-live="polite">
        {visible.map((row, index) => (
          <div
            key={`${row.time}-${row.track}-${index}`}
            className="ai0-telemetry-terminal__row"
            data-track={row.track}
            data-tone={row.tone ?? "calm"}
          >
            <time>{row.time}</time>
            <b>{`[${row.track}]`}</b>
            <span>{row.message}</span>
          </div>
        ))}
        {!visible.length ? (
          <p className="ai0-telemetry-terminal__empty">No selected telemetry tracks.</p>
        ) : null}
      </div>
      <style>{`
        .ai0-telemetry-terminal{display:grid;gap:12px;padding:16px;border:var(--ai0-border-subtle);border-radius:14px;background:var(--ai0-surface-main-card);color:var(--ai0-on-surface)}
        .ai0-telemetry-terminal__header,.ai0-telemetry-terminal__filters{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}.ai0-telemetry-terminal__header span{color:var(--ai0-on-surface-muted)}
        .ai0-telemetry-terminal__filter{padding:5px 8px;border:var(--ai0-border-subtle);border-radius:7px;background:var(--ai0-surface-container-low);color:var(--ai0-on-surface-muted);cursor:pointer}.ai0-telemetry-terminal__filter[aria-pressed=true]{background:var(--ai0-accent-tint);color:var(--ai0-on-surface)}
        .ai0-telemetry-terminal__stream{display:grid;gap:5px;min-height:136px;padding:10px;border-radius:9px;background:var(--ai0-surface-container-low);font:12px/1.45 ui-monospace,SFMono-Regular,monospace}.ai0-telemetry-terminal__row{display:grid;grid-template-columns:70px 72px 1fr;gap:8px}.ai0-telemetry-terminal__row time{color:var(--ai0-on-surface-muted)}.ai0-telemetry-terminal__row b{color:var(--ai0-accent)}.ai0-telemetry-terminal__row[data-tone=warn] b{color:var(--sovereignty-sandbox-amber)}.ai0-telemetry-terminal__row[data-tone=critical] b{color:var(--ai0-danger)}.ai0-telemetry-terminal__empty{margin:auto;color:var(--ai0-on-surface-muted)}
      `}</style>
    </section>
  );
}
