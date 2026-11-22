import { useEffect, useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../live-snapshot.js";
import { type ConsoleRoute } from "../router/routes.js";

export interface Domain6ExtensionsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain6ExtensionsPage(props: Domain6ExtensionsPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const eco = snap?.studioConfig?.ecosystem;

  const [plugins, setPlugins] = useState<ConsoleStudioState["ecosystem"]["plugins"]>(
    eco?.plugins ?? []
  );
  const [commands, setCommands] = useState<ConsoleStudioState["ecosystem"]["commands"]>(
    eco?.commands ?? []
  );
  const [skills, setSkills] = useState<ConsoleStudioState["ecosystem"]["skills"]>(
    eco?.skills ?? []
  );
  const [ecaFlows, setEcaFlows] = useState<ConsoleStudioState["ecosystem"]["ecaFlows"]>(
    eco?.ecaFlows ?? []
  );
  const mcpServers = eco?.mcpServers ?? [];

  useEffect(() => {
    if (!eco) return;
    setPlugins(eco.plugins);
    setCommands(eco.commands);
    setSkills(eco.skills);
    setEcaFlows(eco.ecaFlows);
  }, [eco]);

  const handleSaveEcosystem = async () => {
    if (!ctx) return;
    try {
      await ctx.postStudio("/api/studio/config", {
        ecosystem: { plugins, skills, commands, ecaFlows }
      });
      await ctx.refreshSnapshot();
      ctx.showToast("扩展、指令与技能配置已热重载");
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="extensions" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-ecosystem-page="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>插件与技能</h1>
          </div>
          <div className="ai0-page-header__actions">
            <RippleButton
              variant="primary"
              data-save-ecosystem="true"
              onClick={() => void handleSaveEcosystem()}
            >
              {renderConsoleIcon("save", 14)}
              <span>保存并热重载</span>
            </RippleButton>
          </div>
        </header>

        <section className="ai0-card">
          <div className="ai0-card__head">
            <h2>已安装扩展</h2>
          </div>
          <div className="ai0-grid-3">
            {plugins.map((plug) => (
              <article key={plug.id} className="ai0-card is-elevated" data-plugin-card={plug.id}>
                <div className="ai0-card__head">
                  <div>
                    <strong>{plug.name}</strong>
                    <div style={{ fontSize: "11.5px", color: "var(--ai0-on-surface-muted)", fontFamily: "var(--ai0-font-mono)" }}>
                      v{plug.version} · {plug.bus}
                    </div>
                  </div>
                  <JellySwitch
                    checked={plug.enabled}
                    data-plugin-enabled={plug.id}
                    ariaLabel={`启用 ${plug.name}`}
                    onChange={(enabled) =>
                      setPlugins((prev) =>
                        prev.map((p) => (p.id === plug.id ? { ...p, enabled } : p))
                      )
                    }
                  />
                </div>
                <p style={{ fontSize: "12.5px", color: "var(--ai0-on-surface-muted)" }}>{plug.description}</p>
                {plug.configFields.map((field) => (
                  <div key={field.key} className="ai0-field">
                    <label>{field.label}</label>
                    {field.type === "boolean" ? (
                      <JellySwitch
                        checked={Boolean(field.value)}
                        data-plugin-field={`${plug.id}:${field.key}`}
                        ariaLabel={field.label}
                        onChange={(val) =>
                          setPlugins((prev) =>
                            prev.map((p) =>
                              p.id === plug.id
                                ? {
                                    ...p,
                                    configFields: p.configFields.map((f) =>
                                      f.key === field.key ? { ...f, value: val } : f
                                    )
                                  }
                                : p
                            )
                          )
                        }
                      />
                    ) : (
                      <CompactInput
                        type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
                        value={String(field.value)}
                        data-plugin-field={`${plug.id}:${field.key}`}
                        onInput={(val) =>
                          setPlugins((prev) =>
                            prev.map((p) =>
                              p.id === plug.id
                                ? {
                                    ...p,
                                    configFields: p.configFields.map((f) =>
                                      f.key === field.key
                                        ? { ...f, value: field.type === "number" ? Number(val) : val }
                                        : f
                                    )
                                  }
                                : p
                            )
                          )
                        }
                      />
                    )}
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>

        <div className="ai0-grid-2">
          <section className="ai0-card is-elevated">
            <h2>斜杠指令与权限管理</h2>
            <table className="ai0-table">
              <thead>
                <tr>
                  <th>启用</th>
                  <th>指令与别名</th>
                  <th>权限等级</th>
                  <th>功能说明</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((cmd) => (
                  <tr key={cmd.id}>
                    <td>
                      <JellySwitch
                        checked={cmd.enabled}
                        data-cmd-enabled={cmd.id}
                        ariaLabel={`启用 ${cmd.command}`}
                        onChange={(enabled) =>
                          setCommands((prev) =>
                            prev.map((c) => (c.id === cmd.id ? { ...c, enabled } : c))
                          )
                        }
                      />
                    </td>
                    <td>
                      <code>{cmd.command}</code>
                      <div style={{ fontSize: "11px", color: "var(--ai0-on-surface-muted)" }}>{cmd.aliases.join(" ")}</div>
                    </td>
                    <td>
                      <span className="ai0-badge" data-tone={cmd.permission === "owner" ? "accent" : "info"}>
                        {cmd.permission === "owner" ? "主账户" : cmd.permission === "admin" ? "管理员" : "公开"}
                      </span>
                    </td>
                    <td><small>{cmd.description}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="ai0-card is-elevated">
            <h2>MCP 工具服务连接器 (Model Context Protocol)</h2>
            {mcpServers.map((srv) => (
              <article key={srv.id} className="ai0-card" data-mcp-id={srv.id}>
                <div className="ai0-card__head">
                  <div>
                    <strong>{srv.name}</strong>
                    <div style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px", color: "var(--ai0-on-surface-muted)" }}>
                      [{srv.transport}] {srv.endpoint}
                    </div>
                  </div>
                  <span className="ai0-badge" data-tone={srv.enabled ? "live" : "warn"}>{srv.enabled ? "已挂载" : "已停用"}</span>
                </div>
                <div style={{ display: "grid", gap: "6px" }}>
                  {srv.tools.map((tool) => (
                    <div
                      key={tool.name}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: "8px", background: "var(--ai0-surface-main-card)", border: "var(--ai0-border-subtle)" }}
                    >
                      <div>
                        <code>{tool.name}</code>
                        <div style={{ fontSize: "11.5px", color: "var(--ai0-on-surface-muted)" }}>{tool.description}</div>
                      </div>
                      <span className="ai0-badge" data-tone={tool.risk === "read_only_safe" ? "good" : "warn"}>
                        {tool.risk === "read_only_safe" ? "只读自动放行" : "需审批确认"}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </div>

        <section className="ai0-card is-elevated">
          <div className="ai0-card__head">
            <div>
              <h2>SKILL.md 声明式技能编辑</h2>
              <small>通过自然语言 Markdown 定义任务步骤及执行时的角色内行为姿态（in_character_demeanor）</small>
            </div>
          </div>
          <div className="ai0-grid-2">
            {skills.map((skill) => (
              <article key={skill.id} className="ai0-card" data-skill-id={skill.id}>
                <div className="ai0-card__head">
                  <strong>{skill.name}</strong>
                  <JellySwitch
                    checked={skill.enabled}
                    data-skill-enabled={skill.id}
                    ariaLabel={`启用 ${skill.name}`}
                    onChange={(enabled) =>
                      setSkills((prev) =>
                        prev.map((s) => (s.id === skill.id ? { ...s, enabled } : s))
                      )
                    }
                  />
                </div>
                <div className="ai0-field">
                  <label>角色内执行姿态 (in_character_demeanor)</label>
                  <CompactInput
                    type="text"
                    value={skill.inCharacterDemeanor}
                    data-skill-demeanor={skill.id}
                    onInput={(inCharacterDemeanor) =>
                      setSkills((prev) =>
                        prev.map((s) => (s.id === skill.id ? { ...s, inCharacterDemeanor } : s))
                      )
                    }
                  />
                </div>
                <div className="ai0-field">
                  <label>SKILL.md 规则正文</label>
                  <CompactInput
                    multiline={true}
                    rows={5}
                    value={skill.bodyMarkdown}
                    data-skill-body={skill.id}
                    style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "12px" }}
                    onInput={(bodyMarkdown) =>
                      setSkills((prev) =>
                        prev.map((s) => (s.id === skill.id ? { ...s, bodyMarkdown } : s))
                      )
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="ai0-card is-elevated">
          <div className="ai0-card__head">
            <div>
              <h2>自动化联动流 (ECA · .flow.yaml)</h2>
              <small>基于 When → If → Then 声明式规则联动感官事件、时间节律与主动交互</small>
            </div>
            <RippleButton variant="secondary" size="sm" data-add-eca-flow="true">
              {renderConsoleIcon("plus", 13)}
              <span>新建规则</span>
            </RippleButton>
          </div>
          <div className="ai0-grid-2">
            {ecaFlows.map((flow) => (
              <article key={flow.id} className="ai0-card" data-flow-id={flow.id}>
                <div className="ai0-card__head">
                  <strong>{flow.name}</strong>
                  <JellySwitch
                    checked={flow.enabled}
                    data-flow-enabled={flow.id}
                    ariaLabel={`启用 ${flow.name}`}
                    onChange={(enabled) =>
                      setEcaFlows((prev) =>
                        prev.map((f) => (f.id === flow.id ? { ...f, enabled } : f))
                      )
                    }
                  />
                </div>
                <div style={{ display: "grid", gap: "6px", fontSize: "12.5px" }}>
                  <div><span className="ai0-badge" data-tone="info">WHEN</span> {flow.whenExpr}</div>
                  <div><span className="ai0-badge" data-tone="warn">IF</span> {flow.ifExpr}</div>
                  <div><span className="ai0-badge" data-tone="good">THEN</span> {flow.thenAction}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </MainRoundedCardOutlet>
  );
}
