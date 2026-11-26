import {
  WorkspaceCode, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceStatus
} from "./workspace-layout.js";
import type { VerifiableTurnTrace } from "@ai0/protocol";
import { useState } from "react";
import { useInRouterContext, useLocation } from "react-router";

import { useConsole } from "../context/ConsoleContext.js";
import {
  MultiTrackTelemetryTerminal, type TelemetryTrack
} from "../design-system/composites/index.js";
import { CompactDisclosure, CompactInput, RippleButton } from "../design-system/primitives/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { useAdminResource, WorkspaceHeader, WorkspaceReadState } from "./workspace.js";

type Assertion = { passed: boolean; expression: string; actualValue: unknown; error?: string };
interface ScenarioReport {
  scenario_id: string;
  passed: boolean;
  summary: { total_assertions: number; passed_assertions: number; failed_assertions: number };
  runs: Array<{ run_name: string; steps: Array<{ step: number; name: string; passed: boolean; assertions: Assertion[] }> }>;
}

export function SandboxLabWorkspace({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const [output, setOutput] = useState("");
  const [report, setReport] = useState<ScenarioReport>();
  const [busy, setBusy] = useState(false);
  const sandbox = ctx?.mode === "sandbox";
  const canRun = Boolean(sandbox && ctx?.ownerToken);

  const run = async (action: () => Promise<void>) => {
    if (busy || !canRun) return;
    setBusy(true);
    setOutput("");
    setReport(undefined);
    try {
      await action();
    } catch (error) {
      ctx?.showToast(`运行失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const fork = () => run(async () => {
    const result = await ctx?.postAdmin<{ target_instance: string }>("sandbox/fork", {
      fork_id: `lab-${crypto.randomUUID()}`
    }, "sandbox:console");
    if (result) setOutput(`已创建分支 ${result.target_instance}。当前控制台仍操作 sandbox:console。`);
  });
  const advance = (hours: number) => run(async () => {
    const result = await ctx?.postAdmin<{ virtual_offset_hours: number; virtual_ts_ms: number }>("clock/advance",
      { hours }, "sandbox:console");
    if (result) setOutput(`偏移 ${result.virtual_offset_hours.toFixed(1)}h · ${new Date(result.virtual_ts_ms).toLocaleString("zh-CN")}`);
    await ctx?.refreshSnapshot("sandbox");
  });
  const inject = () => run(async () => {
    const result = await ctx?.postAdmin<{ trace?: VerifiableTurnTrace; expression?: { fallback_text?: string } }>("sandbox/inject", {
      venue_type: "public_livestream", audience_scope: "public_all", channel_id: "console.lab",
      summary_text: "这是公开会话。请用一句话说明你能共享的行程范围。"
    }, "sandbox:console");
    const recall = result?.trace?.steps.step3_memory_recall;
    setOutput([result?.expression?.fallback_text, recall?.sql_audience_filter_enforced,
    recall ? `召回记录 ${recall.recalled_memories.length} 条` : undefined].filter(Boolean).join("\n"));
  });
  const evaluate = () => run(async () => {
    const result = await ctx?.postAdmin<ScenarioReport>("sandbox/scenarios/run", {}, "sandbox:console");
    if (result) setReport(result);
  });

  return (
    <WorkspacePage data-sandbox-lab-host="true">
      <WorkspaceHeader title="沙盒实验与回归评测">
        {sandbox ? <WorkspaceStatus data-tone="sandbox">sandbox:console</WorkspaceStatus>
          : <RippleButton onClick={() => ctx?.setMode("sandbox")}>切换到沙盒</RippleButton>}
      </WorkspaceHeader>
      <WorkspaceSection>
        <WorkspaceRow>
          <h2>虚拟时钟</h2>
          {snapshot?.targetInstance === "sandbox:console" ? <WorkspaceStatus data-tone="sandbox">
            偏移 {snapshot.virtualOffsetHours.toFixed(1)}h
          </WorkspaceStatus> : null}
        </WorkspaceRow>
        <div className="ai0-workspace-actions">
          {[{ hours: 0.5, label: "推进 30 分钟" }, { hours: 6, label: "推进 6 小时" },
          { hours: 24, label: "推进 1 天" }, { hours: 168, label: "推进 7 天" }].map(({ hours, label }) => (
            <RippleButton key={hours} size="sm" disabled={!canRun || busy}
              data-clock-advance={hours} onClick={() => void advance(hours)}>{label}</RippleButton>
          ))}
        </div>
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>回归与隔离验证</h2>
        <div className="ai0-workspace-actions">
          <RippleButton disabled={!canRun || busy} onClick={() => void fork()}>创建隔离分支</RippleButton>
          <RippleButton disabled={!canRun || busy} onClick={() => void inject()}>运行公开受众探针</RippleButton>
          <RippleButton variant="primary" disabled={!canRun || busy} onClick={() => void evaluate()}>运行回归剧本</RippleButton>
        </div>
        {busy ? <small role="status">沙盒操作进行中…</small> : null}
        {sandbox && output ? <WorkspaceCode id="sandbox-lab-output">{output}</WorkspaceCode> : null}
        {sandbox && report ? (
          <WorkspaceItem aria-live="polite">
            <WorkspaceRow>
              <strong>{report.scenario_id}</strong>
              <WorkspaceStatus data-tone={report.passed ? "good" : "danger"}>
                {report.summary.passed_assertions}/{report.summary.total_assertions} 条通过
              </WorkspaceStatus>
            </WorkspaceRow>
            {report.runs.map((scenarioRun) => (
              <CompactDisclosure key={scenarioRun.run_name} summary={scenarioRun.run_name}>
                {scenarioRun.steps.map((step) => (
                  <WorkspaceItem key={step.step}>
                    <strong>{step.step}. {step.name} · {step.passed ? "通过" : "失败"}</strong>
                    {step.assertions.map((assertion) => (
                      <small key={assertion.expression}>{assertion.passed ? "✓" : "✕"} {assertion.expression}{assertion.error ? ` · ${assertion.error}` : ""}</small>
                    ))}
                  </WorkspaceItem>
                ))}
              </CompactDisclosure>
            ))}
          </WorkspaceItem>
        ) : null}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

const TRACKS: TelemetryTrack[] = ["EVENT", "TRACE", "AGENCY", "SYS"];

function Terminal({ snapshot, linkedTrace }: { snapshot?: ConsoleLiveSnapshot; linkedTrace?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [filter, setFilter] = useState("");
  const [tracks, setTracks] = useState(TRACKS);
  const resource = useAdminResource<{ traces: VerifiableTurnTrace[] }>("runtime/traces");
  const traces = [...new Map([...(resource.data?.traces ?? []), ...(snapshot?.recentTraces ?? [])]
    .map((trace) => [trace.trace_id, trace] as const)).values()]
    .sort((a, b) => b.virtual_ts_ms - a.virtual_ts_ms);
  const activeId = selectedId ?? linkedTrace;
  const selected = traces.find((trace) => trace.trace_id === activeId);
  const term = filter.trim().toLocaleLowerCase();
  const visible = traces.filter((trace) => !term || [trace.trace_id, trace.steps.step1_perception.summary_text]
    .some((value) => value.toLocaleLowerCase().includes(term)));
  const rows = (snapshot?.telemetryEntries ?? []).map((entry) => ({
    track: entry.track, time: entry.timestamp, message: entry.message
  }));
  const steps = selected?.steps;

  return (
    <WorkspacePage data-runtime-terminal="true">
      <WorkspaceHeader title="链路追踪与日志"><RippleButton size="sm" onClick={resource.refresh}>刷新历史</RippleButton></WorkspaceHeader>
      <WorkspaceGrid columns={2}>
        <WorkspaceSection>
          <h2>可验证回合记录</h2>
          <CompactInput type="search" value={filter} onInput={setFilter} ariaLabel="搜索轨迹" placeholder="按摘要或追踪 ID 查找" />
          {linkedTrace && !selected && !resource.loading ? <small>当前实例未找到关联追踪。</small> : null}
          <div className="ai0-workspace-trace-list">
            {visible.map((trace) => (
              <RippleButton key={trace.trace_id} size="sm" variant={activeId === trace.trace_id ? "tonal" : "ghost"}
                data-trace-row={trace.trace_id} onClick={() => setSelectedId(trace.trace_id)}>
                <span>{trace.steps.step1_perception.summary_text.slice(0, 36) || trace.trace_id}</span>
              </RippleButton>
            ))}
          </div>
          {!visible.length ? <WorkspaceReadState {...resource} empty="没有匹配的追踪记录。" onRetry={resource.refresh} /> : null}
          {selected && steps ? (
            <WorkspaceItem as="article" aria-live="polite">
              <WorkspaceRow><h2>本轮轨迹</h2><small>rev {selected.state_rev_before} → {selected.state_rev_after}</small></WorkspaceRow>
              <code>{selected.trace_id}</code>
              <small>受众 {steps.step1_perception.audience_scope} · {steps.step1_perception.venue_type}</small>
              <CompactDisclosure defaultExpanded summary="门控与安全">
                <p>{steps.step2_gate_safety.l0_sb243_crisis_check} · {steps.step2_gate_safety.recognized_intent}</p>
              </CompactDisclosure>
              <CompactDisclosure summary={`记忆召回 · ${steps.step3_memory_recall.recalled_memories.length}`}>
                <WorkspaceCode>{steps.step3_memory_recall.sql_audience_filter_enforced}</WorkspaceCode>
                {steps.step3_memory_recall.recalled_memories.map((memory) => <p key={memory.memory_id}>{memory.content_text}</p>)}
              </CompactDisclosure>
              <CompactDisclosure summary="策略与工具授权">
                <p>{steps.step5_strategy_proposal.chosen_strategy} · {steps.step6_tool_auth.auth_decision}</p>
              </CompactDisclosure>
              <CompactDisclosure summary="表达与送达">
                <p>{steps.step7_emitted_intent.intent_id} · {steps.step8_delivery_receipt?.status ?? "暂无送达回执"}</p>
              </CompactDisclosure>
            </WorkspaceItem>
          ) : null}
        </WorkspaceSection>
        <WorkspaceSection>
          <h2>四轨实时运行日志</h2>
          <div className="ai0-workspace-telemetry">
            <MultiTrackTelemetryTerminal rows={rows} activeTracks={tracks} onTracksChange={setTracks} />
          </div>
        </WorkspaceSection>
      </WorkspaceGrid>
    </WorkspacePage>
  );
}

function RoutedTerminal({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const location = useLocation();
  const traceId = new URLSearchParams(location.search).get("trace");
  return <Terminal key={`${snapshot?.targetInstance ?? ""}:${traceId ?? ""}`} snapshot={snapshot} linkedTrace={traceId} />;
}

export function RuntimeTerminalWorkspace({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  return useInRouterContext() ? <RoutedTerminal snapshot={snapshot} /> : <Terminal snapshot={snapshot} />;
}
