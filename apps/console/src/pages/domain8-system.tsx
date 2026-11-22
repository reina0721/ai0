import { useEffect, useState, type ReactElement } from "react";

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

  // Security & settings state
  const [auth2fa, setAuth2fa] = useState(sys?.auth2faEnabled ?? false);
  const [codeSandbox, setCodeSandbox] = useState(sys?.codeSandboxEnabled ?? true);
  const [proxyUrl, setProxyUrl] = useState(sys?.proxyUrl ?? "");

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

  useEffect(() => {
    if (!sys) return;
    setAuth2fa(sys.auth2faEnabled);
    setCodeSandbox(sys.codeSandboxEnabled);
    setProxyUrl(sys.proxyUrl);
  }, [sys]);

  if (route?.id === "system.safety-sb243") {
    return (
      <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>权限与合规</h1>
            </div>
          </header>
          <div className="ai0-grid-2">
            <section className="ai0-card is-elevated">
              <h2>三维工具与动作授权矩阵</h2>
              <table className="ai0-table">
                <thead>
                  <tr><th>操作风险等级</th><th>主账户 1v1</th><th>认证群组</th><th>公开场合</th></tr>
                </thead>
                <tbody>
                  <tr><td>只读检索 (RAG / 查询)</td><td><span className="ai0-badge" data-tone="good">自动放行</span></td><td><span className="ai0-badge" data-tone="good">仅公开集</span></td><td><span className="ai0-badge" data-tone="good">仅公开集</span></td></tr>
                  <tr><td>文件写入 / 日历 / 外部请求</td><td><span className="ai0-badge" data-tone="warn">人工审批</span></td><td><span className="ai0-badge" data-tone="danger">硬拒绝</span></td><td><span className="ai0-badge" data-tone="danger">硬拒绝</span></td></tr>
                  <tr><td>隐私擦除 / 修改核心 DNA</td><td><span className="ai0-badge" data-tone="accent">仅主账户</span></td><td><span className="ai0-badge" data-tone="danger">硬拒绝</span></td><td><span className="ai0-badge" data-tone="danger">硬拒绝</span></td></tr>
                </tbody>
              </table>
            </section>
            <section className="ai0-card is-elevated">
              <h2>危机拦截与健康使用护栏 (SB 243)</h2>
              <div className="ai0-field">
                <label>连续交互休息提醒间隔 (分钟，法定上限 180)</label>
                <CompactInput id="sys-sb243-break" type="number" min={30} max={180} value={sys?.sb243BreakMinutes ?? 180} unit="min" />
              </div>
              <div className="ai0-field">
                <label>危机援助热线地区配置</label>
                <CompactInput id="sys-hotline" type="text" value={sys?.crisisHotlineRegion ?? "CN-4001619995 / US-988"} />
              </div>
              <div className="ai0-card" style={{ background: "var(--ai0-surface-container-low)" }}>
                <strong>SQLite 存储引擎安全状态</strong>
                <small style={{ fontFamily: "var(--ai0-font-mono)" }}>
                  journal_mode={snap?.pragmaStatus.journal_mode ?? "wal"} · foreign_keys={snap?.pragmaStatus.foreign_keys ?? 1} · secure_delete={snap?.pragmaStatus.secure_delete ?? 1}
                </small>
              </div>
            </section>
          </div>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  if (route?.id === "system.settings-security") {
    const handleSaveSettings = async () => {
      if (!ctx) return;
      try {
        await ctx.postStudio("/api/studio/config", {
          systemSettings: {
            auth2faEnabled: auth2fa,
            codeSandboxEnabled: codeSandbox,
            proxyUrl
          }
        });
        await ctx.refreshSnapshot();
        ctx.showToast("系统安全与代理设置已保存");
      } catch (err) {
        ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-system-settings-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>安全与外观</h1>
            </div>
            <div className="ai0-page-header__actions">
              <RippleButton
                variant="primary"
                data-save-system-settings="true"
                onClick={() => void handleSaveSettings()}
              >
                {renderConsoleIcon("save", 14)}
                <span>保存设置</span>
              </RippleButton>
            </div>
          </header>
          <div className="ai0-grid-2">
            <section className="ai0-card is-elevated">
              <h2>访问认证、沙盒与网络代理</h2>
              <JellySwitch
                id="sys-auth-2fa"
                checked={auth2fa}
                onChange={setAuth2fa}
                label="启用管理员双因素认证 (2FA)"
              />
              <JellySwitch
                id="sys-code-sandbox"
                checked={codeSandbox}
                onChange={setCodeSandbox}
                label="启用 Agent 脚本隔离执行沙盒"
              />
              <div className="ai0-field">
                <label>全局 HTTP / SOCKS5 代理地址（留空直连）</label>
                <CompactInput
                  id="sys-proxy-url"
                  type="url"
                  placeholder="http://127.0.0.1:7890"
                  value={proxyUrl}
                  onInput={setProxyUrl}
                />
              </div>
            </section>
            <section className="ai0-card is-elevated">
              <h2>控制台外观模式</h2>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
              <small>外观与主题色偏好会持久化至本地配置并在下次启动时自动恢复。</small>
            </section>
          </div>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Export Packages & Multi-Instance Storage
  const handleExportPack = async (packageType: "soul-template" | "ai0pack") => {
    if (!ctx) return;
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
      URL.revokeObjectURL(url);
      ctx.showToast(`已导出脱敏资产包：${res.filename}`);
    } catch (err) {
      ctx.showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateSoul = async () => {
    if (!ctx) return;
    const trimmed = newSoulName.trim();
    if (!trimmed) {
      ctx.showToast("请输入新实例名称");
      return;
    }
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
    }
  };

  const handleRollback = async (mode: "meta_reconciled" | "dream_bridge" | "silent_hard") => {
    if (!ctx) return;
    try {
      await ctx.postAdmin("/api/admin/v1/system/snapshots/rollback", { mode }, "live");
      await ctx.refreshSnapshot();
      ctx.showToast(`已按 [${mode}] 模式回滚并重放墓碑账本`);
    } catch (err) {
      ctx.showToast(`回滚失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="system" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-creator-publish-page="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>导出与多实例</h1>
          </div>
        </header>

        <section className="ai0-card is-elevated">
          <div className="ai0-card__head">
            <h2>脱敏资产导出</h2>
            <span className="ai0-badge" data-tone="good">
              {renderConsoleIcon("shield", 12)}
              <span>隐私字段物理剥离</span>
            </span>
          </div>

          <div className="ai0-grid-2">
            <div style={{ display: "grid", gap: "10px" }}>
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
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                <RippleButton
                  variant="primary"
                  data-export-pack="soul-template"
                  onClick={() => void handleExportPack("soul-template")}
                >
                  {renderConsoleIcon("download", 14)}
                  <span>导出角色模板 (.soul-template.json)</span>
                </RippleButton>
                <RippleButton
                  variant="secondary"
                  data-export-pack="ai0pack"
                  onClick={() => void handleExportPack("ai0pack")}
                >
                  {renderConsoleIcon("export", 14)}
                  <span>导出完整资产包 (.ai0pack.json)</span>
                </RippleButton>
              </div>
            </div>

            <div id="publish-audit-report" className="ai0-card" style={{ background: "var(--ai0-surface-container-low)" }}>
              {publishReport ? (
                <>
                  <strong>脱敏资产包已生成：{publishReport.filename}</strong>
                  <small>
                    SHA-256 指纹：<code>{publishReport.sha256.slice(0, 32)}…</code>
                  </small>
                  <div className="ai0-diff-after">
                    已剥离 {publishReport.excludedKeys.length} 项敏感隐私字段：
                    {publishReport.excludedKeys.join(", ")}
                  </div>
                </>
              ) : (
                <>
                  <strong>隐私脱敏审计清单</strong>
                  <small>自动剥离：全部 {snap?.eventsCount ?? 5} 条原始对话事件 (event_log)</small>
                  <small>自动剥离：全部 {snap?.memoriesCount ?? 5} 条个人情景与语义记忆</small>
                  <small>自动剥离：全部模型 API Keys、Owner Token 与本地 Vault 凭据</small>
                </>
              )}
            </div>
          </div>
        </section>

        <div className="ai0-grid-2">
          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>多 .soul 角色实例</h2>
              <span className="ai0-badge" data-tone="info">{souls.length || 1} 个存档实例</span>
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              {souls.map((item) => (
                <div
                  key={item.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", borderRadius: "10px", background: "var(--ai0-surface-container-low)", border: item.active ? "var(--ai0-border-strong)" : "var(--ai0-border-subtle)" }}
                >
                  <div>
                    <strong>{item.name}</strong> · <span className="ai0-badge" data-tone="info">{item.role}</span>
                    <div style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11px", color: "var(--ai0-on-surface-muted)" }}>{item.path}</div>
                  </div>
                  <span className="ai0-badge" data-tone={item.active ? "live" : "info"}>{item.active ? "运行中" : "已就绪"}</span>
                </div>
              ))}
            </div>
            <div className="ai0-grid-3" style={{ paddingTop: "8px", borderTop: "var(--ai0-border-subtle)" }}>
              <div className="ai0-field">
                <label>实例名称</label>
                <CompactInput
                  id="new-soul-name"
                  type="text"
                  placeholder="例如：Atlas"
                  value={newSoulName}
                  onInput={setNewSoulName}
                />
              </div>
              <div className="ai0-field">
                <label>默认关系契约</label>
                <CompactSelect
                  id="new-soul-role"
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
              </div>
              <div className="ai0-field" style={{ alignSelf: "end" }}>
                <RippleButton
                  variant="primary"
                  data-create-new-soul="true"
                  onClick={() => void handleCreateSoul()}
                >
                  {renderConsoleIcon("plus", 14)}
                  <span>新建实例</span>
                </RippleButton>
              </div>
            </div>
          </section>

          <section className="ai0-card is-elevated">
            <h2>Git 快照回滚与墓碑重放</h2>
            <p style={{ fontSize: "12.5px", color: "var(--ai0-on-surface-muted)" }}>
              回滚至任意历史快照时，存储引擎会强制重放 <code>redaction_ledger.json</code> 防复活账本，确保已物理擦除的隐私记录不会随旧快照恢复。
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <RippleButton
                variant="secondary"
                size="sm"
                data-rollback-mode="meta_reconciled"
                onClick={() => void handleRollback("meta_reconciled")}
              >
                透明共识回滚（推荐）
              </RippleButton>
              <RippleButton
                variant="secondary"
                size="sm"
                data-rollback-mode="dream_bridge"
                onClick={() => void handleRollback("dream_bridge")}
              >
                梦境过渡回滚
              </RippleButton>
              <RippleButton
                variant="secondary"
                size="sm"
                data-rollback-mode="silent_hard"
                onClick={() => void handleRollback("silent_hard")}
              >
                静默硬回滚
              </RippleButton>
            </div>
            <div className="ai0-card" style={{ background: "var(--ai0-surface-container-low)" }}>
              <strong>容器化自托管部署</strong>
              <pre className="ai0-code-box">docker compose up -d{"\n"}# Healthcheck: GET http://127.0.0.1:4173/healthz</pre>
            </div>
          </section>
        </div>
      </div>
    </MainRoundedCardOutlet>
  );
}
