import { useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../../live-snapshot.js";
import { registeredPages } from "../../router/plugin-pages.js";
import {
  WorkspaceField,
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus,
  WorkspaceTable,
  WorkspaceTableBody,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableRow,
  WorkspaceTag
} from "../workspace-layout.js";
import { useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceSaveButton } from "../workspace.js";

type Ecosystem = ConsoleStudioState["ecosystem"];

export function CommandsAutomationTab(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const ecosystem = snap?.studioConfig?.ecosystem;

  const commands = useWorkspaceDraft<Ecosystem["commands"]>(ecosystem?.commands ?? []);
  const flows = useWorkspaceDraft<Ecosystem["ecaFlows"]>(ecosystem?.ecaFlows ?? []);
  const [cmdSearch, setCmdSearch] = useState("");
  const [organPending, setOrganPending] = useState<string>();

  const form = useWorkspaceSave(
    "extensions.automation",
    commands.dirty || flows.dirty,
    () => {
      commands.discard();
      flows.discard();
    },
    async () => {
      if (flows.value.some((f) => !f.name.trim() || (f.enabled && (!f.whenExpr.trim() || !f.thenAction.trim())))) {
        throw new Error("已启用的联动规则必须填写名称、触发条件与动作。");
      }
      await ctx?.postStudio("config", {
        ecosystem: { commands: commands.value, ecaFlows: flows.value }
      });
    },
    "指令权限与自动化联动流已保存",
    () => {
      commands.accept();
      flows.accept();
    }
  );

  const organs = snap?.extensions.filter((ext) => ext.facets.includes("cognition.context_contributor")) ?? [];
  const sandbox = ctx?.mode === "sandbox";

  const toggleOrgan = async (id: string, enabled: boolean) => {
    if (!ctx || !sandbox || organPending) return;
    setOrganPending(id);
    try {
      await ctx.postAdmin("extensions", { extension_id: id, enabled }, "sandbox:console");
      await ctx.refreshSnapshot("sandbox");
      ctx.showToast(`沙盒认知器官已${enabled ? "恢复" : "消融停用"}`);
    } catch (err) {
      ctx.showToast(`操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOrganPending(undefined);
    }
  };

  const filteredCommands = commands.value.filter((cmd) => {
    const q = cmdSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      cmd.command.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.aliases.some((a) => a.toLowerCase().includes(q))
    );
  });

  const updateFlow = (id: string, patch: Partial<Ecosystem["ecaFlows"][number]>) =>
    flows.setValue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <WorkspacePage data-automation-page="true">
      <WorkspaceHeader title="指令与自动化">
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>

      {/* 1. Slash Commands Permission Matrix */}
      <WorkspaceSection>
        <WorkspaceRow>
          <div>
            <h2>斜杠指令权限矩阵</h2>
            <small>管理对话通道内可用斜杠命令的启停状态与调用权限等级。</small>
          </div>
          <div style={{ minWidth: 220 }}>
            <CompactInput
              type="search"
              ariaLabel="搜索斜杠指令"
              value={cmdSearch}
              placeholder="过滤指令名或说明…"
              onInput={setCmdSearch}
            />
          </div>
        </WorkspaceRow>

        <WorkspaceTable>
          <WorkspaceTableHead>
            <WorkspaceTableRow>
              <WorkspaceTableCell component="th" scope="col">启用</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">指令与别名</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">权限级别</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">功能说明</WorkspaceTableCell>
            </WorkspaceTableRow>
          </WorkspaceTableHead>
          <WorkspaceTableBody>
            {filteredCommands.map((cmd) => (
              <WorkspaceTableRow key={cmd.id}>
                <WorkspaceTableCell>
                  <JellySwitch
                    checked={cmd.enabled}
                    disabled={!form.canWrite}
                    ariaLabel={`启用指令 ${cmd.command}`}
                    onChange={(enabled) =>
                      commands.setValue((list) =>
                        list.map((item) => (item.id === cmd.id ? { ...item, enabled } : item))
                      )
                    }
                  />
                </WorkspaceTableCell>
                <WorkspaceTableCell>
                  <code>{cmd.command}</code>{" "}
                  {cmd.aliases.map((a) => (
                    <WorkspaceTag key={a}>{a}</WorkspaceTag>
                  ))}
                </WorkspaceTableCell>
                <WorkspaceTableCell>
                  <div style={{ minWidth: 120 }}>
                    <CompactSelect
                      ariaLabel={`${cmd.command} 权限`}
                      value={cmd.permission}
                      disabled={!form.canWrite}
                      onChange={(permission) =>
                        commands.setValue((list) =>
                          list.map((item) =>
                            item.id === cmd.id
                              ? { ...item, permission: permission as "owner" | "admin" | "all" }
                              : item
                          )
                        )
                      }
                      options={[
                        { value: "owner", label: "仅主账户 (owner)" },
                        { value: "admin", label: "管理员 (admin)" },
                        { value: "all", label: "所有成员 (all)" }
                      ]}
                    />
                  </div>
                </WorkspaceTableCell>
                <WorkspaceTableCell>{cmd.description}</WorkspaceTableCell>
              </WorkspaceTableRow>
            ))}
          </WorkspaceTableBody>
        </WorkspaceTable>
        {!filteredCommands.length ? <small>暂无匹配指令。</small> : null}
      </WorkspaceSection>

      {/* 2. Cognitive Organs & Sandbox Ablation */}
      <WorkspaceSection>
        <WorkspaceRow>
          <div>
            <h2>认知器官注册与沙盒消融</h2>
            <small>遵循 LIVE 主权护栏：正式实例禁止单侧消融核心认知器官，请切换至 SANDBOX 进行对照实验。</small>
          </div>
          {!sandbox ? (
            <RippleButton size="sm" variant="secondary" onClick={() => ctx?.setMode("sandbox")}>
              {renderConsoleIcon("sandbox", 13)}
              <span>切至沙盒执行消融</span>
            </RippleButton>
          ) : (
            <WorkspaceStatus data-tone="sandbox">SANDBOX 消融已解锁</WorkspaceStatus>
          )}
        </WorkspaceRow>

        {organs.length ? (
          <div className="ai0-card-grid">
            {organs.map((organ) => (
              <article key={organ.id} className="ai0-entity-card">
                <div className="ai0-entity-card__header">
                  <div className="ai0-entity-card__title">
                    <strong>{organ.displayName ?? organ.id}</strong>
                    <small><code>{organ.id}</code> · {organ.carrier} · rev {organ.rev}</small>
                  </div>
                  <JellySwitch
                    ariaLabel={`沙盒启停器官 ${organ.id}`}
                    checked={organ.enabled}
                    disabled={!sandbox || Boolean(organPending)}
                    onChange={(val) => void toggleOrgan(organ.id, val)}
                  />
                </div>
                <div className="ai0-entity-card__body">
                  <small>读取域：{organ.readDomains.join("、") || "—"}</small>
                  <small>提议域：{organ.proposeDomains.join("、") || "—"}</small>
                </div>
                <div className="ai0-entity-card__footer">
                  <div className="ai0-entity-card__actions">
                    {registeredPages(snap)
                      .filter((p) => p.pluginId === organ.id)
                      .map((page) => (
                        <RippleButton
                          key={page.path}
                          size="sm"
                          variant="secondary"
                          onClick={() => ctx?.navigateConsole(page.path)}
                        >
                          查看 {page.title}
                        </RippleButton>
                      ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <small>当前实例未注册自定义认知器官。</small>
        )}
      </WorkspaceSection>

      {/* 3. ECA Automation Flows */}
      <WorkspaceSection>
        <WorkspaceRow>
          <div>
            <h2>声明式联动流 (When → If → Then)</h2>
            <small>编排跨插件、跨感知事件的低噪声条件触发规则。</small>
          </div>
          <RippleButton
            size="sm"
            variant="secondary"
            disabled={!form.canWrite}
            onClick={() =>
              flows.setValue((items) => [
                ...items,
                {
                  id: `eca_${crypto.randomUUID().slice(0, 8)}`,
                  name: "新建联动规则",
                  whenExpr: "",
                  ifExpr: "",
                  thenAction: "",
                  enabled: false
                }
              ])
            }
          >
            {renderConsoleIcon("plus", 13)}
            <span>新建规则</span>
          </RippleButton>
        </WorkspaceRow>

        {flows.value.length ? (
          <div className="ai0-card-grid">
            {flows.value.map((flow) => (
              <article key={flow.id} className="ai0-entity-card" data-flow-id={flow.id}>
                <div className="ai0-entity-card__header">
                  <strong>{flow.name}</strong>
                  <JellySwitch
                    checked={flow.enabled}
                    disabled={!form.canWrite}
                    ariaLabel={`启用联动规则 ${flow.name}`}
                    onChange={(enabled) => updateFlow(flow.id, { enabled })}
                  />
                </div>
                <div className="ai0-entity-card__body">
                  <WorkspaceField>
                    <label>规则名称</label>
                    <CompactInput value={flow.name} disabled={!form.canWrite} onInput={(name) => updateFlow(flow.id, { name })} />
                  </WorkspaceField>
                  <WorkspaceField>
                    <label>WHEN · 触发事件</label>
                    <CompactInput value={flow.whenExpr} disabled={!form.canWrite} onInput={(whenExpr) => updateFlow(flow.id, { whenExpr })} />
                  </WorkspaceField>
                  <WorkspaceField>
                    <label>IF · 门控条件</label>
                    <CompactInput value={flow.ifExpr} disabled={!form.canWrite} onInput={(ifExpr) => updateFlow(flow.id, { ifExpr })} />
                  </WorkspaceField>
                  <WorkspaceField>
                    <label>THEN · 执行动作</label>
                    <CompactInput value={flow.thenAction} disabled={!form.canWrite} onInput={(thenAction) => updateFlow(flow.id, { thenAction })} />
                  </WorkspaceField>
                </div>
                <div className="ai0-entity-card__footer">
                  <small>ID: <code>{flow.id}</code></small>
                  <RippleButton
                    size="sm"
                    variant="ghost"
                    disabled={!form.canWrite}
                    onClick={() => flows.setValue((items) => items.filter((item) => item.id !== flow.id))}
                  >
                    {renderConsoleIcon("trash", 13)}
                    <span>移除</span>
                  </RippleButton>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <small>暂无已保存的联动流规则。</small>
        )}
      </WorkspaceSection>
    </WorkspacePage>
  );
}
