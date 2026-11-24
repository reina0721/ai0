import type { PluginConfigField } from "@ai0/protocol";
import Drawer from "@mui/material/Drawer";
import { useEffect, useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import type { LiveExtensionSnapshot } from "../../live-snapshot.js";
import {
  WorkspaceField,
  WorkspaceItem,
  WorkspaceRow,
  WorkspaceStatus,
  WorkspaceTag
} from "../workspace-layout.js";

function buildDefaults(fields: readonly PluginConfigField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) {
      out[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
    } else if (field.type === "bool") {
      out[field.key] = false;
    } else if (field.type === "int" || field.type === "float") {
      out[field.key] = field.min ?? 0;
    } else if (field.type === "list") {
      out[field.key] = [];
    } else {
      out[field.key] = "";
    }
  }
  return out;
}

export function PluginConfigDrawer(props: {
  extension: LiveExtensionSnapshot | null;
  onClose: () => void;
}): ReactElement {
  const ctx = useConsole();
  const ext = props.extension;
  const canWrite = Boolean(ctx?.ownerToken);
  const fields = ext?.configFields ?? [];

  const [mode, setMode] = useState<"form" | "json">("form");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState("{}");
  const [rev, setRev] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ext) return;
    const initial = { ...buildDefaults(ext.configFields ?? []), ...(ext.currentConfig ?? {}) };
    setValues(initial);
    setJsonText(JSON.stringify(initial, null, 2));
    setRev(ext.rev);
    setMode((ext.configFields?.length ?? 0) > 0 ? "form" : "json");

    if (!ctx?.ownerToken) return;
    let active = true;
    setLoading(true);
    void ctx
      .getAdmin<{ rev: number; config: Record<string, unknown> }>(
        `extensions/${encodeURIComponent(ext.id)}/config`
      )
      .then((res) => {
        if (!active) return;
        const merged = { ...buildDefaults(ext.configFields ?? []), ...(res.config ?? {}) };
        setValues(merged);
        setJsonText(JSON.stringify(merged, null, 2));
        setRev(res.rev);
      })
      .catch(() => {
        // Fallback silently to snapshot config
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ext?.id]);

  const switchMode = (nextMode: "form" | "json") => {
    if (nextMode === "json") {
      setJsonText(JSON.stringify(values, null, 2));
      setMode("json");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText.trim() || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("配置 JSON 必须是对象");
      }
      setValues(parsed as Record<string, unknown>);
      setMode("form");
    } catch (err) {
      ctx?.showToast(`JSON 语法错误，无法切回表单：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const updateField = (key: string, val: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      setJsonText(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const handleResetDefaults = () => {
    const defaults = buildDefaults(fields);
    setValues(defaults);
    setJsonText(JSON.stringify(defaults, null, 2));
  };

  const handleSave = async () => {
    if (!ctx || !ext || saving) return;
    let payload: Record<string, unknown> = values;
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonText.trim() || "{}") as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("配置 JSON 必须是对象");
        }
        payload = parsed as Record<string, unknown>;
      } catch (err) {
        ctx.showToast(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    setSaving(true);
    try {
      const res = await ctx.putAdmin<{ rev: number }>(
        `extensions/${encodeURIComponent(ext.id)}/config`,
        { config: payload, expected_rev: rev }
      );
      setRev(res.rev);
      await ctx.refreshSnapshot();
      ctx.showToast(`已保存「${ext.displayName ?? ext.id}」配置并完成热重载 (rev ${res.rev})`);
      props.onClose();
    } catch (err) {
      ctx.showToast(`保存配置失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(ext)}
      onClose={() => !saving && props.onClose()}
      slotProps={{ paper: { className: "ai0-drawer-surface", "data-plugin-config-drawer": ext?.id ?? "" } as Record<string, unknown> }}
    >
      <header className="ai0-drawer-header">
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>插件配置 · {ext?.displayName ?? ext?.id}</h2>
          <small><code>{ext?.id}</code> · 运行版本 rev {rev} · 保存后自动落盘并热重载</small>
        </div>
        <div className="ai0-workspace-actions">
          <RippleButton
            size="sm"
            variant={mode === "form" ? "primary" : "secondary"}
            data-config-mode-form="true"
            disabled={fields.length === 0}
            onClick={() => switchMode("form")}
          >
            表单模式
          </RippleButton>
          <RippleButton
            size="sm"
            variant={mode === "json" ? "primary" : "secondary"}
            data-config-mode-json="true"
            onClick={() => switchMode("json")}
          >
            JSON 源码
          </RippleButton>
          <RippleButton size="sm" variant="ghost" ariaLabel="关闭插件配置抽屉" onClick={props.onClose}>
            {renderConsoleIcon("close", 15)}
          </RippleButton>
        </div>
      </header>

      <div className="ai0-drawer-body">
        {loading ? <small>正在加载最新运行配置…</small> : null}

        {mode === "form" && fields.length > 0 ? (
          <div className="ai0-workspace-stack">
            {fields.map((field) => {
              const currentVal = values[field.key] ?? field.default;
              if (field.type === "bool") {
                return (
                  <WorkspaceItem key={field.key}>
                    <JellySwitch
                      label={field.label}
                      checked={Boolean(currentVal)}
                      disabled={!canWrite}
                      onChange={(checked) => updateField(field.key, checked)}
                    />
                    {field.hint ? <small>{field.hint}</small> : null}
                  </WorkspaceItem>
                );
              }
              if (field.type === "select" && field.options?.length) {
                return (
                  <WorkspaceField key={field.key}>
                    <span>{field.label}</span>
                    <CompactSelect
                      ariaLabel={field.label}
                      value={String(currentVal ?? field.options[0]!.value)}
                      disabled={!canWrite}
                      options={field.options}
                      onChange={(val) => updateField(field.key, val)}
                    />
                    {field.hint ? <small>{field.hint}</small> : null}
                  </WorkspaceField>
                );
              }
              if (field.type === "list") {
                const listStr = Array.isArray(currentVal)
                  ? currentVal.map(String).join(", ")
                  : String(currentVal ?? "");
                return (
                  <WorkspaceField key={field.key}>
                    <label>{field.label}（逗号分隔）</label>
                    <CompactInput
                      ariaLabel={field.label}
                      value={listStr}
                      disabled={!canWrite}
                      onInput={(raw) =>
                        updateField(
                          field.key,
                          raw
                            .split(/[,\n，]+/u)
                            .map((s) => s.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                    {field.hint ? <small>{field.hint}</small> : null}
                  </WorkspaceField>
                );
              }
              if (field.type === "text") {
                return (
                  <WorkspaceField key={field.key}>
                    <label>{field.label}</label>
                    <CompactInput
                      multiline
                      rows={4}
                      ariaLabel={field.label}
                      value={String(currentVal ?? "")}
                      disabled={!canWrite}
                      onInput={(raw) => updateField(field.key, raw)}
                    />
                    {field.hint ? <small>{field.hint}</small> : null}
                  </WorkspaceField>
                );
              }
              return (
                <WorkspaceField key={field.key}>
                  <label>{field.label}</label>
                  <CompactInput
                    type={
                      field.type === "secret"
                        ? "password"
                        : field.type === "int" || field.type === "float"
                          ? "number"
                          : "text"
                    }
                    ariaLabel={field.label}
                    value={String(currentVal ?? "")}
                    disabled={!canWrite}
                    onInput={(raw) => {
                      if (field.type === "int") {
                        const parsed = Number.parseInt(raw, 10);
                        updateField(field.key, Number.isFinite(parsed) ? parsed : 0);
                      } else if (field.type === "float") {
                        const parsed = Number.parseFloat(raw);
                        updateField(field.key, Number.isFinite(parsed) ? parsed : 0);
                      } else {
                        updateField(field.key, raw);
                      }
                    }}
                  />
                  {field.hint ? <small>{field.hint}</small> : null}
                </WorkspaceField>
              );
            })}
          </div>
        ) : (
          <WorkspaceField>
            <label>运行配置 JSON（持久化至 .soul/config/extensions_state.json）</label>
            <CompactInput
              multiline
              rows={14}
              ariaLabel="插件配置 JSON"
              value={jsonText}
              disabled={!canWrite}
              onInput={setJsonText}
            />
            {fields.length === 0 ? (
              <small>该扩展未声明 config_fields 表单字段，您可以直接编辑透传给 activate() 的 JSON 配置对象。</small>
            ) : null}
          </WorkspaceField>
        )}
      </div>

      <footer className="ai0-drawer-footer">
        <RippleButton size="sm" variant="ghost" disabled={!canWrite || fields.length === 0} onClick={handleResetDefaults}>
          恢复默认值
        </RippleButton>
        <div className="ai0-workspace-actions">
          <RippleButton size="sm" variant="ghost" disabled={saving} onClick={props.onClose}>取消</RippleButton>
          <RippleButton
            size="sm"
            variant="primary"
            data-save-plugin-config="true"
            loading={saving}
            disabled={!canWrite}
            onClick={() => void handleSave()}
          >
            {renderConsoleIcon("save", 13)}
            <span>保存并热重载</span>
          </RippleButton>
        </div>
      </footer>
    </Drawer>
  );
}

export function PluginDetailsDrawer(props: {
  extension: LiveExtensionSnapshot | null;
  onClose: () => void;
}): ReactElement {
  const ext = props.extension;
  return (
    <Drawer
      anchor="right"
      open={Boolean(ext)}
      onClose={props.onClose}
      slotProps={{ paper: { className: "ai0-drawer-surface", "data-plugin-details-drawer": ext?.id ?? "" } as Record<string, unknown> }}
    >
      <header className="ai0-drawer-header">
        <div>
          <h2 style={{ margin: 0 }}>详情与权限审计 · {ext?.displayName ?? ext?.id}</h2>
          <small><code>{ext?.id}</code> · v{ext?.version ?? "1.0.0"}</small>
        </div>
        <RippleButton size="sm" variant="ghost" ariaLabel="关闭详情抽屉" onClick={props.onClose}>
          {renderConsoleIcon("close", 15)}
        </RippleButton>
      </header>
      <div className="ai0-drawer-body">
        {ext ? (
          <>
            <WorkspaceItem>
              <strong>基础元数据</strong>
              <WorkspaceRow><small>作者</small><span>{ext.author ?? "ai0-community"}</span></WorkspaceRow>
              <WorkspaceRow><small>安装来源</small><WorkspaceTag>{ext.origin === "builtin" ? "官方内置 (只读保护)" : ext.origin === "soul" ? "灵魂实例目录" : "用户外部扩展 (user-plugins)"}</WorkspaceTag></WorkspaceRow>
              <WorkspaceRow><small>载体形态</small><code>{ext.carrier}</code></WorkspaceRow>
              <WorkspaceRow><small>挂载总线</small><div className="ai0-entity-card__badges">{ext.buses.map((b) => <WorkspaceTag key={b}>{b}</WorkspaceTag>)}</div></WorkspaceRow>
              <WorkspaceRow><small>运行代际 / 配置版本</small><code>rev {ext.rev} · {ext.generation ?? "未激活"}</code></WorkspaceRow>
            </WorkspaceItem>

            {ext.description ? (
              <WorkspaceItem>
                <strong>扩展说明</strong>
                <p style={{ fontSize: 12.5 }}>{ext.description}</p>
              </WorkspaceItem>
            ) : null}

            <WorkspaceItem>
              <strong>黑板权限与安全边界（零后门隔离）</strong>
              <WorkspaceRow>
                <small>可读状态域 (Read)</small>
                <div className="ai0-entity-card__badges">
                  {ext.readDomains.length
                    ? ext.readDomains.map((d) => <WorkspaceStatus key={d} data-tone="info">{d}</WorkspaceStatus>)
                    : <small>无</small>}
                </div>
              </WorkspaceRow>
              <WorkspaceRow>
                <small>可提议变更域 (Propose)</small>
                <div className="ai0-entity-card__badges">
                  {ext.proposeDomains.length
                    ? ext.proposeDomains.map((d) => <WorkspaceStatus key={d} data-tone="warn">{d}</WorkspaceStatus>)
                    : <WorkspaceStatus data-tone="live">纯只读 (无写提议)</WorkspaceStatus>}
                </div>
              </WorkspaceRow>
              <WorkspaceRow>
                <small>最大受众范围</small>
                <WorkspaceTag>{ext.maxAudienceScope ?? "only_owner"}</WorkspaceTag>
              </WorkspaceRow>
              <WorkspaceRow>
                <small>外部网络访问权限</small>
                <WorkspaceStatus data-tone={ext.networkAccess ? "warn" : "live"}>
                  {ext.networkAccess ? "允许联网请求" : "禁止外部网络"}
                </WorkspaceStatus>
              </WorkspaceRow>
            </WorkspaceItem>

            <WorkspaceItem>
              <strong>控制台 UI 贡献</strong>
              <WorkspaceRow>
                <small>注册页面</small>
                <span>{ext.pages?.length ? ext.pages.map((p) => `${p.title} (${p.path})`).join("、") : "无"}</span>
              </WorkspaceRow>
              <WorkspaceRow>
                <small>UI 槽位</small>
                <span>{ext.uiSlots?.length ? ext.uiSlots.map((s) => `${s.title} @ ${s.slot_target}`).join("、") : "无"}</span>
              </WorkspaceRow>
            </WorkspaceItem>

            {ext.activationError ? (
              <WorkspaceItem className="ai0-workspace-inset">
                <strong>激活异常诊断</strong>
                <pre className="ai0-workspace-code">{ext.activationError}</pre>
              </WorkspaceItem>
            ) : null}
          </>
        ) : null}
      </div>
      <footer className="ai0-drawer-footer">
        <small>所有插件均受 Cordis 隔离作用域与权限白名单约束。</small>
        <RippleButton size="sm" variant="secondary" onClick={props.onClose}>关闭</RippleButton>
      </footer>
    </Drawer>
  );
}
