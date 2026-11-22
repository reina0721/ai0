import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
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
  return (
    <section className="ai0-telemetry-terminal" aria-label="Multi-track telemetry terminal">
      <header className="ai0-telemetry-terminal__header">
        <div>
          <strong>Telemetry terminal</strong>
          <span> streaming</span>
        </div>
        <ToggleButtonGroup size="small" aria-label="筛选日志轨道" value={activeTracks}
          className="ai0-telemetry-terminal__filters" data-telemetry-filters="true"
          onChange={(_, next: TelemetryTrack[]) => onTracksChange?.(next)}>
          {tracks.map((track) => (
            <ToggleButton
              key={track}
              value={track}
              data-track={track}
            >
              {`[${track}]`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
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
    </section>
  );
}
