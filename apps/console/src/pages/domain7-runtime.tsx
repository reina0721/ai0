import {
  WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection, WorkspaceStatus,
  WorkspaceTag
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";
import LinearProgress from "@mui/material/LinearProgress";

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
import { RuntimeTerminalWorkspace, SandboxLabWorkspace } from "./runtime-observation-workspace.js";
import { WorkspaceHeader } from "./workspace.js";

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
  const [subAgent, setNewTaskSubAgent] = useState("");
  const newTaskSubAgent = subAgent || studio?.agency.subAgents.find((agent) => agent.enabled)?.id || "";
  const [pending, setPending] = useState(false);
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  // SubAgents, Async Tasks & Scheduled Promises
  if (route?.id === "runtime.coordinator-agency") {
    const agency = studio?.agency;

    const handleCreateTask = async () => {
      if (!ctx || !canWrite || pending || !newTaskTitle.trim() || !newTaskSubAgent) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/co-work-task", {
          action: "create",
          title: newTaskTitle.trim(),
          subAgentId: newTaskSubAgent || agency?.subAgents[0]?.id
        });
        setNewTaskTitle("");
        await ctx.refreshSnapshot();
        ctx.showToast("异步任务已派发至后台 SubAgent");
      } catch (err) {
        ctx.showToast(`派发失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    const handleTaskAction = async (taskId: string, action: "approve" | "pause") => {
      if (!ctx || !canWrite || pending) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/co-work-task", { action, taskId });
        await ctx.refreshSnapshot();
        ctx.showToast(action === "approve" ? "已批准并归档任务" : "任务已暂停");
      } catch (err) {
        ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="runtime" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-agency-subagents-page="true">
          <WorkspaceHeader title="子代理与任务">

          </WorkspaceHeader>

          <WorkspaceSection>
            <WorkspaceRow>
              <h2>派发后台异步任务</h2>
              <WorkspaceStatus data-tone="good">正式实例任务</WorkspaceStatus>
            </WorkspaceRow>
            <div className="ai0-workspace-actions">
              <div className="ai0-workspace-flex-field">
                <CompactInput
                  id="agency-new-task-title"
                  type="text"
                  ariaLabel="任务目标"
                  value={newTaskTitle}
                  onInput={setNewTaskTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleCreateTask();
                  }}
                  placeholder="输入任务目标，例如：检索知识库并整理架构边界审查要点..."
                />
              </div>
              <CompactSelect
                id="agency-new-task-subagent"
                ariaLabel="专项子代理"
                value={newTaskSubAgent}
                onChange={setNewTaskSubAgent}
                options={(agency?.subAgents ?? []).filter((agent) => agent.enabled).map((sa) => ({ value: sa.id, label: sa.name }))}
              />
              <RippleButton
                variant="primary"
                data-create-cowork-task="true"
                disabled={!canWrite || pending || !newTaskTitle.trim() || !newTaskSubAgent}
                onClick={() => void handleCreateTask()}
              >
                {renderConsoleIcon("play", 13)}
                <span>派发任务</span>
              </RippleButton>
            </div>
            <div className="ai0-workspace-stack">
              {!agency?.activeTasks.length ? <small>暂无已登记任务。</small> : null}
              {(agency?.activeTasks ?? []).map((task) => (
                <WorkspaceItem key={task.id} as="article" data-task-card={task.id}>
                  <WorkspaceRow>
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        {task.stepLabel} · {task.createdAt}
                      </small>
                    </div>
                    <div className="ai0-workspace-actions">
                      <WorkspaceStatus data-tone={task.status === "completed" ? "good" : task.status === "waiting_approval" ? "warn" : "info"}>
                        {task.status === "completed" ? "已完成并归档" : task.status === "waiting_approval" ? "待审批" : task.status === "paused" ? "已暂停" : `执行中 ${task.currentStep}/${task.totalSteps}`}
                      </WorkspaceStatus>
                      {task.status === "running" || task.status === "waiting_approval" ? (
                        <RippleButton
                          variant="primary"
                          size="sm"
                          data-quick-approve={task.id}
                          data-quick-kind="task"
                          disabled={!canWrite || pending}
                          onClick={() => void handleTaskAction(task.id, task.status === "running" ? "pause" : "approve")}
                        >
                          {renderConsoleIcon("check", 13)}
                          <span>{task.status === "running" ? "暂停" : "批准完成"}</span>
                        </RippleButton>
                      ) : null}
                    </div>
                  </WorkspaceRow>
                  <LinearProgress className="ai0-workspace-meter ai0-workspace-task-meter" variant="determinate"
                    value={Math.max(0, Math.min(100, (task.currentStep / Math.max(1, task.totalSteps)) * 100))}
                    aria-label={`${task.title} 进度`} />
                  {task.outputSummary ? <small>产出摘要：{task.outputSummary}</small> : null}
                </WorkspaceItem>
              ))}
            </div>
          </WorkspaceSection>

          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>专项子代理 (SubAgents)</h2>
              {(agency?.subAgents ?? []).map((sa) => (
                <WorkspaceItem key={sa.id} as="article" data-subagent-id={sa.id}>
                  <WorkspaceRow>
                    <strong>{sa.name}</strong>
                    <WorkspaceStatus data-tone="info">{sa.modelProviderId} · ≤ {sa.maxSteps} 步</WorkspaceStatus>
                  </WorkspaceRow>
                  <small>{sa.specialty}</small>
                  <div className="ai0-workspace-actions">
                    {sa.allowedTools.map((t) => <WorkspaceTag key={t}>{t}</WorkspaceTag>)}
                  </div>
                </WorkspaceItem>
              ))}
            </WorkspaceSection>

            <WorkspaceSection>
              <h2>前瞻日程与定时巡检</h2>
              {(agency?.scheduledPromises ?? []).map((prm) => (
                <WorkspaceItem key={prm.id} as="article" data-promise-id={prm.id}>
                  <WorkspaceRow>
                    <strong>{prm.title}</strong>
                    <WorkspaceStatus data-tone={prm.kind === "cron_job" ? "info" : "accent"}>
                      {prm.kind === "cron_job" ? "Cron 定时" : prm.kind === "agent_promise" ? "待履行约定" : "用户日程"}
                    </WorkspaceStatus>
                  </WorkspaceRow>
                  <small>触发表达式：<code>{prm.scheduleExpr}</code> · {prm.note}</small>
                </WorkspaceItem>
              ))}
            </WorkspaceSection>
          </WorkspaceGrid>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  return (
    <MainRoundedCardOutlet domainId="runtime" activePath={props.pathname} onNavigate={props.onNavigate}>
      {route?.id === "runtime.terminal" ? <RuntimeTerminalWorkspace snapshot={snap} />
        : <SandboxLabWorkspace key={ctx?.targetInstance} snapshot={snap} />}
    </MainRoundedCardOutlet>
  );
}
