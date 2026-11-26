import { FACET_LABELS } from "./facet-labels.js";
import type { ExtensionMarketEntry } from "@ai0/protocol";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import {
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus,
  WorkspaceTag
} from "../workspace-layout.js";
import { WorkspaceHeader } from "../workspace.js";


export function ExtensionMarketTab(): ReactElement {
  const ctx = useConsole();
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  const [entries, setEntries] = useState<ExtensionMarketEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [facetFilter, setFacetFilter] = useState("all");
  const [registryUrl, setRegistryUrl] = useState("");
  const [showRegistry, setShowRegistry] = useState(false);
  const [installingId, setInstallingId] = useState<string>();

  const loadMarket = async (customUrl = registryUrl) => {
    if (!ctx?.ownerToken) return;
    setLoading(true);
    setError(null);
    try {
      const qs = customUrl.trim() ? `?registry_url=${encodeURIComponent(customUrl.trim())}` : "";
      const res = await ctx.getAdmin<{ entries: ExtensionMarketEntry[] }>(`extensions/market${qs}`);
      setEntries(res.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMarket("");
  }, [ctx?.ownerToken]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((item) => {
      if (facetFilter !== "all" && !item.facets.includes(facetFilter)) return false;
      if (!q) return true;
      return (
        item.displayName.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, query, facetFilter]);

  const handleInstall = async (entry: ExtensionMarketEntry) => {
    if (!ctx || !canWrite || installingId) return;
    setInstallingId(entry.id);
    try {
      await ctx.postAdmin(
        "extensions/install",
        {
          source: "market",
          marketEntryId: entry.id,
          ...(registryUrl.trim() ? { registryUrl: registryUrl.trim() } : {})
        },
        "live"
      );
      await ctx.refreshSnapshot();
      await loadMarket(registryUrl);
      ctx.showToast(`已从扩展市场安装「${entry.displayName}」`);
    } catch (err) {
      ctx.showToast(`安装失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstallingId(undefined);
    }
  };

  return (
    <WorkspacePage data-extension-market-page="true">
      <WorkspaceHeader title="扩展市场">
        <RippleButton size="sm" variant="secondary" onClick={() => setShowRegistry((v) => !v)}>
          {renderConsoleIcon("globe", 13)}
          <span>自定义市场源</span>
        </RippleButton>
        <RippleButton size="sm" variant="secondary" loading={loading} onClick={() => void loadMarket(registryUrl)}>
          {renderConsoleIcon("refresh", 13)}
          <span>刷新目录</span>
        </RippleButton>
      </WorkspaceHeader>

      {showRegistry ? (
        <WorkspaceSection>
          <WorkspaceRow>
            <div style={{ flex: 1, minWidth: 220 }}>
              <CompactInput
                type="url"
                ariaLabel="自定义扩展市场 Registry URL"
                value={registryUrl}
                placeholder="输入兼容 ai0 ExtensionMarketEntry[] 的 JSON 索引 URL…"
                onInput={setRegistryUrl}
              />
            </div>
            <RippleButton size="sm" variant="primary" loading={loading} onClick={() => void loadMarket(registryUrl)}>
              拉取自定义源
            </RippleButton>
          </WorkspaceRow>
          <small>自定义源将与内置官方精选目录合并，安装前仍强制经过零后门权限契约校验。</small>
        </WorkspaceSection>
      ) : null}

      <div className="ai0-filter-bar">
        <div className="ai0-filter-bar__search">
          <CompactInput
            type="search"
            ariaLabel="搜索扩展市场"
            value={query}
            placeholder="搜索扩展名称、功能关键词或标签…"
            onInput={setQuery}
          />
        </div>
        <div style={{ minWidth: 160 }}>
          <CompactSelect
            ariaLabel="按扩展能力筛选市场"
            value={facetFilter}
            onChange={setFacetFilter}
            options={[
              { value: "all", label: "全部扩展分类" },
              ...Object.entries(FACET_LABELS).map(([value, label]) => ({ value, label }))
            ]}
          />
        </div>
      </div>

      {error ? <small role="alert">加载扩展市场失败：{error}</small> : null}

      <div className="ai0-card-grid">
        {filtered.map((entry) => (
          <article key={entry.id} className="ai0-entity-card" data-market-card={entry.id}>
            <div className="ai0-entity-card__header">
              <div className="ai0-entity-card__title">
                <div className="ai0-entity-card__title-row">
                  <strong>{entry.displayName}</strong>
                  {entry.installed ? <WorkspaceStatus data-tone="live">已安装</WorkspaceStatus> : null}
                </div>
                <small>
                  <code>{entry.id}</code> · v{entry.version} · by {entry.author}
                </small>
              </div>
            </div>

            <div className="ai0-entity-card__body">
              <div className="ai0-entity-card__badges">
                {entry.facets.map(facet => <WorkspaceStatus key={facet} data-tone="info">{FACET_LABELS[facet] ?? facet}</WorkspaceStatus>)}
                <WorkspaceStatus data-tone={entry.permissions.network_access ? "warn" : "live"}>
                  {entry.permissions.network_access ? "需联网" : "零联网隔离"}
                </WorkspaceStatus>
                {entry.configFields.length > 0 ? (
                  <WorkspaceTag>{entry.configFields.length} 项可视化配置</WorkspaceTag>
                ) : null}
              </div>
              <p>{entry.description}</p>
              <div className="ai0-entity-card__badges">
                {entry.tags.map((tag) => (
                  <WorkspaceTag key={tag}>#{tag}</WorkspaceTag>
                ))}
              </div>
            </div>

            <div className="ai0-entity-card__footer">
              <small>受众上限：{entry.permissions.max_audience_scope}</small>
              {entry.installed ? (
                <RippleButton
                  size="sm"
                  variant="secondary"
                  onClick={() => ctx?.navigateConsole("/capabilities/extensions")}
                >
                  {renderConsoleIcon("check", 13)}
                  <span>前往管理</span>
                </RippleButton>
              ) : (
                <RippleButton
                  size="sm"
                  variant="primary"
                  data-market-install={entry.id}
                  loading={installingId === entry.id}
                  disabled={!canWrite || Boolean(installingId)}
                  onClick={() => void handleInstall(entry)}
                >
                  {renderConsoleIcon("download", 13)}
                  <span>一键安装</span>
                </RippleButton>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && !filtered.length ? <small>当前筛选下暂无市场扩展。</small> : null}
    </WorkspacePage>
  );
}
