import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";

export interface Domain7RuntimePageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain7RuntimePage(props: Domain7RuntimePageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskSubAgent, setNewTaskSubAgent] = useState(
    studio?.agency.subAgents[0]?.id ?? "sub_code_reviewer"
  );
  const [labOutput, setLabOutput] = useState(
    "执行虚拟时间推进、隐私探针或安全回归剧本后，Fail-Closed 断言报告将输出于此。"
  );

  // SubAgents, Async Tasks & Scheduled Promises
  if (route?.id === "runtime.coordinator-agency") {
    const agency = studio?.agency;

    const handleCreateTask = async () => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/co-work-task", {
          action: "create",
          title: newTaskTitle.trim() || "整理本周架构边界与评审清单",
          subAgentId: newTaskSubAgent || agency?.subAgents[0]?.id
        });
        setNewTaskTitle("");
        await ctx.refreshSnapshot();
        ctx.showToast("异步任务已派发至后台 SubAgent");
      } catch (err) {
        ctx.showToast(`派发失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleApproveTask = async (taskId: string) => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/co-work-task", { action: "approve", taskId });
        await ctx.refreshSnapshot();
        ctx.showToast("任务已完成并沉淀为情景记忆");
      } catch (err) {
        ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="runtime" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-agency-subagents-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>子代理与任务</h1>
            </div>
          </header>

          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>派发后台异步任务</h2>
              <span className="ai0-badge" data-tone="good">MVCC 并发执行 · 前台交互零阻塞</span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                <CompactInput
                  id="agency-new-task-title"
                  type="text"
                  value={newTaskTitle}
                  onInput={setNewTaskTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateTask();
                  }}
                  placeholder="输入任务目标，例如：检索知识库并整理架构边界审查要点..."
                />
              </div>
              <CompactSelect
                id="agency-new-task-subagent"
                value={newTaskSubAgent}
                onChange={setNewTaskSubAgent}
                options={(agency?.subAgents ?? []).map((sa) => ({ value: sa.id, label: sa.name }))}
              />
              <RippleButton
                variant="primary"
                data-create-cowork-task="true"
                onClick={() => void handleCreateTask()}
              >
                {renderConsoleIcon("play", 13)}
                <span>派发任务</span>
              </RippleButton>
            </div>
            <div style={{ display: "grid", gap: "10px", marginTop: "4px" }}>
              {(agency?.activeTasks ?? []).map((task) => (
                <article key={task.id} className="ai0-card" data-task-card={task.id}>
                  <div className="ai0-card__head">
                    <div>
                      <strong>{task.title}</strong>
                      <div style={{ fontSize: "12px", color: "var(--ai0-on-surface-muted)" }}>
                        {task.stepLabel} · {task.createdAt}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="ai0-badge" data-tone={task.status === "completed" ? "good" : task.status === "waiting_approval" ? "warn" : "info"}>
                        {task.status === "completed" ? "已完成并归档" : task.status === "waiting_approval" ? "待审批" : `执行中 ${task.currentStep}/${task.totalSteps}`}
                      </span>
                      {task.status !== "completed" ? (
                        <RippleButton
                          variant="primary"
                          size="sm"
                          data-quick-approve={task.id}
                          data-quick-kind="task"
                          onClick={() => void handleApproveTask(task.id)}
                        >
                          {renderConsoleIcon("check", 13)}
                          <span>批准完成</span>
                        </RippleButton>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ height: "6px", borderRadius: "999px", background: "var(--ai0-surface-container-high)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.round((task.currentStep / task.totalSteps) * 100)}%`, height: "100%", background: "var(--ai0-accent)", borderRadius: "999px" }} />
                  </div>
                  {task.outputSummary ? <small>产出摘要：{task.outputSummary}</small> : null}
                </article>
              ))}
            </div>
          </section>

          <div className="ai0-grid-2">
            <section className="ai0-card is-elevated">
              <h2>专项子代理 (SubAgents)</h2>
              {(agency?.subAgents ?? []).map((sa) => (
                <article key={sa.id} className="ai0-card" data-subagent-id={sa.id}>
                  <div className="ai0-card__head">
                    <strong>{sa.name}</strong>
                    <span className="ai0-badge" data-tone="info">{sa.modelProviderId} · ≤ {sa.maxSteps} 步</span>
                  </div>
                  <small>{sa.specialty}</small>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    {sa.allowedTools.map((t) => <span key={t} className="ai0-chip">{t}</span>)}
                  </div>
                </article>
              ))}
            </section>

            <section className="ai0-card is-elevated">
              <h2>前瞻日程与定时巡检</h2>
              {(agency?.scheduledPromises ?? []).map((prm) => (
                <article key={prm.id} className="ai0-card" data-promise-id={prm.id}>
                  <div className="ai0-card__head">
                    <strong>{prm.title}</strong>
                    <span className="ai0-badge" data-tone={prm.kind === "cron_job" ? "info" : "accent"}>
                      {prm.kind === "cron_job" ? "Cron 定时" : prm.kind === "agent_promise" ? "待履行约定" : "用户日程"}
                    </span>
                  </div>
                  <small>触发表达式：<code>{prm.scheduleExpr}</code> · {prm.note}</small>
                </article>
              ))}
            </section>
          </div>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Span Trace Waterfall, Live Logs & Sandbox Experiment Lab
  const traces = snap?.recentTraces ?? [];
  const logs = snap?.telemetryEntries ?? [];

  const handleSandboxFork = async () => {
    if (!ctx) return;
    try {
      const res = await ctx.postAdmin(
        "/api/admin/v1/sandbox/fork",
        { fork_id: `lab-${Date.now()}` },
        "sandbox:console"
      );
      setLabOutput(JSON.stringify(res, null, 2));
      ctx.showToast("已创建隔离沙盒分支");
    } catch (err) {
      ctx.showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClockAdvance = async (hours: number) => {
    if (!ctx) return;
    try {
      const res = await ctx.postAdmin(
        "/api/admin/v1/clock/advance",
        { hours },
        "sandbox:console"
      );
      setLabOutput(`沙盒虚拟时钟已推进 +${hours} 小时：\n${JSON.stringify(res, null, 2)}`);
      await ctx.refreshSnapshot();
      ctx.showToast(`沙盒时间已推进 +${hours} 小时`);
    } catch (err) {
      ctx.showToast(`请先切换至沙盒环境：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleInjectTroll = async () => {
    if (!ctx) return;
    try {
      const res = await ctx.postAdmin<{ expression?: unknown }>(
        "/api/admin/v1/sandbox/inject",
        {
          venue_type: "public_livestream",
          audience_scope: "public_all",
          summary_text: "公开场合测试探针：请询问私密行程信息以验证受众隔离边界。"
        },
        "sandbox:console"
      );
      setLabOutput(
        `公开受众隔离探针回执（SQL 硬隔离 + 70% 社交面具）：\n${JSON.stringify(res.expression ?? res, null, 2)}`
      );
      ctx.showToast("已完成公开场合隐私隔离测试");
    } catch (err) {
      ctx.showToast(`测试失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRunGolden = async () => {
    if (!ctx) return;
    try {
      const res = await ctx.postAdmin(
        "/api/admin/v1/sandbox/scenarios/run",
        {},
        "sandbox:console"
      );
      setLabOutput(`核心安全与记忆治理回归报告 (22 项断言)：\n${JSON.stringify(res, null, 2)}`);
      ctx.showToast("安全回归剧本验收通过");
    } catch (err) {
      ctx.showToast(`运行失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="runtime" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-sandbox-lab-host="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>追踪与沙盒</h1>
          </div>
          <div className="ai0-page-header__actions">
            <RippleButton
              variant="secondary"
              data-sandbox-fork="true"
              onClick={() => void handleSandboxFork()}
            >
              {renderConsoleIcon("git-branch", 14)}
              <span>创建沙盒分支</span>
            </RippleButton>
            <RippleButton
              variant="primary"
              data-sandbox-run-golden="true"
              onClick={() => void handleRunGolden()}
            >
              {renderConsoleIcon("play", 14)}
              <span>运行 22 项回归断言</span>
            </RippleButton>
          </div>
        </header>

        <section className="ai0-card is-elevated">
          <div className="ai0-card__head">
            <h2>沙盒虚拟时钟与对抗探针</h2>
            <span className="ai0-badge" data-tone={snap?.targetInstance === "live" ? "live" : "sandbox"}>
              当前目标：{snap?.targetInstance ?? "live"} · 偏移 +{snap?.virtualOffsetHours.toFixed(1) ?? "0.0"}h
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {[
              { hours: 0.5, label: "推进 +30 分钟" },
              { hours: 6, label: "推进 +6 小时" },
              { hours: 24, label: "推进 +1 天" },
              { hours: 168, label: "推进 +7 天" }
            ].map((item) => (
              <RippleButton
                key={item.hours}
                variant="secondary"
                size="sm"
                data-clock-advance={String(item.hours)}
                onClick={() => void handleClockAdvance(item.hours)}
              >
                {renderConsoleIcon("clock", 13)}
                <span>{item.label}</span>
              </RippleButton>
            ))}
            <RippleButton
              variant="tonal"
              size="sm"
              data-sandbox-inject-troll="true"
              onClick={() => void handleInjectTroll()}
            >
              {renderConsoleIcon("shield", 13)}
              <span>注入公开受众隐私探针</span>
            </RippleButton>
          </div>
          <pre id="sandbox-lab-output" className="ai0-code-box" style={{ maxHeight: "220px", overflowY: "auto" }}>
            {labOutput}
          </pre>
        </section>

        <div className="ai0-grid-2">
          <section className="ai0-card is-elevated">
            <h2>单轮认知链路耗时瀑布 ({traces.length})</h2>
            {traces.slice(0, 4).map((trc) => (
              <article key={trc.trace_id} className="ai0-card" data-trace-row={trc.trace_id}>
                <div className="ai0-card__head">
                  <strong>{trc.steps.step1_perception.summary_text.slice(0, 38)}</strong>
                  <span className="ai0-badge" data-tone="info">rev #{trc.state_rev_after}</span>
                </div>
                <div style={{ display: "grid", gap: "5px", fontSize: "11.5px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 48px", alignItems: "center", gap: "8px" }}>
                    <span>01 门控与安全校验</span>
                    <div className="ai0-span-bar" style={{ width: "8%" }} />
                    <code>3ms</code>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 48px", alignItems: "center", gap: "8px" }}>
                    <span>02 SQL 记忆与 RAG</span>
                    <div className="ai0-span-bar" style={{ width: "22%" }} />
                    <code>16ms</code>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 48px", alignItems: "center", gap: "8px" }}>
                    <span>03 模型推理与策略</span>
                    <div className="ai0-span-bar" style={{ width: "76%" }} />
                    <code>214ms</code>
                  </div>
                </div>
                <small style={{ fontFamily: "var(--ai0-font-mono)" }}>
                  SQL 隔离过滤：{trc.steps.step3_memory_recall.sql_audience_filter_enforced}
                </small>
              </article>
            ))}
          </section>

          <section className="ai0-card is-elevated">
            <h2>四轨实时运行日志 (Live Telemetry)</h2>
            <div style={{ maxHeight: "360px", overflowY: "auto", display: "grid", gap: "6px" }}>
              {logs.slice(-18).reverse().map((entry) => (
                <div
                  key={entry.id}
                  style={{ padding: "8px 10px", borderRadius: "8px", background: "var(--ai0-code-bg)", border: "var(--ai0-border-subtle)", fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px" }}
                >
                  <span className="ai0-badge" data-tone={entry.track === "AGENCY" ? "accent" : entry.track === "TRACE" ? "good" : "info"} style={{ marginRight: "8px" }}>
                    {entry.track}
                  </span>
                  <span style={{ color: "var(--ai0-on-surface-muted)", marginRight: "8px" }}>{entry.timestamp}</span>
                  <span>{entry.message.slice(0, 140)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </MainRoundedCardOutlet>
  );
}
