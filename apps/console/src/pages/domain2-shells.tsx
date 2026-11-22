import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import {
  CompactInput,
  RippleButton,
  CompactSelect,
  JellySwitch
} from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot, ConsoleStudioState } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";

export interface Domain2ShellsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

interface ChatBubble {
  id: string;
  role: "user" | "assistant" | "sensor";
  text: string;
  timestamp?: string;
  streaming?: boolean;
}

export function Domain2ShellsPage(props: Domain2ShellsPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;

  // WebChat state
  const [messages, setMessages] = useState<ChatBubble[]>(() =>
    (snap?.recentTranscript ?? []).map((m, i) => ({
      id: `init_${i}`,
      role: m.role,
      text: m.text,
      timestamp: m.timestamp,
      streaming: false
    }))
  );
  const [draft, setDraft] = useState("");
  const [remainderNote, setRemainderNote] = useState<string | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStreamRef = useRef({ intentId: "", fullText: "", spokenChars: 0 });
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  // Profiles & Custom Rules state
  const [newRuleUmo, setNewRuleUmo] = useState("");
  const [newRuleLabel, setNewRuleLabel] = useState("");
  const [newRuleScope, setNewRuleScope] = useState<"only_owner" | "fixed_group" | "public_all">("only_owner");
  const [newRuleProfile, setNewRuleProfile] = useState(
    studio?.profiles[0]?.id ?? "profile_private_owner"
  );

  // Platforms & Attention state
  const [platforms, setPlatforms] = useState<ConsoleStudioState["platforms"]>(
    studio?.platforms ?? []
  );
  const [hysteresis, setHysteresis] = useState(studio?.attentionPolicy.focusHysteresisMs ?? 4000);
  const [habituation, setHabituation] = useState(
    studio?.attentionPolicy.habituationDecayRate ?? 0.18
  );
  const [retractDraft, setRetractDraft] = useState(
    studio?.attentionPolicy.retractDraftAwareness ?? true
  );

  useEffect(() => {
    if (!streamTimerRef.current && snap?.recentTranscript) {
      setMessages(
        snap.recentTranscript.map((m, i) => ({
          id: `snap_${i}_${m.timestamp ?? ""}`,
          role: m.role,
          text: m.text,
          timestamp: m.timestamp,
          streaming: false
        }))
      );
    }
  }, [snap?.recentTranscript]);

  useEffect(() => {
    if (studio?.platforms) setPlatforms(studio.platforms);
    if (studio?.attentionPolicy) {
      setHysteresis(studio.attentionPolicy.focusHysteresisMs);
      setHabituation(studio.attentionPolicy.habituationDecayRate);
      setRetractDraft(studio.attentionPolicy.retractDraftAwareness);
    }
    if (studio?.profiles[0]?.id) {
      setNewRuleProfile((prev) => prev || studio.profiles[0]!.id);
    }
  }, [studio?.platforms, studio?.attentionPolicy, studio?.profiles]);

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [messages]);

  const navClick = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (props.onNavigate || ctx) {
      event.preventDefault();
      if (props.onNavigate) props.onNavigate(path);
      else ctx?.navigateConsole(path);
    }
  };

  // Audience Policies & Channel Rules
  if (route?.id === "shells.profiles-rules") {
    const profiles = studio?.profiles ?? [];
    const rules = studio?.customRules ?? [];

    const handleAddRule = async () => {
      if (!ctx || !studio) return;
      const umo = newRuleUmo.trim() || `adapter:channel:${Date.now().toString().slice(-6)}`;
      const label = newRuleLabel.trim() || "新建会话规则";
      const nextRules = [
        ...studio.customRules,
        {
          id: `rule_${Date.now()}`,
          umo,
          label,
          platform: umo.split(":")[0] || "builtin.webchat",
          audienceScope: newRuleScope,
          profileId: newRuleProfile || profiles[0]?.id || "profile_private_owner",
          triggerAt: true,
          triggerNickname: true,
          triggerKeywords: [snap?.personaName ?? "Mio"],
          proactiveReplyRatePct: newRuleScope === "public_all" ? 20 : 15,
          continuousWindowSec: 60,
          opportunityExpireSec: 45,
          rateLimitPerMin: 12,
          allowExternalTools: newRuleScope !== "public_all",
          enabled: true
        }
      ];
      try {
        await ctx.postStudio("/api/studio/config", { customRules: nextRules });
        setNewRuleUmo("");
        setNewRuleLabel("");
        await ctx.refreshSnapshot();
        ctx.showToast(`已添加会话规则：${label}`);
      } catch (err) {
        ctx.showToast(`新增规则失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const handleToggleRule = async (ruleId: string, enabled: boolean) => {
      if (!ctx || !studio) return;
      const nextRules = studio.customRules.map((r) => (r.id === ruleId ? { ...r, enabled } : r));
      try {
        await ctx.postStudio("/api/studio/config", { customRules: nextRules });
        await ctx.refreshSnapshot();
      } catch (err) {
        ctx.showToast(`更新规则失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="shells" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="ai0-page" data-profiles-rules-page="true">
          <header className="ai0-page-header">
            <div className="ai0-page-header__title">
              <h1>受众与策略</h1>
            </div>
            <div className="ai0-page-header__actions">
              <RippleButton
                variant="primary"
                data-add-custom-rule="true"
                onClick={() => void handleAddRule()}
              >
                {renderConsoleIcon("plus", 14)}
                <span>添加通道规则</span>
              </RippleButton>
            </div>
          </header>

          <section className="ai0-card">
            <div className="ai0-card__head">
              <h2>受众策略模板 (Profiles)</h2>
            </div>
            <div className="ai0-grid-3">
              {profiles.map((profile) => (
                <article key={profile.id} className="ai0-card is-elevated" data-profile-id={profile.id}>
                  <div className="ai0-card__head">
                    <strong>{profile.name}</strong>
                    <span className="ai0-badge" data-tone={profile.socialMaskEnabled ? "warn" : "accent"}>
                      {profile.socialMaskEnabled ? `社交面具 ${profile.socialMaskDampingPct}%` : "私密完整"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <span className="ai0-chip">{profile.llmProviderId}</span>
                    <span className="ai0-chip">{profile.tokenBudgetPreset} tok</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="ai0-card is-elevated">
            <div className="ai0-card__head">
              <h2>已绑定通道规则</h2>
            </div>
            <table className="ai0-table">
              <thead>
                <tr>
                  <th>启用</th>
                  <th>通道标识 (UMO)</th>
                  <th>受众等级</th>
                  <th>策略模板</th>
                  <th>速率限制</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} data-rule-id={rule.id}>
                    <td>
                      <JellySwitch
                        checked={rule.enabled}
                        data-toggle-rule={rule.id}
                        ariaLabel={`启用 ${rule.label}`}
                        onChange={(enabled) => void handleToggleRule(rule.id, enabled)}
                      />
                    </td>
                    <td>
                      <strong>{rule.label}</strong>
                      <div style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px", color: "var(--ai0-on-surface-muted)" }}>
                        {rule.umo}
                      </div>
                    </td>
                    <td>
                      <span
                        className="ai0-badge"
                        data-tone={rule.audienceScope === "only_owner" ? "accent" : rule.audienceScope === "public_all" ? "warn" : "info"}
                      >
                        {rule.audienceScope === "only_owner"
                          ? "only_owner"
                          : rule.audienceScope === "public_all"
                            ? "public_all (70% 面具)"
                            : "fixed_group"}
                      </span>
                    </td>
                    <td><code>{rule.profileId}</code></td>
                    <td><small>{rule.rateLimitPerMin}/min</small></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ai0-grid-4" style={{ paddingTop: "10px", borderTop: "var(--ai0-border-subtle)" }}>
              <div className="ai0-field">
                <label>外部通道 UMO 标识</label>
                <CompactInput
                  id="new-rule-umo"
                  type="text"
                  placeholder="adapter:channel:id"
                  value={newRuleUmo}
                  onInput={setNewRuleUmo}
                />
              </div>
              <div className="ai0-field">
                <label>规则名称</label>
                <CompactInput
                  id="new-rule-label"
                  type="text"
                  placeholder="自定义规则名"
                  value={newRuleLabel}
                  onInput={setNewRuleLabel}
                />
              </div>
              <div className="ai0-field">
                <label>受众等级</label>
                <CompactSelect
                  id="new-rule-scope"
                  value={newRuleScope}
                  onChange={(v) => setNewRuleScope(v as typeof newRuleScope)}
                  options={[
                    { value: "only_owner", label: "only_owner (仅主账户)" },
                    { value: "fixed_group", label: "fixed_group (受限成员)" },
                    { value: "public_all", label: "public_all (公开隔离)" }
                  ]}
                />
              </div>
              <div className="ai0-field">
                <label>绑定策略</label>
                <CompactSelect
                  id="new-rule-profile"
                  value={newRuleProfile}
                  onChange={setNewRuleProfile}
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>
            </div>
          </section>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Authentic WebChat (Pure 1v1 Chat & Debugging Client)
  if (route?.id === "shells.stage" || route?.id === "shells.simulator") {
    const routedModel = studio?.brainRouting.W1_fast_dialogue.primaryId ?? "local";
    const providerObj = studio?.providers.find((p) => p.id === routedModel);

    const handleSend = async () => {
      const trimmed = draft.trim();
      if (!trimmed || !ctx) return;
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      setDraft("");
      setRemainderNote(null);
      const userId = `u_${Date.now()}`;
      const replyId = `a_${Date.now() + 1}`;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", text: trimmed, streaming: false },
        { id: replyId, role: "assistant", text: "生成中…", streaming: true }
      ]);

      try {
        const data = await ctx.postProtocol<{
          expression?: { intent_id?: string; fallback_text?: string };
        }>("/protocol/v0/shell/perception", {
          text: trimmed,
          venue_type: "private_1on1",
          audience_scope: "only_owner",
          modality: "text",
          mode: ctx.mode
        });
        const intentId = data.expression?.intent_id ?? `int_${Date.now()}`;
        const fullText = data.expression?.fallback_text ?? "…";
        const chars = Array.from(fullText);
        activeStreamRef.current = { intentId, fullText, spokenChars: 0 };

        streamTimerRef.current = setInterval(() => {
          activeStreamRef.current.spokenChars += 1;
          const spoken = activeStreamRef.current.spokenChars;
          const done = spoken >= chars.length;
          const partial = chars.slice(0, spoken).join("");
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, text: partial, streaming: !done } : m))
          );
          if (done && streamTimerRef.current) {
            clearInterval(streamTimerRef.current);
            streamTimerRef.current = null;
            void ctx.refreshSnapshot();
          }
        }, 18);
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId
              ? { ...m, text: `请求失败：${err instanceof Error ? err.message : String(err)}`, streaming: false }
              : m
          )
        );
      }
    };

    const handleInterrupt = async () => {
      if (!ctx) return;
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
      const { intentId, fullText, spokenChars } = activeStreamRef.current;
      const chars = Array.from(fullText);
      const offset = Math.min(spokenChars || 10, chars.length);
      let remainder = chars.slice(offset).join("");
      try {
        const receipt = await ctx.postProtocol<{ unsaid_remainder?: string }>(
          "/protocol/v0/shell/receipt",
          {
            intent_id: intentId || "int_webchat",
            spoken_char_offset: offset,
            full_text: fullText,
            mode: ctx.mode
          }
        );
        remainder = receipt.unsaid_remainder ?? remainder;
      } catch {
        // Fallback to local slice
      }
      setRemainderNote(
        `已打断 · 已输出 ${offset} 字 · 未说完腹稿已留存：「${remainder || "本轮已结束"}」`
      );
      ctx.showToast("已记录打断偏移并保留未说完腹稿");
      void ctx.refreshSnapshot();
    };

    const handleClear = async () => {
      if (!ctx) return;
      if (streamTimerRef.current) {
        clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      try {
        await ctx.postStudio("/api/studio/webchat/clear", { mode: ctx.mode });
        setMessages([]);
        setRemainderNote(null);
        ctx.showToast("已清空当前会话显示");
      } catch (err) {
        ctx.showToast(`清空失败：${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return (
      <MainRoundedCardOutlet domainId="shells" activePath={props.pathname} onNavigate={props.onNavigate}>
        <div className="mounted-shell-stage-host" data-shell-plugin-id="builtin.webchat">
          <header
            style={{
              padding: "10px 20px",
              borderBottom: "var(--ai0-border-subtle)",
              background: "var(--ai0-surface-container-low)",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "8px",
                  background: "var(--ai0-accent-tint)",
                  color: "var(--ai0-accent)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "13px"
                }}
              >
                {(snap?.personaName ?? "K").slice(0, 1).toUpperCase()}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "14px" }}>{snap?.personaName ?? "Mio"}</strong>
                <span className="ai0-badge" data-tone="live">WebChat · 在线</span>
                <span className="ai0-badge" data-tone="info">{providerObj?.modelId ?? routedModel}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <RippleButton
                variant="ghost"
                size="sm"
                data-clear-webchat="true"
                onClick={() => void handleClear()}
              >
                {renderConsoleIcon("trash", 13)}
                <span>清空对话</span>
              </RippleButton>
              <RippleButton
                variant="secondary"
                size="sm"
                data-open-inspector="trace"
                onClick={() => ctx?.toggleInspector()}
              >
                {renderConsoleIcon("inspector", 13)}
                <span>思维链路</span>
              </RippleButton>
            </div>
          </header>

          <div className="mounted-shell-stage-host__transcript" ref={transcriptBoxRef}>
            {messages.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", color: "var(--ai0-on-surface-muted)", display: "grid", gap: "6px" }}>
                <strong style={{ fontSize: "14px", color: "var(--ai0-on-surface)" }}>
                  与 {snap?.personaName ?? "Mio"} 开始对话
                </strong>
                <small>builtin.webchat · Protocol v0</small>
              </div>
            ) : (
              messages.map((msg) => (
                <article
                  key={msg.id}
                  className={`mounted-shell-stage-host__bubble is-${msg.role}`}
                  data-streaming={String(Boolean(msg.streaming))}
                >
                  <small>
                    {msg.role === "user" ? "我" : snap?.personaName ?? "Mio"} {msg.timestamp ? `· ${msg.timestamp}` : ""}
                  </small>
                  <span>{msg.text}</span>
                </article>
              ))
            )}
          </div>

          {remainderNote ? <p className="mounted-shell-stage-host__remainder">{remainderNote}</p> : null}

          <footer
            style={{
              padding: "12px 20px 14px",
              borderTop: "var(--ai0-border-subtle)",
              background: "var(--ai0-surface-main-card)"
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CompactInput
                  inputClassName="ai0-webchat-input"
                  type="text"
                  value={draft}
                  onInput={setDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={`发送消息给 ${snap?.personaName ?? "Mio"}...`}
                />
              </div>
              <RippleButton
                variant="ghost"
                size="sm"
                data-webchat-interrupt="true"
                title="打断当前回复"
                onClick={() => void handleInterrupt()}
              >
                {renderConsoleIcon("stop", 13)}
                <span>打断</span>
              </RippleButton>
              <RippleButton
                variant="primary"
                data-webchat-send="true"
                onClick={() => void handleSend()}
              >
                {renderConsoleIcon("send", 14)}
                <span>发送</span>
              </RippleButton>
            </div>
          </footer>
        </div>
      </MainRoundedCardOutlet>
    );
  }

  // Connected Shells & Protocol v0 Gateway
  const updatePlatform = (
    id: string,
    patch: Partial<ConsoleStudioState["platforms"][number]>
  ) => {
    setPlatforms((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleSavePlatforms = async () => {
    if (!ctx) return;
    try {
      await ctx.postStudio("/api/studio/config", {
        platforms,
        attentionPolicy: {
          focusHysteresisMs: hysteresis,
          habituationDecayRate: habituation,
          retractDraftAwareness: retractDraft
        }
      });
      await ctx.refreshSnapshot();
      ctx.showToast("平台适配器与感官门控参数已保存");
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <MainRoundedCardOutlet domainId="shells" activePath={props.pathname} onNavigate={props.onNavigate}>
      <div className="ai0-page" data-platforms-page="true">
        <header className="ai0-page-header">
          <div className="ai0-page-header__title">
            <h1>接入通道</h1>
          </div>
          <div className="ai0-page-header__actions">
            <a
              href="/profiles/rules"
              onClick={navClick("/profiles/rules")}
              className="ai0-ripple-btn"
              data-variant="secondary"
            >
              <span className="ai0-ripple-btn__content">
                {renderConsoleIcon("rules", 14)}
                <span>受众与策略</span>
              </span>
            </a>
            <RippleButton
              variant="primary"
              data-save-platforms="true"
              onClick={() => void handleSavePlatforms()}
            >
              {renderConsoleIcon("save", 14)}
              <span>保存配置</span>
            </RippleButton>
          </div>
        </header>

        <section className="ai0-card is-elevated">
          <div className="ai0-card__head">
            <h2>Protocol v0 接入端点</h2>
            <span className="ai0-badge" data-tone="live">运行中</span>
          </div>
          <pre className="ai0-code-box">WebSocket / HTTP Gateway: http://127.0.0.1:4173/protocol/v0/shell/perception</pre>
        </section>

        <section className="ai0-grid-2">
          {platforms.map((plat) => (
            <article key={plat.id} className="ai0-card is-elevated" data-platform-id={plat.id}>
              <div className="ai0-card__head">
                <div>
                  <strong>{plat.name}</strong>
                  <div style={{ fontFamily: "var(--ai0-font-mono)", fontSize: "11.5px", color: "var(--ai0-on-surface-muted)" }}>
                    {plat.endpoint}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="ai0-badge" data-tone={plat.connected ? "live" : "warn"}>
                    {plat.connected ? `在线 ${plat.rttMs}ms` : "离线"}
                  </span>
                  <JellySwitch
                    checked={plat.enabled}
                    data-plat-enabled={plat.id}
                    ariaLabel={`启用 ${plat.name}`}
                    onChange={(enabled) => updatePlatform(plat.id, { enabled })}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                {plat.sensors.map((s) => <span key={`s:${s}`} className="ai0-chip is-accent">sensor: {s}</span>)}
                {plat.realizers.map((r) => <span key={`r:${r}`} className="ai0-chip">realizer: {r}</span>)}
                {plat.actuators.map((a) => <span key={`a:${a}`} className="ai0-chip">actuator: {a}</span>)}
              </div>
              <div className="ai0-grid-2">
                <div className="ai0-field">
                  <label>感官 TTL (秒)</label>
                  <CompactInput
                    type="number"
                    value={plat.sensorTtlSeconds}
                    data-plat-ttl={plat.id}
                    onInput={(val) =>
                      updatePlatform(plat.id, { sensorTtlSeconds: Number(val) || plat.sensorTtlSeconds })
                    }
                  />
                </div>
                <div className="ai0-field">
                  <label>话轮防抖 (ms)</label>
                  <CompactInput
                    type="number"
                    value={plat.debounceMs}
                    data-plat-debounce={plat.id}
                    onInput={(val) =>
                      updatePlatform(plat.id, { debounceMs: Number(val) || plat.debounceMs })
                    }
                  />
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="ai0-card">
          <div className="ai0-card__head">
            <h2>注意力焦点参数</h2>
            <span className="ai0-badge" data-tone="good">单焦点路由</span>
          </div>
          <div className="ai0-grid-3">
            <div className="ai0-field">
              <label>焦点保持窗口 (ms)</label>
              <CompactInput
                id="attn-hysteresis"
                type="number"
                value={hysteresis}
                onInput={(v) => setHysteresis(Number(v) || 4000)}
              />
            </div>
            <div className="ai0-field">
              <label>静态习惯化衰减率</label>
              <CompactInput
                id="attn-habituation"
                type="number"
                step={0.02}
                value={habituation}
                onInput={(v) => setHabituation(Number(v) || 0.18)}
              />
            </div>
            <div className="ai0-field" style={{ alignSelf: "end" }}>
              <JellySwitch
                id="attn-retract"
                checked={retractDraft}
                onChange={setRetractDraft}
                label="感知草稿撤回事件"
              />
            </div>
          </div>
        </section>
      </div>
    </MainRoundedCardOutlet>
  );
}
