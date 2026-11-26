import type { AudienceScope, PlatformAdapterKind, PlatformChannelInstance } from "@ai0/protocol";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import type { ConsoleRoute } from "../router/routes.js";
import {
  WorkspaceCode,
  WorkspaceField,
  WorkspaceGrid,
  WorkspaceItem,
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus,
  WorkspaceTag
} from "./workspace-layout.js";
import { useAdminResource, WorkspaceConfirm, WorkspaceHeader, WorkspaceReadState } from "./workspace.js";

export interface IntegrationsPlatformsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

interface TopologyData {
  active_sessions: Array<{
    session_id: string;
    channel_id: string;
    venue_type: string;
    audience_scope: string;
    modality: string;
  }>;
  channel_extensions: Array<{ id: string; rev: number }>;
  sensory_coverage: Array<{
    channel_id: string;
    modality: string;
    source_key: string;
    coverage: string;
    summary_text: string;
    freshness_ttl_ms: number;
  }>;
}

const ADAPTER_LABELS: Record<PlatformAdapterKind, string> = {
  builtin_webchat: "内置 WebChat",
  builtin_terminal: "内置终端 CLI",
  protocol_v0_ws: "Protocol v0 交互通道",
  qq_onebot: "QQ (OneBot v11)",
  wechat: "微信桥接",
  feishu: "飞书 / Lark",
  telegram: "Telegram Bot",
  discord: "Discord Bot",
  desktop_channel: "桌面伴侣 / Live2D",
  live2d: "Live2D 客户端",
  webhook: "HTTP Webhook"
};

const PLATFORM_PRESETS: ReadonlyArray<{
  adapterKind: PlatformAdapterKind;
  label: string;
  endpoint: string;
  ceiling: AudienceScope;
}> = [
  { adapterKind: "protocol_v0_ws", label: "自定义 Protocol v0 客户端", endpoint: "ws://127.0.0.1:4173/protocol/v0/channel", ceiling: "only_owner" },
  { adapterKind: "qq_onebot", label: "QQ 群聊机器人 (OneBot)", endpoint: "ws://127.0.0.1:3001", ceiling: "group:default" },
  { adapterKind: "telegram", label: "Telegram Bot", endpoint: "https://api.telegram.org", ceiling: "only_owner" },
  { adapterKind: "discord", label: "Discord 频道机器人", endpoint: "wss://gateway.discord.gg", ceiling: "public_all" },
  { adapterKind: "feishu", label: "飞书协作机器人", endpoint: "https://open.feishu.cn/open-apis", ceiling: "group:default" },
  { adapterKind: "desktop_channel", label: "桌面伴侣 / Live2D 交互通道", endpoint: "ws://127.0.0.1:4173/protocol/v0/channel", ceiling: "only_owner" },
  { adapterKind: "webhook", label: "HTTP Webhook 网关", endpoint: "http://127.0.0.1:8080/webhook", ceiling: "public_all" }
];

const CEILING_LABELS: Record<string, string> = {
  only_owner: "仅主账户 (only_owner)",
  "group:default": "受限群组 (group:default)",
  public_all: "公开场合 (public_all)"
};

export function IntegrationsPlatformsPage(props: IntegrationsPlatformsPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const platforms = snap?.infrastructure?.platforms ?? [];
  const extensions = snap?.extensions ?? [];
  const canWrite = Boolean(ctx?.mode === "live" && ctx.ownerToken);
  const topology = useAdminResource<TopologyData>("channels/topology");

  const [busyId, setBusyId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [adapterKind, setAdapterKind] = useState<PlatformAdapterKind>("qq_onebot");
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("QQ 群聊机器人 (OneBot)");
  const [newEndpoint, setNewEndpoint] = useState("ws://127.0.0.1:3001");
  const [newCeiling, setNewCeiling] = useState<AudienceScope>("group:default");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformChannelInstance | null>(null);
  const [issuedToken, setIssuedToken] = useState<{ channelId: string; token: string } | null>(null);

  const selectPreset = (kind: string) => {
    const preset = PLATFORM_PRESETS.find((item) => item.adapterKind === kind);
    setAdapterKind(kind as PlatformAdapterKind);
    if (!preset) return;
    setNewLabel(preset.label);
    setNewEndpoint(preset.endpoint);
    setNewCeiling(preset.ceiling);
  };

  const handleTogglePlatform = async (platform: PlatformChannelInstance, enabled: boolean) => {
    if (!ctx || !canWrite || busyId) return;
    setBusyId(platform.id);
    try {
      if (platform.builtinPluginId) {
        await ctx.postStudio("plugin-enabled", { id: platform.builtinPluginId, enabled });
      }
      await ctx.patchAdmin(`integrations/platforms/${encodeURIComponent(platform.id)}`, { enabled }, "live");
      await ctx.refreshSnapshot();
      topology.refresh();
      ctx.showToast(`${platform.label} 已${enabled ? "启用" : "停用"}`);
    } catch (err) {
      ctx.showToast(`切换失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(undefined);
    }
  };

  const handleCreatePlatform = async () => {
    if (!ctx || !canWrite || creating) return;
    if (!newLabel.trim()) {
      ctx.showToast("请填写平台实例名称");
      return;
    }
    setCreating(true);
    try {
      const id = newId.trim() || `${adapterKind}.${Date.now().toString(36)}`;
      await ctx.postAdmin("integrations/platforms", {
        id,
        label: newLabel.trim(),
        adapterKind,
        endpoint: newEndpoint.trim(),
        authMode: adapterKind === "webhook" ? "webhook_secret" : "scoped_token",
        defaultAudienceCeiling: newCeiling,
        enabled: true,
        notes: newNotes.trim()
      }, "live");
      setNewId("");
      setNewNotes("");
      setAddOpen(false);
      await ctx.refreshSnapshot();
      ctx.showToast(`已新增接入平台「${newLabel.trim()}」`);
    } catch (err) {
      ctx.showToast(`新增平台失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePlatform = async () => {
    if (!ctx || !canWrite || !deleteTarget || busyId) return;
    setBusyId(deleteTarget.id);
    try {
      await ctx.deleteAdmin(`integrations/platforms/${encodeURIComponent(deleteTarget.id)}`, "live");
      setDeleteTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已移除平台「${deleteTarget.label}」`);
    } catch (err) {
      ctx.showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(undefined);
    }
  };

  const handleIssueToken = async (platform: PlatformChannelInstance) => {
    if (!ctx || !canWrite || busyId) return;
    setBusyId(platform.id);
    try {
      const principalId = platform.defaultAudienceCeiling === "only_owner" ? "owner:local" : `adapter:${platform.id}`;
      const res = await ctx.postStudio<{ token: string; channelId: string }>("channel-grants", {
        channelId: platform.id,
        externalUserId: `client:${platform.id}`,
        principalId,
        audience: platform.defaultAudienceCeiling,
        mode: "live"
      });
      setIssuedToken({ channelId: res.channelId, token: res.token });
      ctx.showToast(`已为 ${platform.label} 签发临时 Scoped Token`);
    } catch (err) {
      ctx.showToast(`签发失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(undefined);
    }
  };

  const activeSessions = topology.data?.active_sessions ?? [];

  return (
    <MainRoundedCardOutlet domainId="integrations" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage data-platforms-page="true">
        <WorkspaceHeader title="消息平台与交互通道">
          <RippleButton size="sm" variant="secondary" onClick={topology.refresh}>
            {renderConsoleIcon("refresh", 13)}
            <span>刷新连接状态</span>
          </RippleButton>
          <RippleButton
            size="sm"
            variant="secondary"
            onClick={() => ctx?.navigateConsole("/config/routing")}
          >
            {renderConsoleIcon("rules", 13)}
            <span>配置会话路由</span>
          </RippleButton>
          <RippleButton
            variant="primary"
            data-add-platform="true"
            disabled={!canWrite}
            onClick={() => setAddOpen(true)}
          >
            {renderConsoleIcon("plus", 14)}
            <span>新增平台接入</span>
          </RippleButton>
        </WorkspaceHeader>

        <WorkspaceSection>
          <WorkspaceRow>
            <h2>已接入平台与具身通道</h2>
            <small>纯粹的下游收发通道管理；话轮防抖与注意力策略位于「核心配置」，语音表现位于「语音与多模态」。</small>
          </WorkspaceRow>

          {!platforms.length ? (
            <small>尚未配置任何平台连接实例。</small>
          ) : null}

          <WorkspaceGrid columns={2}>
            {platforms.map((platform) => {
              const pluginState = platform.builtinPluginId
                ? extensions.find((ext) => ext.id === platform.builtinPluginId)
                : undefined;
              const isEnabled = pluginState ? pluginState.enabled : platform.enabled;
              const sessions = activeSessions.filter(
                (s) => s.channel_id === platform.id || (platform.builtinPluginId && s.channel_id.startsWith(platform.builtinPluginId))
              );
              const statusTone = !isEnabled
                ? "neutral"
                : sessions.length > 0
                  ? "live"
                  : pluginState?.enabled
                    ? "good"
                    : "warn";
              const statusLabel = !isEnabled
                ? "已停用"
                : sessions.length > 0
                  ? `在线 · ${sessions.length} 会话`
                  : pluginState?.enabled
                    ? "内置就绪"
                    : "等待客户端连接";

              return (
                <WorkspaceItem key={platform.id} as="article" data-platform-id={platform.id}>
                  <WorkspaceRow>
                    <div>
                      <div className="ai0-workspace-actions">
                        <strong>{platform.label}</strong>
                        <WorkspaceTag>{ADAPTER_LABELS[platform.adapterKind]}</WorkspaceTag>
                      </div>
                      <small>ID: <code>{platform.id}</code>{platform.endpoint ? ` · ${platform.endpoint}` : ""}</small>
                    </div>
                    <JellySwitch
                      checked={isEnabled}
                      disabled={!canWrite || busyId === platform.id}
                      ariaLabel={`启用 ${platform.label}`}
                      data-plat-enabled={platform.id}
                      onChange={(enabled) => void handleTogglePlatform(platform, enabled)}
                    />
                  </WorkspaceRow>

                  {platform.notes ? <small>{platform.notes}</small> : null}

                  <WorkspaceRow>
                    <div className="ai0-workspace-actions">
                      <WorkspaceStatus data-tone={statusTone}>{statusLabel}</WorkspaceStatus>
                      <WorkspaceTag>
                        受众上限：{CEILING_LABELS[platform.defaultAudienceCeiling] ?? platform.defaultAudienceCeiling}
                      </WorkspaceTag>
                    </div>
                    <div className="ai0-workspace-actions">
                      {!platform.builtinPluginId ? (
                        <>
                          <RippleButton
                            size="sm"
                            variant="secondary"
                            disabled={!canWrite || busyId === platform.id}
                            onClick={() => void handleIssueToken(platform)}
                          >
                            {renderConsoleIcon("key", 12)}
                            <span>签发 Token</span>
                          </RippleButton>
                          <RippleButton
                            size="sm"
                            variant="ghost"
                            ariaLabel={`删除 ${platform.label}`}
                            disabled={!canWrite || busyId === platform.id}
                            onClick={() => setDeleteTarget(platform)}
                          >
                            {renderConsoleIcon("trash", 13)}
                          </RippleButton>
                        </>
                      ) : null}
                    </div>
                  </WorkspaceRow>
                </WorkspaceItem>
              );
            })}
          </WorkspaceGrid>
        </WorkspaceSection>

        <WorkspaceSection>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 620, fontSize: 13 }}>
              Protocol v0 网关接入详情与实时握手诊断（在线会话 {activeSessions.length}）
            </summary>
            <div className="ai0-workspace-stack" style={{ marginTop: 10 }}>
              <WorkspaceCode>
                POST /protocol/v0/channel/perception{"\n"}
                POST /protocol/v0/channel/connections{"\n"}
                POST /protocol/v0/channel/runs
              </WorkspaceCode>
              {!topology.data ? (
                <WorkspaceReadState {...topology} empty="等待连接运行时网关。" onRetry={topology.refresh} />
              ) : (
                <>
                  <small>
                    已注册内核交互通道扩展：{topology.data.channel_extensions.map((ext) => ext.id).join("、") || "无"}
                  </small>
                  {activeSessions.length > 0 ? activeSessions.map((session) => (
                    <WorkspaceItem key={session.session_id} as="article">
                      <WorkspaceRow>
                        <strong>{session.channel_id}</strong>
                        <WorkspaceStatus data-tone="live">{session.audience_scope}</WorkspaceStatus>
                      </WorkspaceRow>
                      <small>{session.venue_type} · 模态 {session.modality} · 会话 {session.session_id}</small>
                    </WorkspaceItem>
                  )) : <small>当前无活跃的外部长连接握手会话。</small>}
                </>
              )}
            </div>
          </details>
        </WorkspaceSection>

        <Dialog open={addOpen} onClose={() => !creating && setAddOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>新增消息平台 / 交互通道接入</DialogTitle>
          <DialogContent>
            <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
              <WorkspaceField>
                <span>平台 / 适配器类型</span>
                <CompactSelect
                  ariaLabel="平台适配器类型"
                  value={adapterKind}
                  onChange={selectPreset}
                  options={PLATFORM_PRESETS.map((p) => ({ value: p.adapterKind, label: ADAPTER_LABELS[p.adapterKind] }))}
                />
              </WorkspaceField>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>显示名称</label>
                  <CompactInput value={newLabel} onInput={setNewLabel} placeholder="例如：主群 QQ 机器人" />
                </WorkspaceField>
                <WorkspaceField>
                  <label>通道标识 ID（用于 UMO 路由，选填）</label>
                  <CompactInput value={newId} onInput={setNewId} placeholder="留空自动生成，如 qq.main" />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceField>
                <label>连接端点 (WebSocket / Webhook URL)</label>
                <CompactInput value={newEndpoint} onInput={setNewEndpoint} />
              </WorkspaceField>
              <WorkspaceField>
                <span>受众隐私天花板（通道级安全硬围栏）</span>
                <CompactSelect
                  ariaLabel="受众隐私天花板"
                  value={newCeiling}
                  onChange={(v) => setNewCeiling(v as AudienceScope)}
                  options={[
                    { value: "only_owner", label: "only_owner（仅主账户私密）" },
                    { value: "group:default", label: "group:default（受限群组）" },
                    { value: "public_all", label: "public_all（公开场合 · 强制 70% 社交面具）" }
                  ]}
                />
              </WorkspaceField>
              <WorkspaceField>
                <label>备注说明</label>
                <CompactInput value={newNotes} onInput={setNewNotes} placeholder="可选备注" />
              </WorkspaceField>
            </div>
          </DialogContent>
          <DialogActions>
            <RippleButton variant="ghost" disabled={creating} onClick={() => setAddOpen(false)}>取消</RippleButton>
            <RippleButton variant="primary" loading={creating} data-confirm-add-platform="true" onClick={() => void handleCreatePlatform()}>
              {renderConsoleIcon("plus", 13)}
              <span>添加平台</span>
            </RippleButton>
          </DialogActions>
        </Dialog>

        <Dialog open={Boolean(issuedToken)} onClose={() => setIssuedToken(null)} fullWidth maxWidth="sm">
          <DialogTitle>Scoped Capability Token 已签发</DialogTitle>
          <DialogContent>
            <div className="ai0-workspace-stack">
              <small>将该令牌放入外部客户端的 <code>Authorization: Bearer &lt;token&gt;</code> 请求头即可通过 Protocol v0 接入通道 <code>{issuedToken?.channelId}</code>（有效期 1 小时，受通道隐私天花板约束，零内核后门权限）。</small>
              <WorkspaceCode>{issuedToken?.token}</WorkspaceCode>
            </div>
          </DialogContent>
          <DialogActions>
            <RippleButton variant="primary" onClick={() => setIssuedToken(null)}>完成</RippleButton>
          </DialogActions>
        </Dialog>

        {deleteTarget ? (
          <WorkspaceConfirm
            title={`移除平台「${deleteTarget.label}」`}
            description="移除后该平台记录将从宿主机接入列表中删除，已绑定的 UMO 路由规则不会自动删除。"
            busy={busyId === deleteTarget.id}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => void handleDeletePlatform()}
          />
        ) : null}
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
