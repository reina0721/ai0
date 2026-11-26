import { ContextAssemblyCompiler, ProviderNotConfiguredError, UpstreamModelClient,
  runAgentTurn, tracePreparedRequest, requestFingerprint, type AgentOptions, type ModelTraceLease } from "@ai0/agent-core";
import { createW1DialogueProfile, type LlmDialogueSynthesisInput,
  type LlmDialogueSynthesisOutput } from "./profiles/digital-life/index.js";
import { cognitionResponseContractFacet, type ExtensionCoreHost } from "@ai0/sdk";
import type { AgentModelAdapter, AgentPromptInput, AudienceScope, ChannelTokenUsage } from "@ai0/protocol";
import type { SoulConsoleStudioConfig } from "@ai0/storage";

type Preview = Awaited<ReturnType<ContextAssemblyCompiler["preview"]>>;
export class ChannelRequestPreview {
  constructor(readonly request: Preview) {}
}

export class ResponseContractUnavailable extends Error {}

export function selectResponseContract(host: ExtensionCoreHost, id: string, audience: AudienceScope) {
  if (id === "agent.standard_v1") return undefined;
  const matches = host.listFacets(cognitionResponseContractFacet).filter(entry => entry.implementation.id === id &&
    host.allowsAudienceScope(entry.packageId, audience, cognitionResponseContractFacet.id));
  if (matches.length !== 1) throw new ResponseContractUnavailable("Response contract " + id + (matches.length ? " has multiple providers" : " is unavailable for this audience"));
  return matches[0];
}

export function channelInference(options: {
  studio: SoulConsoleStudioConfig; host: ExtensionCoreHost; upstream: UpstreamModelClient;
  currentStudio?: () => SoulConsoleStudioConfig;
  response?: ReturnType<typeof selectResponseContract>; modelPackageId?: string; sandboxFallback: boolean; preview?: boolean; trace?: ModelTraceLease;
}) {
  return async (input: LlmDialogueSynthesisInput, signal = new AbortController().signal,
    onReasoning?: (delta: string | null) => void): Promise<LlmDialogueSynthesisOutput> => {
    const contract = options.studio.soulStudio.responseContract;
    const entry = options.response;
    const profile = entry?.implementation;
    const parsed = profile?.inputFormat === "bounded_observation" ? createW1DialogueProfile(profile).compile(input) : undefined;
    const inputs: AgentPromptInput[] = [];
    if (parsed) {
      inputs.push({ id: "instructions", role: "system_invariant", content: parsed.system, source: contract },
        { id: "observation", role: "user", content: parsed.observation, source: contract });
    } else {
      if (profile?.instructions) inputs.push({ id: contract, source: entry!.packageId, version: profile.version,
        role: "developer_frame", content: profile.instructions });
      if (input.corePersonalityPrompt) inputs.push({ source: "studio.identity", role: "developer_frame", content: [input.personaName, input.corePersonalityPrompt].filter(Boolean).join("\n") });
      for (const part of input.promptSources ?? []) {
        if (part.source !== "legacy_unknown" && part.id.startsWith("studio/") && part.text && (part.disposition === "included" || part.disposition === "已裁剪")) {
          inputs.push({ id: part.id, source: part.source ?? "studio", version: part.version,
            role: "developer_frame", content: part.text });
        }
      }
      for (const id of ["slot.tier1_working_turn", "slot.tier1_memory_projection"]) {
        const content = input.contextData?.[id];
        if (content) inputs.push({ id, source: "session", role: "untrusted_observation", content });
      }
      if (input.knowledgeEvidence?.length) {
        inputs.push({ source: "knowledge.citations", role: "developer_frame", content: "Cite supporting reference markers as [K1], [K2], etc." });
        inputs.push({ source: "knowledge", role: "untrusted_observation", content: JSON.stringify(input.knowledgeEvidence) });
      }
      inputs.push({ id: "user", source: "channel", role: "user", content: input.userText });
    }
    for (const part of input.promptSources ?? []) {
      if (part.source === "legacy_unknown" && part.text && part.id.startsWith("studio/")) {
        inputs.push({ id: part.id, source: "legacy_unknown", version: part.version, role: "untrusted_observation", content: part.text });
      }
    }
    let model = input.routedModelId;
    let provider = options.modelPackageId ?? "upstream";
    let usage: ChannelTokenUsage | undefined;
    const textAdapter = options.upstream.asModelAdapter(model, options.trace, input.dynamicLlmConfig, {
      onReasoning, onFinish(actualProvider, actualModel, counts) { provider = actualProvider; model = actualModel; usage = counts; }
    });
    const adapter: AgentModelAdapter = {
      capabilities: { tools: true, structuredOutput: true },
      async *model(request) {
        try {
          if (!parsed || request.tools.length || request.rounds.length) { yield* textAdapter.model(request); return; }
          const result = await options.upstream.generateStructured({ model,
            system: [...request.prompt.system, ...request.prompt.developer].join("\n"),
            observation: request.prompt.observations.length ? JSON.stringify({ ...JSON.parse(request.prompt.users[0]!),
              references: request.prompt.observations }) : request.prompt.users.join("\n"),
            trace: { stepId: request.manifest.stepId, fragments: parsed?.fragments, outputContract: contract },
            outputSchema: request.output?.schema, dynamicLlmConfig: input.dynamicLlmConfig,
            validate: value => { try { profile!.parse(JSON.stringify(value)); return value; } catch { return undefined; } } }, request.signal, onReasoning);
          provider = result.provider_used; model = result.model_used; usage = result.usage;
          yield { kind: "delta", text: JSON.stringify(result.value) };
        } catch (error) {
          if (!options.sandboxFallback || !(error instanceof ProviderNotConfiguredError)) throw error;
          provider = model = "deterministic-sandbox";
          const simulated = entry && options.host.invokeFacet(entry, facet => facet.sandboxResponse?.(parsed ? JSON.parse(parsed.observation) : { userText: input.userText }));
          if (entry && simulated === undefined) throw error;
          const text = entry ? (typeof simulated === "string" ? simulated : JSON.stringify(simulated))
            : input.knowledgeEvidence?.[0] ? input.knowledgeEvidence[0].excerpt + " [K1]" : input.userText;
          yield { kind: "delta", text };
        }
        yield { kind: "finish" };
      }
    };
    const lease = entry && options.host.leaseFacet(entry);
    try {
      const run: AgentOptions = { runId: input.stepId, inputs, modelId: model, maxSteps: options.studio.soulStudio.maxInteractiveSteps,
        signal: lease ? AbortSignal.any([signal, lease.signal]) : signal,
        projections: input.promptSources?.map(part => ({ id: part.id, source: part.source, version: part.version,
          role: part.source === "legacy_unknown" ? "untrusted_observation" : part.authority, reason: part.disposition ?? "included",
          fingerprint: part.text ? requestFingerprint(part.text) : undefined, budget: part.budget })),
        bindings: { host: options.host, modelPackageId: options.modelPackageId, audience: input.audienceScope,
          manualPackageIds: options.studio.soulStudio.manualPackageIds,
          allowsTool: (id, name) => (options.currentStudio?.() ?? options.studio).soulStudio.readOnlyTools.some(tool => tool.packageId === id && tool.name === name) },
        adapter: options.modelPackageId ? undefined : adapter,
        profile: profile && entry ? { id: contract, version: profile.version, schema: profile.schema,
          parse(text) {
            const raw = options.host.invokeFacet(entry, facet => ({ value: facet.parse(text) }));
            if (!raw) throw new Error("Response contract unavailable while decoding " + contract);
            return raw.value;
          } } : { id: contract, version: "1", parse: text => text },
        wrapFetch: options.trace && ((request, name, send) => tracePreparedRequest(options.trace!, request, name, send)),
        onStep(manifest) { options.trace?.({ stepId: manifest.stepId, assembly: manifest, attempts: [], model }, [], provider); }
      };
      if (options.preview) throw new ChannelRequestPreview(await new ContextAssemblyCompiler().preview(run));
      const result = await runAgentTurn(run);
      if (result.stopReason !== "finished") throw new Error("Dialogue exceeded its step limit");
      if (!entry) return { surface_utterance: String(result.output), provider_used: provider, model_used: model, usage };
      const reply = options.host.invokeFacet(entry, facet => facet.toOutput(result.output));
      if (typeof reply?.surface_utterance !== "string") throw new Error("Response contract produced no deliverable text");
      return { ...reply, provider_used: provider, model_used: model, usage,
        projectStateImpulses: registered => options.host.allowsProposeDomain(entry.packageId, "D2_CONTINUOUS_STATES")
          ? options.host.invokeFacet(entry, facet => facet.stateImpulses?.(result.output, registered)) ?? {} : {} };
    } finally {
      lease?.dispose();
    }
  };
}
