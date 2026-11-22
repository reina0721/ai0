import {
  WorkspaceCode, WorkspaceDiff, WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage,
  WorkspaceRow, WorkspaceSection, WorkspaceStatus, WorkspaceTable, WorkspaceTableBody,
  WorkspaceTableCell, WorkspaceTableHead, WorkspaceTableRow
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import {
  useAdminResource, useWorkspaceDraft, useWorkspaceSave,
  WorkspaceConfirm, WorkspaceHeader, WorkspaceReadState, WorkspaceSaveButton
} from "./workspace.js";

type RollbackMode = "meta_reconciled" | "dream_bridge" | "silent_hard";

export interface Domain8SystemPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain8SystemPage(props: Domain8SystemPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;
  const sys = studio?.systemSettings;
  const souls = snap?.availableSouls ?? [];

  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");
  const settings = useWorkspaceDraft({
    auth2faEnabled: sys?.auth2faEnabled ?? false, codeSandboxEnabled: sys?.codeSandboxEnabled ?? true, proxyUrl: sys?.proxyUrl ?? ""
  });
  const compliance = useWorkspaceDraft({
    sb243BreakMinutes: sys?.sb243BreakMinutes ?? 180, crisisHotlineRegion: sys?.crisisHotlineRegion ?? ""
  });
  const settingsForm = useWorkspaceSave(route?.id === "system.settings-security" ? route.id : undefined,
    settings.dirty, settings.discard, async () => { await ctx?.postStudio("config", { systemSettings: settings.value }); },
    "系统安全与代理设置已保存", settings.accept);
  const complianceForm = useWorkspaceSave(route?.id === "system.safety-sb243" ? route.id : undefined,
    compliance.dirty, compliance.discard, async () => {
      if (compliance.value.sb243BreakMinutes < 30 || compliance.value.sb243BreakMinutes > 180) {
        throw new Error("提醒间隔应为 30 至 180 分钟。");
      }
      await ctx?.postStudio("config", { systemSettings: compliance.value });
    }, "合规存档配置已保存", compliance.accept);
  const [snapshotId, setSnapshotId] = useState("");
  const [rollbackMode, setRollbackMode] = useState<RollbackMode>("meta_reconciled");
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [operating, setOperating] = useState(false);
  const snapshots = useAdminResource<{ snapshot_ids: string[] }>(
    canWrite && route?.id === "system.instances-storage" ? "system/snapshots/rollback" : undefined
  );

  // Export & multi-instance state
  const [incBricks, setIncBricks] = useState(true);
  const [incLore, setIncLore] = useState(true);
  const [incSkills, setIncSkills] = useState(true);
  const [publishReport, setPublishReport] = useState<{
    filename: string;
    sha256: string;
    excludedKeys: string[];
  } | null>(null);
  const [newSoulName, setNewSoulName] = useState("");
  const [newSoulRole, setNewSoulRole] = useState("digital_employee");

  if (route?.id === "system.safety-sb243") {
    return (
      <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage>
          <WorkspaceHeader title="权限矩阵与合规护栏">

            <WorkspaceSaveButton form={complianceForm} />
          </WorkspaceHeader>
          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>三维工具与动作授权矩阵</h2>
              <><WorkspaceTable>
                <WorkspaceTableHead>
                  <WorkspaceTableRow><WorkspaceTableCell component="th" scope="col">操作风险等级</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">主账户 1v1</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">认证群组</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">公开场合</WorkspaceTableCell></WorkspaceTableRow>
                </WorkspaceTableHead>
                <WorkspaceTableBody>
                  <WorkspaceTableRow><WorkspaceTableCell>只读检索 (RAG / 查询)</WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="good">自动放行</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="good">仅公开集</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="good">仅公开集</WorkspaceStatus></WorkspaceTableCell></WorkspaceTableRow>
                  <WorkspaceTableRow><WorkspaceTableCell>文件写入 / 日历 / 外部请求</WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="warn">人工审批</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="danger">硬拒绝</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="danger">硬拒绝</WorkspaceStatus></WorkspaceTableCell></WorkspaceTableRow>
                  <WorkspaceTableRow><WorkspaceTableCell>隐私擦除 / 修改核心 DNA</WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="accent">仅主账户</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="danger">硬拒绝</WorkspaceStatus></WorkspaceTableCell><WorkspaceTableCell><WorkspaceStatus data-tone="danger">硬拒绝</WorkspaceStatus></WorkspaceTableCell></WorkspaceTableRow>
                </WorkspaceTableBody>
              </WorkspaceTable></>
            </WorkspaceSection>
            <WorkspaceSection>
              <h2>危机拦截与健康使用护栏 (SB 243)</h2>
              <WorkspaceField>
                <label>连续交互休息提醒间隔 (分钟，30–180)</label>
                <CompactInput id="sys-sb243-break" type="number" min={30} max={180} value={compliance.value.sb243BreakMinutes} unit="min"
                  disabled={!canWrite} onInput={(value) => compliance.setValue((prior) => ({ ...prior, sb243BreakMinutes: Number(value) }))} />
              </WorkspaceField>
              <WorkspaceField>
                <label>危机援助热线地区配置</label>
                <CompactInput id="sys-hotline" type="text" value={compliance.value.crisisHotlineRegion}
                  disabled={!canWrite} onInput={(crisisHotlineRegion) => compliance.setValue((prior) => ({ ...prior, crisisHotlineRegion }))} />
              </WorkspaceField>
              <WorkspaceItem className="ai0-workspace-inset">
                <strong>SQLite 存储引擎安全状态</strong>
                <small className="ai0-workspace-mono">
                  journal_mode={snap?.pragmaStatus.journal_mode ?? "—"} · foreign_keys={snap?.pragmaStatus.foreign_keys ?? "—"} · secure_delete={snap?.pragmaStatus.secure_delete ?? "—"}
                </small>
              </WorkspaceItem>
            </WorkspaceSection>
          </WorkspaceGrid>
          <WorkspaceSection>
            <h2>危机转介统计</h2>
            {snap?.sb243Metrics.map((metric) => (
              <WorkspaceRow key={metric.year_month}>
                <time>{metric.year_month}</time><strong>{metric.crisis_referral_triggered_count} 次</strong>
              </WorkspaceRow>
            ))}
            {!snap?.sb243Metrics.length ? <small>当前实例暂无转介统计。</small> : null}
          </WorkspaceSection>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  if (route?.id === "system.settings-security") {
    return (
      <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
        <WorkspacePage data-system-settings-page="true">
          <WorkspaceHeader title="安全与外观">

            <WorkspaceSaveButton form={settingsForm} name="保存设置" />

          </WorkspaceHeader>
          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>访问策略存档配置</h2>
              <small>在此记录 2FA、脚本隔离和代理偏好。实际运行能力由 daemon 提供。</small>
              <JellySwitch
                id="sys-auth-2fa"
                checked={settings.value.auth2faEnabled}
                disabled={!canWrite}
                onChange={(auth2faEnabled) => settings.setValue((prior) => ({ ...prior, auth2faEnabled }))}
                label="启用管理员双因素认证 (2FA)"
              />
              <JellySwitch
                id="sys-code-sandbox"
                checked={settings.value.codeSandboxEnabled}
                disabled={!canWrite}
                onChange={(codeSandboxEnabled) => settings.setValue((prior) => ({ ...prior, codeSandboxEnabled }))}
                label="启用 Agent 脚本隔离执行沙盒"
              />
              <WorkspaceField>
                <label>HTTP / SOCKS5 代理地址</label>
                <CompactInput
                  id="sys-proxy-url"
                  type="url"
                  placeholder="http://127.0.0.1:7890"
                  value={settings.value.proxyUrl}
                  disabled={!canWrite}
                  onInput={(proxyUrl) => settings.setValue((prior) => ({ ...prior, proxyUrl }))}
                />
              </WorkspaceField>
            </WorkspaceSection>
            <WorkspaceSection>
              <h2>控制台外观模式</h2>
              <div className="ai0-workspace-actions">
                <RippleButton
                  variant={ctx?.appearance === "light" ? "primary" : "secondary"}
                  data-set-appearance="light"
                  onClick={() => void ctx?.setAppearance("light")}
                >
                  {renderConsoleIcon("sun", 14)}
                  <span>浅色模式（默认）</span>
                </RippleButton>
                <RippleButton
                  variant={ctx?.appearance === "dark" ? "primary" : "secondary"}
                  data-set-appearance="dark"
                  onClick={() => void ctx?.setAppearance("dark")}
                >
                  {renderConsoleIcon("moon", 14)}
                  <span>深色模式</span>
                </RippleButton>
              </div>
              <CompactSelect ariaLabel="主题色" value={ctx?.soulTheme ?? "sakura-pink"} options={[
                { value: "sakura-pink", label: "樱花粉" }, { value: "astral-blue", label: "星蓝" }, { value: "cyber-emerald", label: "翡翠绿" }
              ]} onChange={(theme) => void ctx?.setSoulTheme(theme)} />
              <small>正式实例中的外观与主题色偏好保存至存档。</small>
            </WorkspaceSection>
          </WorkspaceGrid>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  // Export Packages & Multi-Instance Storage
  const handleExportPack = async (packageType: "soul-template" | "ai0pack") => {
    if (!ctx || !canWrite || operating) return;
    setOperating(true);
    try {
      const res = await ctx.postStudio<{
        filename: string;
        sha256: string;
        excluded_keys: string[];
        scrubbed_payload: Record<string, unknown>;
      }>("/api/studio/publish-pack", {
        packageType,
        includePromptBricks: incBricks,
        includeLorebooks: incLore,
        includeSkillsAndFlows: incSkills
      });
      setPublishReport({
        filename: res.filename,
        sha256: res.sha256,
        excludedKeys: res.excluded_keys
      });
      const blob = new Blob([JSON.stringify(res.scrubbed_payload, null, 2)], {
        type: "application/json;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.showToast(`已导出脱敏资产包：${res.filename}`);
    } catch (err) {
      ctx.showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOperating(false);
    }
  };

  const handleCreateSoul = async () => {
    if (!ctx || !canWrite || operating) return;
    const trimmed = newSoulName.trim();
    if (!trimmed) {
      ctx.showToast("请输入新实例名称");
      return;
    }
    setOperating(true);
    try {
      const res = await ctx.postStudio<{ id: string }>("/api/studio/instances", {
        slug: trimmed,
        displayName: trimmed,
        primaryRole: newSoulRole
      });
      setNewSoulName("");
      await ctx.refreshSnapshot();
      ctx.showToast(`已创建独立存档实例：${res.id}`);
    } catch (err) {
      ctx.showToast(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOperating(false);
    }
  };

  const validSnapshot = snapshots.data?.snapshot_ids.includes(snapshotId) ?? false;
  const handleRollback = async () => {
    if (!ctx || !canWrite || !validSnapshot || operating) return;
    setOperating(true);
    try {
      const result = await ctx.postAdmin<{ rolled_back_to: string }>("system/snapshots/rollback",
        { mode: rollbackMode, snapshot_id: snapshotId.trim() }, "live");
      await ctx.refreshSnapshot();
      snapshots.refresh();
      setConfirmRollback(false);
      ctx.showToast(`已回滚到 ${result.rolled_back_to}`);
    } catch (error) {
      ctx.showToast(`回滚失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOperating(false);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage data-creator-publish-page="true">
        <WorkspaceHeader title="导出与多实例">

        </WorkspaceHeader>

        <WorkspaceSection>
          <WorkspaceRow>
            <h2>脱敏资产导出</h2>
            <WorkspaceStatus data-tone="good">
              {renderConsoleIcon("shield", 12)}
              <span>隐私字段物理剥离</span>
            </WorkspaceStatus>
          </WorkspaceRow>

          <WorkspaceGrid columns={2}>
            <div className="ai0-workspace-stack">
              <strong>包含资产模块：</strong>
              <JellySwitch
                id="pub-inc-bricks"
                checked={incBricks}
                onChange={setIncBricks}
                label="核心性格 DNA、关系契约、9 块上下文黑板模板与声线样本"
              />
              <JellySwitch
                id="pub-inc-lore"
                checked={incLore}
                onChange={setIncLore}
                label="24h 作息节律曲线、情绪参数与动态世界书 (Lorebook)"
              />
              <JellySwitch
                id="pub-inc-skills"
                checked={incSkills}
                onChange={setIncSkills}
                label="声明式 SKILL.md 技能集与 ECA 自动化规则 (.flow.yaml)"
              />
              <div className="ai0-workspace-actions">
                <RippleButton
                  variant="primary"
                  data-export-pack="soul-template"
                  disabled={!canWrite || operating}
                  onClick={() => void handleExportPack("soul-template")}
                >
                  {renderConsoleIcon("download", 14)}
                  <span>导出角色模板 (.soul-template.json)</span>
                </RippleButton>
                <RippleButton
                  variant="secondary"
                  data-export-pack="ai0pack"
                  disabled={!canWrite || operating}
                  onClick={() => void handleExportPack("ai0pack")}
                >
                  {renderConsoleIcon("export", 14)}
                  <span>导出完整资产包 (.ai0pack.json)</span>
                </RippleButton>
              </div>
            </div>

            <WorkspaceItem id="publish-audit-report" className="ai0-workspace-inset">
              {publishReport ? (
                <>
                  <strong>脱敏资产包已生成：{publishReport.filename}</strong>
                  <small>
                    SHA-256 指纹：<code>{publishReport.sha256.slice(0, 32)}…</code>
                  </small>
                  <WorkspaceDiff side="after">
                    已剥离 {publishReport.excludedKeys.length} 项敏感隐私字段：
                    {publishReport.excludedKeys.join(", ")}
                  </WorkspaceDiff>
                </>
              ) : (
                <>
                  <strong>隐私脱敏审计清单</strong>
                  <small>原始对话事件 (event_log)</small>
                  <small>个人情景与语义记忆</small>
                  <small>模型 API Key、Owner Token 与本地 Vault 凭据</small>
                </>
              )}
            </WorkspaceItem>
          </WorkspaceGrid>
        </WorkspaceSection>

        <WorkspaceGrid columns={2}>
          <WorkspaceSection>
            <WorkspaceRow>
              <h2>多 .soul 角色实例</h2>
              <WorkspaceStatus data-tone="info">{souls.length} 个存档实例</WorkspaceStatus>
            </WorkspaceRow>
            <div className="ai0-workspace-stack">
              {souls.map((item) => (
                <WorkspaceRow key={item.id} className="ai0-workspace-instance" data-active={item.active}>
                  <div>
                    <strong>{item.name}</strong> · <WorkspaceStatus data-tone="info">{item.role}</WorkspaceStatus>
                    <div className="ai0-workspace-mono">{item.path}</div>
                  </div>
                  <WorkspaceStatus data-tone={item.active ? "live" : "info"}>{item.active ? "运行中" : "已就绪"}</WorkspaceStatus>
                </WorkspaceRow>
              ))}
            </div>
            <WorkspaceGrid columns={3} className="ai0-workspace-divided">
              <WorkspaceField>
                <label htmlFor="new-soul-name">实例名称</label>
                <CompactInput
                  id="new-soul-name"
                  type="text"
                  placeholder="例如：Atlas"
                  value={newSoulName}
                  onInput={setNewSoulName}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span id="new-soul-role-label">默认关系契约</span>
                <CompactSelect
                  id="new-soul-role"
                  labelId="new-soul-role-label"
                  value={newSoulRole}
                  onChange={setNewSoulRole}
                  options={[
                    { value: "digital_employee", label: "专业助理" },
                    { value: "romantic_partner", label: "亲密伴侣" },
                    { value: "study_classmate", label: "学习同伴" },
                    { value: "best_friend", label: "日常挚友" },
                    { value: "vtuber_partner", label: "互动搭档" }
                  ]}
                />
              </WorkspaceField>
              <WorkspaceField className="ai0-workspace-align-end">
                <RippleButton
                  variant="primary"
                  data-create-new-soul="true"
                  disabled={!canWrite || operating || !newSoulName.trim()}
                  onClick={() => void handleCreateSoul()}
                >
                  {renderConsoleIcon("plus", 14)}
                  <span>新建实例</span>
                </RippleButton>
              </WorkspaceField>
            </WorkspaceGrid>
          </WorkspaceSection>

          <WorkspaceSection>
            <h2>Git 快照回滚与墓碑重放</h2>
            <p className="ai0-workspace-muted">
              回滚至任意历史快照时，存储引擎会强制重放 <code>redaction_ledger.json</code> 防复活账本，确保已物理擦除的隐私记录不会随旧快照恢复。
            </p>
            <WorkspaceGrid columns={2}>
              <WorkspaceField><span id="rollback-snapshot-label">历史快照 ID</span><CompactSelect value={snapshotId} labelId="rollback-snapshot-label"
                disabled={!canWrite || !snapshots.data?.snapshot_ids.length}
                onChange={setSnapshotId} options={[
                  { value: "", label: "选择快照" },
                  ...(snapshots.data?.snapshot_ids ?? []).map((id) => ({ value: id, label: id }))
                ]} /></WorkspaceField>
              <WorkspaceField><span id="rollback-mode-label">回滚模式</span><CompactSelect value={rollbackMode} labelId="rollback-mode-label"
                disabled={!canWrite} onChange={setRollbackMode} options={[
                  { value: "meta_reconciled", label: "透明共识回滚" },
                  { value: "dream_bridge", label: "梦境过渡回滚" },
                  { value: "silent_hard", label: "静默硬回滚" }
                ]} /></WorkspaceField>
            </WorkspaceGrid>
            {!snapshots.data?.snapshot_ids.length ? <WorkspaceReadState {...snapshots}
              empty={canWrite ? "当前没有可选快照。" : "回滚在正式实例中开放。"} onRetry={snapshots.refresh} /> : null}
            <RippleButton variant="danger" disabled={!canWrite || !validSnapshot || operating}
              onClick={() => setConfirmRollback(true)}>回滚到指定快照</RippleButton>
            {confirmRollback ? <WorkspaceConfirm title="回滚正式存档"
              description={<p>将 LIVE 回滚到 <code>{snapshotId.trim()}</code>。服务端会先保存当前存档快照。</p>}
              busy={operating} onCancel={() => setConfirmRollback(false)} onConfirm={() => void handleRollback()} /> : null}
            <WorkspaceItem className="ai0-workspace-inset">
              <strong>容器化自托管部署</strong>
              <WorkspaceCode>docker compose up -d{"\n"}# Healthcheck: GET http://127.0.0.1:4173/healthz</WorkspaceCode>
            </WorkspaceItem>
          </WorkspaceSection>
        </WorkspaceGrid>
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
