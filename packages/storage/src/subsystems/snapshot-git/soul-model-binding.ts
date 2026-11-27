import type {
  HostInfrastructureConfig, ModelSlotBinding, ProviderCapabilityKind,
  SoulProfileAndCapabilitiesConfig
} from "@ai0/protocol";
import type { SoulArchiveManifest } from "./soul-directory.js";

function availableModels(infrastructure: HostInfrastructureConfig, capability: ProviderCapabilityKind | "vision") {
  const sources = new Map(infrastructure.providerSources.filter(source => source.enabled).map(source => [source.id, source]));
  return infrastructure.modelInstances.flatMap(model => {
    const source = sources.get(model.sourceId);
    if (!source || !model.enabled || model.health.status === "error" ||
        (capability === "vision" ? !(model.capabilityKind === "chat" && model.capabilities.vision) : model.capabilityKind !== capability)) return [];
    const keylessAllowed = source.adapterType === "ollama" || source.adapterType === "builtin_local" || source.adapterType === "custom_http";
    const hasKey = source.apiKeys.some(key => key.enabled && (key.kind !== "env_var" || key.envPresent));
    if (!hasKey && !keylessAllowed) return [];
    if (!hasKey && keylessAllowed && model.health.status !== "ready") return [];
    const rank = hasKey && model.health.status === "ready" ? 4
      : keylessAllowed && model.health.status === "ready" ? 3
      : hasKey && model.health.status === "configured" ? 2
      : hasKey ? 1 : 0;
    if (rank === 0) return [];
    return [{
      rank,
      binding: { providerId: source.id, modelId: model.modelId, modelInstanceId: model.id }
    }];
  }).sort((left, right) => right.rank - left.rank).map(model => model.binding);
}

export function resolveHostDefaultChatBinding(infrastructure: HostInfrastructureConfig): ModelSlotBinding | undefined {
  return availableModels(infrastructure, "chat")[0];
}

export function resolveSoulTurnModelBinding(
  soulManifest: SoulArchiveManifest,
  soulProfiles: SoulProfileAndCapabilitiesConfig,
  infrastructure: HostInfrastructureConfig
) {
  const profile = soulProfiles.profiles.find(item => item.id === soulManifest.active_model_profile) ??
    soulProfiles.profiles.find(item => item.id === soulProfiles.defaultProfileId);
  const resolve = (module: "consciousness" | "vision" | "speech", capability: ProviderCapabilityKind | "vision",
    inherited?: ModelSlotBinding) => {
    const models = availableModels(infrastructure, capability);
    const override = soulManifest.module_overrides?.[module];
    if (override?.mode === "Override") {
      const binding = models.find(model => model.providerId === override.sourceId &&
        (model.modelId === override.modelId || model.modelInstanceId === override.modelId));
      return binding && { ...binding, ...(override.voice_id ? { voice_id: override.voice_id } : {}) };
    }
    return models.find(model => inherited?.providerId === model.providerId &&
      (inherited.modelInstanceId ? inherited.modelInstanceId === model.modelInstanceId : inherited.modelId === model.modelId)) ??
      models[0];
  };
  return {
    consciousness: resolve("consciousness", "chat", profile?.primaryChat),
    vision: resolve("vision", "vision", profile?.brainRegionOverrides.W4_multimodal),
    speech: resolve("speech", "tts", soulProfiles.capabilities.multimodal.ttsBinding)
  };
}
