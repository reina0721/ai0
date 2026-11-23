import { registeredPages } from "../router/plugin-pages.js";
import {
  WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceTable, WorkspaceTableBody, WorkspaceTableCell, WorkspaceTableHead, WorkspaceTableRow
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { CompactInput, CompactSelect, JellySwitch, RippleButton } from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState, LiveExtensionSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import {
  useAdminResource, useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader,
  WorkspaceReadState, WorkspaceSaveButton
} from "./workspace.js";

export interface Domain6ExtensionsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

type Ecosystem = ConsoleStudioState["ecosystem"];
type RuntimeExtension = LiveExtensionSnapshot & { config: Record<string, unknown> };

function RuntimeDetails({ extension }: { extension: LiveExtensionSnapshot }) {
  return (
    <WorkspaceItem>
      <WorkspaceRow>
        <strong>{extension.id}</strong>
        <small>{extension.carrier} · rev {extension.rev}</small>
      </WorkspaceRow>
      <small>{extension.buses.join(" · ")}</small>
      <small>读取：{extension.readDomains.join("、") || "—"} · 提议：{extension.proposeDomains.join("、") || "—"}</small>
    </WorkspaceItem>
  );
}

function ExtensionList({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const [filter, setFilter] = useState("");
  const plugins = snapshot?.studioConfig?.ecosystem.plugins ?? [];
  const runtime = snapshot?.extensions ?? [];
  const query = filter.trim().toLocaleLowerCase();
  const matches = (...parts: string[]) => parts.some((value) => value.toLocaleLowerCase().includes(query));
  const [pending, setPending] = useState<string>();
  const pages = registeredPages(snapshot);
  const ids = [...new Set([...runtime.map(item => item.id), ...plugins.map(item => item.id)])];
  const shown = ids.flatMap(id => {
    const extension = runtime.find(item => item.id === id);
    const config = plugins.find(item => item.id === id);
    const name = extension?.displayName ?? config?.name ?? id;
    return matches(name, id, ...(extension?.buses ?? [config?.bus ?? ""])) ? [{ id, name, extension, config }] : [];
  });
  async function toggle(id: string, enabled: boolean) {
    if (!ctx || pending) return;
    setPending(id);
    try {
      await ctx.postStudio("plugin-enabled", { id, enabled });
      await ctx.refreshSnapshot();
    } catch (error) {
      ctx.showToast("更新插件失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setPending(undefined);
    }
  }
  return (
    <WorkspacePage data-ecosystem-page="true">
      <WorkspaceHeader title="插件与扩展管理">
        <RippleButton onClick={() => ctx?.navigateConsole("/extensions/configurator")}>配置扩展</RippleButton>
      </WorkspaceHeader>
      <CompactInput ariaLabel="过滤扩展" value={filter} type="search" onInput={setFilter} placeholder="搜索名称、标识或总线" />
      <WorkspaceGrid columns={2}>
        {shown.map(({ id, name, extension, config }) => {
          const enabled = config?.enabled ?? extension?.enabled ?? false;
          const status = !extension ? "未发现插件文件" : extension.activationError ? "激活失败"
            : !enabled ? "已停用" : extension.enabled ? "运行中" : "未激活";
          return (
            <WorkspaceItem key={id} as="article" data-plugin-card={id}>
              <WorkspaceRow>
                <strong>{name}</strong><small>{status}</small>
                {extension && <JellySwitch checked={enabled} ariaLabel={"启用 " + name}
                  disabled={!ctx?.ownerToken || ctx.mode === "sandbox" || Boolean(pending)}
                  onChange={value => void toggle(id, value)} />}
              </WorkspaceRow>
              <small>{id} · v{extension?.version ?? config?.version} · {extension?.buses.join("、") ?? config?.bus}</small>
              {config?.description && <p>{config.description}</p>}
              {extension?.activationError && <p role="alert">{extension.activationError}</p>}
              {!!extension?.missingAssets?.length && <p>缺少资源：{extension.missingAssets.join("、")}</p>}
              {pages.filter(page => page.pluginId === id).map(page => (
                <RippleButton key={page.path} onClick={() => ctx?.navigateConsole(page.path)}>打开 {page.title}</RippleButton>
              ))}
            </WorkspaceItem>
          );
        })}
      </WorkspaceGrid>
      {!shown.length && <small>{query ? "没有匹配的插件。" : "未发现插件。"}</small>}
    </WorkspacePage>
  );
}

function Configurator({ ecosystem }: { ecosystem?: Ecosystem }) {
  const ctx = useConsole();
  const plugins = useWorkspaceDraft(ecosystem?.plugins ?? []);
  const commands = useWorkspaceDraft(ecosystem?.commands ?? []);
  const runtime = useAdminResource<{ extensions: RuntimeExtension[] }>("extensions");
  const [reloading, setReloading] = useState<string>();
  const form = useWorkspaceSave("extensions.configurator", plugins.dirty || commands.dirty,
    () => { plugins.discard(); commands.discard(); },
    async () => { await ctx?.postStudio("config", { ecosystem: { plugins: plugins.value, commands: commands.value } }); },
    "扩展存档配置已保存", () => { plugins.accept(); commands.accept(); });
  const setPlugin = (id: string, patch: Partial<Ecosystem["plugins"][number]>) =>
    plugins.setValue((current) => current.map((plugin) => plugin.id === id ? { ...plugin, ...patch } : plugin));
  const updateField = (plugin: Ecosystem["plugins"][number], key: string, value: string | number | boolean) =>
    setPlugin(plugin.id, { configFields: plugin.configFields.map((field) => field.key === key ? { ...field, value } : field) });

  const reload = async (plugin: Ecosystem["plugins"][number], mounted: RuntimeExtension) => {
    if (!ctx || reloading) return;
    setReloading(plugin.id);
    try {
      const values = Object.fromEntries(plugin.configFields.filter((field) => field.type !== "secret").map((field) => [field.key, field.value]));
      const reply = await ctx.postAdmin<{ rev: number }>(`extensions/${encodeURIComponent(plugin.id)}/hot-reload`, {
        config: { ...mounted.config, ...values }, expected_rev: mounted.rev
      });
      runtime.refresh();
      await ctx.refreshSnapshot();
      ctx.showToast(`已应用本实例的运行配置 · rev ${reply.rev}`);
    } catch (error) {
      runtime.refresh();
      ctx.showToast(`应用运行配置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReloading(undefined);
    }
  };

  return (
    <WorkspacePage>
      <WorkspaceHeader title="插件配置与指令"><WorkspaceSaveButton form={form} /></WorkspaceHeader>
      <WorkspaceSection>
        <h2>扩展字段</h2>
        {!plugins.value.length ? <small>当前没有可配置扩展。</small> : null}
        <WorkspaceGrid columns={2}>
          {plugins.value.map((plugin) => {
            const mounted = runtime.data?.extensions.find((extension) => extension.id === plugin.id);
            return (
              <WorkspaceItem key={plugin.id} as="article" data-plugin-card={plugin.id}>
                <WorkspaceRow>
                  <div><strong>{plugin.name}</strong><div><small>{plugin.id} · {plugin.bus}</small></div></div>
                  <JellySwitch checked={plugin.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${plugin.name}`}
                    onChange={(enabled) => setPlugin(plugin.id, { enabled })} />
                </WorkspaceRow>
                {plugin.configFields.map((field) => field.type === "boolean" ? (
                  <JellySwitch key={field.key} checked={Boolean(field.value)} label={field.label} disabled={!form.canWrite}
                    onChange={(value) => updateField(plugin, field.key, value)} />
                ) : (
                  <WorkspaceField key={field.key} as="label">{field.label}
                    <CompactInput type={field.type === "secret" ? "password" : field.type}
                      value={field.type === "secret" ? "••••••••" : String(field.value)}
                      disabled={!form.canWrite || field.type === "secret"}
                      onInput={(value) => updateField(plugin, field.key, field.type === "number" ? Number(value) : value)} />
                  </WorkspaceField>
                ))}
                {mounted ? (
                  <RippleButton size="sm" loading={reloading === plugin.id}
                    onClick={() => void reload(plugin, mounted)}>应用运行配置 · rev {mounted.rev}</RippleButton>
                ) : <small>运行时未注册此配置项。</small>}
              </WorkspaceItem>
            );
          })}
        </WorkspaceGrid>
        {runtime.error ? <WorkspaceReadState {...runtime} empty="" onRetry={runtime.refresh} /> : null}
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>斜杠指令与权限</h2>
        <>
          <WorkspaceTable>
            <WorkspaceTableHead><WorkspaceTableRow><WorkspaceTableCell component="th" scope="col">启用</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">指令与别名</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">权限</WorkspaceTableCell><WorkspaceTableCell component="th" scope="col">说明</WorkspaceTableCell></WorkspaceTableRow></WorkspaceTableHead>
            <WorkspaceTableBody>{commands.value.map((command) => (
              <WorkspaceTableRow key={command.id}>
                <WorkspaceTableCell><JellySwitch checked={command.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${command.command}`}
                  onChange={(enabled) => commands.setValue((items) => items.map((item) => item.id === command.id ? { ...item, enabled } : item))} /></WorkspaceTableCell>
                <WorkspaceTableCell><code>{command.command}</code> <small>{command.aliases.join(" ")}</small></WorkspaceTableCell>
                <WorkspaceTableCell><code>{command.permission}</code></WorkspaceTableCell>
                <WorkspaceTableCell>{command.description}</WorkspaceTableCell>
              </WorkspaceTableRow>
            ))}</WorkspaceTableBody>
          </WorkspaceTable>
        </>
        {!commands.value.length ? <small>暂无已配置指令。</small> : null}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

function Skills({ ecosystem }: { ecosystem?: Ecosystem }) {
  const ctx = useConsole();
  const skills = useWorkspaceDraft(ecosystem?.skills ?? []);
  const servers = useWorkspaceDraft(ecosystem?.mcpServers ?? []);
  const form = useWorkspaceSave("extensions.skills-mcp", skills.dirty || servers.dirty,
    () => { skills.discard(); servers.discard(); },
    async () => { await ctx?.postStudio("config", { ecosystem: { skills: skills.value, mcpServers: servers.value } }); },
    "技能与 MCP 配置已保存", () => { skills.accept(); servers.accept(); });
  const updateSkill = (id: string, patch: Partial<Ecosystem["skills"][number]>) =>
    skills.setValue((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const updateServer = (id: string, patch: Partial<Ecosystem["mcpServers"][number]>) =>
    servers.setValue((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));

  return (
    <WorkspacePage>
      <WorkspaceHeader title="技能与 MCP"><WorkspaceSaveButton form={form} /></WorkspaceHeader>
      <WorkspaceGrid columns={2}>
        <WorkspaceSection>
          <h2>SKILL.md 声明式技能</h2>
          {skills.value.map((skill) => (
            <WorkspaceItem key={skill.id} as="article" data-skill-id={skill.id}>
              <WorkspaceRow>
                <strong>{skill.name}</strong>
                <JellySwitch checked={skill.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${skill.name}`}
                  onChange={(enabled) => updateSkill(skill.id, { enabled })} />
              </WorkspaceRow>
              <small>{skill.description}</small>
              <WorkspaceField as="label">执行姿态<CompactInput value={skill.inCharacterDemeanor} disabled={!form.canWrite}
                onInput={(inCharacterDemeanor) => updateSkill(skill.id, { inCharacterDemeanor })} /></WorkspaceField>
              <WorkspaceField as="label">Markdown 正文<CompactInput multiline rows={5} value={skill.bodyMarkdown}
                disabled={!form.canWrite} onInput={(bodyMarkdown) => updateSkill(skill.id, { bodyMarkdown })} /></WorkspaceField>
            </WorkspaceItem>
          ))}
          {!skills.value.length ? <small>暂无已配置技能。</small> : null}
        </WorkspaceSection>
        <WorkspaceSection>
          <h2>MCP 服务与工具目录</h2>
          {servers.value.map((server) => (
            <WorkspaceItem key={server.id} as="article" data-mcp-id={server.id}>
              <WorkspaceRow>
                <strong>{server.name}</strong>
                <JellySwitch checked={server.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${server.name}`}
                  onChange={(enabled) => updateServer(server.id, { enabled })} />
              </WorkspaceRow>
              <WorkspaceGrid columns={2}>
                <WorkspaceField><span>传输协议</span><CompactSelect ariaLabel={`${server.name} 传输协议`} value={server.transport} disabled={!form.canWrite}
                  options={[{ value: "stdio", label: "stdio" }, { value: "sse", label: "SSE" }, { value: "http", label: "HTTP" }]}
                  onChange={(transport) => updateServer(server.id, { transport })} /></WorkspaceField>
                <WorkspaceField as="label">端点<CompactInput value={server.endpoint} disabled={!form.canWrite}
                  onInput={(endpoint) => updateServer(server.id, { endpoint })} /></WorkspaceField>
              </WorkspaceGrid>
              {server.tools.map((tool) => (
                <WorkspaceRow key={tool.name}><code>{tool.name}</code><small>{tool.risk}</small></WorkspaceRow>
              ))}
            </WorkspaceItem>
          ))}
          {!servers.value.length ? <small>暂无 MCP 服务配置。</small> : null}
        </WorkspaceSection>
      </WorkspaceGrid>
    </WorkspacePage>
  );
}

function Flows({ ecosystem }: { ecosystem?: Ecosystem }) {
  const ctx = useConsole();
  const draft = useWorkspaceDraft(ecosystem?.ecaFlows ?? []);
  const form = useWorkspaceSave("extensions.flows-eca", draft.dirty, draft.discard, async () => {
    if (draft.value.some((flow) => !flow.name.trim() || (flow.enabled && (!flow.whenExpr.trim() || !flow.thenAction.trim())))) {
      throw new Error("已启用的规则需要名称、触发条件和动作。");
    }
    await ctx?.postStudio("config", { ecosystem: { ecaFlows: draft.value } });
  }, "联动流配置已保存", draft.accept);
  const update = (id: string, patch: Partial<Ecosystem["ecaFlows"][number]>) =>
    draft.setValue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  return (
    <WorkspacePage>
      <WorkspaceHeader title="自动化联动流">
        <RippleButton disabled={!form.canWrite} onClick={() => draft.setValue((items) => [...items, {
          id: `eca_${crypto.randomUUID()}`, name: "新建规则", whenExpr: "", ifExpr: "", thenAction: "", enabled: false
        }])}>新建规则</RippleButton>
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>
      <WorkspaceSection>
        <h2>When → If → Then 配置</h2>
        <small>此页管理保存到正式存档的声明式联动流。</small>
        {!draft.value.length ? <small>暂无已保存的联动流。</small> : null}
        <WorkspaceGrid columns={2}>
          {draft.value.map((flow) => (
            <WorkspaceItem key={flow.id} as="article" data-flow-id={flow.id}>
              <WorkspaceRow>
                <strong>{flow.name}</strong>
                <JellySwitch checked={flow.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${flow.name}`}
                  onChange={(enabled) => update(flow.id, { enabled })} />
              </WorkspaceRow>
              <WorkspaceField as="label">名称<CompactInput value={flow.name} disabled={!form.canWrite}
                onInput={(name) => update(flow.id, { name })} /></WorkspaceField>
              <WorkspaceField as="label">WHEN · 触发<CompactInput value={flow.whenExpr}
                disabled={!form.canWrite} onInput={(whenExpr) => update(flow.id, { whenExpr })} /></WorkspaceField>
              <WorkspaceField as="label">IF · 条件<CompactInput value={flow.ifExpr}
                disabled={!form.canWrite} onInput={(ifExpr) => update(flow.id, { ifExpr })} /></WorkspaceField>
              <WorkspaceField as="label">THEN · 动作<CompactInput value={flow.thenAction}
                disabled={!form.canWrite} onInput={(thenAction) => update(flow.id, { thenAction })} /></WorkspaceField>
              <RippleButton size="sm" variant="ghost" disabled={!form.canWrite}
                onClick={() => draft.setValue((items) => items.filter((item) => item.id !== flow.id))}>移除规则</RippleButton>
            </WorkspaceItem>
          ))}
        </WorkspaceGrid>
      </WorkspaceSection>
    </WorkspacePage>
  );
}

function Organs({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const [pending, setPending] = useState<string>();
  const organs = snapshot?.extensions.filter((extension) => extension.buses.includes("ext.cognitive_organ")) ?? [];
  const sandbox = ctx?.mode === "sandbox";
  const toggle = async (id: string, enabled: boolean) => {
    if (!ctx || !sandbox || pending) return;
    setPending(id);
    try {
      await ctx.postAdmin("extensions", { extension_id: id, enabled }, "sandbox:console");
      await ctx.refreshSnapshot("sandbox");
    } catch (error) {
      ctx.showToast(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPending(undefined);
    }
  };
  return (
    <WorkspacePage>
      <WorkspaceHeader title="认知器官模块">
        {!sandbox ? <RippleButton onClick={() => ctx?.setMode("sandbox")}>在沙盒执行消融</RippleButton> : null}
      </WorkspaceHeader>
      <WorkspaceSection>
        <h2>本实例器官注册</h2>
        {organs.map((organ) => (
          <WorkspaceItem key={organ.id} as="article">
            <RuntimeDetails extension={organ} />
            <JellySwitch label="启用器官" checked={organ.enabled} disabled={!sandbox || Boolean(pending)}
              onChange={(enabled) => void toggle(organ.id, enabled)} />
            {registeredPages(snapshot).filter(page => page.pluginId === organ.id).map(page =>
              <RippleButton key={page.path} onClick={() => ctx?.navigateConsole(page.path)}>查看{page.title}</RippleButton>)}
          </WorkspaceItem>
        ))}
        {!organs.length ? <small>当前实例没有已注册的认知器官。</small> : null}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

export function Domain6ExtensionsPage(props: Domain6ExtensionsPageProps): ReactElement {
  const ctx = useConsole();
  const snapshot = props.snapshot ?? ctx?.snapshot;
  const ecosystem = snapshot?.studioConfig?.ecosystem;
  const route = resolveConsoleRoute(props.pathname);
  let content: ReactElement;

  switch (route?.id) {
    case "extensions.configurator": content = <Configurator ecosystem={ecosystem} />; break;
    case "extensions.skills-mcp": content = <Skills ecosystem={ecosystem} />; break;
    case "extensions.cognitive-organs": content = <Organs snapshot={snapshot} />; break;
    case "extensions.flows-eca": content = <Flows ecosystem={ecosystem} />; break;
    default: content = <ExtensionList snapshot={snapshot} />;
  }
  return (
    <MainRoundedCardOutlet domainId="extensions" activePath={props.pathname} onNavigate={props.onNavigate}>
      {content}
    </MainRoundedCardOutlet>
  );
}
