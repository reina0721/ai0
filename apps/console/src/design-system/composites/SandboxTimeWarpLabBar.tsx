import type { ReactElement } from "react";
import { HoverTooltip, RippleButton } from "../primitives/index.js";

export interface VaultSecret {
  name: string;
  scope: string;
  status: "sealed" | "rotating" | "ready";
}

export interface SecretsVaultManagerProps {
  secrets?: VaultSecret[];
  onRotate?: (secret: VaultSecret) => void;
}

export interface SandboxTimeWarpLabBarProps {
  timeOffsetHours?: number;
  replayStep?: number;
  onTimeWarp?: (hours: number) => void;
  onReplayStep?: (step: number) => void;
  secrets?: VaultSecret[];
  onRotateSecret?: (secret: VaultSecret) => void;
}

const defaultSecrets: VaultSecret[] = [
  { name: "AI0_LLM_API_KEY", scope: "routing", status: "sealed" },
  { name: "MCP_SANDBOX_TOKEN", scope: "sandbox", status: "ready" }
];

export function SecretsVaultManager({
  secrets = defaultSecrets,
  onRotate
}: SecretsVaultManagerProps): ReactElement {
  return (
    <section className="ai0-secrets-vault" aria-label="Secrets vault">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
        <strong>Secrets Vault</strong>
        <span>ephemeral sandbox bindings</span>
      </div>
      {secrets.map((secret) => (
        <div key={secret.name} className="ai0-secrets-vault__row" data-vault-status={secret.status}>
          <HoverTooltip content={secret.name} className="ai0-secrets-vault__secret"><code>{secret.name}</code></HoverTooltip>
          <small>{secret.scope}</small>
          <RippleButton size="sm"
            onClick={() => onRotate?.(secret)}
          >
            Rotate
          </RippleButton>
        </div>
      ))}
    </section>
  );
}

export function SandboxTimeWarpLabBar({
  timeOffsetHours = 0,
  replayStep = 0,
  onTimeWarp,
  onReplayStep,
  secrets,
  onRotateSecret
}: SandboxTimeWarpLabBarProps): ReactElement {
  const step = Math.max(0, Math.min(5, replayStep));
  return (
    <section className="ai0-time-warp-lab" data-sandbox-lab="true">
      <div className="ai0-time-warp-lab__controls">
        <div>
          <strong>VirtualClock Time-Warp &amp; Golden Regression</strong>
          <span data-time-warp-offset-label="true">
            {timeOffsetHours >= 0 ? "+" : ""}
            {timeOffsetHours}h virtual offset
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <RippleButton size="sm"
            data-time-warp-hours="6"
            onClick={() => onTimeWarp?.(6)}
          >
            +6h
          </RippleButton>
          <RippleButton size="sm"
            data-time-warp-hours="38"
            onClick={() => onTimeWarp?.(38)}
          >
            +38h Hibernation
          </RippleButton>
          <RippleButton size="sm" variant="primary"
            data-golden-replay="true"
            data-replay-step={String(step)}
            onClick={() => onReplayStep?.(step >= 5 ? 0 : step + 1)}
          >
            {step >= 5 ? "Replay Passed · 5/5" : `Run Golden Scenario (${step}/5)`}
          </RippleButton>
        </div>
      </div>
      <div className="ai0-time-warp-lab__progress" aria-label="Golden scenario replay progress">
        {[1, 2, 3, 4, 5].map((index) => (
          <i key={index} data-active={index <= step} aria-hidden="true" />
        ))}
      </div>
      <div
        data-sandbox-result-log="true"
        style={{
          fontSize: "12px",
          color: "var(--ai0-on-surface-muted)",
          padding: "8px 10px",
          borderRadius: "9px",
          background: "var(--ai0-surface-container-low)",
          border: "var(--ai0-border-subtle)"
        }}
      >
        Ready — LIVE mode enforces HTTP 403 fence; switch top bar to SANDBOX to advance VirtualClock or run the 5-step regression playbook against real SQLite sandboxes.
      </div>
      <SecretsVaultManager secrets={secrets} onRotate={onRotateSecret} />
    </section>
  );
}
