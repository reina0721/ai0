import {
  getSupportedReasoningEfforts,
  HOSTED_CHAT_PROVIDER_TEMPLATES,
  isOpenRouterBaseUrl,
  type DiscoveredRemoteModel,
  type KeyRotationStrategy,
  type ModelInstance,
  type ProviderAdapterType,
  type ProviderCapabilityKind,
  type ProviderCatalogSource,
  type ProviderSource,
  type ReasoningEffort
} from "@ai0/protocol";
import ButtonBase from "@mui/material/ButtonBase";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

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
  WorkspacePage,
  WorkspaceRow,
  WorkspaceSection,
  WorkspaceStatus,
  WorkspaceTag
} from "./workspace-layout.js";
import { WorkspaceConfirm, WorkspaceHeader } from "./workspace.js";

export interface IntegrationsProvidersPageProps {
  pathname: string;
  snapshot?: ConsoleLiveSnapshot;
  onNavigate?: (path: string, route?: ConsoleRoute) => void;
}

const CAPABILITY_TABS: ReadonlyArray<{ id: "all" | ProviderCapabilityKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "chat", label: "LLM 对话" },
  { id: "embedding", label: "Embedding" },
  { id: "rerank", label: "Rerank" },
  { id: "tts", label: "TTS 语音" },
  { id: "stt", label: "STT 识别" },
  { id: "guard_lora", label: "本地守卫" }
];

const CAPABILITY_LABELS: Record<ProviderCapabilityKind, string> = {
  chat: "LLM 对话",
  embedding: "Embedding",
  rerank: "Rerank",
  tts: "TTS 语音",
  stt: "STT 识别",
  guard_lora: "本地守卫"
};

const REASONING_EFFORT_LABELS: Readonly<Record<ReasoningEffort, string>> = {
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高"
};

const MIN_CONTEXT_WINDOW = 512;
const MAX_CONTEXT_WINDOW = 4_000_000;
const MIN_OUTPUT_TOKENS = 64;
const MAX_OUTPUT_TOKENS = 128_000;

interface VendorTemplate {
  id: string;
  label: string;
  vendor: string;
  supportedCapabilities: readonly ProviderCapabilityKind[];
  adapterType: ProviderAdapterType;
  baseUrl: string;
  description: string;
}

const VENDOR_TEMPLATES: readonly VendorTemplate[] = [
  {
    id: "tpl_deepseek",
    label: "DeepSeek 官方",
    vendor: "DeepSeek",
    supportedCapabilities: ["chat"],
    adapterType: "deepseek",
    baseUrl: "https://api.deepseek.com",
    description: "官方高性价比对话与 R1 深度推理"
  },
  {
    id: "tpl_openai",
    label: "OpenAI / 兼容中转",
    vendor: "OpenAI Compatible",
    supportedCapabilities: ["chat", "embedding", "tts", "stt"],
    adapterType: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI 官方或 OneAPI / NewAPI 聚合站"
  },
  {
    id: "tpl_anthropic",
    label: "Anthropic Claude",
    vendor: "Anthropic",
    supportedCapabilities: ["chat"],
    adapterType: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    description: "长上下文推理、视觉与工具调用"
  },
  {
    id: "tpl_gemini",
    label: "Google Gemini",
    vendor: "Google",
    supportedCapabilities: ["chat", "embedding"],
    adapterType: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    description: "OpenAI 兼容端点，支持多模态与超长上下文"
  },
  {
    id: "tpl_siliconflow",
    label: "SiliconFlow 硅基流动",
    vendor: "SiliconFlow",
    supportedCapabilities: ["chat", "embedding", "rerank"],
    adapterType: "openai_compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    description: "单来源共用 Key：对话 + 向量嵌入 + 重排"
  },
  ...HOSTED_CHAT_PROVIDER_TEMPLATES.map(({ defaultBaseUrl, ...template }) => ({
    ...template,
    baseUrl: defaultBaseUrl
  })),
  {
    id: "tpl_ollama",
    label: "Ollama 本地引擎",
    vendor: "Ollama",
    supportedCapabilities: ["chat", "embedding"],
    adapterType: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    description: "本机免密钥运行，自动拉取 /api/tags"
  },
  {
    id: "tpl_tts",
    label: "FishAudio / GPT-SoVITS",
    vendor: "FishAudio / GPT-SoVITS",
    supportedCapabilities: ["tts"],
    adapterType: "custom_http",
    baseUrl: "http://127.0.0.1:9880",
    description: "本地情感声线合成与口型时间戳端点"
  },
  {
    id: "tpl_stt",
    label: "SenseVoice / FunASR",
    vendor: "FunASR / SenseVoice",
    supportedCapabilities: ["stt"],
    adapterType: "custom_http",
    baseUrl: "http://127.0.0.1:8009",
    description: "流式语音转写与情感特征识别"
  }
];

interface CatalogRequest {
  loading: boolean;
  notice: string;
  failed?: boolean;
}

const EMPTY_REMOTE_MODELS: readonly DiscoveredRemoteModel[] = [];
const CATALOG_SOURCE_LABELS: Record<ProviderCatalogSource, string> = {
  upstream: "上游 API",
  official_docs: "官方文档",
  built_in: "内建目录"
};

function modelCatalogNeedsRefresh(
  source: ProviderSource,
  model: Pick<ModelInstance, "modelId" | "catalogContextWindow" | "catalogMaxOutputTokens" | "supportedReasoningEfforts">,
  entry?: DiscoveredRemoteModel
): boolean {
  const missingContext = (entry?.contextWindow ?? model.catalogContextWindow) === undefined;
  const missingOutput = (entry?.maxOutputTokens ?? model.catalogMaxOutputTokens) === undefined;
  if (source.adapterType === "opencode_go" || source.adapterType === "openrouter" || isOpenRouterBaseUrl(source.baseUrl)) {
    return missingContext || missingOutput || (entry?.supportedReasoningEfforts ?? model.supportedReasoningEfforts) === undefined;
  }
  const isOfficialGemini = source.adapterType === "gemini" &&
    /^https:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?\/openai\/?$/iu.test(source.baseUrl.trim());
  if (source.adapterType === "anthropic" || isOfficialGemini ||
      (source.adapterType === "zhipu" && /^glm-5\.3(?:-|$)/u.test(model.modelId))) {
    return missingContext || missingOutput;
  }
  return source.adapterType === "moonshot" && missingContext;
}

function getSourceMonogram(src: ProviderSource): string {
  const hay = `${src.vendor} ${src.label} ${src.adapterType}`.toLowerCase();
  if (hay.includes("deepseek")) return "DS";
  if (hay.includes("anthropic") || hay.includes("claude")) return "CL";
  if (hay.includes("openai")) return "OA";
  if (hay.includes("gemini") || hay.includes("google")) return "GM";
  if (hay.includes("siliconflow") || hay.includes("硅基")) return "SF";
  if (hay.includes("openrouter")) return "OR";
  if (hay.includes("ollama")) return "OL";
  if (hay.includes("fish") || hay.includes("sovits") || src.supportedCapabilities.includes("tts")) return "TTS";
  if (hay.includes("sensevoice") || hay.includes("funasr") || src.supportedCapabilities.includes("stt")) return "STT";
  if (src.supportedCapabilities.includes("guard_lora")) return "L0";
  if (src.supportedCapabilities.includes("rerank")) return "RR";
  if (src.supportedCapabilities.includes("embedding")) return "EM";
  return src.label.slice(0, 2).toUpperCase();
}

export function IntegrationsProvidersPage(props: IntegrationsProvidersPageProps): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const sources = snap?.infrastructure?.providerSources ?? [];
  const models = snap?.infrastructure?.modelInstances ?? [];
  const sourceUsages = snap?.providerUsages ?? {};
  const modelUsages = snap?.modelUsages ?? {};
  const canWrite = Boolean(ctx?.mode === "live" && ctx.ownerToken);

  const [category, setCategory] = useState<"all" | ProviderCapabilityKind>("all");
  const [search, setSearch] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");

  // Source draft fields
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftStrategy, setDraftStrategy] = useState<KeyRotationStrategy>("round_robin");
  const [draftProxyUrl, setDraftProxyUrl] = useState("");
  const [draftTimeoutMs, setDraftTimeoutMs] = useState("60000");
  const [draftHeadersText, setDraftHeadersText] = useState("{}");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savingSource, setSavingSource] = useState(false);

  // Add key inline inputs
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);

  // Remote Fetch Models Drawer
  const [catalogSourceId, setCatalogSourceId] = useState<string>();
  const [catalogRequests, setCatalogRequests] = useState<Record<string, CatalogRequest>>({});
  const activeSourceId = useRef<string | undefined>(undefined);
  const fetchingCatalogs = useRef(new Set<string>());
  const automaticallyRefreshedModelCatalogs = useRef(new Set<string>());
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | ProviderCapabilityKind>("all");
  const [catalogSelection, setCatalogSelection] = useState<{ sourceId: string; modelIds: readonly string[] }>();
  const [importingCatalog, setImportingCatalog] = useState(false);

  // Testing state
  const [testingModelId, setTestingModelId] = useState<string>();
  const [modelActionBusy, setModelActionBusy] = useState<string>();

  // Add Source Dialog
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [pickedTemplateId, setPickedTemplateId] = useState("tpl_openai");
  const [addSrcLabel, setAddSrcLabel] = useState("OpenAI / 兼容中转");
  const [addSrcVendor, setAddSrcVendor] = useState("OpenAI Compatible");
  const [addSrcAdapter, setAddSrcAdapter] = useState<ProviderAdapterType>("openai_compatible");
  const [addSrcCap, setAddSrcCap] = useState<ProviderCapabilityKind>("chat");
  const [addSrcUrl, setAddSrcUrl] = useState("https://api.openai.com/v1");
  const [addSrcKey, setAddSrcKey] = useState("");
  const [creatingSource, setCreatingSource] = useState(false);

  // Edit Model Dialog
  const [editingModel, setEditingModel] = useState<ModelInstance | null>(null);
  const [editModelName, setEditModelName] = useState("");
  const [editModelCap, setEditModelCap] = useState<ProviderCapabilityKind>("chat");
  const [editModelTemp, setEditModelTemp] = useState("0.75");
  const [editModelMaxTok, setEditModelMaxTok] = useState<string>();
  const [editModelCtx, setEditModelCtx] = useState<string>();
  const [editReasoningEffort, setEditReasoningEffort] = useState<ReasoningEffort | "">("");
  const [editModelVision, setEditModelVision] = useState(false);
  const [editModelTools, setEditModelTools] = useState(true);
  const [editModelReasoning, setEditModelReasoning] = useState(false);
  const [editModelParamsJson, setEditModelParamsJson] = useState("{}");
  const [savingModel, setSavingModel] = useState(false);

  const editingSource = editingModel ? sources.find((source) => source.id === editingModel.sourceId) : undefined;
  const editingCatalogModel = editingSource?.discoveredModels.find((entry) => entry.modelId === editingModel?.modelId);
  const catalogContextWindow = editingCatalogModel?.contextWindow ?? editingModel?.catalogContextWindow;
  const catalogWindowIsInputLimit = editingCatalogModel?.contextWindow !== undefined
    ? editingCatalogModel.contextWindowIsInputLimit === true : editingModel?.catalogContextWindowIsInputLimit === true;
  const catalogMaxOutputTokens = editingCatalogModel?.maxOutputTokens ?? editingModel?.catalogMaxOutputTokens;
  const supportsTemperature = editingCatalogModel?.supportsTemperature ?? editingModel?.supportsTemperature;
  const catalogEffortOptions = editingCatalogModel?.supportedReasoningEfforts ?? editingModel?.supportedReasoningEfforts;
  const supportedReasoningEfforts = editingSource && editingModel && editModelCap === "chat"
    ? getSupportedReasoningEfforts(editingSource.adapterType, editingModel.modelId, {
        supportedReasoningEfforts: catalogEffortOptions,
        chatProtocol: editingCatalogModel?.chatProtocol ?? editingModel.chatProtocol
      }, editingSource.baseUrl)
    : [];
  const reasoningOptions = [
    { value: "" as const, label: "默认" },
    ...supportedReasoningEfforts.map((effort) => ({ value: effort, label: REASONING_EFFORT_LABELS[effort] }))
  ];
  const unsupportedReasoningEffort = editModelCap === "chat" && editReasoningEffort !== "" &&
    !supportedReasoningEfforts.includes(editReasoningEffort);
  const needsModelCatalogRefresh = editingSource && editingModel && editModelCap === "chat" &&
    modelCatalogNeedsRefresh(editingSource, editingModel, editingCatalogModel);
  const modelCatalogRequest = editingSource ? catalogRequests[editingSource.id] : undefined;
  const hasSavedManualOutput = editingModel !== null && (
    editingModel.useCatalogMaxOutputTokens === false ||
    (editingModel.useCatalogMaxOutputTokens === undefined &&
      editingModel.defaultMaxTokens !== (editingModel.capabilityKind === "chat" ? 4096 : 512))
  );
  const contextWindowValue = editModelCtx ?? String(editingModel?.contextWindowOverride ?? catalogContextWindow ?? editingModel?.contextWindow ?? "");
  const maxOutputValue = editModelMaxTok ?? String(
    (hasSavedManualOutput ? undefined : catalogMaxOutputTokens) ?? editingModel?.defaultMaxTokens ?? ""
  );
  const contextWindowOverride = editModelCtx === undefined
    ? editingModel?.contextWindowOverride ?? null
    : editModelCtx.trim() ? Number(editModelCtx) : null;
  const useCatalogContextWindow = contextWindowOverride === null &&
    (catalogContextWindow !== undefined || editingModel?.useCatalogContextWindow === true);
  const contextWindowError = contextWindowOverride !== null &&
    (!Number.isInteger(contextWindowOverride) || contextWindowOverride < MIN_CONTEXT_WINDOW || contextWindowOverride > MAX_CONTEXT_WINDOW)
    ? "请输入 512 到 4000000 之间的整数。"
    : undefined;
  const maxOutputTokens = editModelMaxTok?.trim() ? Number(editModelMaxTok) : undefined;
  const useCatalogMaxOutputTokens = maxOutputTokens !== undefined ? false
    : catalogMaxOutputTokens !== undefined && (editModelMaxTok !== undefined || !hasSavedManualOutput)
      ? true : editingModel?.useCatalogMaxOutputTokens;
  const maxOutputTokensError = maxOutputTokens !== undefined &&
    (!Number.isInteger(maxOutputTokens) || maxOutputTokens < MIN_OUTPUT_TOKENS || maxOutputTokens > MAX_OUTPUT_TOKENS)
    ? "请输入 64 到 128000 之间的整数。"
    : undefined;

  // Delete confirmations
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<ProviderSource | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<ModelInstance | null>(null);
  const [deleting, setDeleting] = useState(false);

  const query = search.trim().toLowerCase();

  const filteredSources = useMemo(() => {
    return sources.filter((src) => {
      const srcModels = models.filter((m) => m.sourceId === src.id);
      if (category !== "all") {
        const matchesCat =
          src.supportedCapabilities.includes(category) ||
          srcModels.some((m) => m.capabilityKind === category);
        if (!matchesCat) return false;
      }
      if (!query) return true;
      return (
        src.label.toLowerCase().includes(query) ||
        src.vendor.toLowerCase().includes(query) ||
        src.id.toLowerCase().includes(query) ||
        srcModels.some(
          (m) => m.modelId.toLowerCase().includes(query) || m.displayName.toLowerCase().includes(query)
        )
      );
    });
  }, [sources, models, category, query]);

  const activeSource = useMemo(() => {
    return (
      filteredSources.find((s) => s.id === selectedSourceId) ??
      sources.find((s) => s.id === selectedSourceId) ??
      filteredSources[0] ??
      sources[0]
    );
  }, [filteredSources, sources, selectedSourceId]);

  const catalogRequest = activeSource ? catalogRequests[activeSource.id] : undefined;
  const fetchingModels = catalogRequest?.loading ?? false;
  const remoteModels = activeSource?.discoveredModels ?? EMPTY_REMOTE_MODELS;
  const activeCatalogByModelId = useMemo(() => new Map(remoteModels.map((model) => [model.modelId, model])), [remoteModels]);
  const catalogSource = activeSource?.catalogSource;
  const registeredModelIds = new Set(models.filter((model) => model.sourceId === activeSource?.id).map((model) => model.modelId));
  const selectedCatalogIds = catalogSelection?.sourceId === activeSource?.id ? catalogSelection?.modelIds : undefined;
  const selectedModels = remoteModels
    .filter((model) => selectedCatalogIds?.includes(model.modelId) && !registeredModelIds.has(model.modelId))
    .map((model) => model.modelId);

  useEffect(() => {
    activeSourceId.current = activeSource?.id;
    if (!activeSource) return;
    setSelectedSourceId(activeSource.id);
    setDraftLabel(activeSource.label);
    setDraftBaseUrl(activeSource.baseUrl);
    setDraftStrategy(activeSource.keyRotationStrategy);
    setDraftProxyUrl(activeSource.proxyUrl);
    setDraftTimeoutMs(String(activeSource.timeoutMs));
    setDraftHeadersText(JSON.stringify(activeSource.customHeaders ?? {}, null, 2));
  }, [activeSource?.id, activeSource?.lastFetchedAt]);

  const activeSourceModels = useMemo(() => {
    if (!activeSource) return [];
    return models.filter((m) => {
      if (m.sourceId !== activeSource.id) return false;
      if (category !== "all" && m.capabilityKind !== category) return false;
      if (query && !activeSource.label.toLowerCase().includes(query) && !activeSource.vendor.toLowerCase().includes(query)) {
        return m.modelId.toLowerCase().includes(query) || m.displayName.toLowerCase().includes(query);
      }
      return true;
    });
  }, [activeSource, models, category, query]);

  const applyTemplate = (tplId: string) => {
    setPickedTemplateId(tplId);
    const tpl = VENDOR_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    setAddSrcLabel(tpl.label);
    setAddSrcVendor(tpl.vendor);
    setAddSrcAdapter(tpl.adapterType);
    setAddSrcCap(tpl.supportedCapabilities[0] ?? "chat");
    setAddSrcUrl(tpl.baseUrl);
  };

  const openModelCatalog = (sourceId: string) => {
    setCatalogSelection(undefined);
    setCatalogSourceId(sourceId);
  };

  const handleCreateSource = async () => {
    if (!ctx || !canWrite || creatingSource) return;
    if (!addSrcLabel.trim()) {
      ctx.showToast("请填写服务来源名称");
      return;
    }
    setCreatingSource(true);
    try {
      const tpl = VENDOR_TEMPLATES.find((t) => t.id === pickedTemplateId);
      const supportedCaps = tpl
        ? Array.from(new Set([addSrcCap, ...tpl.supportedCapabilities]))
        : [addSrcCap];
      const res = await ctx.postAdmin<{ source?: ProviderSource }>("integrations/sources", {
        label: addSrcLabel.trim(),
        vendor: addSrcVendor.trim() || addSrcLabel.trim(),
        adapterType: addSrcAdapter,
        supportedCapabilities: supportedCaps,
        baseUrl: addSrcUrl.trim(),
        initialApiKey: addSrcKey.trim(),
        enabled: true
      }, "live");
      setAddSrcKey("");
      setAddSourceOpen(false);
      await ctx.refreshSnapshot();
      if (res.source) {
        setSelectedSourceId(res.source.id);
        openModelCatalog(res.source.id);
        void handleFetchRemoteModels(res.source);
      }
    } catch (err) {
      ctx.showToast(`新增失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreatingSource(false);
    }
  };

  const handleSaveSource = async (andFetchModels = false) => {
    if (!ctx || !canWrite || !activeSource || savingSource) return;
    let parsedHeaders: Record<string, string> = {};
    try {
      const obj = JSON.parse(draftHeadersText.trim() || "{}") as unknown;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("自定义请求头必须是 JSON 对象");
      }
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        parsedHeaders[k] = String(v);
      }
    } catch (err) {
      ctx.showToast(`高级参数 JSON 有误：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    setSavingSource(true);
    try {
      const { source } = await ctx.patchAdmin<{ source?: ProviderSource }>(`integrations/sources/${encodeURIComponent(activeSource.id)}`, {
        label: draftLabel.trim() || activeSource.label,
        baseUrl: draftBaseUrl.trim(),
        keyRotationStrategy: draftStrategy,
        proxyUrl: draftProxyUrl.trim(),
        timeoutMs: Math.max(1000, Number(draftTimeoutMs) || 60000),
        customHeaders: parsedHeaders
      }, "live");
      if (source && activeSource.lastFetchedAt && !source.lastFetchedAt) {
        setCatalogRequests(({ [source.id]: _request, ...requests }) => requests);
        setCatalogSelection((selection) => selection?.sourceId === source.id ? undefined : selection);
      }
      await ctx.refreshSnapshot();
      ctx.showToast(`已保存来源「${draftLabel.trim() || activeSource.label}」`);
      if (andFetchModels) {
        if (activeSourceId.current === activeSource.id) openModelCatalog(activeSource.id);
        await handleFetchRemoteModels(source ?? activeSource);
      }
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSource(false);
    }
  };

  const handleToggleSourceEnabled = async (src: ProviderSource, enabled: boolean) => {
    if (!ctx || !canWrite) return;
    try {
      await ctx.patchAdmin(`integrations/sources/${encodeURIComponent(src.id)}`, { enabled }, "live");
      await ctx.refreshSnapshot();
      ctx.showToast(`来源「${src.label}」已${enabled ? "启用" : "停用"}`);
    } catch (err) {
      ctx.showToast(`切换失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAddApiKey = async () => {
    if (!ctx || !canWrite || !activeSource || !newKeyValue.trim() || keyBusy) return;
    setKeyBusy(true);
    try {
      await ctx.postAdmin(`integrations/sources/${encodeURIComponent(activeSource.id)}/keys`, {
        apiKey: newKeyValue.trim(),
        label: newKeyLabel.trim()
      }, "live");
      setNewKeyValue("");
      setNewKeyLabel("");
      await ctx.refreshSnapshot();
      ctx.showToast("已将密钥添加到轮询池");
    } catch (err) {
      ctx.showToast(`添加密钥失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const handleToggleApiKey = async (keyId: string, enabled: boolean) => {
    if (!ctx || !canWrite || !activeSource || keyBusy) return;
    setKeyBusy(true);
    try {
      await ctx.patchAdmin(
        `integrations/sources/${encodeURIComponent(activeSource.id)}/keys/${encodeURIComponent(keyId)}`,
        { enabled },
        "live"
      );
      await ctx.refreshSnapshot();
    } catch (err) {
      ctx.showToast(`更新密钥状态失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const handleRemoveApiKey = async (keyId: string) => {
    if (!ctx || !canWrite || !activeSource || keyBusy) return;
    setKeyBusy(true);
    try {
      await ctx.deleteAdmin(
        `integrations/sources/${encodeURIComponent(activeSource.id)}/keys/${encodeURIComponent(keyId)}`,
        "live"
      );
      await ctx.refreshSnapshot();
      ctx.showToast("已从轮询池移除该密钥");
    } catch (err) {
      ctx.showToast(`移除密钥失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const handleFetchRemoteModels = async (source: ProviderSource, showToast = true) => {
    if (!ctx || !canWrite || fetchingCatalogs.current.has(source.id)) return;
    const sourceId = source.id;
    fetchingCatalogs.current.add(sourceId);
    setCatalogRequests((current) => ({
      ...current,
      [sourceId]: { ...current[sourceId], loading: true, notice: "正在向上游拉取可用模型目录…" }
    }));
    try {
      const res = await ctx.postAdmin<{
        ok: boolean;
        detail: string;
      }>(`integrations/sources/${encodeURIComponent(sourceId)}/fetch-models`, {}, "live");
      if (res.ok && !(await ctx.refreshSnapshot())) {
        throw new Error("模型目录已拉取，读取最新状态失败，请重试。");
      }
      setCatalogRequests((current) => ({
        ...current,
        [sourceId]: { loading: false, notice: res.detail, failed: !res.ok }
      }));
      if (showToast) ctx.showToast(res.detail);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCatalogRequests((current) => ({
        ...current,
        [sourceId]: { loading: false, notice: `拉取失败：${msg}`, failed: true }
      }));
      if (showToast) ctx.showToast(`拉取模型失败：${msg}`);
    } finally {
      fetchingCatalogs.current.delete(sourceId);
    }
  };

  const fetchModelCatalogOnce = (source: ProviderSource) => {
    if (automaticallyRefreshedModelCatalogs.current.has(source.id)) return;
    automaticallyRefreshedModelCatalogs.current.add(source.id);
    void handleFetchRemoteModels(source, false);
  };

  const handleImportCatalogModels = async () => {
    if (!ctx || !canWrite || !activeSource || fetchingModels || importingCatalog || selectedModels.length === 0) return;
    const sourceId = activeSource.id;
    setImportingCatalog(true);
    try {
      await ctx.postAdmin(`integrations/sources/${encodeURIComponent(sourceId)}/import-models`, { modelIds: selectedModels }, "live");
      await ctx.refreshSnapshot();
      setCatalogSelection((selection) => selection?.sourceId === sourceId ? undefined : selection);
      ctx.showToast(`已添加 ${selectedModels.length} 个模型`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.showToast(message === "MODEL_NOT_IN_CATALOG"
        ? "部分模型已不在目录中，请重新拉取后再选择。"
        : `添加模型失败：${message}`);
    } finally {
      setImportingCatalog(false);
    }
  };

  const handleToggleModel = async (mdl: ModelInstance, enabled: boolean) => {
    if (!ctx || !canWrite || modelActionBusy) return;
    setModelActionBusy(mdl.id);
    try {
      await ctx.patchAdmin(`integrations/models/${encodeURIComponent(mdl.id)}`, { enabled }, "live");
      await ctx.refreshSnapshot();
      ctx.showToast(`模型「${mdl.displayName}」已${enabled ? "启用" : "停用"}`);
    } catch (err) {
      ctx.showToast(`更新状态失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setModelActionBusy(undefined);
    }
  };

  const handleTestModel = async (mdl: ModelInstance) => {
    if (!ctx || testingModelId) return;
    setTestingModelId(mdl.id);
    try {
      const res = await ctx.postAdmin<{ ok: boolean; detail: string }>(
        `integrations/models/${encodeURIComponent(mdl.id)}/test`,
        {},
        "live"
      );
      await ctx.refreshSnapshot();
      ctx.showToast(res.detail);
    } catch (err) {
      ctx.showToast(`测试失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingModelId(undefined);
    }
  };

  const openEditModel = (mdl: ModelInstance) => {
    setEditingModel(mdl);
    setEditModelName(mdl.displayName);
    setEditModelCap(mdl.capabilityKind);
    setEditModelTemp(String(mdl.defaultTemperature));
    setEditModelMaxTok(undefined);
    setEditModelCtx(undefined);
    setEditReasoningEffort(mdl.reasoningEffort ?? "");
    setEditModelVision(mdl.capabilities.vision);
    setEditModelTools(mdl.capabilities.tools);
    setEditModelReasoning(mdl.capabilities.reasoning);
    setEditModelParamsJson(JSON.stringify(mdl.customParams ?? {}, null, 2));

    const source = sources.find((item) => item.id === mdl.sourceId);
    const catalogEntry = source?.discoveredModels.find((entry) => entry.modelId === mdl.modelId);
    if (source && mdl.capabilityKind === "chat" && modelCatalogNeedsRefresh(source, mdl, catalogEntry)) fetchModelCatalogOnce(source);
  };

  const handleSaveModelParams = async () => {
    if (!ctx || !canWrite || !editingModel || savingModel || contextWindowError || maxOutputTokensError || unsupportedReasoningEffort) return;
    let customParams: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(editModelParamsJson.trim() || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("自定义参数必须是 JSON 对象");
      }
      customParams = parsed as Record<string, unknown>;
    } catch (err) {
      ctx.showToast(`自定义参数 JSON 有误：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSavingModel(true);
    try {
      await ctx.patchAdmin(`integrations/models/${encodeURIComponent(editingModel.id)}`, {
        displayName: editModelName.trim() || editingModel.modelId,
        capabilityKind: editModelCap,
        ...(supportsTemperature === false ? {} : { defaultTemperature: Math.max(0, Math.min(2, Number(editModelTemp) || 0)) }),
        ...(maxOutputTokens === undefined ? {} : { defaultMaxTokens: maxOutputTokens }),
        ...(useCatalogMaxOutputTokens === undefined ? {} : { useCatalogMaxOutputTokens }),
        useCatalogContextWindow,
        contextWindowOverride,
        reasoningEffort: editModelCap === "chat" ? editReasoningEffort || null : null,
        capabilities: {
          vision: editModelVision,
          tools: editModelTools,
          reasoning: editModelReasoning,
          streaming: editingModel.capabilities.streaming
        },
        customParams
      }, "live");
      await ctx.refreshSnapshot();
      setEditingModel(null);
      ctx.showToast(`已保存模型「${editModelName.trim() || editingModel.modelId}」参数`);
    } catch (err) {
      ctx.showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingModel(false);
    }
  };

  const handleConfirmDeleteSource = async () => {
    if (!ctx || !canWrite || !deleteSourceTarget || deleting) return;
    setDeleting(true);
    try {
      await ctx.deleteAdmin(`integrations/sources/${encodeURIComponent(deleteSourceTarget.id)}`, "live");
      setDeleteSourceTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已删除来源「${deleteSourceTarget.label}」`);
    } catch (err) {
      ctx.showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteModel = async () => {
    if (!ctx || !canWrite || !deleteModelTarget || deleting) return;
    setDeleting(true);
    try {
      await ctx.deleteAdmin(`integrations/models/${encodeURIComponent(deleteModelTarget.id)}`, "live");
      setDeleteModelTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已移除模型「${deleteModelTarget.displayName}」`);
    } catch (err) {
      ctx.showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  const filteredRemoteModels = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return remoteModels.filter((item) => {
      if (catalogFilter !== "all" && item.inferredCapability !== catalogFilter) return false;
      if (!q) return true;
      return item.modelId.toLowerCase().includes(q) || (item.ownedBy ?? "").toLowerCase().includes(q);
    });
  }, [remoteModels, catalogSearch, catalogFilter]);

  return (
    <MainRoundedCardOutlet domainId="integrations" activePath={props.pathname} onNavigate={props.onNavigate}>
      <WorkspacePage data-providers-page="true">
        <WorkspaceHeader title="服务提供商">
          <RippleButton variant="secondary" size="sm" onClick={() => ctx?.navigateConsole("/config/profiles")}>
            {renderConsoleIcon("rules", 13)}
            <span>去配置文件指派模型</span>
          </RippleButton>
          <RippleButton
            variant="primary"
            data-add-provider="true"
            disabled={!canWrite}
            onClick={() => setAddSourceOpen(true)}
          >
            {renderConsoleIcon("plus", 14)}
            <span>新增服务来源</span>
          </RippleButton>
        </WorkspaceHeader>

        <div className="ai0-filter-bar">
          <div className="ai0-filter-bar__search">
            <CompactInput
              type="search"
              ariaLabel="搜索服务来源或模型"
              value={search}
              placeholder="搜索来源名称、厂商或 Model ID…"
              onInput={setSearch}
            />
          </div>
          <div className="ai0-cap-segment" role="tablist" aria-label="服务能力分类">
            {CAPABILITY_TABS.map((tab) => (
              <ButtonBase
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={category === tab.id}
                className="ai0-cap-segment__btn"
                data-provider-filter={tab.id}
                onClick={() => setCategory(tab.id)}
              >
                {tab.label}
              </ButtonBase>
            ))}
          </div>
        </div>

        <div className="ai0-master-detail">
          {/* Left Rail: Tier-1 Provider Sources (Cherry Studio / LobeChat / AstrBot tonal list) */}
          <aside className="ai0-source-rail" aria-label="服务提供商来源列表">
            <div className="ai0-source-rail__header">
              <strong>服务来源 ({filteredSources.length})</strong>
              <RippleButton
                size="sm"
                variant="ghost"
                ariaLabel="快速新增服务来源"
                disabled={!canWrite}
                onClick={() => setAddSourceOpen(true)}
              >
                {renderConsoleIcon("plus", 13)}
              </RippleButton>
            </div>
            {filteredSources.map((src) => {
              const srcModels = models.filter((m) => m.sourceId === src.id);
              const enabledCount = srcModels.filter((m) => m.enabled).length;
              const isSelected = activeSource?.id === src.id;
              const envKeysCount = src.apiKeys.filter((k) => k.kind === "env_var").length;
              const isLocalNoKey = src.adapterType === "ollama" || src.adapterType === "builtin_local" || src.baseUrl.includes("127.0.0.1") || src.baseUrl.includes("localhost");
              const hasActiveKey = src.apiKeys.some((k) => k.enabled && (k.kind === "vault_secret" || k.envPresent));
              const dotState = !src.enabled
                ? "disabled"
                : hasActiveKey || isLocalNoKey
                  ? "ready"
                  : "needs_key";
              const keySummary =
                src.apiKeys.length > 0
                  ? `${src.apiKeys.length} Keys${envKeysCount > 0 ? " · $ENV" : ""}`
                  : isLocalNoKey
                    ? "本地免密钥"
                    : "待配密钥";
              return (
                <ButtonBase
                  key={src.id}
                  type="button"
                  className="ai0-source-item"
                  data-source-item={src.id}
                  data-selected={isSelected}
                  onClick={() => setSelectedSourceId(src.id)}
                >
                  <span className="ai0-vendor-avatar" aria-hidden="true">
                    {getSourceMonogram(src)}
                  </span>
                  <div className="ai0-source-item__body">
                    <span className="ai0-source-item__name">{src.label}</span>
                    <span className="ai0-source-item__meta">{keySummary}</span>
                  </div>
                  <div className="ai0-source-item__trail">
                    <span
                      className="ai0-source-dot"
                      data-state={dotState}
                      title={!src.enabled ? "已停用" : dotState === "ready" ? "已就绪" : "待配置 API Key"}
                    />
                    <span className="ai0-source-count" title={`已启用 ${enabledCount} / 共 ${srcModels.length} 个模型`}>
                      {enabledCount}
                    </span>
                  </div>
                </ButtonBase>
              );
            })}
            {!filteredSources.length ? (
              <small style={{ padding: 8 }}>当前筛选下暂无服务来源。</small>
            ) : null}
          </aside>

          {/* Right Workbench: Source Credentials + Tier-2 Model Instances */}
          <div className="ai0-workspace-stack">
            {activeSource ? (
              <>
                <WorkspaceSection data-source-workbench={activeSource.id}>
                  <WorkspaceRow>
                    <div>
                      <div className="ai0-entity-card__title-row">
                        <h2>{activeSource.label}</h2>
                        <WorkspaceTag>{activeSource.adapterType}</WorkspaceTag>
                        {activeSource.supportedCapabilities.map((cap) => (
                          <WorkspaceStatus key={cap} data-tone="info">{CAPABILITY_LABELS[cap]}</WorkspaceStatus>
                        ))}
                      </div>
                      <small>{activeSource.vendor} · 来源 ID: <code>{activeSource.id}</code></small>
                    </div>
                    <div className="ai0-workspace-actions">
                      <JellySwitch
                        label="启用来源"
                        checked={activeSource.enabled}
                        disabled={!canWrite}
                        onChange={(enabled) => void handleToggleSourceEnabled(activeSource, enabled)}
                      />
                      <RippleButton
                        size="sm"
                        variant="ghost"
                        ariaLabel={`删除来源 ${activeSource.label}`}
                        data-delete-source={activeSource.id}
                        disabled={!canWrite}
                        onClick={() => setDeleteSourceTarget(activeSource)}
                      >
                        {renderConsoleIcon("trash", 14)}
                      </RippleButton>
                    </div>
                  </WorkspaceRow>

                  <WorkspaceGrid columns={2}>
                    <WorkspaceField>
                      <label>来源显示名称</label>
                      <CompactInput
                        ariaLabel="来源显示名称"
                        value={draftLabel}
                        disabled={!canWrite}
                        onInput={setDraftLabel}
                      />
                    </WorkspaceField>
                    <WorkspaceField>
                      <label>API Base URL</label>
                      <CompactInput
                        type="url"
                        ariaLabel="来源 API Base URL"
                        value={draftBaseUrl}
                        disabled={!canWrite}
                        onInput={setDraftBaseUrl}
                      />
                    </WorkspaceField>
                  </WorkspaceGrid>

                  {/* Multi-Key Rotation Pool */}
                  <div className="ai0-key-pool" data-key-pool={activeSource.id}>
                    <WorkspaceRow>
                      <strong>API Key 轮询池（支持多 Key 负载均衡与 <code>$ENV_VAR</code> 环境变量）</strong>
                      <div style={{ minWidth: 185 }}>
                        <CompactSelect
                          ariaLabel="Key 轮询策略"
                          value={draftStrategy}
                          disabled={!canWrite}
                          onChange={(v) => setDraftStrategy(v as KeyRotationStrategy)}
                          options={[
                            { value: "round_robin", label: "轮询均衡 (Round-Robin)" },
                            { value: "failover", label: "主备故障转移 (Failover)" }
                          ]}
                        />
                      </div>
                    </WorkspaceRow>

                    {activeSource.apiKeys.map((entry) => (
                      <div key={entry.id} className="ai0-key-row" data-key-entry={entry.id}>
                        <div className="ai0-entity-card__title-row">
                          {renderConsoleIcon("key", 13)}
                          <code>{entry.maskedPreview}</code>
                          {entry.label ? <small>{entry.label}</small> : null}
                          {entry.kind === "env_var" ? (
                            <WorkspaceStatus data-tone={entry.envPresent ? "live" : "warn"}>
                              {entry.envPresent ? "环境变量已注入" : "环境变量未设置"}
                            </WorkspaceStatus>
                          ) : (
                            <WorkspaceTag>Host Vault</WorkspaceTag>
                          )}
                        </div>
                        <div className="ai0-workspace-actions">
                          <JellySwitch
                            ariaLabel={`启用密钥 ${entry.label || entry.id}`}
                            checked={entry.enabled}
                            disabled={!canWrite || keyBusy}
                            onChange={(enabled) => void handleToggleApiKey(entry.id, enabled)}
                          />
                          <RippleButton
                            size="sm"
                            variant="ghost"
                            ariaLabel={`删除密钥 ${entry.id}`}
                            disabled={!canWrite || keyBusy}
                            onClick={() => void handleRemoveApiKey(entry.id)}
                          >
                            {renderConsoleIcon("trash", 13)}
                          </RippleButton>
                        </div>
                      </div>
                    ))}

                    {activeSource.apiKeys.length === 0 ? (
                      <small>
                        {activeSource.adapterType === "ollama" || activeSource.adapterType === "builtin_local"
                          ? "本地服务默认无需 API Key，如需鉴权可在下方添加。"
                          : "尚未添加密钥：可直接粘贴 sk-... 存入宿主机 Vault，或输入 $DEEPSEEK_API_KEY 引用环境变量。"}
                      </small>
                    ) : null}

                    <div className="ai0-key-add-row">
                      <CompactInput
                        ariaLabel="新增 API Key 或环境变量"
                        value={newKeyValue}
                        disabled={!canWrite || keyBusy}
                        placeholder="输入 sk-... 或 $ENV_VAR_NAME"
                        onInput={setNewKeyValue}
                      />
                      <CompactInput
                        ariaLabel="密钥备注"
                        value={newKeyLabel}
                        disabled={!canWrite || keyBusy}
                        placeholder="备注（可选，如 备用 Key）"
                        onInput={setNewKeyLabel}
                      />
                      <RippleButton
                        size="sm"
                        variant="secondary"
                        data-add-source-key="true"
                        loading={keyBusy}
                        disabled={!canWrite || !newKeyValue.trim()}
                        onClick={() => void handleAddApiKey()}
                      >
                        {renderConsoleIcon("plus", 13)}
                        <span>添加密钥</span>
                      </RippleButton>
                    </div>
                  </div>

                  {/* Collapsible Advanced Connection Settings */}
                  <div>
                    <RippleButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAdvanced((v) => !v)}
                    >
                      {renderConsoleIcon("sliders", 13)}
                      <span>{showAdvanced ? "收起高级连接参数" : "展开高级连接参数（代理 / 超时 / 自定义请求头）"}</span>
                    </RippleButton>
                    {showAdvanced ? (
                      <div className="ai0-workspace-stack" style={{ marginTop: 8 }}>
                        <WorkspaceGrid columns={2}>
                          <WorkspaceField>
                            <label>独立代理地址 (Proxy URL，留空继承系统设置)</label>
                            <CompactInput
                              ariaLabel="来源代理地址"
                              value={draftProxyUrl}
                              disabled={!canWrite}
                              placeholder="http://127.0.0.1:7890"
                              onInput={setDraftProxyUrl}
                            />
                          </WorkspaceField>
                          <WorkspaceField>
                            <label>请求超时 (ms)</label>
                            <CompactInput
                              type="number"
                              ariaLabel="请求超时毫秒"
                              value={draftTimeoutMs}
                              disabled={!canWrite}
                              onInput={setDraftTimeoutMs}
                            />
                          </WorkspaceField>
                        </WorkspaceGrid>
                        <WorkspaceField>
                          <label>自定义 HTTP 请求头 (JSON)</label>
                          <CompactInput
                            multiline
                            rows={3}
                            ariaLabel="自定义请求头 JSON"
                            value={draftHeadersText}
                            disabled={!canWrite}
                            onInput={setDraftHeadersText}
                          />
                        </WorkspaceField>
                      </div>
                    ) : null}
                  </div>

                  <WorkspaceRow>
                    <small>
                      {(sourceUsages[activeSource.id]?.length ?? 0) > 0
                        ? `当前被 ${sourceUsages[activeSource.id]!.length} 处配置引用`
                        : "当前来源尚未被配置文件引用"}
                    </small>
                    <div className="ai0-workspace-actions">
                      <RippleButton
                        size="sm"
                        variant="secondary"
                        data-save-source="true"
                        loading={savingSource}
                        disabled={!canWrite}
                        onClick={() => void handleSaveSource(false)}
                      >
                        {renderConsoleIcon("save", 13)}
                        <span>保存来源配置</span>
                      </RippleButton>
                      <RippleButton
                        size="sm"
                        variant="primary"
                        data-fetch-source-models="true"
                        loading={fetchingModels}
                        disabled={!canWrite}
                        onClick={() => void handleSaveSource(true)}
                      >
                        {renderConsoleIcon("refresh", 13)}
                        <span>保存并拉取模型目录</span>
                      </RippleButton>
                    </div>
                  </WorkspaceRow>
                </WorkspaceSection>

                {/* Tier-2: Model Instances under this Source */}
                <WorkspaceSection>
                  <WorkspaceRow>
                    <div>
                      <h2>该来源下的模型实例 ({activeSourceModels.length})</h2>
                      <small>每个模型可独立启停、标注视觉/工具/深度思考能力并单独发起真实连通性测试。</small>
                    </div>
                    <div className="ai0-workspace-actions">
                      <RippleButton
                        size="sm"
                        variant="primary"
                        data-open-remote-catalog="true"
                        onClick={() => {
                          openModelCatalog(activeSource.id);
                          if (!activeSource.lastFetchedAt || remoteModels.some((entry) =>
                            entry.inferredCapability === "chat" && modelCatalogNeedsRefresh(activeSource, { modelId: entry.modelId }, entry)
                          )) fetchModelCatalogOnce(activeSource);
                        }}
                      >
                        {renderConsoleIcon("download", 13)}
                        <span>模型目录 ({remoteModels.length})</span>
                      </RippleButton>
                    </div>
                  </WorkspaceRow>

                  {!activeSourceModels.length ? (
                    <small>该来源下暂无模型实例。打开模型目录，选择要添加的模型。</small>
                  ) : (
                    <div className="ai0-card-grid">
                      {activeSourceModels.map((mdl) => {
                        const usages = modelUsages[mdl.id] ?? [];
                        const catalogModel = activeCatalogByModelId.get(mdl.modelId);
                        const catalogWindow = catalogModel?.contextWindow ?? mdl.catalogContextWindow;
                        const catalogIsInputLimit = catalogModel?.contextWindow !== undefined
                          ? catalogModel.contextWindowIsInputLimit === true : mdl.catalogContextWindowIsInputLimit === true;
                        const totalCatalogWindow = catalogIsInputLimit ? undefined : catalogWindow;
                        const contextWindow = mdl.contextWindowOverride === undefined
                          ? catalogWindow ?? mdl.contextWindow
                          : Math.min(mdl.contextWindowOverride, totalCatalogWindow ?? Number.POSITIVE_INFINITY);
                        const windowLabel = mdl.contextWindowOverride === undefined && catalogWindow !== undefined && catalogIsInputLimit
                          ? "最大输入" : "上下文";
                        const status = mdl.health.status;
                        const tone =
                          status === "ready"
                            ? "live"
                            : status === "error"
                              ? "danger"
                              : status === "configured"
                                ? "info"
                                : "warn";
                        return (
                          <article
                            key={mdl.id}
                            className="ai0-entity-card"
                            data-model-card={mdl.id}
                            data-disabled={!mdl.enabled}
                          >
                            <div className="ai0-entity-card__header">
                              <div className="ai0-entity-card__title">
                                <div className="ai0-entity-card__title-row">
                                  <strong>{mdl.displayName}</strong>
                                  <WorkspaceStatus data-tone="info">{CAPABILITY_LABELS[mdl.capabilityKind]}</WorkspaceStatus>
                                </div>
                                <small><code>{mdl.modelId}</code></small>
                              </div>
                              <JellySwitch
                                ariaLabel={`启用模型 ${mdl.displayName}`}
                                checked={mdl.enabled}
                                disabled={!canWrite || modelActionBusy === mdl.id}
                                onChange={(enabled) => void handleToggleModel(mdl, enabled)}
                              />
                            </div>

                            <div className="ai0-entity-card__body">
                              <div className="ai0-entity-card__badges">
                                <WorkspaceStatus data-tone={tone} data-model-status={mdl.id}>
                                  {status === "ready" && mdl.health.latencyMs > 0
                                    ? `就绪 ${mdl.health.latencyMs}ms`
                                    : status === "ready"
                                      ? "就绪"
                                      : status === "error"
                                        ? "测试失败"
                                        : status === "configured"
                                          ? "待配密钥"
                                          : "未测试"}
                                </WorkspaceStatus>
                                {mdl.capabilities.vision ? <WorkspaceTag>视觉 Vision</WorkspaceTag> : null}
                                {mdl.capabilities.tools ? <WorkspaceTag>工具 Tools</WorkspaceTag> : null}
                                {mdl.capabilities.reasoning ? <WorkspaceTag>深度思考</WorkspaceTag> : null}
                                {contextWindow === undefined ? null : (
                                  <WorkspaceTag>{windowLabel} {contextWindow.toLocaleString("zh-CN")} Tokens</WorkspaceTag>
                                )}
                                {mdl.reasoningEffort ? (
                                  <WorkspaceTag>推理强度 {REASONING_EFFORT_LABELS[mdl.reasoningEffort]}</WorkspaceTag>
                                ) : null}
                              </div>

                              {mdl.health.detail ? (
                                <small>{mdl.health.detail}</small>
                              ) : null}

                              {usages.length > 0 ? (
                                <div className="ai0-entity-card__badges">
                                  {usages.slice(0, 2).map((u) => (
                                    <span key={`${u.scope}:${u.targetId}`} className="ai0-usage-pill">
                                      {u.targetLabel}
                                    </span>
                                  ))}
                                  {usages.length > 2 ? (
                                    <span className="ai0-usage-pill">+{usages.length - 2} 处引用</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            <div className="ai0-entity-card__footer">
                              <div className="ai0-entity-card__actions">
                                <RippleButton
                                  size="sm"
                                  variant="secondary"
                                  data-test-model={mdl.id}
                                  loading={testingModelId === mdl.id}
                                  disabled={Boolean(testingModelId)}
                                  onClick={() => void handleTestModel(mdl)}
                                >
                                  {renderConsoleIcon("zap", 12)}
                                  <span>测试</span>
                                </RippleButton>
                                <RippleButton
                                  size="sm"
                                  variant="secondary"
                                  ariaLabel={`模型参数 ${mdl.displayName}`}
                                  data-edit-model={mdl.id}
                                  disabled={!canWrite}
                                  onClick={() => openEditModel(mdl)}
                                >
                                  {renderConsoleIcon("sliders", 12)}
                                  <span>模型参数</span>
                                </RippleButton>
                              </div>
                              <RippleButton
                                size="sm"
                                variant="ghost"
                                ariaLabel={`删除模型 ${mdl.displayName}`}
                                data-delete-model={mdl.id}
                                disabled={!canWrite}
                                onClick={() => setDeleteModelTarget(mdl)}
                              >
                                {renderConsoleIcon("trash", 13)}
                              </RippleButton>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </WorkspaceSection>
              </>
            ) : (
              <WorkspaceSection>
                <small>请先点击右上角「新增服务来源」添加大模型或多模态接入点。</small>
              </WorkspaceSection>
            )}
          </div>
        </div>

        {/* Remote Model Catalog Slide-over Drawer */}
        <Drawer
          anchor="right"
          open={catalogSourceId !== undefined && catalogSourceId === activeSource?.id}
          onClose={() => setCatalogSourceId(undefined)}
          slotProps={{ paper: { className: "ai0-drawer-surface" } }}
        >
          <header className="ai0-drawer-header">
            <div>
              <h2 style={{ margin: 0 }}>模型目录 · {activeSource?.label}</h2>
              {catalogSource ? <WorkspaceTag>目录来源：{CATALOG_SOURCE_LABELS[catalogSource]}</WorkspaceTag> : null}
              <small role="status" style={{ display: "block" }}>
                {catalogRequest?.notice || (activeSource?.lastFetchedAt ? `已缓存 ${remoteModels.length} 个模型` : "尚未拉取模型目录")}
              </small>
            </div>
            <div className="ai0-workspace-actions">
              {activeSource ? (
                <RippleButton
                  size="sm"
                  variant="secondary"
                  ariaLabel="重新拉取"
                  loading={fetchingModels}
                  disabled={!canWrite || importingCatalog}
                  onClick={() => void handleFetchRemoteModels(activeSource)}
                >
                  {renderConsoleIcon("refresh", 13)}
                  <span>重新拉取</span>
                </RippleButton>
              ) : null}
              <RippleButton size="sm" variant="ghost" ariaLabel="关闭模型目录" onClick={() => setCatalogSourceId(undefined)}>
                {renderConsoleIcon("close", 15)}
              </RippleButton>
            </div>
          </header>
          <div className="ai0-drawer-body">
            <div className="ai0-filter-bar">
              <div className="ai0-filter-bar__search">
                <CompactInput
                  type="search"
                  ariaLabel="过滤远端模型"
                  value={catalogSearch}
                  placeholder="搜索远端 Model ID…"
                  onInput={setCatalogSearch}
                />
              </div>
              <div style={{ minWidth: 130 }}>
                <CompactSelect
                  ariaLabel="筛选远端模型能力"
                  value={catalogFilter}
                  onChange={(v) => setCatalogFilter(v as "all" | ProviderCapabilityKind)}
                  options={CAPABILITY_TABS.map((t) => ({ value: t.id, label: t.label }))}
                />
              </div>
            </div>

            {filteredRemoteModels.map((item) => {
              const alreadyAdded = registeredModelIds.has(item.modelId);
              return (
                <div key={item.modelId} className="ai0-remote-model-row" data-remote-model={item.modelId}>
                  <div style={{ minWidth: 0 }}>
                    <div><strong><code>{item.modelId}</code></strong></div>
                    <div className="ai0-entity-card__badges" style={{ marginTop: 4 }}>
                      <WorkspaceStatus data-tone="info">{CAPABILITY_LABELS[item.inferredCapability]}</WorkspaceStatus>
                      {item.capabilities?.vision ? <WorkspaceTag>Vision</WorkspaceTag> : null}
                      {item.capabilities?.reasoning ? <WorkspaceTag>Reasoning</WorkspaceTag> : null}
                      {item.ownedBy ? <small>{item.ownedBy}</small> : null}
                    </div>
                  </div>
                  <div className="ai0-workspace-actions">
                    {alreadyAdded ? <WorkspaceStatus data-tone="good">已添加</WorkspaceStatus> : null}
                    <Checkbox
                      size="small"
                      checked={alreadyAdded || (selectedCatalogIds?.includes(item.modelId) ?? false)}
                      disabled={!canWrite || alreadyAdded || importingCatalog || fetchingModels}
                      slotProps={{ input: { "aria-label": `选择模型 ${item.modelId}` } }}
                      onChange={(_, checked) => {
                        if (!activeSource) return;
                        const sourceId = activeSource.id;
                        setCatalogSelection((selection) => {
                          const previous = selection?.sourceId === sourceId ? selection.modelIds : [];
                          return {
                            sourceId,
                            modelIds: checked ? [...previous, item.modelId] : previous.filter((id) => id !== item.modelId)
                          };
                        });
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {!filteredRemoteModels.length ? (
              <small>
                {fetchingModels
                  ? "正在请求上游接口…"
                  : "暂无匹配模型。可调整筛选条件或重新拉取。"}
              </small>
            ) : null}
          </div>
          {canWrite ? (
            <footer className="ai0-drawer-footer">
              <small>已选 {selectedModels.length} 个模型</small>
              <RippleButton
                size="sm"
                variant="primary"
                ariaLabel="添加所选模型"
                loading={importingCatalog}
                disabled={fetchingModels || selectedModels.length === 0}
                onClick={() => void handleImportCatalogModels()}
              >
                {renderConsoleIcon("plus", 13)}
                <span>添加所选模型</span>
              </RippleButton>
            </footer>
          ) : null}
        </Drawer>

        {/* Add Source Dialog with Vendor Template Grid */}
        <Dialog open={addSourceOpen} onClose={() => !creatingSource && setAddSourceOpen(false)} fullWidth maxWidth="md">
          <DialogTitle>新增服务提供商来源</DialogTitle>
          <DialogContent>
            <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
              <div>
                <small>选择厂商模板（也可自由修改 Base URL 接入任意兼容代理）：</small>
                <div className="ai0-vendor-grid" style={{ marginTop: 8 }}>
                  {VENDOR_TEMPLATES.map((tpl) => (
                    <ButtonBase
                      key={tpl.id}
                      type="button"
                      className="ai0-vendor-tile"
                      data-vendor-template={tpl.id}
                      aria-pressed={pickedTemplateId === tpl.id}
                      onClick={() => applyTemplate(tpl.id)}
                    >
                      <strong>{tpl.label}</strong>
                      <small>{tpl.description}</small>
                    </ButtonBase>
                  ))}
                </div>
              </div>

              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>自定义来源名称</label>
                  <CompactInput ariaLabel="自定义来源名称" value={addSrcLabel} onInput={setAddSrcLabel} />
                </WorkspaceField>
                <WorkspaceField>
                  <span>主要能力类型</span>
                  <CompactSelect
                    ariaLabel="主要能力类型"
                    value={addSrcCap}
                    onChange={(v) => setAddSrcCap(v as ProviderCapabilityKind)}
                    options={CAPABILITY_TABS.filter((t) => t.id !== "all").map((t) => ({ value: t.id, label: t.label }))}
                  />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceField>
                <label>API Base URL</label>
                <CompactInput type="url" ariaLabel="新增来源 Base URL" value={addSrcUrl} onInput={setAddSrcUrl} />
              </WorkspaceField>
              <WorkspaceField>
                <label>初始 API Key 或 $环境变量（本地服务可留空）</label>
                <CompactInput
                  ariaLabel="初始 API Key"
                  value={addSrcKey}
                  placeholder="sk-... 或 $OPENAI_API_KEY"
                  onInput={setAddSrcKey}
                />
              </WorkspaceField>
              <small>保存后自动拉取可用模型。勾选需要的模型即可添加。</small>
            </div>
          </DialogContent>
          <DialogActions>
            <RippleButton variant="ghost" disabled={creatingSource} onClick={() => setAddSourceOpen(false)}>取消</RippleButton>
            <RippleButton
              variant="primary"
              ariaLabel="保存并获取模型"
              data-confirm-add-provider="true"
              loading={creatingSource}
              onClick={() => void handleCreateSource()}
            >
              {renderConsoleIcon("plus", 13)}
              <span>保存并获取模型</span>
            </RippleButton>
          </DialogActions>
        </Dialog>

        {/* Edit Model Parameters Dialog */}
        <Dialog open={Boolean(editingModel)} onClose={() => !savingModel && setEditingModel(null)} fullWidth maxWidth="sm">
          <DialogTitle>模型参数设置 · {editingModel?.modelId}</DialogTitle>
          <DialogContent>
            <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>显示别名</label>
                  <CompactInput ariaLabel="编辑模型别名" value={editModelName} onInput={setEditModelName} />
                </WorkspaceField>
                <WorkspaceField>
                  <span>能力分类</span>
                  <CompactSelect
                    ariaLabel="编辑模型能力分类"
                    value={editModelCap}
                    onChange={(v) => setEditModelCap(v as ProviderCapabilityKind)}
                    options={CAPABILITY_TABS.filter((t) => t.id !== "all").map((t) => ({ value: t.id, label: t.label }))}
                  />
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>Temperature</label>
                  <CompactInput
                    type="number"
                    ariaLabel="编辑 Temperature"
                    value={editModelTemp}
                    disabled={supportsTemperature === false}
                    onInput={setEditModelTemp}
                  />
                  {supportsTemperature === false ? <small>接口声明此模型不支持调节 Temperature。</small> : null}
                </WorkspaceField>
                <WorkspaceField>
                  <label>最大输出 Tokens</label>
                  <CompactInput
                    type="number"
                    ariaLabel="编辑 Max Tokens"
                    min={editModelMaxTok === undefined ? undefined : MIN_OUTPUT_TOKENS}
                    max={editModelMaxTok === undefined ? undefined : MAX_OUTPUT_TOKENS}
                    step={1}
                    unit="Tokens"
                    value={maxOutputValue}
                    error={maxOutputTokensError}
                    onInput={setEditModelMaxTok}
                  />
                  <small>
                    {catalogMaxOutputTokens === undefined
                      ? "接口暂无输出上限，沿用已保存的数值。"
                      : `接口最大输出 ${catalogMaxOutputTokens.toLocaleString("zh-CN")} Tokens。清空可恢复接口值。`}
                    {catalogMaxOutputTokens !== undefined && Number(maxOutputValue) > catalogMaxOutputTokens
                      ? " 实际最大输出受接口上限限制。" : null}
                  </small>
                </WorkspaceField>
              </WorkspaceGrid>
              <WorkspaceGrid columns={2}>
                <WorkspaceField>
                  <label>上下文窗口</label>
                  <CompactInput
                    type="number"
                    ariaLabel="上下文窗口覆盖"
                    min={MIN_CONTEXT_WINDOW}
                    max={MAX_CONTEXT_WINDOW}
                    step={1}
                    unit="Tokens"
                    value={contextWindowValue}
                    error={contextWindowError}
                    placeholder="沿用配置档案"
                    onInput={setEditModelCtx}
                  />
                  <small>
                    {catalogContextWindow !== undefined
                      ? `${catalogWindowIsInputLimit ? "接口最大输入" : "接口上下文窗口"} ${catalogContextWindow.toLocaleString("zh-CN")} Tokens。清空可恢复接口值。`
                      : editingModel?.contextWindow !== undefined
                        ? `历史记录 ${editingModel.contextWindow.toLocaleString("zh-CN")} Tokens。`
                        : "接口暂无窗口信息。"}
                    {catalogContextWindow !== undefined && !catalogWindowIsInputLimit && contextWindowOverride !== null && contextWindowOverride > catalogContextWindow
                      ? " 实际窗口受接口上限限制。" : null}
                    {catalogContextWindow === undefined && useCatalogContextWindow
                      ? " 接口未返回窗口时沿用配置档案预算。" : null}
                  </small>
                </WorkspaceField>
                {editModelCap === "chat" ? (
                  <WorkspaceField>
                    <span>推理强度</span>
                    <CompactSelect<ReasoningEffort | "">
                      ariaLabel="推理强度"
                      value={editReasoningEffort}
                      options={reasoningOptions}
                      disabled={!supportedReasoningEfforts.length && !unsupportedReasoningEffort}
                      onChange={setEditReasoningEffort}
                    />
                    {unsupportedReasoningEffort ? (
                      <small role="status">已保存的档位当前不可用。请选择可用档位或恢复默认。</small>
                    ) : null}
                    {!unsupportedReasoningEffort && supportedReasoningEfforts.length === 0 ? (
                      <small>{needsModelCatalogRefresh && catalogEffortOptions === undefined
                        ? "接口目录暂无推理档位信息。" : "此模型未提供可配置的推理档位。"}</small>
                    ) : null}
                  </WorkspaceField>
                ) : null}
              </WorkspaceGrid>
              {needsModelCatalogRefresh && editingSource ? (
                <WorkspaceRow>
                  <small role="status">
                    {modelCatalogRequest?.loading ? "正在刷新模型接口数据…"
                      : modelCatalogRequest?.failed ? modelCatalogRequest.notice : "可刷新模型目录以获取最新接口数据。"}
                  </small>
                  <RippleButton
                    size="sm"
                    variant="secondary"
                    ariaLabel={modelCatalogRequest?.failed ? "重试刷新模型目录" : "刷新模型目录"}
                    disabled={!canWrite || savingModel}
                    loading={modelCatalogRequest?.loading}
                    onClick={() => void handleFetchRemoteModels(editingSource, false)}
                  >
                    {modelCatalogRequest?.failed ? "重试刷新模型目录" : "刷新模型目录"}
                  </RippleButton>
                </WorkspaceRow>
              ) : null}
              <div className="ai0-workspace-actions">
                <JellySwitch label="视觉 Vision" checked={editModelVision} onChange={setEditModelVision} />
                <JellySwitch label="工具调用 Tools" checked={editModelTools} onChange={setEditModelTools} />
                <JellySwitch label="支持推理" checked={editModelReasoning} onChange={setEditModelReasoning} />
              </div>
              <WorkspaceField>
                <label>额外透传参数 (customParams JSON)</label>
                <CompactInput multiline rows={3} ariaLabel="自定义模型参数 JSON" value={editModelParamsJson} onInput={setEditModelParamsJson} />
              </WorkspaceField>
            </div>
          </DialogContent>
          <DialogActions>
            <RippleButton variant="ghost" disabled={savingModel} onClick={() => setEditingModel(null)}>取消</RippleButton>
            <RippleButton
              variant="primary"
              ariaLabel="保存模型参数"
              loading={savingModel}
              disabled={Boolean(contextWindowError || maxOutputTokensError) || unsupportedReasoningEffort}
              onClick={() => void handleSaveModelParams()}
            >
              {renderConsoleIcon("save", 13)}
              <span>保存模型参数</span>
            </RippleButton>
          </DialogActions>
        </Dialog>

        {deleteSourceTarget ? (
          <WorkspaceConfirm
            title={`删除服务来源「${deleteSourceTarget.label}」`}
            description={
              (sourceUsages[deleteSourceTarget.id]?.length ?? 0) > 0
                ? `该来源下的模型正被引用：${sourceUsages[deleteSourceTarget.id]!.map((u) => u.targetLabel).join("、")}。请先解绑后再删除。`
                : "删除来源将同步删除该来源下的所有模型实例与宿主机 Vault 中的对应 API Keys。"
            }
            busy={deleting}
            onCancel={() => setDeleteSourceTarget(null)}
            onConfirm={() => void handleConfirmDeleteSource()}
          />
        ) : null}

        {deleteModelTarget ? (
          <WorkspaceConfirm
            title={`移除模型实例「${deleteModelTarget.displayName}」`}
            description={
              (modelUsages[deleteModelTarget.id]?.length ?? 0) > 0
                ? `该模型正被引用：${modelUsages[deleteModelTarget.id]!.map((u) => u.targetLabel).join("、")}。请先在对应配置中更换模型后再移除。`
                : "仅从当前来源移除该模型实例，不会影响来源的 API Key 与其他模型。"
            }
            busy={deleting}
            onCancel={() => setDeleteModelTarget(null)}
            onConfirm={() => void handleConfirmDeleteModel()}
          />
        ) : null}
      </WorkspacePage>
    </MainRoundedCardOutlet>
  );
}
