import type { ReactElement } from "react";
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
        <div className="ai0-secrets-vault__row" data-vault-status={secret.status}>
          <code title={secret.name}>{secret.name}</code>
          <small>{secret.scope}</small>
          <button
            type="button"
            className="ai0-ripple-btn"
            onClick={() => onRotate?.(secret)}
          >
            Rotate
          </button>
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
          <button
            type="button"
            className="ai0-ripple-btn"
            data-time-warp-hours="6"
            onClick={() => onTimeWarp?.(6)}
          >
            +6h
          </button>
          <button
            type="button"
            className="ai0-ripple-btn"
            data-time-warp-hours="38"
            onClick={() => onTimeWarp?.(38)}
          >
            +38h Hibernation
          </button>
          <button
            type="button"
            className="ai0-ripple-btn is-primary"
            data-golden-replay="true"
            data-replay-step={String(step)}
            onClick={() => onReplayStep?.(step >= 5 ? 0 : step + 1)}
          >
            {step >= 5 ? "Replay Passed · 5/5" : `Run Golden Scenario (${step}/5)`}
          </button>
        </div>
      </div>
      <div className="ai0-time-warp-lab__progress" aria-label="Golden scenario replay progress">
        {[1, 2, 3, 4, 5].map((index) => (
          <i data-active={index <= step} aria-hidden="true" />
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
      <style>{`
        .ai0-time-warp-lab{display:grid;gap:12px;padding:16px;border:var(--ai0-border-subtle);border-radius:14px;background:var(--ai0-surface-main-card);color:var(--ai0-on-surface)}
        .ai0-time-warp-lab__controls{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
        .ai0-time-warp-lab span,.ai0-secrets-vault span{display:block;color:var(--ai0-on-surface-muted);font-size:12px}
        .ai0-time-warp-lab__progress{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
        .ai0-time-warp-lab__progress i{height:6px;border-radius:99px;background:var(--ai0-surface-container-high);transition:background 220ms ease}
        .ai0-time-warp-lab__progress i[data-active="true"]{background:var(--ai0-accent)}
        .ai0-secrets-vault{display:grid;gap:8px;padding-top:12px;border-top:var(--ai0-border-subtle)}
        .ai0-secrets-vault__row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 10px;border-radius:10px;background:var(--ai0-surface-container-low);border:var(--ai0-border-subtle)}
        .ai0-secrets-vault__row code{color:var(--ai0-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ai0-secrets-vault__row small{color:var(--ai0-on-surface-muted);white-space:nowrap}
        .ai0-secrets-vault__row[data-vault-status="sealed"] code{color:var(--sovereignty-sandbox-amber)}
      `}</style>
    </section>
  );
}
