import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { ModelInstanceSchema, ProviderSourceSchema, SoulModuleOverridesSchema } from "@ai0/protocol";
import {
  addSourceApiKey, awakenSoulFromCard, deleteHostCharacterCard, exportSoulToCharacterCardV3,
  getHostCharacterCard, inferModelCapabilities, isPlaceholderSecret, listHostCharacterCards, makeDefaultModelInstanceId,
  parseCharacterCardV3, PROVIDER_VENDOR_TEMPLATES, readConsoleStudioConfig, readHostInfrastructureConfig,
  readHostOwnerClaim, readSoulArchiveConfig, readSoulProfileConfig, RelationshipArchetypeSchema,
  resolveEffectiveSourceApiKeys, sanitizeCharacterCardV3, saveHostCharacterCard, SoulDirectoryLayout,
  upsertModelInstance, upsertProviderSource, writeHostOwnerClaim, writeSoulProfileConfig
} from "@ai0/storage";
import type { AdminOperation, AdminRouteHandler } from "@ai0/gateway";
import type { Ai0DaemonRuntime } from "./index.js";
import { updateStudioConfig } from "./studio-service.js";

type Body = Record<string, unknown>;
function isObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

class LifecycleRequestError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

export function lifecycleErrorResponse(error: unknown) {
  if (error instanceof LifecycleRequestError) return { status: error.status, body: { error: error.message } };
  if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
    return { status: 409 as const, body: { error: "SOUL_ALREADY_EXISTS" } };
  if (error instanceof Error && error.message === "SNAPSHOT_ROLLBACK_IN_PROGRESS")
    return { status: 409 as const, body: { error: error.message } };
  if (error instanceof SyntaxError || error instanceof TypeError || (error instanceof Error && error.name === "ZodError"))
    return { status: 400 as const, body: { error: "INVALID_LIFECYCLE_INPUT", message: error.message } };
  throw error;
}

function claimHost(runtime: Ai0DaemonRuntime, mode?: unknown) {
  const previous = readHostOwnerClaim(runtime.hostDir);
  const deploymentMode = mode ?? previous.deploymentMode;
  if (deploymentMode !== "local_sovereign" && deploymentMode !== "public_hosted_sb243")
    throw new LifecycleRequestError(400, "INVALID_DEPLOYMENT_MODE");
  const { claimed, claimedAt } = writeHostOwnerClaim(runtime.hostDir, {
    claimed: true, claimedAt: previous.claimedAt ?? new Date().toISOString(), deploymentMode,
    ownerTokenHash: createHash("sha256").update(runtime.ownerMasterToken).digest("hex")
  });
  return { claimed, claimedAt, deploymentMode };
}

function awaken(runtime: Ai0DaemonRuntime, body: Body) {
  if (runtime.mutableState.rollbackInProgress) throw new LifecycleRequestError(409, "SNAPSHOT_ROLLBACK_IN_PROGRESS");
  const cardId = trimmed(body.cardId);
  if (!cardId) throw new LifecycleRequestError(400, "CARD_ID_REQUIRED");
  const card = getHostCharacterCard(runtime.hostDir, cardId);
  if (!card) throw new LifecycleRequestError(404, "CARD_NOT_FOUND");
  const layout = awakenSoulFromCard({
    soulsDirPath: runtime.soulsRoot, hostDirPath: runtime.hostDir, cardId, card,
    slug: trimmed(body.slug) || undefined,
    moduleOverrides: SoulModuleOverridesSchema.optional().parse(body.moduleOverrides),
    onboardingCompleted: true
  });
  runtime.activateSoulDirectory(layout.rootPath);
  return activeSoul(runtime);
}

function activeSoul(runtime: Ai0DaemonRuntime) {
  return { ok: true, soulId: readSoulArchiveConfig(runtime.soulDir).manifest.soul_id,
    soulDir: runtime.soulDir, readiness: runtime.computeReadiness() };
}

function findSoul(runtime: Ai0DaemonRuntime, id: unknown): string {
  if (runtime.hasAwakenedSoul && id === readSoulArchiveConfig(runtime.soulDir).manifest.soul_id) return runtime.soulDir;
  const instances = runtime.listSoulInstances();
  const archive = instances.find(soul => soul.id === id) ??
    instances.find(soul => readSoulArchiveConfig(soul.path).manifest.soul_id === id);
  if (!archive) throw new LifecycleRequestError(404, "SOUL_NOT_FOUND");
  return archive.path;
}

export function createLifecycleAdminHandlers(getRuntime: () => Ai0DaemonRuntime): Partial<Record<AdminOperation, AdminRouteHandler>> {
  const handle = (operation: (runtime: Ai0DaemonRuntime, body: Body, method: string, params: Record<string, string>) => unknown): AdminRouteHandler =>
    (request, context) => {
      if (request.method !== "GET" && context.target_instance !== "live")
        return { status: 403, body: { error: "LIVE_SOVEREIGNTY_FENCE_VIOLATION" } };
      try {
        return operation(getRuntime(), isObject(request.body) ? request.body : {}, request.method, context.params);
      } catch (error) { return lifecycleErrorResponse(error); }
    };
  return {
    "system.readiness": () => getRuntime().computeReadiness(),
    "host.claim": handle((runtime, body) => ({
      ok: true, claim: claimHost(runtime, body.deploymentMode), readiness: runtime.computeReadiness()
    })),
    "cards.collection": handle((runtime, body, method) => {
      if (method === "GET") return { cards: listHostCharacterCards(runtime.hostDir) };
      const input = isObject(body.card) || typeof body.card === "string" ? body.card : typeof body.rawText === "string" ? body.rawText :
        typeof body.base64Png === "string" ? Buffer.from(body.base64Png, "base64") : undefined;
      if (!input) throw new LifecycleRequestError(400, "CARD_REQUIRED");
      return { status: 201, body: { ok: true, ...saveHostCharacterCard(runtime.hostDir, input, trimmed(body.cardId) || undefined) } };
    }),
    "cards.item": handle((runtime, _body, method, { cardId }) => {
      if (method === "DELETE") {
        if (!deleteHostCharacterCard(runtime.hostDir, cardId!)) throw new LifecycleRequestError(404, "CARD_NOT_FOUND");
        return { ok: true, cardId };
      }
      const card = getHostCharacterCard(runtime.hostDir, cardId!);
      if (!card) throw new LifecycleRequestError(404, "CARD_NOT_FOUND");
      return { cardId, card };
    }),
    "souls.collection": handle(runtime => ({ souls: runtime.listSoulInstances() })),
    "souls.awaken": handle((runtime, body) => ({ status: 201, body: awaken(runtime, body) })),
    "souls.select": handle((runtime, body) => {
      runtime.activateSoulDirectory(findSoul(runtime, body.id ?? body.soulId));
      return activeSoul(runtime);
    }),
    "souls.exportCard": handle((runtime, _body, _method, { soulId }) => {
      const path = findSoul(runtime, soulId);
      if (existsSync(new SoulDirectoryLayout(path).characterCardPath))
        return { card: exportSoulToCharacterCardV3(path) };
      const { identity } = readSoulArchiveConfig(path);
      return { card: sanitizeCharacterCardV3(parseCharacterCardV3({
        spec: "chara_card_v3", spec_version: "3.0",
        data: { name: identity.display_name, description: identity.core_values.join("\n") }
      })).card };
    })
  };
}

function configureOnboardingModel(hostDir: string, body: Body, apiKey: string) {
  if (isPlaceholderSecret(apiKey)) throw new LifecycleRequestError(400, "INVALID_PROVIDER_KEY");
  const infrastructure = readHostInfrastructureConfig(hostDir);
  const providerId = trimmed(body.providerId);
  const previous = infrastructure.providerSources.find(item => item.id === providerId);
  const template = PROVIDER_VENDOR_TEMPLATES.find(item => item.id === providerId && item.capabilityKind === "chat");
  if (!previous && !template) throw new LifecycleRequestError(400, "CHAT_PROVIDER_REQUIRED");
  const source = ProviderSourceSchema.parse({
    ...(previous ?? { id: providerId, label: template!.label, vendor: template!.vendor,
      supportedCapabilities: template!.supportedCapabilities, adapterType: template!.adapterType }),
    enabled: true, baseUrl: trimmed(body.baseUrl) || previous?.baseUrl || template?.defaultBaseUrl
  });
  const chatModels = infrastructure.modelInstances.filter(model => model.sourceId === source.id && model.capabilityKind === "chat");
  const modelId = trimmed(body.modelId) || chatModels[0]?.modelId || template?.defaultModels[0];
  if (!modelId) throw new LifecycleRequestError(400, "CHAT_MODEL_REQUIRED");
  const existing = chatModels.find(model => model.modelId === modelId);
  const model = ModelInstanceSchema.parse({
    ...(existing ?? { id: makeDefaultModelInstanceId(providerId, modelId), modelId,
      displayName: modelId, sourceId: providerId, capabilityKind: "chat", capabilities: inferModelCapabilities(modelId, "chat") }),
    enabled: true, health: { status: "ready", latencyMs: 0 }
  });
  upsertProviderSource(hostDir, source);
  if (!source.apiKeys.some(key => key.enabled) || !resolveEffectiveSourceApiKeys(hostDir, source).includes(apiKey))
    addSourceApiKey(hostDir, source.id, apiKey);
  upsertModelInstance(hostDir, model);
  return { providerId, modelId, modelInstanceId: model.id };
}

export function completeOnboarding(runtime: Ai0DaemonRuntime, body: Body) {
  if (runtime.mutableState.rollbackInProgress) throw new LifecycleRequestError(409, "SNAPSHOT_ROLLBACK_IN_PROGRESS");
  const shouldAwaken = !runtime.hasAwakenedSoul || body.awakenNew === true;
  const displayName = trimmed(body.displayName);
  const prompt = trimmed(body.corePersonalityPrompt);
  const rawCard = isObject(body.card) || typeof body.card === "string" ? body.card : trimmed(body.rawCard);
  const card = shouldAwaken ? parseCharacterCardV3(rawCard || {
    spec: "chara_card_v3", spec_version: "3.0", data: { name: displayName, description: prompt }
  }) : undefined;
  const role = RelationshipArchetypeSchema.optional().parse(body.primaryRole);
  claimHost(runtime, "local_sovereign");
  const apiKey = trimmed(body.apiKey);
  const binding = apiKey ? configureOnboardingModel(runtime.hostDir, body, apiKey) : undefined;
  if (card) {
    const { cardId } = saveHostCharacterCard(runtime.hostDir, card);
    try {
      awaken(runtime, { cardId });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") deleteHostCharacterCard(runtime.hostDir, cardId);
      throw error;
    }
  }
  const current = readConsoleStudioConfig(runtime.soulDir);
  const primaryRole = role ?? current.soulStudio.primaryRole;
  if (binding || role) {
    const profiles = readSoulProfileConfig(runtime.soulDir);
    writeSoulProfileConfig(runtime.soulDir, { ...profiles, profiles: profiles.profiles.map(profile =>
      profile.id === profiles.defaultProfileId ? { ...profile, roleArchetype: primaryRole, ...(binding && { primaryChat: binding }) } : profile) });
  }
  const saved = updateStudioConfig(runtime, {
    onboardingCompleted: true, soulStudio: {
      primaryRole, displayName: card?.data.name || displayName || current.soulStudio.displayName,
      ...(!card && prompt ? { corePersonalityPrompt: prompt } : {})
    }
  });
  return { ...activeSoul(runtime), config: saved };
}
