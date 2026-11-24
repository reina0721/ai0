import type { McpServerConfig, McpTransport } from "@ai0/protocol";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../../live-snapshot.js";
import {
  WorkspaceField,
  WorkspaceGrid,
  WorkspacePage,
  WorkspaceRow,
  WorkspaceStatus,
  WorkspaceTag
} from "../workspace-layout.js";
import { WorkspaceConfirm, WorkspaceHeader } from "../workspace.js";

const SAMPLE_MCP_JSON = JSON.stringify(
  {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      },
      remote_search: {
        transport: "streamable_http",
        url: "http://127.0.0.1:8787/mcp",
        headers: { Authorization: "Bearer your-token" }
      }
    }
  },
  null,
  2
);

const RISK_META = {
  read_only_safe: { label: "只读安全", tone: "live" as const },
  needs_owner_confirm: { label: "需主人确认", tone: "warn" as const },
  high_risk: { label: "高危操作", tone: "danger" as const }
};

export function McpServersTab(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const servers = snap?.infrastructure?.mcpServers ?? [];
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  const [query, setQuery] = useState("");
  const [probingId, setProbingId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  // Add / Edit Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("-y @modelcontextprotocol/server-filesystem .");
  const [envJson, setEnvJson] = useState("{}");
  const [url, setUrl] = useState("");
  const [headersJson, setHeadersJson] = useState("{}");
  const [timeoutMs, setTimeoutMs] = useState("15000");
  const [saving, setSaving] = useState(false);

  // AstrBot / Claude Desktop JSON Import Modal
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState(SAMPLE_MCP_JSON);
  const [importing, setImporting] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  const totalTools = servers.reduce((sum, s) => sum + s.discoveredTools.length, 0);
  const enabledCount = servers.filter((s) => s.enabled).length;

  const filtered = servers.filter((srv) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      srv.name.toLowerCase().includes(q) ||
      srv.id.toLowerCase().includes(q) ||
      srv.command.toLowerCase().includes(q) ||
      srv.url.toLowerCase().includes(q) ||
      srv.discoveredTools.some((t) => t.name.toLowerCase().includes(q))
    );
  });

  const openNewDialog = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setTransport("stdio");
    setCommand("npx");
    setArgsText("-y @modelcontextprotocol/server-filesystem .");
    setEnvJson("{}");
    setUrl("");
    setHeadersJson("{}");
    setTimeoutMs("15000");
    setEditorOpen(true);
  };

  const openEditDialog = (srv: McpServerConfig) => {
    setEditingId(srv.id);
    setName(srv.name);
    setDescription(srv.description);
    setTransport(srv.transport);
    setCommand(srv.command);
    setArgsText(srv.args.join(" "));
    setEnvJson(JSON.stringify(srv.env ?? {}, null, 2));
    setUrl(srv.url);
    setHeadersJson(JSON.stringify(srv.headers ?? {}, null, 2));
    setTimeoutMs(String(srv.timeoutMs));
    setEditorOpen(true);
  };

  const handleSaveServer = async () => {
    if (!ctx || !canWrite || saving) return;
    if (!name.trim()) {
      ctx.showToast("请填写 MCP 服务器名称");
      return;
    }
    let env: Record<string, string> = {};
    let headers: Record<string, string> = {};
    try {
      env = JSON.parse(envJson.trim() || "{}") as Record<string, string>;
      headers = JSON.parse(headersJson.trim() || "{}") as Record<string, string>;
    } catch (err) {
      ctx.showToast(`JSON 格式错误：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim(),
      transport,
      command: transport === "stdio" ? command.trim() : "",
      args: transport === "stdio" ? argsText.trim().split(/\s+/u).filter(Boolean) : [],
      env,
      url: transport === "stdio" ? "" : url.trim(),
      headers,
      timeoutMs: Math.max(1000, Number(timeoutMs) || 15000),
      enabled: true
    };

    setSaving(true);
    try {
      if (editingId) {
        await ctx.patchAdmin(`extensions/mcp/${encodeURIComponent(editingId)}`, payload, "live");
      } else {
        await ctx.postAdmin("extensions/mcp", payload, "live");
      }
      setEditorOpen(false);
      await ctx.refreshSnapshot();
      ctx.showToast(`已保存 MCP 服务器「${name.trim()}」`);
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImportJson = async () => {
    if (!ctx || !canWrite || importing) return;
    setImporting(true);
    try {
      const parsed = JSON.parse(importJson) as Record<string, unknown>;
      const res = await ctx.postAdmin<{ imported: McpServerConfig[] }>(
        "extensions/mcp/import-json",
        { json: parsed },
        "live"
      );
      setImportOpen(false);
      await ctx.refreshSnapshot();
      ctx.showToast(`成功导入 ${res.imported.length} 个 MCP 服务器配置`);
    } catch (err) {
      ctx.showToast(`JSON 导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleToggle = async (srv: McpServerConfig, enabled: boolean) => {
    if (!ctx || !canWrite || busyId) return;
    setBusyId(srv.id);
    try {
      await ctx.patchAdmin(`extensions/mcp/${encodeURIComponent(srv.id)}`, { enabled }, "live");
      await ctx.refreshSnapshot();
    } catch (err) {
      ctx.showToast(`切换失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(undefined);
    }
  };

  const handleProbe = async (srv: McpServerConfig) => {
    if (!ctx || probingId) return;
    setProbingId(srv.id);
    try {
      const res = await ctx.postAdmin<{ ok: boolean; detail: string }>(
        `extensions/mcp/${encodeURIComponent(srv.id)}/probe`,
        {},
        "live"
      );
      await ctx.refreshSnapshot();
      ctx.showToast(res.detail);
    } catch (err) {
      ctx.showToast(`探测失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProbingId(undefined);
    }
  };

  const handleDelete = async () => {
    if (!ctx || !canWrite || !deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await ctx.deleteAdmin(`extensions/mcp/${encodeURIComponent(deleteTarget.id)}`, "live");
      setDeleteTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已删除 MCP 服务器「${deleteTarget.name}」`);
    } catch (err) {
      ctx.showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <WorkspacePage data-mcp-page="true">
      <WorkspaceHeader title="MCP 服务">
        <RippleButton
          size="sm"
          variant="secondary"
          data-open-mcp-import="true"
          disabled={!canWrite}
          onClick={() => setImportOpen(true)}
        >
          {renderConsoleIcon("code", 13)}
          <span>JSON 粘贴导入</span>
        </RippleButton>
        <RippleButton
          variant="primary"
          data-add-mcp-server="true"
          disabled={!canWrite}
          onClick={openNewDialog}
        >
          {renderConsoleIcon("plus", 14)}
          <span>新增 MCP 服务器</span>
        </RippleButton>
      </WorkspaceHeader>

      <div className="ai0-stat-strip">
        <div className="ai0-stat-tile">
          <small>已配置 MCP 服务器</small>
          <strong>{servers.length}</strong>
        </div>
        <div className="ai0-stat-tile">
          <small>运行 / 启用中</small>
          <strong>{enabledCount}</strong>
        </div>
        <div className="ai0-stat-tile">
          <small>已发现可用工具总数</small>
          <strong>{totalTools}</strong>
        </div>
      </div>

      <div className="ai0-filter-bar">
        <div className="ai0-filter-bar__search">
          <CompactInput
            type="search"
            ariaLabel="过滤 MCP 服务器或工具"
            value={query}
            placeholder="搜索 MCP 名称、命令、URL 或工具名…"
            onInput={setQuery}
          />
        </div>
      </div>

      {!filtered.length ? (
        <small>暂无 MCP 服务器配置，可点击「JSON 粘贴导入」直接粘贴 Claude Desktop / AstrBot 格式配置。</small>
      ) : (
        <div className="ai0-card-grid">
          {filtered.map((srv) => {
            const statusTone = srv.status === "connected" ? "live" : srv.status === "error" ? "danger" : "warn";
            const statusLabel =
              srv.status === "connected"
                ? `已连通${srv.lastLatencyMs ? ` ${srv.lastLatencyMs}ms` : ""}`
                : srv.status === "error"
                  ? "探测失败"
                  : "未探测";
            const endpointSummary =
              srv.transport === "stdio"
                ? `${srv.command} ${srv.args.join(" ")}`.trim()
                : srv.url;

            return (
              <article
                key={srv.id}
                className="ai0-entity-card"
                data-mcp-card={srv.id}
                data-disabled={!srv.enabled}
              >
                <div className="ai0-entity-card__header">
                  <div className="ai0-entity-card__title">
                    <div className="ai0-entity-card__title-row">
                      <strong>{srv.name}</strong>
                      <WorkspaceTag>{srv.transport}</WorkspaceTag>
                      <WorkspaceStatus data-tone={statusTone}>{statusLabel}</WorkspaceStatus>
                    </div>
                    <small><code>{endpointSummary || "未填写端点"}</code></small>
                  </div>
                  <JellySwitch
                    ariaLabel={`启用 MCP ${srv.name}`}
                    checked={srv.enabled}
                    disabled={!canWrite || busyId === srv.id}
                    onChange={(enabled) => void handleToggle(srv, enabled)}
                  />
                </div>

                <div className="ai0-entity-card__body">
                  {srv.description ? <p>{srv.description}</p> : null}
                  {srv.lastError ? <small style={{ color: "var(--ai0-danger)" }}>{srv.lastError}</small> : null}

                  <div className="ai0-workspace-stack" style={{ gap: 5 }}>
                    <small>已发现工具 ({srv.discoveredTools.length})：</small>
                    {srv.discoveredTools.length > 0 ? (
                      srv.discoveredTools.slice(0, 6).map((tool) => {
                        const risk = RISK_META[tool.risk] ?? RISK_META.read_only_safe;
                        return (
                          <WorkspaceRow key={tool.name}>
                            <div style={{ minWidth: 0 }}>
                              <code>{tool.name}</code>
                              {tool.description ? <small> · {tool.description.slice(0, 48)}</small> : null}
                            </div>
                            <WorkspaceStatus data-tone={risk.tone}>{risk.label}</WorkspaceStatus>
                          </WorkspaceRow>
                        );
                      })
                    ) : (
                      <small>点击下方「探测工具」发起实时 JSON-RPC `tools/list` 握手。</small>
                    )}
                  </div>
                </div>

                <div className="ai0-entity-card__footer">
                  <div className="ai0-entity-card__actions">
                    <RippleButton
                      size="sm"
                      variant="secondary"
                      data-probe-mcp={srv.id}
                      loading={probingId === srv.id}
                      disabled={Boolean(probingId)}
                      onClick={() => void handleProbe(srv)}
                    >
                      {renderConsoleIcon("zap", 12)}
                      <span>探测工具</span>
                    </RippleButton>
                    <RippleButton
                      size="sm"
                      variant="secondary"
                      disabled={!canWrite}
                      onClick={() => openEditDialog(srv)}
                    >
                      {renderConsoleIcon("sliders", 12)}
                      <span>编辑</span>
                    </RippleButton>
                  </div>
                  <RippleButton
                    size="sm"
                    variant="ghost"
                    ariaLabel={`删除 MCP ${srv.name}`}
                    data-delete-mcp={srv.id}
                    disabled={!canWrite}
                    onClick={() => setDeleteTarget(srv)}
                  >
                    {renderConsoleIcon("trash", 13)}
                  </RippleButton>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add / Edit MCP Server Dialog */}
      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingId ? "编辑 MCP 服务器" : "新增 MCP 服务器"}</DialogTitle>
        <DialogContent>
          <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
            <WorkspaceGrid columns={2}>
              <WorkspaceField>
                <label>服务器名称</label>
                <CompactInput ariaLabel="MCP 服务器名称" value={name} placeholder="例如：github / filesystem" onInput={setName} />
              </WorkspaceField>
              <WorkspaceField>
                <span>传输协议</span>
                <CompactSelect
                  ariaLabel="MCP 传输协议"
                  value={transport}
                  onChange={(v) => setTransport(v as McpTransport)}
                  options={[
                    { value: "stdio", label: "stdio（本地子进程）" },
                    { value: "streamable_http", label: "Streamable HTTP（推荐远端）" },
                    { value: "sse", label: "SSE（Server-Sent Events）" }
                  ]}
                />
              </WorkspaceField>
            </WorkspaceGrid>
            <WorkspaceField>
              <label>用途简介</label>
              <CompactInput ariaLabel="MCP 简介" value={description} placeholder="简述该 MCP 提供的外部工具能力" onInput={setDescription} />
            </WorkspaceField>
            {transport === "stdio" ? (
              <>
                <WorkspaceGrid columns={2}>
                  <WorkspaceField>
                    <label>可执行命令 (Command)</label>
                    <CompactInput ariaLabel="MCP Command" value={command} placeholder="npx / uvx / node" onInput={setCommand} />
                  </WorkspaceField>
                  <WorkspaceField>
                    <label>超时时间 (ms)</label>
                    <CompactInput type="number" ariaLabel="MCP 超时" value={timeoutMs} onInput={setTimeoutMs} />
                  </WorkspaceField>
                </WorkspaceGrid>
                <WorkspaceField>
                  <label>命令行参数 (Args，空格分隔)</label>
                  <CompactInput ariaLabel="MCP Args" value={argsText} placeholder="-y @modelcontextprotocol/server-filesystem ." onInput={setArgsText} />
                </WorkspaceField>
                <WorkspaceField>
                  <label>环境变量 JSON（支持 $ENV_VAR 动态引用）</label>
                  <CompactInput multiline rows={3} ariaLabel="MCP Env JSON" value={envJson} onInput={setEnvJson} />
                </WorkspaceField>
              </>
            ) : (
              <>
                <WorkspaceField>
                  <label>远端端点 URL</label>
                  <CompactInput type="url" ariaLabel="MCP Endpoint URL" value={url} placeholder="http://127.0.0.1:8787/mcp" onInput={setUrl} />
                </WorkspaceField>
                <WorkspaceField>
                  <label>自定义 HTTP 请求头 (Headers JSON)</label>
                  <CompactInput multiline rows={3} ariaLabel="MCP Headers JSON" value={headersJson} onInput={setHeadersJson} />
                </WorkspaceField>
              </>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <RippleButton variant="ghost" disabled={saving} onClick={() => setEditorOpen(false)}>取消</RippleButton>
          <RippleButton variant="primary" data-confirm-save-mcp="true" loading={saving} onClick={() => void handleSaveServer()}>
            {renderConsoleIcon("save", 13)}
            <span>保存服务器</span>
          </RippleButton>
        </DialogActions>
      </Dialog>

      {/* JSON Paste Import Dialog */}
      <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>从 JSON 批量导入 MCP 服务器（兼容 AstrBot / Claude Desktop）</DialogTitle>
        <DialogContent>
          <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
            <small>直接粘贴包含 <code>mcpServers</code> 对象的 JSON，自动识别 stdio / sse / streamable_http 协议。</small>
            <CompactInput
              multiline
              rows={12}
              ariaLabel="MCP JSON 配置"
              value={importJson}
              onInput={setImportJson}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <RippleButton variant="ghost" disabled={importing} onClick={() => setImportOpen(false)}>取消</RippleButton>
          <RippleButton variant="primary" data-confirm-import-mcp="true" loading={importing} onClick={() => void handleImportJson()}>
            {renderConsoleIcon("download", 13)}
            <span>解析并导入</span>
          </RippleButton>
        </DialogActions>
      </Dialog>

      {deleteTarget ? (
        <WorkspaceConfirm
          title={`删除 MCP 服务器「${deleteTarget.name}」`}
          description="删除后该服务器暴露的工具将不再参与 W2 工具规划调度。"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </WorkspacePage>
  );
}
