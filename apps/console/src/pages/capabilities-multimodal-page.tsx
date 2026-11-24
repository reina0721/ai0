import type { ModelSlotBinding, MultimodalCapabilityConfig } from "@ai0/protocol";
import { type ReactElement } from "react";

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
  WorkspaceField,
  WorkspaceGrid,
  WorkspaceItem,
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus
} from "./workspace-layout.js";
import { useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceSaveButton } from "./workspace.js";

export interface CapabilitiesMultimodalPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

const DEFAULT_MULTIMODAL: MultimodalCapabilityConfig = {
  voiceStyleTag: "warm_natural",
  keyframeChoreographyEnabled: true,
  autoSynthesizeOnVoiceVenue: true
};

export function CapabilitiesMultimodalPage(props: CapabilitiesMultimodalPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const allProviders = snap?.infrastructure?.providers ?? [];
  const ttsProviders = allProviders.filter((p) => p.capabilityKind === "tts");
  const sttProviders = allProviders.filter((p) => p.capabilityKind === "stt");
  const extensions = snap?.extensions.filter((ext) => ext.buses.some((bus) => bus.startsWith("ext.media"))) ?? [];
  const intent = snap?.latestTrace?.steps.step7_emitted_intent;

  const draft = useWorkspaceDraft<MultimodalCapabilityConfig>(
    snap?.soulProfiles?.capabilities.multimodal ?? DEFAULT_MULTIMODAL
  );
  const form = useWorkspaceSave(
    "capabilities.multimodal",
    draft.dirty,
    draft.discard,
    async () => {
      await ctx?.patchAdmin("capabilities/multimodal", draft.value as unknown as Record<string, unknown>, "live");
    },
    "语音与多模态能力配置已保存",
    draft.accept
  );

  const setBinding = (field: "ttsBinding" | "sttBinding", providerId: string, list: typeof ttsProviders) => {
    if (!providerId || providerId === "__none__") {
      draft.setValue((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    const prov = list.find((item) => item.id === providerId);
    const next: ModelSlotBinding = { providerId, modelId: prov?.models[0] ?? "" };
    draft.setValue((prev) => ({ ...prev, [field]: next }));
  };

  const ttsSelected = ttsProviders.find((p) => p.id === draft.value.ttsBinding?.providerId);
  const sttSelected = sttProviders.find((p) => p.id === draft.value.sttBinding?.providerId);

  return (
    <MainRoundedCardOutlet domainId="capabilities" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage data-multimodal-capability-page="true">
        <WorkspaceHeader title="语音与多模态">
          <RippleButton size="sm" variant="secondary" onClick={() => ctx?.navigateConsole("/integrations/providers")}>
            {renderConsoleIcon("models", 13)}
            <span>管理语音服务提供商</span>
          </RippleButton>
          <WorkspaceSaveButton form={form} />
        </WorkspaceHeader>

        <WorkspaceSection>
          <WorkspaceRow>
            <h2>上游语音服务绑定（引用接入池）</h2>
            <small>TTS / STT 接口凭据统一在「外部接入 → 服务提供商」维护，此处仅按需引用。</small>
          </WorkspaceRow>
          <WorkspaceGrid columns={2}>
            <WorkspaceItem>
              <strong>语音合成 (TTS)</strong>
              <WorkspaceField>
                <span>TTS 服务提供商</span>
                <CompactSelect
                  ariaLabel="TTS 服务提供商"
                  value={draft.value.ttsBinding?.providerId ?? "__none__"}
                  disabled={!form.canWrite}
                  options={[
                    { value: "__none__", label: "不启用外部 TTS" },
                    ...ttsProviders.map((p) => ({ value: p.id, label: p.label }))
                  ]}
                  onChange={(id) => setBinding("ttsBinding", id, ttsProviders)}
                />
              </WorkspaceField>
              {ttsSelected ? (
                <WorkspaceField>
                  <span>声线模型 ID</span>
                  <CompactSelect
                    ariaLabel="TTS 声线模型"
                    value={draft.value.ttsBinding?.modelId ?? ttsSelected.models[0] ?? ""}
                    disabled={!form.canWrite}
                    options={ttsSelected.models.map((m) => ({ value: m, label: m }))}
                    onChange={(modelId) =>
                      draft.setValue((prev) => ({
                        ...prev,
                        ttsBinding: { providerId: ttsSelected.id, modelId }
                      }))
                    }
                  />
                </WorkspaceField>
              ) : null}
            </WorkspaceItem>

            <WorkspaceItem>
              <strong>语音识别 (STT)</strong>
              <WorkspaceField>
                <span>STT 服务提供商</span>
                <CompactSelect
                  ariaLabel="STT 服务提供商"
                  value={draft.value.sttBinding?.providerId ?? "__none__"}
                  disabled={!form.canWrite}
                  options={[
                    { value: "__none__", label: "不启用外部 STT" },
                    ...sttProviders.map((p) => ({ value: p.id, label: p.label }))
                  ]}
                  onChange={(id) => setBinding("sttBinding", id, sttProviders)}
                />
              </WorkspaceField>
              {sttSelected ? (
                <WorkspaceField>
                  <span>识别模型 ID</span>
                  <CompactSelect
                    ariaLabel="STT 识别模型"
                    value={draft.value.sttBinding?.modelId ?? sttSelected.models[0] ?? ""}
                    disabled={!form.canWrite}
                    options={sttSelected.models.map((m) => ({ value: m, label: m }))}
                    onChange={(modelId) =>
                      draft.setValue((prev) => ({
                        ...prev,
                        sttBinding: { providerId: sttSelected.id, modelId }
                      }))
                    }
                  />
                </WorkspaceField>
              ) : null}
            </WorkspaceItem>
          </WorkspaceGrid>
        </WorkspaceSection>

        <WorkspaceGrid columns={2}>
          <WorkspaceSection>
            <h2>声线风格与具身关键帧编排</h2>
            <WorkspaceField>
              <label>默认情绪声线风格标签</label>
              <CompactInput
                value={draft.value.voiceStyleTag}
                disabled={!form.canWrite}
                onInput={(voiceStyleTag) => draft.setValue((prev) => ({ ...prev, voiceStyleTag }))}
              />
            </WorkspaceField>
            <JellySwitch
              label="启用三锚点具身关键帧（开口前视线先行 → 词中微表情 → 句末余韵）"
              checked={draft.value.keyframeChoreographyEnabled}
              disabled={!form.canWrite}
              onChange={(keyframeChoreographyEnabled) =>
                draft.setValue((prev) => ({ ...prev, keyframeChoreographyEnabled }))
              }
            />
            <JellySwitch
              label="语音场景收到音频输入时自动合成回复音频"
              checked={draft.value.autoSynthesizeOnVoiceVenue}
              disabled={!form.canWrite}
              onChange={(autoSynthesizeOnVoiceVenue) =>
                draft.setValue((prev) => ({ ...prev, autoSynthesizeOnVoiceVenue }))
              }
            />
          </WorkspaceSection>

          <WorkspaceSection>
            <h2>已挂载媒体管线扩展与最近表现帧</h2>
            {extensions.length ? extensions.map((ext) => (
              <WorkspaceRow key={ext.id}>
                <code>{ext.id}</code>
                <WorkspaceStatus data-tone={ext.enabled ? "good" : "neutral"}>
                  {ext.enabled ? "运行中" : "已停用"} · {ext.carrier}
                </WorkspaceStatus>
              </WorkspaceRow>
            )) : <small>当前实例未注册自定义媒体管线扩展。</small>}
            <WorkspaceItem className="ai0-workspace-inset">
              <strong>最近一次表达意图的表现能力</strong>
              {intent ? (
                <small>
                  <code>{intent.intent_id}</code> · {intent.extensions_attached.join("、") || "纯文本输出"}
                </small>
              ) : <small>等待本实例产生表达意图，可在「调试与系统 → 协议模拟器」测试。</small>}
            </WorkspaceItem>
          </WorkspaceSection>
        </WorkspaceGrid>
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
