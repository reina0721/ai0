import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DiscoveredRemoteModel, ModelInstance, ProviderCatalogSource, ProviderSource, ChannelTokenUsage, SoulProfileAndCapabilitiesConfig } from "@ai0/protocol";
import { expect, it } from "vitest";

import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer } from "./index.js";

const goModel = "glm-5.3-flash";
const commandChatModel = "deepseek/deepseek-v4-flash";
const commandMessagesModel = "command/messages-only";
const commandCollisionModel = "command.messages-only";
const commandUnselectedModel = "command/unselected";
const goCatalogPath = "/inference/go/v1/models";
const goChatPath = "/inference/go/openai/v1/chat/completions";
const commandChatPath = "/provider/v1/chat/completions";
const commandMessagesPath = "/provider/v1/messages";
const limitedKey = "test-key-with-exhausted-quota";

const providerCases = [
  { adapterType: "opencode_go", defaultBaseUrl: "https://opencode.ai/inference/go/openai/v1", catalogs: [goModel], modelId: goModel, apiPath: goChatPath },
  { adapterType: "command_code", defaultBaseUrl: "https://api.commandcode.ai/provider/v1", catalogs: [commandMessagesModel, commandCollisionModel, commandUnselectedModel, commandChatModel], modelId: commandChatModel, apiPath: commandChatPath },
  { adapterType: "openrouter", defaultBaseUrl: "https://openrouter.ai/api/v1", catalogs: ["openai/gpt-4.1-mini"], modelId: "openai/gpt-4.1-mini", apiPath: "/api/v1/chat/completions" },
  { adapterType: "moonshot", defaultBaseUrl: "https://api.moonshot.cn/v1", catalogs: ["kimi-k3.1-pro"], modelId: "kimi-k3.1-pro", apiPath: "/v1/chat/completions" },
  { adapterType: "zhipu", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", catalogs: [], modelId: "glm-5.3", apiPath: "/api/paas/v4/chat/completions" }
] as const;

type UpstreamRequest = {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
};

interface ModelCatalogResponse {
  ok: boolean;
  models: DiscoveredRemoteModel[];
  httpStatus?: number;
  catalogSource?: ProviderCatalogSource;
  lastFetchedAt?: string;
}

const replyFor = (model: string) => `来自模拟上游的回复 ${model}`;

function makeReplyStream(model: string, messagesApi: boolean, reply = replyFor(model)): string {
  const content = JSON.stringify({
    surface_utterance: reply,
    theatrical_subtext: "验证对话确实来自选定的外部模型。",
    masked_placeholder: "",
    chosen_strategy: "answer",
    interaction_frame: "serious_factual",
    vocal_emotion_tag: "neutral",
    facial_expression: "neutral",
    valence_impulse: "none",
    provider_used: "test-provider",
    model_used: model
  });
  if (messagesApi) {
    const frames = [
      { type: "message_start", message: { id: "msg_test", model, role: "assistant", content: [], usage: { input_tokens: 3000, cache_read_input_tokens: 9000 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
      { type: "message_stop" }
    ];
    return frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join("");
  }
  const frame = (delta: object, finishReason: string | null) => ({
    id: "chat_test", object: "chat.completion.chunk", model, created: 1,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  });
  return [frame({ reasoning_content: "正在核对输入" }, null), frame({ content }, null),
    { ...frame({}, "stop"), usage: { prompt_tokens: 12000, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 9000 } } }]
    .map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n";
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

it("discovers, imports, probes and uses hosted models through real admin and WebChat requests", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ai0-hosted-models-"));
  const ownerToken = "hosted-model-e2e-owner-token";
  const requests: UpstreamRequest[] = [];
  let goCatalogStatus = 200;
  const catalogs: Record<string, readonly object[]> = {
    [goCatalogPath]: [
      { id: goModel, type: "chat", capabilities: { temperature: true } },
      { id: "decision-model", type: "decision" },
      { id: "text-embedding-3-small", type: "embedding" }
    ],
    "/provider/v1/models": [
      { id: commandChatModel, supported_endpoints: ["/chat/completions", "/responses"] },
      { id: commandMessagesModel, supported_endpoints: ["/messages"] },
      { id: commandCollisionModel, supported_endpoints: ["/chat/completions"] },
      { id: commandUnselectedModel, supported_endpoints: ["/chat/completions"] },
      { id: "typesafe/jev", supported_endpoints: ["/systemone"] },
      { id: "responses-only", supported_endpoints: ["/responses"] }
    ],
    "/api/v1/models": [
      { id: "openai/gpt-4.1-mini", endpoints: ["/api/v1/chat/completions"], architecture: { output_modalities: ["text"] } },
      { id: "image-only", endpoints: ["/api/v1/chat/completions"], architecture: { output_modalities: ["image"] } }
    ],
    "/v1/models": [{ id: "kimi-k3.1-pro", supports_image_in: true, supports_reasoning: true }]
  };
  const mockUpstream = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET") {
      requests.push({ path, headers: request.headers, body: {} });
      const models = catalogs[path];
      const status = path === goCatalogPath ? goCatalogStatus : models ? 200 : 404;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(status === 200 ? { data: models } : { error: { message: "Catalog unavailable" } }));
      return;
    }
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    requests.push({ path, headers: request.headers, body });
    const model = String(body.model);
    const usesMessages = path === commandMessagesPath;
    if (request.headers.authorization === `Bearer ${limitedKey}`) {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Rate limited" } }));
    } else if (body.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(makeReplyStream(model, usesMessages));
    } else {
      const content = model === "empty-reply" ? "" : "OK";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(usesMessages ? { content: [{ type: "text", text: content }] } : { choices: [{ message: { content } }] }));
    }
  });
  const runtime = createDefaultDaemonRuntime({ soulDir: join(tempRoot, "test.soul"), ownerMasterToken: ownerToken });
  const server = createUnifiedDaemonHttpServer(runtime);

  try {
    const upstream = await listen(mockUpstream);
    const daemon = await listen(server);
    const headers = { "x-ai0-owner-token": ownerToken, "content-type": "application/json" };

    async function admin<T>(path: string, method: "GET" | "POST" | "PUT" | "PATCH" = "GET", body?: object, status = 200): Promise<T> {
      const response = await fetch(`${daemon}/api/admin/v1/${path}`, { headers, method, body: body && JSON.stringify(body) });
      const data = await response.json();
      expect(response.status, `${method} ${path}: ${JSON.stringify(data)}`).toBe(status);
      return data as T;
    }

    async function runWebChat(thread: string, modelId: string): Promise<void> {
      const response = await fetch(`${daemon}/protocol/v0/channel/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId: randomUUID(), mode: "live", channelId: "builtin.webchat", thread, text: "请帮我检查这个函数的返回值。" })
      });
      expect(response.status).toBe(200);
      const raw = await response.text();
      expect(raw).toContain("data: [DONE]");
      const frames = raw.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as {
        type: string;
        delta?: string;
        data?: { provider?: { model: string }; process?: import("@ai0/protocol").ChannelRunProcess };
      });
      expect(frames.filter((frame) => frame.type === "text-delta").map((frame) => frame.delta).join("")).toBe(replyFor(modelId));
      expect(frames.some((frame) => frame.data?.provider?.model === modelId)).toBe(true);
      const process = frames.filter(frame => frame.type === "data-turn").at(-1)?.data?.process;
      expect(process).toMatchObject({ provider: { model: modelId },
        usage: { inputTokens: 12000, outputTokens: 9, cachedInputTokens: 9000 } });
      if (modelId !== commandMessagesModel) {
        expect(process?.reasoning).toBe("正在核对输入");
        expect(frames.findIndex(frame => frame.type === "data-turn-reasoning")).toBeLessThan(
          frames.findIndex(frame => frame.type === "text-delta"));
      }
    }

    async function addModel(sourceId: string, modelId: string): Promise<ModelInstance> {
      return (await admin<{ model: ModelInstance }>("integrations/models", "POST", { sourceId, modelId }, 201)).model;
    }

    async function importModels(sourceId: string, modelIds: string[]): Promise<ModelInstance[]> {
      return (await admin<{ models: ModelInstance[] }>(`integrations/sources/${sourceId}/import-models`, "POST", { modelIds })).models;
    }

    async function listModels(sourceId: string): Promise<ModelInstance[]> {
      const { models } = await admin<{ models: ModelInstance[] }>("integrations/models");
      return models.filter((model) => model.sourceId === sourceId);
    }

    async function probeAndUse(model: ModelInstance, apiPath: string, thread: string, apiKey: string): Promise<void> {
      const { sourceId, modelId, id: modelInstanceId } = model;
      const probe = await admin(`integrations/models/${modelInstanceId}/test`, "POST", {});
      expect(probe).toMatchObject({ ok: true, health: { status: "ready" }, lastResponseSnippet: "OK" });
      expect(requests.at(-1)).toMatchObject({ path: apiPath, headers: { authorization: `Bearer ${apiKey}` }, body: { model: modelId } });

      const config = await admin<SoulProfileAndCapabilitiesConfig>("config/profiles");
      await admin("config/profiles", "PUT", {
        defaultProfileId: config.defaultProfileId,
        profiles: config.profiles.map((profile) => profile.id === config.defaultProfileId ? {
          ...profile,
          primaryChat: { providerId: sourceId, modelId, modelInstanceId }
        } : profile)
      });
      await runWebChat(thread, modelId);
      expect(requests.at(-1)).toMatchObject({ path: apiPath, headers: { authorization: `Bearer ${apiKey}` }, body: { model: modelId, stream: true } });
    }

    const listing = await admin<{ templates: unknown[] }>("integrations/sources");
    for (const provider of providerCases) {
      const { adapterType, defaultBaseUrl, catalogs: expectedModels, modelId, apiPath } = provider;
      expect(listing.templates).toContainEqual(expect.objectContaining({ id: `tpl_${adapterType}`, adapterType, defaultBaseUrl, defaultModels: expect.arrayContaining([modelId]) }));
      const id = `src_test_${adapterType}`;
      const apiKey = `test-${adapterType}-bearer-key`;
      const baseUrl = `${upstream}${new URL(defaultBaseUrl).pathname}`;
      const created = await admin<{ models: ModelInstance[] }>("integrations/sources", "POST", {
        id, label: adapterType, vendor: adapterType, adapterType, baseUrl,
        keyRotationStrategy: "failover", initialApiKey: adapterType === "opencode_go" ? limitedKey : apiKey
      }, 201);
      expect(created.models.some((model) => model.sourceId === id)).toBe(false);
      if (adapterType === "opencode_go") await admin(`integrations/sources/${id}/keys`, "POST", { apiKey }, 201);

      const discovered = await admin<ModelCatalogResponse>(`integrations/sources/${id}/fetch-models`, "POST", {});
      expect(discovered.ok).toBe(adapterType !== "zhipu");
      expect(discovered.models.map((model) => model.modelId)).toEqual([...expectedModels].sort((a, b) => a.localeCompare(b)));
      if (adapterType === "zhipu") {
        expect(discovered.httpStatus).toBe(404);
        expect(discovered.catalogSource).toBeUndefined();
        await probeAndUse(await addModel(id, modelId), apiPath, "zhipu-legacy-manual-thread", apiKey);
        continue;
      }
      expect(discovered.catalogSource).toBe("upstream");
      expect(discovered.lastFetchedAt).toEqual(expect.any(String));
      expect(await listModels(id)).toEqual([]);

      if (adapterType === "command_code") {
        const rejected = await admin(`integrations/sources/${id}/import-models`, "POST", {
          modelIds: [commandUnselectedModel, "absent/model"]
        }, 400);
        expect(rejected).toMatchObject({ error: "MODEL_NOT_IN_CATALOG" });
        expect(await listModels(id)).toEqual([]);
      }

      const selected = adapterType === "command_code"
        ? [modelId, commandMessagesModel, commandCollisionModel]
        : [modelId];
      const imported = await importModels(id, selected);
      expect(imported.map((model) => model.modelId).sort()).toEqual([...selected].sort());
      expect((await listModels(id)).map((model) => model.modelId).sort()).toEqual([...selected].sort());
      expect(new Set(imported.map((model) => model.id)).size).toBe(selected.length);
      const mainModel = imported.find((model) => model.modelId === modelId)!;
      if (adapterType === "moonshot") expect(mainModel.capabilities).toMatchObject({ vision: true, reasoning: true });
      await probeAndUse(mainModel, apiPath, `${adapterType}-thread-one`, apiKey);

      if (adapterType === "command_code") {
        expect(discovered.models).toContainEqual(expect.objectContaining({ modelId: commandMessagesModel, chatProtocol: "anthropic_messages" }));
        const messagesModel = imported.find((model) => model.modelId === commandMessagesModel)!;
        await probeAndUse(messagesModel, commandMessagesPath, "command-messages-thread", apiKey);
        expect(requests.at(-1)?.headers["anthropic-version"]).toBeDefined();
        expect(requests.at(-1)?.headers["x-api-key"]).toBeUndefined();

        const { model: edited } = await admin<{ model: ModelInstance }>(`integrations/models/${mainModel.id}`, "PATCH", {
          displayName: "我的 Command Code 模型", defaultTemperature: 0.25, enabled: false
        });
        expect(edited).toMatchObject({
          displayName: "我的 Command Code 模型", defaultTemperature: 0.25, enabled: false, health: { status: "ready" }
        });
        expect(await importModels(id, [mainModel.modelId])).toEqual([edited]);
        expect(await listModels(id)).toContainEqual(edited);
      }
      if (adapterType === "opencode_go") {
        await runWebChat("opencode_go-thread-one", modelId);
        await runWebChat("opencode_go-thread-two", modelId);
        const inference = requests.filter((request) => request.path === goChatPath);
        const goSessions = inference.map((request) => request.headers["x-opencode-session"]);
        expect(inference.map((request) => request.headers.authorization)).toEqual(
          Array.from({ length: 4 }, () => [`Bearer ${limitedKey}`, `Bearer ${apiKey}`]).flat()
        );
        expect(inference.every(({ headers }) => /\bai0\b/iu.test(headers["user-agent"] ?? ""))).toBe(true);
        expect(goSessions.every((session) => typeof session === "string" && session.length > 0)).toBe(true);
        expect(goSessions).toEqual([goSessions[0], goSessions[0], goSessions[2], goSessions[2], goSessions[2], goSessions[2], goSessions[6], goSessions[6]]);
        expect(new Set(goSessions).size).toBe(3);

        goCatalogStatus = 503;
        expect(await admin(`integrations/sources/${id}/fetch-models`, "POST", {})).toMatchObject({ ok: false, httpStatus: 503 });
        const state = await admin<{ sources: ProviderSource[] }>("integrations/sources");
        expect(state.sources.find((source) => source.id === id)).toMatchObject({
          discoveredModels: discovered.models,
          catalogSource: "upstream",
          lastFetchedAt: discovered.lastFetchedAt
        });

        const { source: editedSource } = await admin<{ source: ProviderSource }>(`integrations/sources/${id}`, "PATCH", {
          baseUrl: `${upstream}/new/inference/go/openai/v1`
        });
        expect(editedSource.discoveredModels).toEqual([]);
        expect(editedSource).not.toHaveProperty("catalogSource");
        expect(editedSource.lastFetchedAt).toBeUndefined();
        expect(await listModels(id)).toMatchObject([{ id: mainModel.id, modelId, health: { status: "ready" } }]);
        expect(await admin(`integrations/sources/${id}/import-models`, "POST", { modelIds: [modelId] }, 400))
          .toMatchObject({ error: "MODEL_NOT_IN_CATALOG" });
      }
    }

    const model = await addModel("src_test_openrouter", "empty-reply");
    expect(await admin(`integrations/models/${model.id}/test`, "POST", {})).toMatchObject({ ok: false, health: { status: "error" } });

    const legacySourceId = "legacy-openrouter";
    const legacyKey = "test-legacy-openrouter-bearer-key";
    const legacyModelId = "openai/gpt-4.1-mini";
    await admin("integrations/providers", "POST", {
      id: legacySourceId,
      label: "OpenRouter",
      vendor: "OpenRouter",
      adapterType: "openai_compatible",
      capabilityKind: "chat",
      baseUrl: `${upstream}/api/v1`,
      apiKey: legacyKey,
      models: [legacyModelId]
    }, 201);
    const { models, sources } = await admin<{ models: ModelInstance[]; sources: ProviderSource[] }>("integrations/sources");
    expect(sources.find((source) => source.id === legacySourceId)?.adapterType).toBe("openai_compatible");
    const legacyModel = models.find((entry) => entry.sourceId === legacySourceId && entry.modelId === legacyModelId)!;
    expect(legacyModel).toBeDefined();
    await probeAndUse(legacyModel, "/api/v1/chat/completions", "legacy-openrouter-thread", legacyKey);
    expect(requests.at(-1)?.body).toMatchObject({ temperature: 0.75, response_format: { type: "json_object" } });

    const initialSourceId = "legacy-initial-models";
    const initialModelId = "legacy/custom-model";
    await admin("integrations/sources", "POST", {
      id: initialSourceId, label: "通用接入", vendor: "OpenAI Compatible", adapterType: "openai_compatible",
      baseUrl: `${upstream}/v1`, initialModels: [initialModelId]
    }, 201);
    expect(await listModels(initialSourceId)).toMatchObject([{ modelId: initialModelId, capabilityKind: "chat" }]);

    const guardSourceId = "test-built-in-guard";
    const guardModelId = "safety-l0-guard-v1";
    const injectedCatalog = {
      discoveredModels: [{ modelId: "injected-model", inferredCapability: "guard_lora" }],
      catalogSource: "upstream",
      lastFetchedAt: "2026-11-01T00:00:00.000Z"
    };
    const { source: guardSource } = await admin<{ source: ProviderSource }>("integrations/sources", "POST", {
      id: guardSourceId,
      label: "本地守卫",
      vendor: "ai0",
      adapterType: "builtin_local",
      supportedCapabilities: ["guard_lora"],
      baseUrl: "local://safety-l0-guard",
      ...injectedCatalog
    }, 201);
    expect(guardSource.discoveredModels).toEqual([]);
    expect(guardSource.catalogSource).toBeUndefined();
    expect(guardSource.lastFetchedAt).toBeUndefined();

    const upstreamRequestCount = requests.length;
    const guardCatalog = await admin<ModelCatalogResponse>(`integrations/sources/${guardSourceId}/fetch-models`, "POST", {});
    expect(guardCatalog).toMatchObject({
      ok: true, catalogSource: "built_in", models: [{ modelId: guardModelId, inferredCapability: "guard_lora" }]
    });
    expect(requests).toHaveLength(upstreamRequestCount);
    const { source: editedGuardSource } = await admin<{ source: ProviderSource }>(`integrations/sources/${guardSourceId}`, "PATCH", {
      label: "本地守卫测试",
      ...injectedCatalog
    });
    expect(editedGuardSource).toMatchObject({
      label: "本地守卫测试", discoveredModels: guardCatalog.models, catalogSource: "built_in", lastFetchedAt: guardCatalog.lastFetchedAt
    });
    expect(await importModels(guardSourceId, [guardModelId, guardModelId])).toMatchObject([
      { modelId: guardModelId, capabilityKind: "guard_lora" }
    ]);
  } finally {
    await close(server);
    await close(mockUpstream);
    runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

it("applies a model context override to real conversation prompts and rejects input that cannot fit", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ai0-model-context-"));
  const ownerToken = "model-context-e2e-owner-token";
  const modelId = "fixture/context-model";
  const contextOnlyModelId = "fixture/known-context-only";
  const modelWithoutLimitsId = "fixture/unknown-limits";
  const sourceId = "context-model-source";
  const chatThread = "context-history";
  const outputLimit = 8192;
  const upstreamOutputLimit = 6144;
  const upstreamWindow = 128_000;
  const expandedWindow = 32_768;
  let advertisedWindow = upstreamWindow;
  let advertisedOutputLimit = upstreamOutputLimit;
  type ModelRequest = {
    messages: { role: string; content: string }[];
    reasoning?: { effort: string };
    stream?: boolean;
    max_tokens?: number;
  };
  const modelRequests: ModelRequest[] = [];
  const mockUpstream = createServer(async (request, response) => {
    if (request.url?.startsWith("/api/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{
        id: modelId,
        context_length: advertisedWindow,
        top_provider: { max_completion_tokens: advertisedOutputLimit },
        endpoints: ["/api/v1/chat/completions"],
        reasoning: { supported_efforts: ["low", "medium"] },
        architecture: { output_modalities: ["text"] }
      }, { id: contextOnlyModelId, context_length: 49_152 }, { id: modelWithoutLimitsId }] }));
      return;
    }
    if (request.url !== "/api/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as ModelRequest;
    modelRequests.push(body);
    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
      return;
    }
    const undelivered = body.messages.find((message) => message.role === "user")?.content.includes("request-undelivered-marker");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(makeReplyStream(modelId, false, undelivered ? "assistant-undelivered-marker" : "正常送达的模型回复。"));
  });
  const runtime = createDefaultDaemonRuntime({ soulDir: join(tempRoot, "test.soul"), ownerMasterToken: ownerToken });
  const server = createUnifiedDaemonHttpServer(runtime);

  try {
    const upstream = await listen(mockUpstream);
    const daemon = await listen(server);
    const headers = { "x-ai0-owner-token": ownerToken, "content-type": "application/json" };
    const request = (path: string, method: string, body?: object) => fetch(daemon + path, {
      headers, method, body: body === undefined ? undefined : JSON.stringify(body)
    });

    async function json<T>(path: string, method: string, body?: object, status = 200): Promise<T> {
      const result = await request(path, method, body);
      const data = await result.json();
      expect(result.status, `${method} ${path}: ${JSON.stringify(data).slice(0, 300)}`).toBe(status);
      return data as T;
    }

    async function turn(text: string, options: Record<string, unknown> = {}, deliver = true) {
      const result = await json<{
        event_id: string;
        expression: { intent_id: string; fallback_text: string };
        compiledBlackboard: { max_total_tokens: number };
        usage?: ChannelTokenUsage;
      }>("/protocol/v0/channel/perception", "POST", { channel_id: "builtin.webchat", thread: chatThread, text, ...options });
      if (deliver) {
        await json("/protocol/v0/channel/receipt", "POST", {
          intent_id: result.expression.intent_id,
          spoken_char_offset: Array.from(result.expression.fallback_text).length,
          full_text: result.expression.fallback_text
        });
      }
      return result;
    }

    function observedHistory(): string {
      const system = modelRequests.at(-1)?.messages.find((message) => message.role === "system")?.content ?? "";
      return system.match(/\[slot\.tier1_working_turn\]\n([\s\S]*?)(?=\n\n\[slot\.|\n\n--- OUTPUT CONTRACT ---|$)/u)?.[1] ?? "";
    }

    const sourcePath = `/api/admin/v1/integrations/sources/${sourceId}`;
    await json("/api/admin/v1/integrations/sources", "POST", {
      id: sourceId, label: "上下文测试", vendor: "OpenRouter", adapterType: "openrouter",
      initialApiKey: "test-context-configuration-key", baseUrl: `${upstream}/api/v1`
    }, 201);
    const catalog = await json<ModelCatalogResponse>(`${sourcePath}/fetch-models`, "POST", {});
    expect(catalog.models.find((entry) => entry.modelId === modelId)).toMatchObject({
      modelId, contextWindow: upstreamWindow, maxOutputTokens: upstreamOutputLimit, supportedReasoningEfforts: ["low", "medium"]
    });
    const { models: [model, contextOnlyModel, modelWithoutLimits] } = await json<{ models: ModelInstance[] }>(`${sourcePath}/import-models`, "POST", {
      modelIds: [modelId, contextOnlyModelId, modelWithoutLimitsId]
    });
    expect(model).toMatchObject({
      modelId, catalogContextWindow: upstreamWindow, catalogMaxOutputTokens: upstreamOutputLimit,
      useCatalogContextWindow: true, useCatalogMaxOutputTokens: true
    });
    expect(model).not.toHaveProperty("contextWindowOverride");
    const modelPath = `/api/admin/v1/integrations/models/${model!.id}`;
    expect(contextOnlyModel).toMatchObject({ modelId: contextOnlyModelId, useCatalogContextWindow: true });
    expect(contextOnlyModel?.useCatalogMaxOutputTokens).not.toBe(true);
    expect(modelWithoutLimits).toMatchObject({ modelId: modelWithoutLimitsId });
    expect(modelWithoutLimits?.useCatalogContextWindow).not.toBe(true);
    expect(modelWithoutLimits?.useCatalogMaxOutputTokens).not.toBe(true);
    for (const option of ["useCatalogContextWindow", "useCatalogMaxOutputTokens"]) {
      expect(await json(`/api/admin/v1/integrations/models/${modelWithoutLimits!.id}`, "PATCH", { [option]: true }, 400))
        .toMatchObject({ error: "MODEL_CATALOG_LIMIT_UNAVAILABLE" });
    }

    const profilePath = "/api/admin/v1/config/profiles";
    const { defaultProfileId, profiles } = await json<SoulProfileAndCapabilitiesConfig>(profilePath, "GET");
    await json(profilePath, "PUT", {
      defaultProfileId,
      profiles: profiles.map((profile) => profile.id === defaultProfileId ? {
        ...profile,
        maxContextTokens: 8000,
        primaryChat: { providerId: sourceId, modelId, modelInstanceId: model!.id }
      } : profile)
    });

    for (let index = 1; index <= 26; index += 1) {
      await turn(`history-item-${index} ${"abcdef0123456789 ".repeat(60)}`);
    }
    await turn("foreign-thread-marker", { thread: "foreign-thread" });
    await turn("public-audience-marker", { venue_type: "public_livestream", audience_scope: "public_all" });
    const redacted = await turn("redacted-history-marker");
    runtime.storage.sqlite.prepare("UPDATE event_log SET redacted_at_ts_ms = ? WHERE event_id = ?").run(Date.now(), redacted.event_id);
    const beforePending = modelRequests.length;
    const pending = await turn("request-undelivered-marker", {}, false);
    expect(modelRequests).toHaveLength(beforePending + 1);
    expect(pending.expression.fallback_text).toBe("assistant-undelivered-marker");

    const automatic = await turn("用刚导入的模型继续这段对话。");
    expect(automatic.compiledBlackboard.max_total_tokens).toBeGreaterThan(8000);
    expect(automatic.usage?.contextWindow).toBe(upstreamWindow);
    expect(observedHistory()).toContain("history-item-1 ");
    expect(modelRequests.at(-1)?.max_tokens).toBe(upstreamOutputLimit);

    await json(modelPath, "PATCH", {
      useCatalogContextWindow: false, useCatalogMaxOutputTokens: false,
      defaultMaxTokens: outputLimit, contextWindow: upstreamWindow
    });
    const { models: [reimported] } = await json<{ models: ModelInstance[] }>(`${sourcePath}/import-models`, "POST", { modelIds: [modelId] });
    expect(reimported).toMatchObject({ useCatalogContextWindow: false, useCatalogMaxOutputTokens: false });
    const inherited = await turn("仍采用配置档案的上下文。");
    expect(inherited.compiledBlackboard.max_total_tokens).toBe(8000);
    expect(inherited.usage?.contextWindow).toBe(upstreamWindow);
    expect(observedHistory().length).toBeLessThan(2_000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(upstreamOutputLimit);

    expect(await json(modelPath, "PATCH", { reasoningEffort: "max" }, 400)).toMatchObject({
      error: "UNSUPPORTED_REASONING_EFFORT", allowed: ["low", "medium"]
    });

    const saved = await json<{ model: ModelInstance }>(modelPath, "PATCH", { contextWindowOverride: expandedWindow, reasoningEffort: "medium" });
    expect(saved.model).toMatchObject({
      contextWindow: upstreamWindow, catalogContextWindow: upstreamWindow, contextWindowOverride: expandedWindow, reasoningEffort: "medium"
    });
    expect(await json(`${modelPath}/test`, "POST", {})).toMatchObject({ ok: true });
    expect(modelRequests.at(-1)?.reasoning).toEqual({ effort: "medium" });
    const currentText = "现在采用模型自己的上下文设置。";
    const expanded = await turn(currentText);
    expect(modelRequests.at(-1)?.reasoning).toEqual({ effort: "medium" });
    expect(modelRequests.at(-1)?.max_tokens).toBe(upstreamOutputLimit);
    const sentUserMessage = modelRequests.at(-1)?.messages.find((message) => message.role === "user");
    expect(JSON.parse(sentUserMessage!.content)).toHaveProperty("userText", currentText);
    expect(expanded.compiledBlackboard.max_total_tokens).toBeGreaterThan(8000);
    const history = observedHistory();
    expect(history.length).toBeGreaterThan(20_000);
    expect(history).toContain("history-item-1 ");
    expect(history).toContain("history-item-26 ");
    expect(history).toContain("正常送达的模型回复。");
    for (const excluded of ["foreign-thread-marker", "public-audience-marker", "redacted-history-marker", "assistant-undelivered-marker"]) {
      expect(history).not.toContain(excluded);
    }

    const customOutputLimit = 5120;
    const cleared = await json<{ model: ModelInstance }>(modelPath, "PATCH", {
      contextWindowOverride: null, reasoningEffort: null, defaultMaxTokens: customOutputLimit
    });
    expect(cleared.model).not.toHaveProperty("contextWindowOverride");
    expect(cleared.model).not.toHaveProperty("reasoningEffort");
    expect((await turn("已恢复配置档案上下文。")).compiledBlackboard.max_total_tokens).toBe(8000);
    expect(modelRequests.at(-1)?.reasoning).toBeUndefined();
    expect(observedHistory().length).toBeLessThan(2_000);

    await json(modelPath, "PATCH", { useCatalogContextWindow: true });
    const catalogContextOnly = await turn("只使用目录上下文上限。");
    expect(catalogContextOnly.compiledBlackboard.max_total_tokens).toBeGreaterThan(8000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(customOutputLimit);

    const followingCatalog = await json<{ model: ModelInstance }>(modelPath, "PATCH", { useCatalogMaxOutputTokens: true });
    expect(followingCatalog.model).toMatchObject({
      useCatalogContextWindow: true, useCatalogMaxOutputTokens: true, defaultMaxTokens: customOutputLimit
    });
    expect(followingCatalog.model).not.toHaveProperty("contextWindowOverride");
    const catalogBudget = await turn("请按目录上限带上之前的历史。");
    expect(catalogBudget.compiledBlackboard.max_total_tokens).toBeGreaterThan(8000);
    expect(observedHistory()).toContain("history-item-1 ");
    expect(observedHistory().length).toBeGreaterThan(20_000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(upstreamOutputLimit);

    advertisedWindow = 49_152;
    advertisedOutputLimit = 12_288;
    const updatedCatalog = await json<ModelCatalogResponse>(`${sourcePath}/fetch-models`, "POST", {});
    expect(updatedCatalog.models.find((entry) => entry.modelId === modelId)).toMatchObject({
      contextWindow: advertisedWindow, maxOutputTokens: advertisedOutputLimit
    });
    const refreshedBudget = await turn("请使用刷新后的目录上限。");
    expect(refreshedBudget.compiledBlackboard.max_total_tokens).toBeLessThan(catalogBudget.compiledBlackboard.max_total_tokens);
    expect(refreshedBudget.compiledBlackboard.max_total_tokens).toBeGreaterThan(8000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(advertisedOutputLimit);

    await json(modelPath, "PATCH", { useCatalogContextWindow: false });
    const catalogOutputOnly = await turn("只使用目录输出上限。");
    expect(catalogOutputOnly.compiledBlackboard.max_total_tokens).toBe(8000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(advertisedOutputLimit);

    const restored = await json<{ model: ModelInstance }>(modelPath, "PATCH", {
      useCatalogContextWindow: false, useCatalogMaxOutputTokens: false
    });
    expect(restored.model).toMatchObject({ defaultMaxTokens: customOutputLimit });
    expect((await turn("重新使用配置档案与自定义输出。")).compiledBlackboard.max_total_tokens).toBe(8000);
    expect(observedHistory().length).toBeLessThan(2_000);
    expect(modelRequests.at(-1)?.max_tokens).toBe(customOutputLimit);

    await json(modelPath, "PATCH", { contextWindowOverride: 1024 });
    await turn("请简洁回复。");
    const shortResponseBudget = modelRequests.at(-1)?.max_tokens ?? 0;
    expect(shortResponseBudget).toBeGreaterThanOrEqual(64);
    expect(shortResponseBudget).toBeLessThan(1024);
    const upstreamCallCount = modelRequests.length;
    const text = "请求文本越界。".repeat(1000);
    expect(await json("/protocol/v0/channel/perception", "POST", { channel_id: "builtin.webchat", thread: chatThread, text }, 422))
      .toMatchObject({ error: "MODEL_CONTEXT_LIMIT" });
    const requestId = randomUUID();
    const streamed = await request("/protocol/v0/channel/runs", "POST", {
      requestId, channelId: "builtin.webchat", thread: chatThread, mode: "live", text
    });
    expect(streamed.status).toBe(200);
    expect(await streamed.text()).toContain("MODEL_CONTEXT_LIMIT");
    const status = await json(`/protocol/v0/channel/runs/${requestId}?mode=live&channelId=builtin.webchat`, "GET");
    expect(status).toMatchObject({ status: "failed", error: "MODEL_CONTEXT_LIMIT" });
    expect(modelRequests).toHaveLength(upstreamCallCount);
  } finally {
    await close(server);
    await close(mockUpstream);
    runtime.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}, 15_000);
