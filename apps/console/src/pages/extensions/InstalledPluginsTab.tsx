import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useMemo, useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, LiveExtensionSnapshot } from "../../live-snapshot.js";
import { registeredPages } from "../../router/plugin-pages.js";
import {
  WorkspaceField,
  WorkspacePage,
  WorkspaceStatus,
  WorkspaceTag
} from "../workspace-layout.js";
import { WorkspaceHeader } from "../workspace.js";
import { PluginConfigDrawer, PluginDetailsDrawer } from "./PluginDrawers.js";

const BUS_LABELS: Record<string, string> = {
  "ext.cognitive_organ": "认知器官",
  "ext.media_pipeline": "媒体管线",
  "ext.shell": "交互躯壳",
  "ext.action_mcp_skill": "工具与技能",
  "ext.memory_knowledge": "记忆与知识",
  "ext.model_provider": "模型适配",
  "ext.soul_asset": "灵魂资产",
  "ext.console_ui": "控制台界面"
};

const SAMPLE_MANIFEST_JSON = JSON.stringify(
  {
    manifest_version: "1.1.0",
    extension_id: "community.asset.custom-greeting",
    display_name: "自定义晨间问候包",
    description: "在每日首次对话时附上柔和的晨间问候提示",
    version: "1.0.0",
    author: "me",
    carrier_kind: "declarative_soul_asset",
    dimension: "ext.soul_asset",
    permissions: {
      read_blackboard_domains: ["D2_HOMEOSTASIS_AFFECT"],
      propose_mutation_domains: [],
      max_audience_scope: "only_owner",
      network_access: false
    },
    console_contributions: {
      config_fields: [
        { key: "greeting_prefix", label: "问候前缀", type: "string", default: "早安呀" }
      ]
    }
  },
  null,
  2
);

export function InstalledPluginsTab(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const runtime = snap?.extensions ?? [];
  const legacyMeta = snap?.studioConfig?.ecosystem.plugins ?? [];
  const pages = registeredPages(snap);
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled" | "error">("all");
  const [busFilter, setBusFilter] = useState<string>("all");
  const [pendingId, setPendingId] = useState<string>();
  const [reloadingAll, setReloadingAll] = useState(false);

  // Drawers
  const [configTarget, setConfigTarget] = useState<LiveExtensionSnapshot | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<LiveExtensionSnapshot | null>(null);

  // Install Modal
  const [installOpen, setInstallOpen] = useState(false);
  const [installMode, setInstallMode] = useState<"local_path" | "manifest_bundle">("local_path");
  const [localPathInput, setLocalPathInput] = useState("");
  const [manifestJsonInput, setManifestJsonInput] = useState(SAMPLE_MANIFEST_JSON);
  const [installing, setInstalling] = useState(false);

  // Uninstall Modal (with AstrBot keep-config toggle)
  const [uninstallTarget, setUninstallTarget] = useState<LiveExtensionSnapshot | null>(null);
  const [keepConfigOnUninstall, setKeepConfigOnUninstall] = useState(true);
  const [uninstalling, setUninstalling] = useState(false);

  const normalizedList = useMemo(() => {
    return runtime.map((ext) => {
      const meta = legacyMeta.find((p) => p.id === ext.id);
      return {
        ...ext,
        displayName: ext.displayName ?? meta?.name ?? ext.id,
        description: ext.description ?? meta?.description ?? ""
      };
    });
  }, [runtime, legacyMeta]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return normalizedList.filter((ext) => {
      if (statusFilter === "active" && (!ext.enabled || Boolean(ext.activationError))) return false;
      if (statusFilter === "disabled" && ext.enabled) return false;
      if (statusFilter === "error" && !ext.activationError) return false;
      if (busFilter !== "all" && !ext.buses.includes(busFilter)) return false;
      if (!q) return true;
      return (
        ext.displayName.toLowerCase().includes(q) ||
        ext.id.toLowerCase().includes(q) ||
        ext.description.toLowerCase().includes(q) ||
        (ext.author ?? "").toLowerCase().includes(q) ||
        ext.buses.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [normalizedList, query, statusFilter, busFilter]);

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!ctx || !canWrite || pendingId) return;
    setPendingId(id);
    try {
      await ctx.postStudio("plugin-enabled", { id, enabled });
      await ctx.refreshSnapshot();
      ctx.showToast(`扩展已${enabled ? "启用" : "停用"}`);
    } catch (err) {
      ctx.showToast(`切换状态失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingId(undefined);
    }
  };

  const handleReloadOne = async (ext: LiveExtensionSnapshot) => {
    if (!ctx || pendingId) return;
    setPendingId(ext.id);
    try {
      await ctx.postAdmin(`extensions/${encodeURIComponent(ext.id)}/reload`, {});
      await ctx.refreshSnapshot();
      ctx.showToast(`已热重载「${ext.displayName ?? ext.id}」`);
    } catch (err) {
      ctx.showToast(`重载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingId(undefined);
    }
  };

  const handleReloadAll = async () => {
    if (!ctx || !canWrite || reloadingAll) return;
    setReloadingAll(true);
    try {
      const res = await ctx.postAdmin<{ count: number; revision: number }>("extensions/reload-all", {}, "live");
      await ctx.refreshSnapshot();
      ctx.showToast(`已全部重载 ${res.count} 个扩展 (rev ${res.revision})`);
    } catch (err) {
      ctx.showToast(`全部重载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReloadingAll(false);
    }
  };

  const handleInstallSubmit = async () => {
    if (!ctx || !canWrite || installing) return;
    setInstalling(true);
    try {
      if (installMode === "local_path") {
        if (!localPathInput.trim()) throw new Error("请输入包含 ai0.extension.json 的本地文件夹路径");
        await ctx.postAdmin("extensions/install", { source: "local_path", localPath: localPathInput.trim() }, "live");
      } else {
        const parsed = JSON.parse(manifestJsonInput) as Record<string, unknown>;
        await ctx.postAdmin("extensions/install", { source: "manifest_bundle", manifest: parsed }, "live");
      }
      setInstallOpen(false);
      setLocalPathInput("");
      await ctx.refreshSnapshot();
      ctx.showToast("外部扩展安装成功并已热挂载");
    } catch (err) {
      ctx.showToast(`安装失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstallConfirm = async () => {
    if (!ctx || !canWrite || !uninstallTarget || uninstalling) return;
    setUninstalling(true);
    try {
      await ctx.deleteAdmin(
        `extensions/${encodeURIComponent(uninstallTarget.id)}?keep_config=${keepConfigOnUninstall ? "true" : "false"}`,
        "live"
      );
      setUninstallTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已卸载外部扩展「${uninstallTarget.displayName ?? uninstallTarget.id}」`);
    } catch (err) {
      ctx.showToast(`卸载失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <WorkspacePage data-ecosystem-page="true">
      <WorkspaceHeader title="已安装插件">
        <RippleButton
          size="sm"
          variant="secondary"
          data-reload-all-plugins="true"
          loading={reloadingAll}
          disabled={!canWrite}
          onClick={() => void handleReloadAll()}
        >
          {renderConsoleIcon("refresh", 13)}
          <span>全部重载</span>
        </RippleButton>
        <RippleButton
          size="sm"
          variant="secondary"
          onClick={() => ctx?.navigateConsole("/capabilities/extensions/market")}
        >
          {renderConsoleIcon("sparkles", 13)}
          <span>浏览扩展市场</span>
        </RippleButton>
        <RippleButton
          variant="primary"
          data-open-install-plugin="true"
          disabled={!canWrite}
          onClick={() => setInstallOpen(true)}
        >
          {renderConsoleIcon("plus", 14)}
          <span>安装扩展</span>
        </RippleButton>
      </WorkspaceHeader>

      <div className="ai0-filter-bar">
        <div className="ai0-filter-bar__search">
          <CompactInput
            type="search"
            ariaLabel="过滤已安装插件"
            value={query}
            placeholder="搜索插件名称、扩展 ID、作者或总线…"
            onInput={setQuery}
          />
        </div>
        <div className="ai0-workspace-actions">
          {(
            [
              ["all", `全部 (${normalizedList.length})`],
              ["active", "运行中"],
              ["disabled", "已停用"],
              ["error", "异常"]
            ] as const
          ).map(([id, label]) => (
            <RippleButton
              key={id}
              size="sm"
              variant={statusFilter === id ? "primary" : "secondary"}
              onClick={() => setStatusFilter(id)}
            >
              {label}
            </RippleButton>
          ))}
        </div>
        <div style={{ minWidth: 150 }}>
          <CompactSelect
            ariaLabel="按总线筛选插件"
            value={busFilter}
            onChange={setBusFilter}
            options={[
              { value: "all", label: "全部扩展总线" },
              ...Object.entries(BUS_LABELS).map(([value, label]) => ({ value, label }))
            ]}
          />
        </div>
      </div>

      {!filtered.length ? (
        <small>{query ? "没有匹配的已安装插件。" : "当前未发现插件。"}</small>
      ) : (
        <div className="ai0-card-grid">
          {filtered.map((ext) => {
            const extPages = pages.filter((p) => p.pluginId === ext.id);
            const isBuiltin = ext.origin === "builtin";
            const statusText = ext.activationError ? "激活失败" : ext.enabled ? "运行中" : "已停用";
            const statusTone = ext.activationError ? "danger" : ext.enabled ? "live" : "neutral";
            const fieldCount = ext.configFields?.length ?? 0;

            return (
              <article
                key={ext.id}
                className="ai0-entity-card"
                data-plugin-card={ext.id}
                data-disabled={!ext.enabled}
              >
                <div className="ai0-entity-card__header">
                  <div className="ai0-entity-card__title">
                    <div className="ai0-entity-card__title-row">
                      <strong>{ext.displayName}</strong>
                      <WorkspaceStatus data-tone={statusTone}>{statusText}</WorkspaceStatus>
                      <WorkspaceTag>{isBuiltin ? "官方内置" : ext.origin === "soul" ? "灵魂目录" : "外部扩展"}</WorkspaceTag>
                    </div>
                    <small>
                      <code>{ext.id}</code> · v{ext.version ?? "1.0.0"} · by {ext.author ?? "ai0"}
                    </small>
                  </div>
                  <JellySwitch
                    checked={ext.enabled}
                    ariaLabel={`启用 ${ext.displayName}`}
                    disabled={!canWrite || pendingId === ext.id}
                    onChange={(val) => void handleToggle(ext.id, val)}
                  />
                </div>

                <div className="ai0-entity-card__body">
                  <div className="ai0-entity-card__badges">
                    {ext.buses.map((bus) => (
                      <WorkspaceStatus key={bus} data-tone="info">
                        {BUS_LABELS[bus] ?? bus}
                      </WorkspaceStatus>
                    ))}
                    {ext.networkAccess ? <WorkspaceStatus data-tone="warn">需联网</WorkspaceStatus> : null}
                  </div>
                  <p>{ext.description || "标准 ai0 Cordis 隔离扩展模块。"}</p>
                  {ext.activationError ? <small role="alert" style={{ color: "var(--ai0-danger)" }}>{ext.activationError}</small> : null}
                  {ext.missingAssets?.length ? <small>缺少构建资源：{ext.missingAssets.join("、")}</small> : null}
                </div>

                <div className="ai0-entity-card__footer">
                  <div className="ai0-entity-card__actions">
                    <RippleButton
                      size="sm"
                      variant="secondary"
                      data-plugin-configure={ext.id}
                      onClick={() => setConfigTarget(ext)}
                    >
                      {renderConsoleIcon("sliders", 12)}
                      <span>配置{fieldCount > 0 ? ` (${fieldCount})` : ""}</span>
                    </RippleButton>
                    <RippleButton
                      size="sm"
                      variant="secondary"
                      data-plugin-details={ext.id}
                      onClick={() => setDetailsTarget(ext)}
                    >
                      {renderConsoleIcon("info", 12)}
                      <span>详情</span>
                    </RippleButton>
                    <RippleButton
                      size="sm"
                      variant="ghost"
                      data-plugin-reload={ext.id}
                      loading={pendingId === ext.id}
                      disabled={Boolean(pendingId)}
                      onClick={() => void handleReloadOne(ext)}
                    >
                      {renderConsoleIcon("refresh", 12)}
                      <span>重载</span>
                    </RippleButton>
                    {extPages.map((page) => (
                      <RippleButton
                        key={page.path}
                        size="sm"
                        variant="secondary"
                        onClick={() => ctx?.navigateConsole(page.path)}
                      >
                        {renderConsoleIcon("arrow-right", 12)}
                        <span>打开 {page.title}</span>
                      </RippleButton>
                    ))}
                  </div>
                  {!isBuiltin ? (
                    <RippleButton
                      size="sm"
                      variant="ghost"
                      ariaLabel={`卸载 ${ext.displayName}`}
                      data-plugin-uninstall={ext.id}
                      disabled={!canWrite}
                      onClick={() => {
                        setKeepConfigOnUninstall(true);
                        setUninstallTarget(ext);
                      }}
                    >
                      {renderConsoleIcon("trash", 13)}
                    </RippleButton>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Slide-over Drawers */}
      <PluginConfigDrawer extension={configTarget} onClose={() => setConfigTarget(null)} />
      <PluginDetailsDrawer extension={detailsTarget} onClose={() => setDetailsTarget(null)} />

      {/* Install External Plugin Modal */}
      <Dialog open={installOpen} onClose={() => !installing && setInstallOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>安装外部扩展（落盘至宿主机 user-plugins/）</DialogTitle>
        <DialogContent>
          <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
            <div className="ai0-workspace-actions">
              <RippleButton
                size="sm"
                variant={installMode === "local_path" ? "primary" : "secondary"}
                onClick={() => setInstallMode("local_path")}
              >
                本地目录导入
              </RippleButton>
              <RippleButton
                size="sm"
                variant={installMode === "manifest_bundle" ? "primary" : "secondary"}
                data-install-mode-manifest="true"
                onClick={() => setInstallMode("manifest_bundle")}
              >
                粘贴 ai0.extension.json 清单
              </RippleButton>
            </div>

            {installMode === "local_path" ? (
              <WorkspaceField>
                <label>本地扩展目录绝对路径（须包含 ai0.extension.json）</label>
                <CompactInput
                  ariaLabel="本地扩展目录路径"
                  value={localPathInput}
                  placeholder="例如：C:/plugins/my-custom-organ"
                  onInput={setLocalPathInput}
                />
                <small>安装时将严格校验清单契约，且禁止覆盖官方内置扩展。</small>
              </WorkspaceField>
            ) : (
              <WorkspaceField>
                <label>标准声明式清单 JSON (ai0.extension.json)</label>
                <CompactInput
                  multiline
                  rows={12}
                  ariaLabel="扩展清单 JSON"
                  value={manifestJsonInput}
                  onInput={setManifestJsonInput}
                />
              </WorkspaceField>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <RippleButton variant="ghost" disabled={installing} onClick={() => setInstallOpen(false)}>取消</RippleButton>
          <RippleButton
            variant="primary"
            data-confirm-install-plugin="true"
            loading={installing}
            onClick={() => void handleInstallSubmit()}
          >
            {renderConsoleIcon("download", 13)}
            <span>确认安装并挂载</span>
          </RippleButton>
        </DialogActions>
      </Dialog>

      {/* Uninstall Confirmation Dialog */}
      <Dialog open={Boolean(uninstallTarget)} onClose={() => !uninstalling && setUninstallTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>卸载外部扩展「{uninstallTarget?.displayName}」</DialogTitle>
        <DialogContent>
          <div className="ai0-workspace-stack" style={{ paddingTop: 4 }}>
            <small>卸载将立即注销该扩展的 Cordis 运行作用域并删除 <code>user-plugins/</code> 对应目录。</small>
            <JellySwitch
              label="保留已保存的插件配置（下次重装可直接复用）"
              checked={keepConfigOnUninstall}
              onChange={setKeepConfigOnUninstall}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <RippleButton variant="ghost" disabled={uninstalling} onClick={() => setUninstallTarget(null)}>取消</RippleButton>
          <RippleButton
            variant="danger"
            data-confirm-uninstall-plugin="true"
            loading={uninstalling}
            onClick={() => void handleUninstallConfirm()}
          >
            确认卸载
          </RippleButton>
        </DialogActions>
      </Dialog>
    </WorkspacePage>
  );
}
