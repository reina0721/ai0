import ButtonBase from "@mui/material/ButtonBase";
import type { ReactElement } from "react";
import type { AudienceScope } from "@ai0/protocol";
import { StatusBadge, JellySwitch } from "../primitives/index.js";

export interface MountedProtocolChannel {
  channelId: string;
  displayName: string;
  channelKind: string;
  status: "mounted" | "standby" | "offline";
  privacyCeiling: AudienceScope;
}
export interface EmbodimentStarMapCardProps {
  channels: readonly MountedProtocolChannel[];
  activeChannelId?: string;
  socialMaskDamperEnabled?: boolean;
  onSelectChannel?: (channelId: string) => void;
  onSocialMaskDamperChange?: (enabled: boolean) => void;
}

const ORBITS = [
  { left: "50%", top: "8%" }, { left: "80%", top: "26%" },
  { left: "78%", top: "72%" }, { left: "50%", top: "86%" },
  { left: "18%", top: "68%" }, { left: "20%", top: "24%" }
] as const;

export function EmbodimentStarMapCard(props: EmbodimentStarMapCardProps): ReactElement {
  return <section className="ai0-embodiment-star-map" aria-label="Mounted channel star map"
    style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) 220px",
      minHeight: "300px", border: "var(--ai0-border-subtle)" }}>
    <div style={{ position: "relative", minHeight: "300px", overflow: "hidden",
      background: "radial-gradient(circle, var(--ai0-accent-tint), transparent 62%)" }}>
      <span aria-hidden="true" style={{ position: "absolute", inset: "14%", borderRadius: "50%",
        border: "var(--ai0-border-subtle)" }} />
      <span aria-hidden="true" style={{ position: "absolute", inset: "31%", borderRadius: "50%",
        border: "var(--ai0-border-subtle)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        textAlign: "center" }}><strong>.soul</strong><small style={{ display: "block" }}>Protocol v0 core</small></div>
      {props.channels.map((channel, index) => <ButtonBase key={channel.channelId} aria-pressed={channel.channelId === props.activeChannelId}
        data-status={channel.status} data-active={channel.channelId === props.activeChannelId}
        onClick={() => props.onSelectChannel?.(channel.channelId)}
        style={{ position: "absolute", display: "grid", left: ORBITS[index % ORBITS.length]?.left, top: ORBITS[index % ORBITS.length]?.top,
          transform: "translate(-50%, -50%)", minWidth: "92px", padding: "7px", borderRadius: "12px",
          border: "var(--ai0-border-subtle)", background: "var(--ai0-surface-container-high)" }}>
        <span aria-hidden="true">{channel.status === "mounted" ? "✦" : channel.status === "standby" ? "◌" : "×"}</span>
        <span style={{ display: "block" }}>{channel.displayName}</span>
        <small>{channel.channelKind}</small>
      </ButtonBase>)}
    </div>
    <aside style={{ padding: "12px", borderLeft: "var(--ai0-border-subtle)" }}>
      <small>MOUNTED PROTOCOL V0 CHANNELS</small>
      {props.channels.map((channel) => <div key={channel.channelId} style={{ padding: "9px 0", borderBottom: "var(--ai0-border-subtle)" }}>
        <strong>{channel.displayName}</strong>
        <StatusBadge tone={channel.status === "mounted" ? "success" : "neutral"}>{channel.status}</StatusBadge>
        <div><StatusBadge tone="taint">ScopedCapabilityToken ≤ {channel.privacyCeiling}</StatusBadge></div>
      </div>)}
      <JellySwitch checked={props.socialMaskDamperEnabled ?? true} label="Social Mask Damper"
        onChange={props.onSocialMaskDamperChange} />
    </aside>
  </section>;
}
