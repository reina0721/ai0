import type {
  AgentConfigProfile,
  AudienceScope,
  ModelSlotBinding,
  ProviderInstance,
  ResolvedSessionRoute,
  RoleArchetype,
  UmoRoutingRule,
  VenueType
} from "@ai0/protocol";
import LinearProgress from "@mui/material/LinearProgress";
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
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import {
  WorkspaceField,
  WorkspaceGrid,
  WorkspaceItem,
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus,
  WorkspaceTable,
  WorkspaceTableBody,
  WorkspaceTableCell,
  WorkspaceTableHead,
  WorkspaceTableRow,
  WorkspaceTag
} from "./workspace-layout.js";
import { useAdminResource, useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceReadState, WorkspaceSaveButton } from "./workspace.js";

export interface ConfigProfilesPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

interface RuntimeRoute {
  region: string;
  route: { selected_model_id: string; fallback_model_id: string; drowsy_downgraded: boolean };
}

const ROLE_OPTIONS: ReadonlyArray<{ value: RoleArchetype; label: string }> = [
  { value: "best_friend", label: "日常挚友" },
  { value: "romantic_partner", label: "亲密伴侣" },
  { value: "digital_employee", label: "专业助理" },
  { value: "study_classmate", label: "学习同伴" },
  { value: "vtuber_partner", label: "互动搭档" }
];

function ModelBindingPicker(props: {
  label: string;
  providers: readonly ProviderInstance[];
  value?: ModelSlotBinding;
  allowInherit?: boolean;
  disabled?: boolean;
  onChange: (next?: ModelSlotBinding) => void;
}): ReactElement {
  const activeProvider = props.providers.find((p) => p.id === props.value?.providerId);
  const currentProviderId = props.value?.providerId;
  const currentModelId = props.value?.modelId;
  const providerOptions = [
    ...(props.allowInherit ? [{ value: "__inherit__", label: "自动继承主力对话模型" }] : []),
    ...props.providers.map((p) => ({ value: p.id, label: `${p.label}${p.enabled ? "" : " (已停用)"}` })),
    ...(currentProviderId && !activeProvider ? [{ value: currentProviderId, label: `${currentProviderId}（当前绑定）` }] : [])
  ];
  const modelOptions = (activeProvider?.models ?? []).map((m) => ({ value: m, label: m }));
  if (currentModelId && activeProvider && !activeProvider.models.includes(currentModelId)) {
    modelOptions.push({ value: currentModelId, label: `${currentModelId}（当前绑定）` });
  }

  return (
    <WorkspaceGrid columns={2}>
      <WorkspaceField>
        <span>{props.label} · 服务提供商</span>
        <CompactSelect
          ariaLabel={`${props.label}服务提供商`}
          value={props.value?.providerId ?? (props.allowInherit ? "__inherit__" : "")}
          disabled={props.disabled}
          options={providerOptions.length ? providerOptions : [{ value: "", label: "请先在「服务提供商」接入模型" }]}
          onChange={(providerId) => {
            if (providerId === "__inherit__" || !providerId) {
              props.onChange(undefined);
              return;
            }
            const picked = props.providers.find((p) => p.id === providerId);
            const modelId = picked?.models[0];
            if (modelId) props.onChange({ providerId, modelId });
          }}
        />
      </WorkspaceField>
      <WorkspaceField>
        <span>{props.label} · 模型 ID</span>
        {activeProvider ? (
          <CompactSelect
            ariaLabel={`${props.label}模型 ID`}
            value={props.value?.modelId ?? activeProvider.models[0] ?? ""}
            disabled={props.disabled}
            options={modelOptions}
            onChange={(modelId) => {
              if (!props.value?.providerId) return;
              props.onChange({ providerId: props.value.providerId, modelId });
            }}
          />
        ) : (
          <CompactInput
            value={props.allowInherit ? "自动继承主力模型" : (props.value?.modelId ?? "")}
            disabled
            ariaLabel={`${props.label}模型 ID`}
            onInput={() => {}}
          />
        )}
      </WorkspaceField>
    </WorkspaceGrid>
  );
}

function ProfilesEditor(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const soulProfiles = props.snapshot?.soulProfiles;
  const infrastructure = props.snapshot?.infrastructure;
  const primaryCapabilities = new Map(infrastructure?.providerSources.map((source) => [source.id, source.supportedCapabilities[0]]));
  const populatedProviders = new Set(infrastructure?.modelInstances.map((model) => (
    model.capabilityKind === primaryCapabilities.get(model.sourceId) ? model.sourceId : `${model.sourceId}__${model.capabilityKind}`
  )));
  const allProviders = infrastructure?.providers.filter((provider) => populatedProviders.has(provider.id)) ?? [];
  const chatProviders = allProviders.filter((p) => p.capabilityKind === "chat");
  const guardProviders = allProviders.filter((p) => p.capabilityKind === "guard_lora" || p.capabilityKind === "chat");
  const firstEnabledChat = chatProviders.find((provider) => provider.enabled);
  const knowledgePacks = props.snapshot?.knowledgePacks ?? [];
  const runtimeRoutes = useAdminResource<{ regions: RuntimeRoute[] }>("models/routing");

  const draft = useWorkspaceDraft({
    defaultProfileId: soulProfiles?.defaultProfileId ?? "",
    profiles: soulProfiles?.profiles ?? []
  });
  const [selectedId, setSelectedId] = useState("");
  const activeProfile =
    draft.value.profiles.find((p) => p.id === selectedId) ??
    draft.value.profiles.find((p) => p.id === draft.value.defaultProfileId) ??
    draft.value.profiles[0];

  const form = useWorkspaceSave(
    "config.profiles",
    draft.dirty,
    draft.discard,
    async () => {
      await ctx?.putAdmin("config/profiles", {
        defaultProfileId: draft.value.defaultProfileId,
        profiles: draft.value.profiles
      }, "live");
      runtimeRoutes.refresh();
    },
    "配置文件已保存并同步至运行时路由",
    draft.accept
  );

  const updateActive = (patch: Partial<AgentConfigProfile>) => {
    if (!activeProfile) return;
    draft.setValue((prev) => ({
      ...prev,
      profiles: prev.profiles.map((item) => (item.id === activeProfile.id ? { ...item, ...patch } : item))
    }));
  };

  const handleCreateProfile = () => {
    const modelId = firstEnabledChat?.models[0];
    if (!firstEnabledChat || !modelId) return;
    const id = `profile_${Date.now().toString(36)}`;
    const next: AgentConfigProfile = {
      id,
      name: `自定义配置 ${draft.value.profiles.length + 1}`,
      description: "按场景组装的模型、门控与能力策略",
      roleArchetype: "best_friend",
      primaryChat: {
        providerId: firstEnabledChat.id,
        modelId
      },
      brainRegionOverrides: {},
      metabolicPolicy: {
        dailyTokenBudget: 300000,
        usedTokensToday: 0,
        sleepyThresholdPct: 25,
        emergencyReservePct: 5,
        autoDowngradeEnabled: true
      },
      conversationGate: {
        debounceMs: 1200,
        focusHysteresisMs: 4000,
        habituationDecayRate: 0.18,
        retractDraftAwareness: true,
        neverBroadcastAll: true,
        triggerAt: true,
        triggerNickname: true,
        triggerKeywords: [],
        proactiveReplyRatePct: 15,
        rateLimitPerMin: 12
      },
      socialMaskEnabled: false,
      socialMaskDampingPct: 70,
      maxContextTokens: 2200,
      knowledgeCollectionIds: [],
      voiceReplyEnabled: false,
      allowedExtensionIds: ["*"],
      allowExternalTools: true
    };
    draft.setValue((prev) => ({ ...prev, profiles: [...prev.profiles, next] }));
    setSelectedId(id);
  };

  const handleDeleteActive = () => {
    if (!activeProfile || draft.value.profiles.length <= 1) return;
    const remaining = draft.value.profiles.filter((p) => p.id !== activeProfile.id);
    const nextDefault = draft.value.defaultProfileId === activeProfile.id
      ? remaining[0]!.id
      : draft.value.defaultProfileId;
    draft.setValue({ defaultProfileId: nextDefault, profiles: remaining });
    setSelectedId(remaining[0]!.id);
  };

  const meta = activeProfile?.metabolicPolicy;
  const remainPct = meta
    ? Math.max(0, 100 - Math.round((meta.usedTokensToday / Math.max(1, meta.dailyTokenBudget)) * 100))
    : undefined;

  return (
    <WorkspacePage data-profiles-page="true">
      <WorkspaceHeader title="配置文件 (Profiles)">
        <RippleButton size="sm" variant="secondary" onClick={() => ctx?.navigateConsole("/integrations/providers")}>
          {renderConsoleIcon("models", 13)}
          <span>管理服务提供商池</span>
        </RippleButton>
        <RippleButton size="sm" variant="secondary" disabled={!form.canWrite || !firstEnabledChat} data-create-profile="true" onClick={handleCreateProfile}>
          {renderConsoleIcon("plus", 13)}
          <span>新建配置文件</span>
        </RippleButton>
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>

      <WorkspaceSection>
        <WorkspaceRow>
          <div className="ai0-workspace-actions" role="tablist" aria-label="配置文件切换">
            {draft.value.profiles.map((prof) => {
              const isSelected = prof.id === activeProfile?.id;
              const isDefault = prof.id === draft.value.defaultProfileId;
              return (
                <RippleButton
                  key={prof.id}
                  size="sm"
                  variant={isSelected ? "primary" : "secondary"}
                  data-select-profile={prof.id}
                  onClick={() => setSelectedId(prof.id)}
                >
                  <span>{prof.name}{isDefault ? " · 默认" : ""}</span>
                </RippleButton>
              );
            })}
          </div>
          {activeProfile ? (
            <div className="ai0-workspace-actions">
              {activeProfile.id !== draft.value.defaultProfileId ? (
                <RippleButton
                  size="sm"
                  variant="ghost"
                  disabled={!form.canWrite}
                  onClick={() => draft.setValue((prev) => ({ ...prev, defaultProfileId: activeProfile.id }))}
                >
                  设为默认兜底
                </RippleButton>
              ) : (
                <WorkspaceStatus data-tone="accent">全局默认配置</WorkspaceStatus>
              )}
              {draft.value.profiles.length > 1 ? (
                <RippleButton size="sm" variant="ghost" disabled={!form.canWrite} onClick={handleDeleteActive}>
                  {renderConsoleIcon("trash", 13)}
                </RippleButton>
              ) : null}
            </div>
          ) : null}
        </WorkspaceRow>
      </WorkspaceSection>

      {activeProfile ? (
        <>
          <WorkspaceSection>
            <h2>1. 基础信息与主力模型选择</h2>
            <WorkspaceGrid columns={2}>
              <WorkspaceField>
                <label>配置文件名称</label>
                <CompactInput
                  value={activeProfile.name}
                  disabled={!form.canWrite}
                  onInput={(name) => updateActive({ name })}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span>关系契约定位</span>
                <CompactSelect
                  ariaLabel="关系契约定位"
                  value={activeProfile.roleArchetype}
                  disabled={!form.canWrite}
                  options={ROLE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  onChange={(roleArchetype) => updateActive({ roleArchetype: roleArchetype as RoleArchetype })}
                />
              </WorkspaceField>
            </WorkspaceGrid>
            <WorkspaceField>
              <label>适用场景说明</label>
              <CompactInput
                value={activeProfile.description}
                disabled={!form.canWrite}
                onInput={(description) => updateActive({ description })}
              />
            </WorkspaceField>

            <ModelBindingPicker
              label="主力对话"
              providers={chatProviders}
              value={activeProfile.primaryChat}
              disabled={!form.canWrite}
              onChange={(next) => {
                if (next) updateActive({ primaryChat: next });
              }}
            />

            <details className="ai0-workspace-inset">
              <summary style={{ cursor: "pointer", fontWeight: 620, fontSize: 12.5 }}>
                高级：分脑区异构路由（W2 规划 / W3 睡眠 / W4 多模态 / L0 守卫）与算力代谢预算（可选）
              </summary>
              <div className="ai0-workspace-stack" style={{ marginTop: 10 }}>
                <small>未单独指定的脑区将自动继承上方「主力对话」模型。</small>
                <ModelBindingPicker
                  label="低算力降级备用"
                  providers={chatProviders}
                  value={activeProfile.brainRegionOverrides.fallbackChat}
                  allowInherit
                  disabled={!form.canWrite}
                  onChange={(fallbackChat) =>
                    updateActive({ brainRegionOverrides: { ...activeProfile.brainRegionOverrides, fallbackChat } })
                  }
                />
                <ModelBindingPicker
                  label="W2 多步任务规划"
                  providers={chatProviders}
                  value={activeProfile.brainRegionOverrides.W2_agency_planner}
                  allowInherit
                  disabled={!form.canWrite}
                  onChange={(W2_agency_planner) =>
                    updateActive({ brainRegionOverrides: { ...activeProfile.brainRegionOverrides, W2_agency_planner } })
                  }
                />
                <ModelBindingPicker
                  label="W3 后台睡眠整理"
                  providers={chatProviders}
                  value={activeProfile.brainRegionOverrides.W3_sleep_curiosity}
                  allowInherit
                  disabled={!form.canWrite}
                  onChange={(W3_sleep_curiosity) =>
                    updateActive({ brainRegionOverrides: { ...activeProfile.brainRegionOverrides, W3_sleep_curiosity } })
                  }
                />
                <ModelBindingPicker
                  label="W4 多模态理解"
                  providers={chatProviders}
                  value={activeProfile.brainRegionOverrides.W4_multimodal}
                  allowInherit
                  disabled={!form.canWrite}
                  onChange={(W4_multimodal) =>
                    updateActive({ brainRegionOverrides: { ...activeProfile.brainRegionOverrides, W4_multimodal } })
                  }
                />
                <ModelBindingPicker
                  label="L0 安全危机守卫"
                  providers={guardProviders}
                  value={activeProfile.brainRegionOverrides.L0_crisis_classifier}
                  allowInherit
                  disabled={!form.canWrite}
                  onChange={(L0_crisis_classifier) =>
                    updateActive({ brainRegionOverrides: { ...activeProfile.brainRegionOverrides, L0_crisis_classifier } })
                  }
                />

                <WorkspaceItem>
                  <WorkspaceRow>
                    <strong>每日 Token 算力代谢预算</strong>
                    <strong>{remainPct === undefined ? "—" : `余量 ${remainPct}%`}</strong>
                  </WorkspaceRow>
                  {remainPct !== undefined ? (
                    <LinearProgress className="ai0-workspace-meter" variant="determinate" value={remainPct} />
                  ) : null}
                  <WorkspaceGrid columns={3}>
                    <WorkspaceField>
                      <label>每日 Token 上限</label>
                      <CompactInput
                        type="number"
                        step={10000}
                        value={activeProfile.metabolicPolicy.dailyTokenBudget}
                        disabled={!form.canWrite}
                        onInput={(v) =>
                          updateActive({
                            metabolicPolicy: { ...activeProfile.metabolicPolicy, dailyTokenBudget: Math.max(10000, Number(v) || 300000) }
                          })
                        }
                      />
                    </WorkspaceField>
                    <WorkspaceField>
                      <label>犯困降级阈值 (%)</label>
                      <CompactInput
                        type="number"
                        min={5}
                        max={50}
                        unit="%"
                        value={activeProfile.metabolicPolicy.sleepyThresholdPct}
                        disabled={!form.canWrite}
                        onInput={(v) =>
                          updateActive({
                            metabolicPolicy: { ...activeProfile.metabolicPolicy, sleepyThresholdPct: Math.max(5, Math.min(50, Number(v) || 25)) }
                          })
                        }
                      />
                    </WorkspaceField>
                    <div style={{ alignSelf: "end" }}>
                      <JellySwitch
                        label="低余量自动降级"
                        checked={activeProfile.metabolicPolicy.autoDowngradeEnabled}
                        disabled={!form.canWrite}
                        onChange={(autoDowngradeEnabled) =>
                          updateActive({ metabolicPolicy: { ...activeProfile.metabolicPolicy, autoDowngradeEnabled } })
                        }
                      />
                    </div>
                  </WorkspaceGrid>
                </WorkspaceItem>

                <WorkspaceItem>
                  <WorkspaceRow>
                    <strong>内核当前生效脑区路由</strong>
                    <RippleButton size="sm" variant="ghost" onClick={runtimeRoutes.refresh}>刷新</RippleButton>
                  </WorkspaceRow>
                  {runtimeRoutes.data?.regions.length ? runtimeRoutes.data.regions.map(({ region, route }) => (
                    <WorkspaceRow key={region}>
                      <code>{region}</code>
                      <small>{route.selected_model_id}{route.drowsy_downgraded ? " · 已降级" : ""}</small>
                    </WorkspaceRow>
                  )) : <WorkspaceReadState {...runtimeRoutes} empty="等待连接运行时路由状态。" onRetry={runtimeRoutes.refresh} />}
                </WorkspaceItem>
              </div>
            </details>
          </WorkspaceSection>

          <WorkspaceGrid columns={2}>
            <WorkspaceSection>
              <h2>2. 对话节奏、防抖与注意力门控</h2>
              <small>统一控制跨平台话轮合并、焦点仲裁与防刷频率，不再散落在具体接入通道中。</small>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>话轮合并防抖</label>
                  <CompactInput
                    type="number"
                    min={0}
                    unit="ms"
                    value={activeProfile.conversationGate.debounceMs}
                    disabled={!form.canWrite}
                    onInput={(v) =>
                      updateActive({
                        conversationGate: { ...activeProfile.conversationGate, debounceMs: Math.max(0, Number(v) || 0) }
                      })
                    }
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>多端焦点保持窗口</label>
                  <CompactInput
                    type="number"
                    min={0}
                    unit="ms"
                    value={activeProfile.conversationGate.focusHysteresisMs}
                    disabled={!form.canWrite}
                    onInput={(v) =>
                      updateActive({
                        conversationGate: { ...activeProfile.conversationGate, focusHysteresisMs: Math.max(0, Number(v) || 0) }
                      })
                    }
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>每分钟回复速率上限</label>
                  <CompactInput
                    type="number"
                    min={1}
                    max={120}
                    unit="/min"
                    value={activeProfile.conversationGate.rateLimitPerMin}
                    disabled={!form.canWrite}
                    onInput={(v) =>
                      updateActive({
                        conversationGate: { ...activeProfile.conversationGate, rateLimitPerMin: Math.max(1, Number(v) || 12) }
                      })
                    }
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>感官习惯化衰减率</label>
                  <CompactInput
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.02}
                    value={activeProfile.conversationGate.habituationDecayRate}
                    disabled={!form.canWrite}
                    onInput={(v) =>
                      updateActive({
                        conversationGate: { ...activeProfile.conversationGate, habituationDecayRate: Math.max(0.01, Math.min(1, Number(v) || 0.18)) }
                      })
                    }
                  />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceGrid columns={2}>
                <JellySwitch
                  label="感知输入草稿撤回"
                  checked={activeProfile.conversationGate.retractDraftAwareness}
                  disabled={!form.canWrite}
                  onChange={(retractDraftAwareness) =>
                    updateActive({ conversationGate: { ...activeProfile.conversationGate, retractDraftAwareness } })
                  }
                />
                <JellySwitch
                  label="禁止全通道同时广播"
                  checked={activeProfile.conversationGate.neverBroadcastAll}
                  disabled={!form.canWrite}
                  onChange={(neverBroadcastAll) =>
                    updateActive({ conversationGate: { ...activeProfile.conversationGate, neverBroadcastAll } })
                  }
                />
                <JellySwitch
                  label="@ 提及触发回复"
                  checked={activeProfile.conversationGate.triggerAt}
                  disabled={!form.canWrite}
                  onChange={(triggerAt) =>
                    updateActive({ conversationGate: { ...activeProfile.conversationGate, triggerAt } })
                  }
                />
                <JellySwitch
                  label="昵称唤醒触发"
                  checked={activeProfile.conversationGate.triggerNickname}
                  disabled={!form.canWrite}
                  onChange={(triggerNickname) =>
                    updateActive({ conversationGate: { ...activeProfile.conversationGate, triggerNickname } })
                  }
                />
              </WorkspaceGrid>
            </WorkspaceSection>

            <WorkspaceSection>
              <h2>3. 隐私社交面具与通用能力挂载</h2>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>上下文黑板 Token 上限</label>
                  <CompactInput
                    type="number"
                    min={600}
                    max={8000}
                    step={200}
                    unit="tok"
                    value={activeProfile.maxContextTokens}
                    disabled={!form.canWrite}
                    onInput={(v) => updateActive({ maxContextTokens: Math.max(600, Number(v) || 2200) })}
                  />
                </WorkspaceField>
                <WorkspaceField>
                  <label>社交面具情绪阻尼 (%)</label>
                  <CompactInput
                    type="number"
                    min={0}
                    max={100}
                    unit="%"
                    value={activeProfile.socialMaskDampingPct}
                    disabled={!form.canWrite || !activeProfile.socialMaskEnabled}
                    onInput={(v) => updateActive({ socialMaskDampingPct: Math.max(0, Math.min(100, Number(v) || 0)) })}
                  />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceGrid columns={2}>
                <JellySwitch
                  label="启用公开社交面具隔离"
                  checked={activeProfile.socialMaskEnabled}
                  disabled={!form.canWrite}
                  onChange={(socialMaskEnabled) => updateActive({ socialMaskEnabled })}
                />
                <JellySwitch
                  label="允许调用外部工具 / MCP"
                  checked={activeProfile.allowExternalTools}
                  disabled={!form.canWrite}
                  onChange={(allowExternalTools) => updateActive({ allowExternalTools })}
                />
                <JellySwitch
                  label="启用语音合成自动播报"
                  checked={activeProfile.voiceReplyEnabled}
                  disabled={!form.canWrite}
                  onChange={(voiceReplyEnabled) => updateActive({ voiceReplyEnabled })}
                />
              </WorkspaceGrid>

              <WorkspaceItem>
                <strong>已挂载知识库集合</strong>
                <div className="ai0-workspace-actions">
                  {knowledgePacks.length === 0 ? <small>尚未创建知识库集合，可前往「通用能力 → 知识库」导入。</small> : null}
                  {knowledgePacks.map((pack) => {
                    const mounted = activeProfile.knowledgeCollectionIds.includes(pack.id);
                    return (
                      <RippleButton
                        key={pack.id}
                        size="sm"
                        variant={mounted ? "primary" : "secondary"}
                        disabled={!form.canWrite}
                        onClick={() => {
                          const next = mounted
                            ? activeProfile.knowledgeCollectionIds.filter((id) => id !== pack.id)
                            : [...activeProfile.knowledgeCollectionIds, pack.id];
                          updateActive({ knowledgeCollectionIds: next });
                        }}
                      >
                        {mounted ? renderConsoleIcon("check", 12) : renderConsoleIcon("plus", 12)}
                        <span>{pack.name} ({pack.documents})</span>
                      </RippleButton>
                    );
                  })}
                </div>
              </WorkspaceItem>
            </WorkspaceSection>
          </WorkspaceGrid>
        </>
      ) : null}
    </WorkspacePage>
  );
}

function RoutingRulesEditor(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const soulProfiles = props.snapshot?.soulProfiles;
  const profiles = soulProfiles?.profiles ?? [];
  const draft = useWorkspaceDraft<UmoRoutingRule[]>(soulProfiles?.routingRules ?? []);

  const [newLabel, setNewLabel] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newPriority, setNewPriority] = useState(50);
  const [newScope, setNewScope] = useState<AudienceScope>("only_owner");
  const [newProfileId, setNewProfileId] = useState("");
  const pickedProfileId = newProfileId || profiles[0]?.id || "";

  // Live UMO routing simulator
  const [testChannel, setTestChannel] = useState("builtin.webchat");
  const [testVenue, setTestVenue] = useState<VenueType>("private_1on1");
  const [testSession, setTestSession] = useState("owner:local");
  const [testCeiling, setTestCeiling] = useState<AudienceScope>("only_owner");
  const [testResult, setTestResult] = useState<ResolvedSessionRoute | null>(null);
  const [testing, setTesting] = useState(false);

  const form = useWorkspaceSave(
    "config.routing",
    draft.dirty,
    draft.discard,
    async () => {
      await ctx?.putAdmin("config/routing-rules", { routingRules: draft.value }, "live");
    },
    "会话路由规则已保存",
    draft.accept
  );

  const handleAddRule = () => {
    if (!pickedProfileId) return;
    const rule: UmoRoutingRule = {
      id: `rule_${Date.now().toString(36)}`,
      priority: newPriority,
      label: newLabel.trim() || "自定义会话路由",
      umoPattern: newPattern.trim() || "*:*:*",
      audienceScope: newScope,
      profileId: pickedProfileId,
      enabled: true
    };
    draft.setValue((prev) => [...prev, rule]);
    setNewLabel("");
    setNewPattern("");
  };

  const handleTestRoute = async () => {
    if (!ctx || testing) return;
    setTesting(true);
    try {
      const res = await ctx.postAdmin<{ route: ResolvedSessionRoute }>("config/routing-rules/test", {
        channelId: testChannel,
        venueType: testVenue,
        sessionKey: testSession,
        maxAudienceCeiling: testCeiling
      });
      setTestResult(res.route);
    } catch (err) {
      ctx.showToast(`路由测试失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <WorkspacePage data-profiles-rules-page="true">
      <WorkspaceHeader title="会话路由规则 (UMO)">
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>

      <WorkspaceSection>
        <WorkspaceRow>
          <h2>按 UMO 路由至对应配置文件</h2>
          <small>格式：<code>平台ID:场合类型:会话或用户ID</code>（支持 <code>*</code> 通配，优先级数字越小越先匹配，未命中则走全局默认配置）。</small>
        </WorkspaceRow>

        <WorkspaceTable>
          <WorkspaceTableHead>
            <WorkspaceTableRow>
              <WorkspaceTableCell component="th" scope="col">启用</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">优先级</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">规则名称与 UMO 模式</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">受众等级</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">目标配置文件</WorkspaceTableCell>
              <WorkspaceTableCell component="th" scope="col">操作</WorkspaceTableCell>
            </WorkspaceTableRow>
          </WorkspaceTableHead>
          <WorkspaceTableBody>
            {draft.value.map((rule) => {
              const targetProf = profiles.find((p) => p.id === rule.profileId);
              return (
                <WorkspaceTableRow key={rule.id} data-rule-id={rule.id}>
                  <WorkspaceTableCell>
                    <JellySwitch
                      checked={rule.enabled}
                      disabled={!form.canWrite}
                      ariaLabel={`启用 ${rule.label}`}
                      onChange={(enabled) =>
                        draft.setValue((prev) => prev.map((item) => (item.id === rule.id ? { ...item, enabled } : item)))
                      }
                    />
                  </WorkspaceTableCell>
                  <WorkspaceTableCell><code>{rule.priority}</code></WorkspaceTableCell>
                  <WorkspaceTableCell>
                    <strong>{rule.label}</strong>
                    <div className="ai0-workspace-mono">{rule.umoPattern}</div>
                  </WorkspaceTableCell>
                  <WorkspaceTableCell>
                    <WorkspaceStatus data-tone={rule.audienceScope === "only_owner" ? "accent" : rule.audienceScope === "public_all" ? "warn" : "info"}>
                      {rule.audienceScope}
                    </WorkspaceStatus>
                  </WorkspaceTableCell>
                  <WorkspaceTableCell>{targetProf?.name ?? rule.profileId}</WorkspaceTableCell>
                  <WorkspaceTableCell>
                    <RippleButton
                      size="sm"
                      variant="ghost"
                      disabled={!form.canWrite}
                      ariaLabel={`删除 ${rule.label}`}
                      onClick={() => draft.setValue((prev) => prev.filter((item) => item.id !== rule.id))}
                    >
                      {renderConsoleIcon("trash", 13)}
                    </RippleButton>
                  </WorkspaceTableCell>
                </WorkspaceTableRow>
              );
            })}
          </WorkspaceTableBody>
        </WorkspaceTable>

        <WorkspaceGrid columns={4} className="ai0-workspace-divided">
          <WorkspaceField>
            <label>规则名称</label>
            <CompactInput id="new-rule-label" value={newLabel} onInput={setNewLabel} placeholder="例如：QQ 公开群聊" />
          </WorkspaceField>
          <WorkspaceField>
            <label>UMO 匹配模式</label>
            <CompactInput id="new-rule-umo" value={newPattern} onInput={setNewPattern} placeholder="qq.*:group_chat:*" />
          </WorkspaceField>
          <WorkspaceField>
            <span>受众隔离等级</span>
            <CompactSelect
              ariaLabel="受众隔离等级"
              value={newScope}
              onChange={(v) => setNewScope(v as AudienceScope)}
              options={[
                { value: "only_owner", label: "only_owner (仅主账户)" },
                { value: "group:default", label: "group:default (受限群组)" },
                { value: "public_all", label: "public_all (公开隔离)" }
              ]}
            />
          </WorkspaceField>
          <WorkspaceField>
            <span>路由至配置文件</span>
            <CompactSelect
              ariaLabel="路由至配置文件"
              value={pickedProfileId}
              onChange={setNewProfileId}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            />
          </WorkspaceField>
        </WorkspaceGrid>
        <WorkspaceRow>
          <div className="ai0-workspace-actions">
            <CompactInput
              type="number"
              min={0}
              max={1000}
              ariaLabel="规则优先级"
              value={newPriority}
              className="ai0-workspace-count"
              onInput={(v) => setNewPriority(Math.max(0, Number(v) || 50))}
            />
            <small>优先级（数字越小越优先）</small>
          </div>
          <RippleButton variant="secondary" disabled={!form.canWrite} data-add-custom-rule="true" onClick={handleAddRule}>
            {renderConsoleIcon("plus", 13)}
            <span>加入规则列表（保存后生效）</span>
          </RippleButton>
        </WorkspaceRow>
      </WorkspaceSection>

      <WorkspaceSection>
        <WorkspaceRow>
          <h2>在线 UMO 路由命中测试</h2>
          <RippleButton size="sm" variant="primary" loading={testing} data-test-umo-route="true" onClick={() => void handleTestRoute()}>
            {renderConsoleIcon("play", 12)}
            <span>测试命中</span>
          </RippleButton>
        </WorkspaceRow>
        <WorkspaceGrid columns={4}>
          <WorkspaceField>
            <label>来源平台 / Channel ID</label>
            <CompactInput value={testChannel} onInput={setTestChannel} />
          </WorkspaceField>
          <WorkspaceField>
            <span>场合类型</span>
            <CompactSelect
              ariaLabel="场合类型"
              value={testVenue}
              onChange={(v) => setTestVenue(v as VenueType)}
              options={[
                { value: "private_1on1", label: "private_1on1 (私聊)" },
                { value: "group_chat", label: "group_chat (群聊)" },
                { value: "public_livestream", label: "public_livestream (直播间)" },
                { value: "local_ambient", label: "local_ambient (本地环境)" }
              ]}
            />
          </WorkspaceField>
          <WorkspaceField>
            <label>会话 / 用户标识</label>
            <CompactInput value={testSession} onInput={setTestSession} />
          </WorkspaceField>
          <WorkspaceField>
            <span>通道受众上限</span>
            <CompactSelect
              ariaLabel="通道受众上限"
              value={testCeiling}
              onChange={(v) => setTestCeiling(v as AudienceScope)}
              options={[
                { value: "only_owner", label: "only_owner" },
                { value: "group:default", label: "group:default" },
                { value: "public_all", label: "public_all" }
              ]}
            />
          </WorkspaceField>
        </WorkspaceGrid>
        {testResult ? (
          <WorkspaceItem className="ai0-workspace-inset" data-umo-test-result="true">
            <WorkspaceRow>
              <strong>命中配置：{testResult.profileName}</strong>
              <div className="ai0-workspace-actions">
                <WorkspaceTag>模型：{testResult.primaryChat.providerId} / {testResult.primaryChat.modelId}</WorkspaceTag>
                <WorkspaceStatus data-tone={testResult.socialMaskActive ? "warn" : "good"}>
                  有效受众：{testResult.effectiveAudienceScope}{testResult.audienceDowngradedByCeiling ? "（已被通道上限强制降级）" : ""}
                </WorkspaceStatus>
              </div>
            </WorkspaceRow>
            <small>
              UMO: <code>{testResult.umo}</code> · 匹配规则：{testResult.matchedRuleLabel} · 防抖 {testResult.debounceMs}ms · 上下文上限 {testResult.maxContextTokens} tok
            </small>
          </WorkspaceItem>
        ) : null}
      </WorkspaceSection>
    </WorkspacePage>
  );
}

export function ConfigProfilesPage(props: ConfigProfilesPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const route = resolveConsoleRoute(props.pathname);

  return (
    <MainRoundedCardOutlet domainId="config" activePath={props.pathname} onNavigate={props.onNavigate}>
      {route?.id === "config.routing" ? <RoutingRulesEditor snapshot={snap} /> : <ProfilesEditor snapshot={snap} />}
    </MainRoundedCardOutlet>
  );
}
