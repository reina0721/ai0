import { KnowledgeLibraryPage } from "./knowledge-library-page.js";
import {
  WorkspaceDiff, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow,
  WorkspaceSection, WorkspaceStatus
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  RippleButton,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { MemoryRecordWorkspace, RelationshipWorkspace } from "./memory-record-workspace.js";
import { WorkspaceHeader } from "./workspace.js";

export interface Domain4MemoryPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain4MemoryPage(props: Domain4MemoryPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");
  const [pending, setPending] = useState(false);
  // Sleep Consolidation & Evolution Approval
  if (route?.id === "capabilities.sleep") {
    const evo = studio?.evolution;

    const handleSleepRun = async () => {
      if (!ctx || !canWrite || pending) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/sleep-run", {});
        await ctx.refreshSnapshot();
        ctx.showToast("睡眠巩固周期已执行完毕");
      } catch (err) {
        ctx.showToast(`执行失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    const handleProposal = async (proposalId: string, decision: "approved" | "rejected") => {
      if (!ctx || !canWrite || pending) return;
      setPending(true);
      try {
        await ctx.postStudio("/api/studio/growth-proposal", { proposalId, decision });
        await ctx.refreshSnapshot();
        ctx.showToast(decision === "approved" ? "演化提案已批准并合入存档" : "已驳回演化提案");
      } catch (err) {
        ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPending(false);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="capabilities" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-sleep-evolution-page="true">
          <WorkspaceHeader title="睡眠整理与演化">

            <RippleButton
              variant="primary"
              data-trigger-sleep-run="true"
              disabled={!canWrite || pending}
              onClick={() => void handleSleepRun()}
            >
              {renderConsoleIcon("play", 14)}
              <span>执行睡眠巩固</span>
            </RippleButton>

          </WorkspaceHeader>

          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>待审批演化提案 (Diff)</h2>
              {(evo?.growthProposals ?? []).map((prop) => (
                <WorkspaceItem key={prop.id} as="article" data-proposal-card={prop.id}>
                  <WorkspaceRow>
                    <strong>{prop.title}</strong>
                    <WorkspaceStatus data-tone={prop.status === "approved" ? "good" : prop.status === "rejected" ? "danger" : "accent"}>
                      {prop.status === "approved" ? "已合入" : prop.status === "rejected" ? "已驳回" : "待审批"}
                    </WorkspaceStatus>
                  </WorkspaceRow>
                  <small>目标文件：<code>{prop.targetFile}</code> · {prop.sourceEventSummary} · {prop.createdAt}</small>
                  <WorkspaceGrid columns={2}>
                    <WorkspaceDiff side="before">
                      <strong>变更前</strong>
                      <div>{prop.beforeText}</div>
                    </WorkspaceDiff>
                    <WorkspaceDiff side="after">
                      <strong>变更后</strong>
                      <div>{prop.afterText}</div>
                    </WorkspaceDiff>
                  </WorkspaceGrid>
                  {prop.status === "pending" ? (
                    <div className="ai0-workspace-actions">
                      <RippleButton
                        variant="primary"
                        size="sm"
                        data-quick-approve={prop.id}
                        data-quick-kind="growth"
                        disabled={!canWrite || pending}
                        onClick={() => void handleProposal(prop.id, "approved")}
                      >
                        {renderConsoleIcon("check", 13)}
                        <span>批准合入 {prop.targetFile}</span>
                      </RippleButton>
                      <RippleButton
                        variant="secondary"
                        size="sm"
                        data-quick-reject={prop.id}
                        data-quick-kind="growth"
                        disabled={!canWrite || pending}
                        onClick={() => void handleProposal(prop.id, "rejected")}
                      >
                        驳回
                      </RippleButton>
                    </div>
                  ) : null}
                </WorkspaceItem>
              ))}
            </WorkspaceSection>

            <div className="ai0-workspace-stack">
              <WorkspaceSection>
                <h2>睡眠反思与阅读笔记</h2>
                <div id="dream-journal-list" className="ai0-workspace-stack">
                  {(evo?.dreamJournal ?? []).map((item) => (
                    <WorkspaceItem
                      key={item.id}
                      as="article"
                    >
                      <div className="ai0-workspace-row">
                        <strong>{item.title}</strong>
                        <small>{item.date}</small>
                      </div>
                      <p className="ai0-workspace-muted">{item.content}</p>
                    </WorkspaceItem>
                  ))}
                </div>
              </WorkspaceSection>

              <WorkspaceSection>
                <h2>写入防火墙与只读订阅源</h2>
                <div className="ai0-workspace-stack">
                  <JellySwitch
                    checked={evo?.sleepFirewall.level0Only ?? true}
                    label="Level-0 溯源约束（仅从原始事件提炼，禁止递归摘要）"
                  />
                  <JellySwitch
                    checked={evo?.sleepFirewall.blockPlayfulBanter ?? true}
                    label="语用过滤（拦截调侃与玩笑语境进入事实记忆库）"
                  />
                </div>
                <div className="ai0-workspace-stack">
                  <strong>授权只读信息源</strong>
                  {(evo?.curiositySources ?? []).map((src) => (
                    <WorkspaceRow key={src.id} className="ai0-workspace-divided">
                      <span>{src.name}</span>
                      <WorkspaceStatus data-tone="good">{src.type}</WorkspaceStatus>
                    </WorkspaceRow>
                  ))}
                </div>
              </WorkspaceSection>
            </div>
          </WorkspaceGrid>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  if (route?.id === "capabilities.knowledge") {
    return (
      <MainRoundedCardOutlet domainId="capabilities" activePath={props.pathname} onNavigate={props.onNavigate}>
        <KnowledgeLibraryPage key={ctx?.targetInstance} />
      </MainRoundedCardOutlet>
    );
  }

  return (
    <MainRoundedCardOutlet domainId="capabilities" activePath={props.pathname} onNavigate={props.onNavigate}>
      {route?.id === "capabilities.relationship" ? <RelationshipWorkspace key={ctx?.targetInstance} snapshot={snap} /> : (
        <MemoryRecordWorkspace key={`${ctx?.targetInstance}:${route?.id}`} eventsOnly={route?.id === "capabilities.events"} />
      )}
    </MainRoundedCardOutlet>
  );
}
