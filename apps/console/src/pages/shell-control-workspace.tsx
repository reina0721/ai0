import {
  WorkspaceCode, WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow,
  WorkspaceSection, WorkspaceStatus, WorkspaceTag
} from "./workspace-layout.js";
import { ExtEmbodiedV1Schema, type ExpressionEnvelope } from "@ai0/protocol";
import { useState } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { CompactInput, CompactSelect, JellySwitch, RippleButton } from "../design-system/primitives/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../live-snapshot.js";
import {
  useAdminResource, useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader,
  WorkspaceReadState, WorkspaceSaveButton
} from "./workspace.js";

interface SensoryBucket {
  shell_id: string;
  modality: string;
  source_key: string;
  coverage: string;
  summary_text: string;
  freshness_ttl_ms: number;
}

interface Topology {
  active_sessions: Array<{ session_id: string; shell_id: string; venue_type: string; audience_scope: string; modality: string }>;
  shell_extensions: Array<{ id: string; rev: number }>;
  sensory_coverage: SensoryBucket[];
}

interface GateStatus {
  debounce_window_ms: number;
  opportunity_pool: Array<{ id: string; lifecycle: string; topic_key?: string }>;
  sensory_coverage: SensoryBucket[];
}

const DEFAULT_ATTENTION: ConsoleStudioState["attentionPolicy"] = {
  focusHysteresisMs: 4_000,
  neverBroadcastAll: true,
  retractDraftAwareness: true,
  habituationDecayRate: 0.18
};

function Coverage({ entries }: { entries: SensoryBucket[] }) {
  if (!entries.length) return <small>尚无感官覆盖记录。</small>;
  return entries.map((entry) => (
    <WorkspaceItem key={`${entry.shell_id}:${entry.modality}:${entry.source_key}`}>
      <WorkspaceRow>
        <strong>{entry.shell_id} · {entry.modality}</strong>
        <WorkspaceStatus data-tone="info">{entry.coverage}</WorkspaceStatus>
      </WorkspaceRow>
      <small>{entry.summary_text} · TTL {entry.freshness_ttl_ms}ms</small>
    </WorkspaceItem>
  ));
}

function PlatformConfig({ gate, studio }: { gate: boolean; studio?: ConsoleStudioState }) {
  const ctx = useConsole();
  const platforms = useWorkspaceDraft<ConsoleStudioState["platforms"]>(studio?.platforms ?? []);
  const form = useWorkspaceSave(
    gate ? "shells.thalamic-gate" : "shells.topology",
    platforms.dirty,
    platforms.discard,
    async () => { await ctx?.postStudio("config", { platforms: platforms.value }); },
    "通道配置已保存",
    platforms.accept
  );
  const topology = useAdminResource<Topology>(gate ? undefined : "shells/topology");
  const gateStatus = useAdminResource<GateStatus>(gate ? "shells/thalamic-gate" : undefined);
  const resource = gate ? gateStatus : topology;
  const coverage = gateStatus.data?.sensory_coverage ?? topology.data?.sensory_coverage ?? [];
  const update = (id: string, patch: Partial<ConsoleStudioState["platforms"][number]>) => {
    platforms.setValue((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  };

  return (
    <WorkspacePage data-platforms-page="true">
      <WorkspaceHeader title={gate ? "话轮防抖与感官门控" : "接入通道"}>
        <RippleButton size="sm" onClick={resource.refresh}>刷新运行状态</RippleButton>
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>
      <WorkspaceSection>
        <WorkspaceRow>
          <h2>{gate ? "共享感官覆盖" : "Protocol v0 接入拓扑"}</h2>
          {gateStatus.data ? <WorkspaceStatus data-tone="info">运行时防抖 {gateStatus.data.debounce_window_ms}ms</WorkspaceStatus> : null}
        </WorkspaceRow>
        {!resource.data ? <WorkspaceReadState {...resource} empty="等待控制台连接运行时。" onRetry={resource.refresh} /> : (
          gate ? <Coverage entries={coverage} /> : (
            <>
              <WorkspaceCode>POST /protocol/v0/shell/perception</WorkspaceCode>
              <small>共享运行时会话 · {topology.data?.active_sessions.length ?? 0}</small>
              {topology.data?.active_sessions.map((session) => (
                <WorkspaceItem key={session.session_id} as="article">
                  <strong>{session.shell_id}</strong>
                  <small>{session.venue_type} · {session.audience_scope} · {session.modality}</small>
                </WorkspaceItem>
              ))}
              <small>已注册躯壳：{topology.data?.shell_extensions.map((extension) => extension.id).join("、") || "无"}</small>
            </>
          )
        )}
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>{gate ? "各通道感官参数" : "通道适配器"}</h2>
        {!platforms.value.length ? <small>当前没有通道配置。</small> : null}
        <WorkspaceGrid columns={2}>
          {platforms.value.map((platform) => (
            <WorkspaceItem key={platform.id} as="article" data-platform-id={platform.id}>
              <WorkspaceRow>
                <div><strong>{platform.name}</strong><div><small>{platform.endpoint}</small></div></div>
                {!gate ? (
                  <JellySwitch checked={platform.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${platform.name}`}
                    data-plat-enabled={platform.id} onChange={(enabled) => update(platform.id, { enabled })} />
                ) : null}
              </WorkspaceRow>
              {gate ? (
                <WorkspaceGrid columns={2}>
                  <CompactInput ariaLabel="感官 TTL（秒）" type="number" min={0} unit="s" value={platform.sensorTtlSeconds}
                    disabled={!form.canWrite} data-plat-ttl={platform.id}
                    onInput={(value) => update(platform.id, { sensorTtlSeconds: Math.max(0, Number(value)) })} />
                  <CompactInput ariaLabel="话轮防抖（毫秒）" type="number" min={0} unit="ms" value={platform.debounceMs}
                    disabled={!form.canWrite} data-plat-debounce={platform.id}
                    onInput={(value) => update(platform.id, { debounceMs: Math.max(0, Number(value)) })} />
                </WorkspaceGrid>
              ) : (
                <div className="ai0-workspace-actions">
                  <WorkspaceStatus data-tone={platform.connected ? "live" : "warn"}>
                    {platform.connected ? `在线 ${platform.rttMs}ms` : "离线"}
                  </WorkspaceStatus>
                  {[...platform.sensors, ...platform.realizers, ...platform.actuators].map((value, index) => (
                    <WorkspaceTag key={`${value}:${index}`}>{value}</WorkspaceTag>
                  ))}
                </div>
              )}
            </WorkspaceItem>
          ))}
        </WorkspaceGrid>
      </WorkspaceSection>
    </WorkspacePage>
  );
}

function Attention({ studio }: { studio?: ConsoleStudioState }) {
  const ctx = useConsole();
  const draft = useWorkspaceDraft(studio?.attentionPolicy ?? DEFAULT_ATTENTION);
  const form = useWorkspaceSave("shells.attention", draft.dirty, draft.discard,
    async () => { await ctx?.postStudio("config", { attentionPolicy: draft.value }); },
    "注意力焦点参数已保存", draft.accept);
  const resource = useAdminResource<GateStatus>("shells/thalamic-gate");

  return (
    <WorkspacePage>
      <WorkspaceHeader title="注意力焦点仲裁"><WorkspaceSaveButton form={form} /></WorkspaceHeader>
      <WorkspaceSection>
        <h2>焦点保持与感知策略</h2>
        <WorkspaceGrid columns={2}>
          <WorkspaceField as="label">焦点保持窗口
            <CompactInput type="number" min={0} unit="ms" value={draft.value.focusHysteresisMs}
              disabled={!form.canWrite} onInput={(value) => draft.setValue((state) => ({ ...state, focusHysteresisMs: Math.max(0, Number(value)) }))} />
          </WorkspaceField>
          <WorkspaceField as="label">习惯化衰减率
            <CompactInput type="number" min={0} max={1} step={0.02} value={draft.value.habituationDecayRate}
              disabled={!form.canWrite} onInput={(value) => draft.setValue((state) => ({ ...state, habituationDecayRate: Math.max(0, Math.min(1, Number(value))) }))} />
          </WorkspaceField>
          <JellySwitch checked={draft.value.retractDraftAwareness} disabled={!form.canWrite} label="感知草稿撤回"
            onChange={(retractDraftAwareness) => draft.setValue((state) => ({ ...state, retractDraftAwareness }))} />
          <JellySwitch checked={draft.value.neverBroadcastAll} disabled={!form.canWrite} label="禁止全通道广播"
            onChange={(neverBroadcastAll) => draft.setValue((state) => ({ ...state, neverBroadcastAll }))} />
        </WorkspaceGrid>
      </WorkspaceSection>
      <WorkspaceSection>
        <WorkspaceRow>
          <h2>共享机会池</h2><RippleButton size="sm" onClick={resource.refresh}>刷新</RippleButton>
        </WorkspaceRow>
        {resource.data?.opportunity_pool.length ? resource.data.opportunity_pool.map((opportunity) => (
          <WorkspaceRow key={opportunity.id}>
            <code>{opportunity.topic_key ?? opportunity.id}</code>
            <WorkspaceStatus data-tone="info">{opportunity.lifecycle}</WorkspaceStatus>
          </WorkspaceRow>
        )) : <WorkspaceReadState {...resource} empty="当前没有机会记录。" onRetry={resource.refresh} />}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

function Media({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const providers = snapshot?.studioConfig?.providers.filter((provider) =>
    provider.category === "tts" || provider.category === "stt" || provider.category === "lora") ?? [];
  const extensions = snapshot?.extensions.filter((extension) =>
    extension.buses.some((bus) => bus.startsWith("ext.media"))) ?? [];
  const intent = snapshot?.latestTrace?.steps.step7_emitted_intent;
  return (
    <WorkspacePage>
      <WorkspaceHeader title="语音与表现管线">
        <RippleButton onClick={() => ctx?.navigateConsole("/models/providers")}>配置服务商</RippleButton>
      </WorkspaceHeader>
      <WorkspaceSection>
        <h2>语音与多模态服务</h2>
        {providers.length ? providers.map((provider) => (
          <WorkspaceRow key={provider.id}>
            <strong>{provider.name} · {provider.category.toUpperCase()}</strong>
            <small>{provider.modelId} · {provider.enabled ? "已启用" : "未启用"}</small>
          </WorkspaceRow>
        )) : <small>当前未配置语音或多模态服务。</small>}
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>管线扩展</h2>
        {extensions.length ? extensions.map((extension) => (
          <WorkspaceRow key={extension.id}>
            <code>{extension.id}</code>
            <small>{extension.buses.join("、")} · {extension.carrier}</small>
          </WorkspaceRow>
        )) : <small>当前实例未注册媒体管线扩展。</small>}
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>最近意图的表现能力</h2>
        {intent ? (
          <><code>{intent.intent_id}</code><small>{intent.extensions_attached.join("、") || "该意图没有表现扩展。"}</small></>
        ) : <small>等待本实例产生表达意图。</small>}
        <small>可在虚拟躯壳模拟器查看返回的实际表现关键帧。</small>
      </WorkspaceSection>
    </WorkspacePage>
  );
}

function Simulator() {
  const ctx = useConsole();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<"only_owner" | "public_all">("only_owner");
  const [result, setResult] = useState<{ expression?: ExpressionEnvelope }>();
  const [running, setRunning] = useState(false);
  const sandbox = ctx?.mode === "sandbox";
  const expression = result?.expression;
  const embodied = ExtEmbodiedV1Schema.safeParse(expression?.extensions?.["ext.embodied.v1"]);

  const run = async () => {
    if (!ctx || !sandbox || !text.trim() || running) return;
    setRunning(true);
    setResult(undefined);
    try {
      setResult(await ctx.postAdmin<{ expression?: ExpressionEnvelope }>("sandbox/inject", {
        shell_id: "console.simulator", summary_text: text.trim(), modality: "text",
        venue_type: audience === "only_owner" ? "private_1on1" : "public_livestream", audience_scope: audience
      }, "sandbox:console"));
      await ctx.refreshSnapshot("sandbox");
    } catch (error) {
      ctx.showToast(`模拟失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <WorkspacePage>
      <WorkspaceHeader title="虚拟躯壳模拟器">
        {sandbox ? <WorkspaceStatus data-tone="sandbox">sandbox:console</WorkspaceStatus>
          : <RippleButton onClick={() => ctx?.setMode("sandbox")}>切换到沙盒</RippleButton>}
      </WorkspaceHeader>
      <WorkspaceSection>
        <h2>注入文本感知</h2>
        <CompactSelect ariaLabel="受众" value={audience} onChange={setAudience}
          options={[{ value: "only_owner", label: "仅主账户" }, { value: "public_all", label: "公开场合" }]} />
        <CompactInput multiline rows={3} ariaLabel="模拟文本" value={text} onInput={setText} />
        <RippleButton variant="primary" disabled={!sandbox || !text.trim()} loading={running} onClick={() => void run()}>运行模拟</RippleButton>
      </WorkspaceSection>
      <WorkspaceSection aria-live="polite">
        <h2>表达回执</h2>
        {sandbox && expression ? (
          <>
            <p>{expression.fallback_text}</p>
            {embodied.success && embodied.data.keyframes?.map((frame, index) => (
              <div key={`${frame.sync_anchor}:${index}`}><code>{frame.sync_anchor}</code> <small>{frame.facial?.expression ?? frame.gaze?.behavior}</small></div>
            ))}
          </>
        ) : <small>表达结果会在沙盒模拟完成后显示。</small>}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

export function ShellControlWorkspace({ routeId, snapshot }: { routeId?: string; snapshot?: ConsoleLiveSnapshot }) {
  switch (routeId) {
    case "shells.attention": return <Attention studio={snapshot?.studioConfig} />;
    case "shells.thalamic-gate": return <PlatformConfig gate studio={snapshot?.studioConfig} />;
    case "shells.media-pipeline": return <Media snapshot={snapshot} />;
    case "shells.simulator": return <Simulator />;
    default: return <PlatformConfig gate={false} studio={snapshot?.studioConfig} />;
  }
}
