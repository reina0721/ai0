import {
  WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceStatus
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";
import LinearProgress from "@mui/material/LinearProgress";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import {
  useAdminResource, useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceReadState, WorkspaceSaveButton
} from "./workspace.js";

interface RuntimeRoute {
  region: string;
  route: { selected_model_id: string; fallback_model_id: string; drowsy_downgraded: boolean };
}

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
  const routeId = resolveConsoleRoute(props.pathname)?.id;
  const editingRouting = routeId === "models.routing";

  const providerDraft = useWorkspaceDraft<ConsoleStudioState["providers"]>(studio?.providers ?? []);
  const routingDraft = useWorkspaceDraft(studio?.brainRouting);
  const budget = useWorkspaceDraft({
    dailyBudget: studio?.metabolicPolicy.dailyTokenBudget ?? 300_000,
    sleepyPct: studio?.metabolicPolicy.sleepyThresholdPct ?? 25,
    autoDowngrade: studio?.metabolicPolicy.autoDowngradeEnabled ?? true
  });
  const { dailyBudget, sleepyPct, autoDowngrade } = budget.value;
  const providers = providerDraft.value;
  const routing = routingDraft.value;
  const [newKeys, setNewKeys] = useState<Record<string, string>>({});
  const [latencies, setLatencies] = useState<Record<string, {
    milliseconds: number;
    detail: string;
    status: ConsoleStudioState["providers"][number]["status"];
  }>>({});
  const [pinging, setPinging] = useState<string>();
  const runtimeRoutes = useAdminResource<{ regions: RuntimeRoute[] }>(editingRouting ? "models/routing" : undefined);

  const llmProviders = providers.filter((provider) => provider.category === "llm" || provider.category === "lora");
  const meta = studio?.metabolicPolicy;
  const usedPct = meta ? Math.round((meta.usedTokensToday / Math.max(1, dailyBudget)) * 100) : undefined;
  const remainPct = usedPct === undefined ? undefined : Math.max(0, 100 - usedPct);
  const clearKeys = () => setNewKeys({});
  const canConfigure = Boolean(studio && ctx?.mode === "live" && ctx.ownerToken);

  const updateProvider = (
    id: string,
    patch: Partial<ConsoleStudioState["providers"][number]>
  ) => {
    providerDraft.setValue((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handlePing = async (providerId: string) => {
    if (!ctx || !canConfigure || pinging) return;
    setPinging(providerId);
    try {
      const res = await ctx.postStudio<{
        latencyMs: number; detail: string; status: ConsoleStudioState["providers"][number]["status"];
      }>(
        "/api/studio/provider-ping",
        { providerId }
      );
      setLatencies((prev) => ({ ...prev, [providerId]: { milliseconds: res.latencyMs, detail: res.detail, status: res.status } }));
      ctx.showToast(res.detail);
    } catch (err) {
      ctx.showToast(`连接测试失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPinging(undefined);
    }
  };

  const providerForm = useWorkspaceSave(editingRouting ? undefined : "models.providers",
    providerDraft.dirty || Object.values(newKeys).some((key) => key.trim()),
    () => { providerDraft.discard(); clearKeys(); },
    async () => {
      const updated = providers.map((provider) => {
        const latest = studio?.providers.find((item) => item.id === provider.id);
        return {
          ...provider,
          apiKeyMasked: newKeys[provider.id]?.trim() || latest?.apiKeyMasked || provider.apiKeyMasked,
          lastLatencyMs: latest?.lastLatencyMs ?? provider.lastLatencyMs,
          status: latest?.status ?? provider.status
        };
      });
      await ctx?.postStudio("config", { providers: updated });
    },
    "模型服务商配置已保存", () => { providerDraft.accept(); clearKeys(); });
  const routingForm = useWorkspaceSave(editingRouting ? "models.routing" : undefined,
    routingDraft.dirty || budget.dirty,
    () => { routingDraft.discard(); budget.discard(); },
    async () => {
      await ctx?.postStudio("config", {
        ...(routing ? { brainRouting: routing } : {}),
        metabolicPolicy: { dailyTokenBudget: dailyBudget, sleepyThresholdPct: sleepyPct, autoDowngradeEnabled: autoDowngrade }
      });
    },
    "脑区路由与代谢策略已保存", () => { routingDraft.accept(); budget.accept(); });

  return (
    <MainRoundedCardOutlet domainId="models" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage data-models-page="true">
        <WorkspaceHeader title={editingRouting ? "脑区路由与代谢策略" : "模型与多模态服务"}>
          <WorkspaceSaveButton form={editingRouting ? routingForm : providerForm} />
        </WorkspaceHeader>
        {editingRouting ? null : (
          <WorkspaceSection>
            <WorkspaceRow>
              <h2>模型与多模态服务商</h2>
            </WorkspaceRow>
            <WorkspaceGrid columns={2}>
              {!providers.length ? <small>当前没有模型或多模态服务配置。</small> : null}
              {providers.map((prov) => {
                const shownLatency = latencies[prov.id]?.milliseconds ?? prov.lastLatencyMs;
                const status = latencies[prov.id]?.status ?? prov.status;
                const isReady = status === "ready" || status === "configured";
                return (
                  <WorkspaceItem key={prov.id} as="article" data-provider-card={prov.id}>
                    <WorkspaceRow>
                      <div>
                        <div className="ai0-workspace-actions">
                          <strong>{prov.name}</strong>
                          <WorkspaceStatus data-tone="info">{CAT_LABELS[prov.category] ?? prov.category}</WorkspaceStatus>
                        </div>
                        <small>{prov.vendor}</small>
                      </div>
                      <div className="ai0-workspace-actions">
                        <WorkspaceStatus data-tone={isReady ? "live" : "warn"} data-provider-latency={prov.id}>
                          {isReady && shownLatency ? `≈ ${shownLatency}ms` : status === "error" ? "检查失败" : "待检查"}
                        </WorkspaceStatus>
                        <RippleButton
                          variant="secondary"
                          size="sm"
                          data-ping-provider={prov.id}
                          loading={pinging === prov.id}
                          disabled={!canConfigure || providerDraft.dirty || Boolean(newKeys[prov.id]) || Boolean(pinging)}
                          onClick={() => void handlePing(prov.id)}
                        >
                          {renderConsoleIcon("zap", 12)}
                          <span>检查</span>
                        </RippleButton>
                      </div>
                    </WorkspaceRow>
                    <WorkspaceGrid columns={3}>
                      <WorkspaceField>
                        <label>Model ID</label>
                        <CompactInput
                          type="text"
                          value={prov.modelId}
                          disabled={!canConfigure}
                          ariaLabel="模型 ID"
                          data-prov-model={prov.id}
                          onInput={(modelId) => updateProvider(prov.id, { modelId })}
                        />
                      </WorkspaceField>
                      <WorkspaceField>
                        <label>API Base URL</label>
                        <CompactInput
                          type="url"
                          value={prov.baseUrl}
                          disabled={!canConfigure}
                          ariaLabel="API Base URL"
                          data-prov-url={prov.id}
                          onInput={(baseUrl) => updateProvider(prov.id, { baseUrl })}
                        />
                      </WorkspaceField>
                      <WorkspaceField>
                        <label>API Key (Vault)</label>
                        <CompactInput
                          type="password"
                          value={newKeys[prov.id] ?? ""}
                          placeholder={prov.apiKeyMasked || "输入新密钥"}
                          disabled={!canConfigure}
                          ariaLabel="替换 API Key"
                          data-prov-key={prov.id}
                          onInput={(value) => setNewKeys((keys) => ({ ...keys, [prov.id]: value }))}
                        />
                      </WorkspaceField>
                    </WorkspaceGrid>
                    <JellySwitch label="启用服务商" checked={prov.enabled} disabled={!canConfigure}
                      onChange={(enabled) => updateProvider(prov.id, { enabled })} />
                    {latencies[prov.id] ? <small>{latencies[prov.id]?.detail}</small> : null}
                  </WorkspaceItem>
                );
              })}
            </WorkspaceGrid>
          </WorkspaceSection>)}

        {editingRouting ? <WorkspaceGrid columns={2}>
          <WorkspaceSection>
            <h2>五脑区异构路由矩阵</h2>
            {routing ? (
              <div className="ai0-workspace-stack">
                {(Object.entries(routing) as Array<
                  [keyof ConsoleStudioState["brainRouting"], { primaryId: string; fallbackId: string; label: string }]
                >).map(([regionKey, cfg]) => (
                  <WorkspaceItem key={regionKey} data-brain-region={regionKey}>
                    <strong>{cfg.label}</strong>
                    <WorkspaceGrid columns={2}>
                      <WorkspaceField>
                        <label>主力模型</label>
                        <CompactSelect
                          value={cfg.primaryId}
                          disabled={!canConfigure}
                          ariaLabel={`${cfg.label} 主力模型`}
                          data-route-primary={regionKey}
                          options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
                          onChange={(primaryId) =>
                            routingDraft.setValue((prev) =>
                              prev ? { ...prev, [regionKey]: { ...prev[regionKey], primaryId } } : prev
                            )
                          }
                        />
                      </WorkspaceField>
                      <WorkspaceField>
                        <label>降级备用模型</label>
                        <CompactSelect
                          value={cfg.fallbackId}
                          disabled={!canConfigure}
                          ariaLabel={`${cfg.label} 备用模型`}
                          data-route-fallback={regionKey}
                          options={llmProviders.map((p) => ({ value: p.id, label: p.name }))}
                          onChange={(fallbackId) =>
                            routingDraft.setValue((prev) =>
                              prev ? { ...prev, [regionKey]: { ...prev[regionKey], fallbackId } } : prev
                            )
                          }
                        />
                      </WorkspaceField>
                    </WorkspaceGrid>
                  </WorkspaceItem>
                ))}
              </div>
            ) : null}
          </WorkspaceSection>

          <WorkspaceSection>
            <h2>算力预算代谢</h2>
            <WorkspaceItem className="ai0-workspace-inset">
              <div className="ai0-workspace-row">
                <strong>今日可用预算余量</strong>
                <strong className="ai0-workspace-metric__value">{remainPct === undefined ? "—" : `${remainPct}%`}</strong>
              </div>
              {remainPct !== undefined ? <LinearProgress className="ai0-workspace-meter" variant="determinate"
                value={Math.min(100, remainPct)} aria-label="今日可用预算余量" /> : null}
              <small>
                {meta ? `配置用量 ${meta.usedTokensToday.toLocaleString()} / ${dailyBudget.toLocaleString()} Tokens · L0 应急配额 ${meta.emergencyReservePct}%` : "等待预算数据。"}
              </small>
            </WorkspaceItem>
            <WorkspaceGrid columns={2}>
              <WorkspaceField>
                <label>每日 Token 预算上限</label>
                <CompactInput
                  id="meta-daily-budget"
                  type="number"
                  step={10000}
                  value={dailyBudget}
                  ariaLabel="每日 Token 预算"
                  disabled={!canConfigure}
                  onInput={(v) => budget.setValue((previous) => ({ ...previous, dailyBudget: Math.max(1, Number(v)) }))}
                />
              </WorkspaceField>
              <WorkspaceField>
                <label>降级触发阈值 (%)</label>
                <CompactInput
                  id="meta-sleepy-pct"
                  type="number"
                  min={5}
                  max={50}
                  value={sleepyPct}
                  unit="%"
                  ariaLabel="降级触发阈值"
                  disabled={!canConfigure}
                  onInput={(v) => budget.setValue((previous) => ({ ...previous, sleepyPct: Math.max(5, Math.min(50, Number(v))) }))}
                />
              </WorkspaceField>
            </WorkspaceGrid>
            <JellySwitch label="自动降级" checked={autoDowngrade} disabled={!canConfigure}
              onChange={(enabled) => budget.setValue((previous) => ({ ...previous, autoDowngrade: enabled }))} />
            <WorkspaceItem>
              <WorkspaceRow>
                <h2>内核运行时路由</h2><RippleButton size="sm" onClick={runtimeRoutes.refresh}>刷新</RippleButton>
              </WorkspaceRow>
              {runtimeRoutes.data?.regions.length ? runtimeRoutes.data.regions.map(({ region, route }) => (
                <WorkspaceRow key={region}>
                  <code>{region}</code><small>{route.selected_model_id}{route.drowsy_downgraded ? " · 已降级" : ""}</small>
                </WorkspaceRow>
              )) : <WorkspaceReadState {...runtimeRoutes} empty="当前没有内核路由数据。" onRetry={runtimeRoutes.refresh} />}
            </WorkspaceItem>
          </WorkspaceSection>
        </WorkspaceGrid> : null}
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
