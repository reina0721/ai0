import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { KnowledgeCapabilityConfig, ModelSlotBinding } from "@ai0/protocol";
import {
  WorkspaceField,
  WorkspaceGrid,
  WorkspaceItem,
  WorkspaceRow,
  WorkspaceSection
} from "./workspace-layout.js";

import { useConsole } from "../context/ConsoleContext.js";
import { CompactInput, CompactSelect, RippleButton, TonalSlider } from "../design-system/primitives/index.js";

import {
  useWorkspaceDraft,
  useWorkspaceSave,
  WorkspaceHeader,
  WorkspaceConfirm,
  WorkspaceSaveButton
} from "./workspace.js";

export function KnowledgeSettings({ back }: { back: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const ctx = useConsole();
  const snap = ctx?.snapshot;
  const studio = snap?.studioConfig;
  const allProviders = snap?.infrastructure?.providers ?? [];
  const embedProviders = allProviders.filter((p) => p.capabilityKind === "embedding");
  const rerankProviders = allProviders.filter((p) => p.capabilityKind === "rerank");
  const knowledgeSource: KnowledgeCapabilityConfig = snap?.soulProfiles?.capabilities.knowledge ?? {
    chunkSize: studio?.ragSettings.chunkSize ?? 500,
    chunkOverlap: studio?.ragSettings.chunkOverlap ?? 80,
    topK: studio?.ragSettings.topK ?? 4,
    denseWeight: studio?.ragSettings.denseWeight ?? 0.65,
    bm25Weight: studio?.ragSettings.bm25Weight ?? 0.35,
    honestForgetThreshold: studio?.ragSettings.honestForgetThreshold ?? 0.38
  };
  const rag = useWorkspaceDraft<KnowledgeCapabilityConfig>(knowledgeSource);
  const {
    chunkSize,
    chunkOverlap,
    topK,
    denseWeight,
    bm25Weight,
    honestForgetThreshold: honestThreshold
  } = rag.value;
  const setRag = (
    key: "chunkSize" | "chunkOverlap" | "topK" | "denseWeight" | "bm25Weight" | "honestForgetThreshold",
    value: number
  ) => rag.setValue((previous) => ({ ...previous, [key]: value }));
  const setModelBinding = (
    field: "embeddingBinding" | "rerankBinding",
    providerId: string,
    list: typeof embedProviders
  ) => {
    if (!providerId || providerId === "__none__") {
      rag.setValue((previous) => ({ ...previous, [field]: undefined }));
      return;
    }
    const prov = list.find((item) => item.id === providerId);
    const binding: ModelSlotBinding = { providerId, modelId: prov?.models[0] ?? "" };
    rag.setValue((previous) => ({ ...previous, [field]: binding }));
  };
  const form = useWorkspaceSave(
    "capabilities.knowledge",
    rag.dirty,
    rag.discard,
    async () => {
      if (chunkOverlap >= chunkSize) throw new Error("切片重叠长度必须小于切片大小。");
      await ctx?.patchAdmin(
        "capabilities/knowledge",
        {
          ...rag.value,
          embeddingBinding: rag.value.embeddingBinding ?? null,
          rerankBinding: rag.value.rerankBinding ?? null
        },
        "live"
      );
    },
    "知识库模型绑定与检索参数已保存",
    rag.accept
  );
  const embedSelected = embedProviders.find((p) => p.id === rag.value.embeddingBinding?.providerId);
  const rerankSelected = rerankProviders.find((p) => p.id === rag.value.rerankBinding?.providerId);

  return (
    <>
      <RippleButton variant="ghost" size="sm"
        type="button"
        className="kb-back"
        disabled={form.saving}
        onClick={() => (rag.dirty ? setLeaving(true) : back())}
      >
        <ArrowLeft size={14} />
        知识库目录
      </RippleButton>
      {leaving && (
        <WorkspaceConfirm
          title="放弃未保存的检索设置？"
          description="返回目录后，本次编辑将被丢弃。"
          onCancel={() => setLeaving(false)}
          onConfirm={back}
        />
      )}
      <WorkspaceHeader title="检索设置">
        <RippleButton variant="secondary" onClick={() => ctx?.navigateConsole("/integrations/providers")}>
          管理服务商
        </RippleButton>
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>
      <WorkspaceSection>
        <WorkspaceRow>
          <h2>检索模型</h2>
          <small>未绑定模型时使用本地全文检索。凭据在「服务提供商」中维护。</small>
        </WorkspaceRow>
        <WorkspaceGrid columns={2}>
          <WorkspaceItem>
            <strong>向量嵌入 (Embedding)</strong>
            <WorkspaceGrid columns={2}>
              <WorkspaceField>
                <span>服务提供商</span>
                <CompactSelect
                  ariaLabel="Embedding 服务提供商"
                  value={rag.value.embeddingBinding?.providerId ?? "__none__"}
                  disabled={!form.canWrite}
                  options={[
                    { value: "__none__", label: "仅使用内置 FTS5 关键词检索" },
                    ...embedProviders.map((p) => ({ value: p.id, label: p.label }))
                  ]}
                  onChange={(id) => setModelBinding("embeddingBinding", id, embedProviders)}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span>模型 ID</span>
                {embedSelected ? (
                  <CompactSelect
                    ariaLabel="Embedding 模型 ID"
                    value={rag.value.embeddingBinding?.modelId ?? embedSelected.models[0] ?? ""}
                    disabled={!form.canWrite}
                    options={embedSelected.models.map((m) => ({ value: m, label: m }))}
                    onChange={(modelId) =>
                      rag.setValue((prev) => ({
                        ...prev,
                        embeddingBinding: { providerId: embedSelected.id, modelId }
                      }))
                    }
                  />
                ) : (
                  <CompactInput value="未绑定" disabled ariaLabel="Embedding 模型 ID" onInput={() => {}} />
                )}
              </WorkspaceField>
            </WorkspaceGrid>
          </WorkspaceItem>

          <WorkspaceItem>
            <strong>结果重排 (Reranker)</strong>
            <WorkspaceGrid columns={2}>
              <WorkspaceField>
                <span>服务提供商</span>
                <CompactSelect
                  ariaLabel="Reranker 服务提供商"
                  value={rag.value.rerankBinding?.providerId ?? "__none__"}
                  disabled={!form.canWrite}
                  options={[
                    { value: "__none__", label: "不启用精排重打分" },
                    ...rerankProviders.map((p) => ({ value: p.id, label: p.label }))
                  ]}
                  onChange={(id) => setModelBinding("rerankBinding", id, rerankProviders)}
                />
              </WorkspaceField>
              <WorkspaceField>
                <span>模型 ID</span>
                {rerankSelected ? (
                  <CompactSelect
                    ariaLabel="Reranker 模型 ID"
                    value={rag.value.rerankBinding?.modelId ?? rerankSelected.models[0] ?? ""}
                    disabled={!form.canWrite}
                    options={rerankSelected.models.map((m) => ({ value: m, label: m }))}
                    onChange={(modelId) =>
                      rag.setValue((prev) => ({
                        ...prev,
                        rerankBinding: { providerId: rerankSelected.id, modelId }
                      }))
                    }
                  />
                ) : (
                  <CompactInput value="未绑定" disabled ariaLabel="Reranker 模型 ID" onInput={() => {}} />
                )}
              </WorkspaceField>
            </WorkspaceGrid>
          </WorkspaceItem>
        </WorkspaceGrid>
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>切片与混合检索权重</h2>
        <WorkspaceGrid columns={2}>
          <WorkspaceField>
            <label>分块大小 (chunk_size)</label>
            <CompactInput
              disabled={!form.canWrite}
              id="rag-chunk-size"
              type="number"
              value={chunkSize}
              unit="chars"
              onInput={(v) => setRag("chunkSize", Number(v) || 500)}
            />
          </WorkspaceField>
          <WorkspaceField>
            <label>分块重叠 (chunk_overlap)</label>
            <CompactInput
              disabled={!form.canWrite}
              id="rag-chunk-overlap"
              type="number"
              value={chunkOverlap}
              unit="chars"
              onInput={(v) => setRag("chunkOverlap", Number(v))}
            />
          </WorkspaceField>
          <WorkspaceField>
            <label>召回数量 (Top-K)</label>
            <CompactInput
              disabled={!form.canWrite}
              id="rag-topk"
              type="number"
              value={topK}
              onInput={(v) => setRag("topK", Number(v) || 4)}
            />
          </WorkspaceField>
          <WorkspaceField>
            <label>低置信度诚实兜底阈值</label>
            <CompactInput
              disabled={!form.canWrite}
              id="rag-honest-threshold"
              type="number"
              step={0.05}
              value={honestThreshold}
              onInput={(v) => setRag("honestForgetThreshold", Number(v))}
            />
          </WorkspaceField>
          <TonalSlider
            disabled={!form.canWrite}
            id="rag-dense-weight"
            label="稠密向量权重"
            min={0}
            max={1}
            step={0.05}
            value={denseWeight}
            onInput={(value) => setRag("denseWeight", value)}
          />
          <TonalSlider
            disabled={!form.canWrite}
            id="rag-bm25-weight"
            label="FTS5 BM25 权重"
            min={0}
            max={1}
            step={0.05}
            value={bm25Weight}
            onInput={(value) => setRag("bm25Weight", value)}
          />
        </WorkspaceGrid>
      </WorkspaceSection>
    </>
  );
}
