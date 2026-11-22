import { useEffect, useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../live-snapshot.js";
import { type ConsoleRoute } from "../router/routes.js";

export interface Domain5ModelsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

const CAT_LABELS: Record<string, string> = {
  llm: "LLM 对话",
  embedding: "Embedding 嵌入",
  reranker: "Reranker 精排",
  tts: "TTS 语音合成",
  stt: "STT 语音识别",
  lora: "L0 守卫 / LoRA"
};

export function Domain5ModelsPage(props: Domain5ModelsPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  const [providers, setProviders] = useState<ConsoleStudioState["providers"]>(
    studio?.providers ?? []
  );
  const [routing, setRouting] = useState<ConsoleStudioState["brainRouting"] | undefined>(
    studio?.brainRouting
  );
  const [dailyBudget, setDailyBudget] = useState(
    studio?.metabolicPolicy.dailyTokenBudget ?? 300000
  );
  const [sleepyPct, setSleepyPct] = useState(studio?.metabolicPolicy.sleepyThresholdPct ?? 25);
  const [latencies, setLatencies] = useState<Record<string, number>>({});

  useEffect(() => {
    if (studio?.providers) setProviders(studio.providers);
    if (studio?.brainRouting) setRouting(studio.brainRouting);
    if (studio?.metabolicPolicy) {
      setDailyBudget(studio.metabolicPolicy.dailyTokenBudget);
      setSleepyPct(studio.metabolicPolicy.sleepyThresholdPct);
    }
  }, [studio?.providers, studio?.brainRouting, studio?.metabolicPolicy]);

  const llmProviders = providers.filter((p) => p.category === "llm" || p.category === "lora");
  const meta = studio?.metabolicPolicy;
  const usedPct = meta ? Math.round((meta.usedTokensToday / Math.max(1, dailyBudget)) * 100) : 9;
  const remainPct = Math.max(0, 100 - usedPct);

  const updateProvider = (
    id: string,
    patch: Partial<ConsoleStudioState["providers"][number]>
  ) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handlePing = async (providerId: string) => {
    if (!ctx) return;
    try {
      const res = await ctx.postStudio<{ latencyMs: number; detail: string }>(
        "/api/studio/provider-ping",
        { providerId }
      );
      setLatencies((prev) => ({ ...prev, [providerId]: res.latencyMs }));
      ctx.showToast(res.detail);
    } catch (err) {
      ctx.showToast(`连接测速失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSave = async () => {
    if (!ctx) return;
    try {
      await ctx.postStudio("/api/studio/config", {
        providers,
        ...(routing ? { brainRouting: routing } : {}),
        metabolicPolicy: {
          dailyTokenBudget: dailyBudget,
          sleepyThresholdPct: sleepyPct
        }
      });
      await ctx.refreshSnapshot();
      ctx.showToast("模型服务商与脑区路由配置已保存");
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="models" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-models-page="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>模型与路由</h1>
          </div>
          <div className="ai0-page-header__actions">
            <RippleButton
              variant="primary"
              data-save-models-routing="true"
              onClick={() => void handleSave()}
            >
              {renderConsoleIcon("save", 14)}
              <span>保存配置</span>
            </RippleButton>
          </div>
        </header>

        <section className="ai0-card">
          <div className="ai0-card__head">
            <h2>模型与多模态服务商</h2>
          </div>
          <div className="ai0-grid-2">
            {providers.map((prov) => {
              const shownLatency = latencies[prov.id] ?? prov.lastLatencyMs;
              const isReady = prov.status === "ready" || latencies[prov.id] !== undefined;
              return (
                <article key={prov.id} className="ai0-card is-elevated" data-provider-card={prov.id}>
                  <div className="ai0-card__head">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <strong>{prov.name}</strong>
                        <span className="ai0-badge" data-tone="info">{CAT_LABELS[prov.category] ?? prov.category}</span>
                      </div>
                      <small>{prov.vendor}</small>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="ai0-badge" data-tone={isReady ? "live" : "warn"} data-provider-latency={prov.id}>
                        {isReady ? `${shownLatency}ms` : "待测试"}
                      </span>
                      <RippleButton
                        variant="secondary"
                        size="sm"
                        data-ping-provider={prov.id}
                        onClick={() => void handlePing(prov.id)}
                      >
                        {renderConsoleIcon("zap", 12)}
                        <span>测速</span>
                      </RippleButton>
                    </div>
                  </div>
                  <div className="ai0-grid-3">
                    <div className="ai0-field">
                      <label>Model ID</label>
                      <CompactInput
                        type="text"
                        value={prov.modelId}
                        data-prov-model={prov.id}
                        onInput={(modelId) => updateProvider(prov.id, { modelId })}
                      />
                    </div>
                    <div className="ai0-field">
                      <label>API Base URL</label>
                      <CompactInput
                        type="url"
                        value={prov.baseUrl}
                        data-prov-url={prov.id}
                        onInput={(baseUrl) => updateProvider(prov.id, { baseUrl })}
                      />
                    </div>
                    <div className="ai0-field">
                      <label>API Key (Vault)</label>
                      <CompactInput
                        type="password"
                        value={prov.apiKeyMasked}
                        data-prov-key={prov.id}
                        onInput={(apiKeyMasked) => updateProvider(prov.id, { apiKeyMasked })}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="ai0-grid-2">
          <section className="ai0-card is-elevated">
            <h2>五脑区异构路由矩阵</h2>
            {routing ? (
              <div style={{ display: "grid", gap: "10px" }}>
                {(Object.entries(routing) as Array<
                  [keyof ConsoleStudioState["brainRouting"], { primaryId: string; fallbackId: string; label: string }]
                >).map(([regionKey, cfg]) => (
                  <div
                    key={regionKey}
                    data-brain-region={regionKey}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: "var(--ai0-surface-container-low)",
                      border: "var(--ai0-border-subtle)",
                      display: "grid",
                      gap: "8px"
                    }}
                  >
                    <strong>{cfg.label}</strong>
                    <div className="ai0-grid-2">
                      <div className="ai0-field">
                        <label>主力模型</label>
                        <CompactSelect
                          value={cfg.primaryId}
                          data-route-primary={regionKey}
                          options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
                          onChange={(primaryId) =>
                            setRouting((prev) =>
                              prev ? { ...prev, [regionKey]: { ...prev[regionKey], primaryId } } : prev
                            )
                          }
                        />
                      </div>
                      <div className="ai0-field">
                        <label>降级备用模型</label>
                        <CompactSelect
                          value={cfg.fallbackId}
                          data-route-fallback={regionKey}
                          options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
                          onChange={(fallbackId) =>
                            setRouting((prev) =>
                              prev ? { ...prev, [regionKey]: { ...prev[regionKey], fallbackId } } : prev
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="ai0-card is-elevated">
            <h2>算力预算代谢与声线漂移监控</h2>
            <div style={{ padding: "13px 14px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: "var(--ai0-border-subtle)", display: "grid", gap: "9px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>今日可用预算余量</strong>
                <strong style={{ fontSize: "17px", color: "var(--ai0-success)", fontVariantNumeric: "tabular-nums" }}>{remainPct}%</strong>
              </div>
              <div style={{ height: "8px", borderRadius: "999px", background: "var(--ai0-surface-container-high)", overflow: "hidden" }}>
                <div style={{ width: `${remainPct}%`, height: "100%", background: "var(--ai0-success)", borderRadius: "999px" }} />
              </div>
              <small>
                已消耗 {(meta?.usedTokensToday ?? 27400).toLocaleString()} / {dailyBudget.toLocaleString()} Tokens · 低于 {sleepyPct}% 自动切换备用低耗模型 · 强制预留 {meta?.emergencyReservePct ?? 5}% L0 应急配额
              </small>
            </div>
            <div className="ai0-grid-2">
              <div className="ai0-field">
                <label>每日 Token 预算上限</label>
                <CompactInput
                  id="meta-daily-budget"
                  type="number"
                  step={10000}
                  value={dailyBudget}
                  onInput={(v) => setDailyBudget(Number(v) || 300000)}
                />
              </div>
              <div className="ai0-field">
                <label>降级触发阈值 (%)</label>
                <CompactInput
                  id="meta-sleepy-pct"
                  type="number"
                  min={5}
                  max={50}
                  value={sleepyPct}
                  unit="%"
                  onInput={(v) => setSleepyPct(Number(v) || 25)}
                />
              </div>
            </div>
            <div className="ai0-card" style={{ background: "var(--ai0-surface-container-low)" }}>
              <strong>跨模型声线一致性基线（基于黄金原声样本）</strong>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span className="ai0-badge" data-tone="good">日常对话 94%</span>
                <span className="ai0-badge" data-tone="good">情绪安抚 92%</span>
                <span className="ai0-badge" data-tone="good">反差张力 89%</span>
                <span className="ai0-badge" data-tone="good">禁词零触发 100%</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </MainRoundedCardOutlet>
  );
}
