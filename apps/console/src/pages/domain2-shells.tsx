import {
  WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceStatus, WorkspaceTable, WorkspaceTableBody, WorkspaceTableCell, WorkspaceTableHead,
  WorkspaceTableRow, WorkspaceTag
} from "./workspace-layout.js";
import { useState, type ReactElement } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { CompactInput, CompactSelect, JellySwitch, RippleButton } from "../design-system/primitives/index.js";
import { MainRoundedCardOutlet } from "../design-system/shell/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { resolveConsoleRoute, type ConsoleRoute } from "../router/routes.js";
import { ShellControlWorkspace } from "./shell-control-workspace.js";
import { WorkspaceHeader } from "./workspace.js";

export interface Domain2ShellsPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

export function Domain2ShellsPage(props: Domain2ShellsPageProps): ReactElement {
  const ctx = useConsole();
  const route = resolveConsoleRoute(props.pathname);
  const snap = props.snapshot ?? ctx?.snapshot;
  const studio = snap?.studioConfig;
  const [newRuleUmo, setNewRuleUmo] = useState("");
  const [newRuleLabel, setNewRuleLabel] = useState("");
  const [newRuleScope, setNewRuleScope] = useState<"only_owner" | "fixed_group" | "public_all">("only_owner");
  const [ruleProfile, setNewRuleProfile] = useState("");
  const newRuleProfile = ruleProfile || studio?.profiles[0]?.id || "";

  // Audience Policies & Channel Rules
  if (route?.id === "shells.profiles-rules") {
    const profiles = studio?.profiles ?? [];
    const rules = studio?.customRules ?? [];

    const handleAddRule = async () => {
      if (!ctx || ctx.mode !== "live" || !studio) return;
      const umo = newRuleUmo.trim() || `adapter:channel:${Date.now().toString().slice(-6)}`;
      const label = newRuleLabel.trim() || "新建会话规则";
      const nextRules = [
        ...studio.customRules,
        {
          id: `rule_${Date.now()}`,
          umo,
          label,
          platform: umo.split(":")[0] || "shell.default",
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
      if (!ctx || ctx.mode !== "live" || !studio) return;
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
        <WorkspacePage data-profiles-rules-page="true">
          <WorkspaceHeader title="受众与策略">

            <RippleButton
              variant="primary"
              data-add-custom-rule="true"
              disabled={!studio || ctx?.mode !== "live"}
              onClick={() => void handleAddRule()}
            >
              {renderConsoleIcon("plus", 14)}
              <span>添加通道规则</span>
            </RippleButton>

          </WorkspaceHeader>

          <WorkspaceSection>
            <WorkspaceRow>
              <h2>受众策略模板 (Profiles)</h2>
            </WorkspaceRow>
            <WorkspaceGrid columns={3}>
              {profiles.map((profile) => (
                <WorkspaceItem key={profile.id} as="article" data-profile-id={profile.id}>
                  <WorkspaceRow>
                    <strong>{profile.name}</strong>
                    <WorkspaceStatus data-tone={profile.socialMaskEnabled ? "warn" : "accent"}>
                      {profile.socialMaskEnabled ? `社交面具 ${profile.socialMaskDampingPct}%` : "私密完整"}
                    </WorkspaceStatus>
                  </WorkspaceRow>
                  <div className="ai0-workspace-actions">
                    <WorkspaceTag>{profile.llmProviderId}</WorkspaceTag>
                    <WorkspaceTag>{profile.tokenBudgetPreset} tok</WorkspaceTag>
                  </div>
                </WorkspaceItem>
              ))}
            </WorkspaceGrid>
          </WorkspaceSection>

          <WorkspaceSection>
            <WorkspaceRow>
              <h2>已绑定通道规则</h2>
            </WorkspaceRow>
            <><WorkspaceTable>
              <WorkspaceTableHead>
                <WorkspaceTableRow>
                  <WorkspaceTableCell component="th" scope="col">启用</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">通道标识 (UMO)</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">受众等级</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">策略模板</WorkspaceTableCell>
                  <WorkspaceTableCell component="th" scope="col">速率限制</WorkspaceTableCell>
                </WorkspaceTableRow>
              </WorkspaceTableHead>
              <WorkspaceTableBody>
                {rules.map((rule) => (
                  <WorkspaceTableRow key={rule.id} data-rule-id={rule.id}>
                    <WorkspaceTableCell>
                      <JellySwitch
                        checked={rule.enabled}
                        data-toggle-rule={rule.id}
                        disabled={ctx?.mode !== "live"}
                        ariaLabel={`启用 ${rule.label}`}
                        onChange={(enabled) => void handleToggleRule(rule.id, enabled)}
                      />
                    </WorkspaceTableCell>
                    <WorkspaceTableCell>
                      <strong>{rule.label}</strong>
                      <div className="ai0-workspace-mono">
                        {rule.umo}
                      </div>
                    </WorkspaceTableCell>
                    <WorkspaceTableCell>
                      <WorkspaceStatus

                        data-tone={rule.audienceScope === "only_owner" ? "accent" : rule.audienceScope === "public_all" ? "warn" : "info"}
                      >
                        {rule.audienceScope === "only_owner"
                          ? "only_owner"
                          : rule.audienceScope === "public_all"
                            ? "public_all (70% 面具)"
                            : "fixed_group"}
                      </WorkspaceStatus>
                    </WorkspaceTableCell>
                    <WorkspaceTableCell><code>{rule.profileId}</code></WorkspaceTableCell>
                    <WorkspaceTableCell><small>{rule.rateLimitPerMin}/min</small></WorkspaceTableCell>
                  </WorkspaceTableRow>
                ))}
              </WorkspaceTableBody>
            </WorkspaceTable></>

            <WorkspaceGrid columns={4} className="ai0-workspace-divided">
              <WorkspaceField>
                <label>外部通道 UMO 标识</label>
                <CompactInput
                  id="new-rule-umo"
                  type="text"
                  placeholder="adapter:channel:id"
                  value={newRuleUmo}
                  onInput={setNewRuleUmo}
                />
              </WorkspaceField>
              <WorkspaceField>
                <label>规则名称</label>
                <CompactInput
                  id="new-rule-label"
                  type="text"
                  placeholder="自定义规则名"
                  value={newRuleLabel}
                  onInput={setNewRuleLabel}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span id="new-rule-scope-label">受众等级</span>
                <CompactSelect
                  id="new-rule-scope"
                  labelId="new-rule-scope-label"
                  value={newRuleScope}
                  onChange={(v) => setNewRuleScope(v as typeof newRuleScope)}
                  options={[
                    { value: "only_owner", label: "only_owner (仅主账户)" },
                    { value: "fixed_group", label: "fixed_group (受限成员)" },
                    { value: "public_all", label: "public_all (公开隔离)" }
                  ]}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span id="new-rule-profile-label">绑定策略</span>
                <CompactSelect
                  id="new-rule-profile"
                  labelId="new-rule-profile-label"
                  value={newRuleProfile}
                  onChange={setNewRuleProfile}
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                />
              </WorkspaceField>
            </WorkspaceGrid>
          </WorkspaceSection>
        </WorkspacePage>
      </MainRoundedCardOutlet>
    );
  }

  return (
    <MainRoundedCardOutlet domainId="shells" activePath={props.pathname} onNavigate={props.onNavigate}>
      <ShellControlWorkspace key={route?.id} routeId={route?.id} snapshot={snap} />
    </MainRoundedCardOutlet>
  );
}
