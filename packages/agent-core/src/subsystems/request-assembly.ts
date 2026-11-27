import type { ExtensionHostView, FacetRegistration } from "@ai0/extension-core";
import {
  AgentPromptInputSchema,
  AuthorityRoleSchema,
  AudienceScopeSchema,
  type AgentContextContributor,
  type AgentContextFragment,
  type AgentFragmentTrace,
  type AgentModelAdapter,
  type AgentOutputProfile,
  type AgentPromptInput,
  type AgentRequestMessage,
  type AgentRound,
  type AgentSkillManual,
  type AgentStepManifest,
  type AgentToolDefinition,
  type AgentToolProvider,
  type AudienceScope,
  type AuthorityRole,
  type CapabilityRisk,
  type PreparedAgentRequest,
  type TaintLevel
} from "@ai0/protocol";
import { abortable } from "../kernel/abortable.js";
import { fingerprintContent, projectPromptInputs } from "../kernel/authority-lanes.js";
import {
  runKernelAgentTurn,
  type AgentRunResult,
  type ApprovedActionTurn,
  type KernelAgentOptions,
  type KernelDispatchedTool,
  type KernelSelectedModel
} from "../kernel/turn-runtime.js";
import {
  agentContextContributorFacet,
  agentModelAdapterFacet,
  agentSkillManualFacet,
  agentToolProviderFacet
} from "./facets.js";

export interface AgentToolAuthorizationMeta {
  readonly capabilityRisk?: CapabilityRisk;
  readonly resultTaint?: TaintLevel;
  readonly activeTurnTaint: TaintLevel;
}

/** These grants belong to the host. An extension cannot promote its own fragments to instructions. */
export interface AgentBindings {
  host: ExtensionHostView;
  modelPackageId?: string;
  modelPackageIds?: readonly string[];
  manualPackageIds?: readonly string[];
  initialTaint?: TaintLevel;
  allowsTool?(packageId: string, name: string, meta: AgentToolAuthorizationMeta): boolean;
  toolPriority?(packageId: string): number;
  allowsContext?(packageId: string, audience: AudienceScope): boolean;
  contextRole?(packageId: string): AuthorityRole;
  contextPriority?(packageId: string): number;
  /** An explicit shared slot allows otherwise independent sources to replace one another. */
  contextSlot?(packageId: string, fragmentId: string): string | undefined;
  audience?: AudienceScope;
}

export interface BoundTool extends KernelDispatchedTool {
  entry: FacetRegistration<AgentToolProvider>;
}

export interface AgentOptions extends Omit<KernelAgentOptions, "stepCompiler"> {
  bindings?: AgentBindings;
}

export function selectAgentModel(bindings: AgentBindings | undefined, direct: AgentModelAdapter | undefined): KernelSelectedModel {
  const candidateIds = [
    ...(bindings?.modelPackageId ? [bindings.modelPackageId] : []),
    ...(bindings?.modelPackageIds ?? [])
  ];
  if (candidateIds.length === 0) {
    if (!direct) throw new Error("Select an agent model adapter");
    return { adapter: direct, identity: { id: "direct" }, live: () => true, lease: undefined };
  }
  if (direct) throw new Error("Select one model adapter per run");
  const host = bindings!.host;
  const audience = bindings!.audience ?? "only_owner";
  const allEntries = host.listFacets(agentModelAdapterFacet);

  if (candidateIds.length === 1) {
    const targetId = candidateIds[0]!;
    const entries = allEntries.filter(entry => entry.packageId === targetId);
    const entry = entries[0];
    if (entries.length !== 1 || !entry) throw new Error(`Model adapter unavailable or ambiguous: ${targetId}`);
    const live = () => host.listFacets(agentModelAdapterFacet).includes(entry) &&
      host.allowsAudienceScope(entry.packageId, bindings!.audience ?? "only_owner", entry.facetId);
    if (!live()) throw new Error("Model adapter audience denied");
    return {
      adapter: agentModelAdapterFacet.parse(entry.implementation),
      identity: { id: entry.packageId, generation: entry.generation },
      live,
      lease: () => host.leaseFacet(entry),
      allowsNetwork: () => host.allowsNetworkAccess(entry.packageId)
    };
  }

  for (const targetId of candidateIds) {
    const entries = allEntries.filter(entry => entry.packageId === targetId);
    if (entries.length !== 1) continue;
    const entry = entries[0]!;
    const live = () => host.listFacets(agentModelAdapterFacet).includes(entry) &&
      host.allowsAudienceScope(entry.packageId, bindings!.audience ?? "only_owner", entry.facetId);
    if (!live()) continue;
    return {
      adapter: agentModelAdapterFacet.parse(entry.implementation),
      identity: { id: entry.packageId, generation: entry.generation },
      live,
      lease: () => host.leaseFacet(entry),
      allowsNetwork: () => host.allowsNetworkAccess(entry.packageId)
    };
  }
  throw new Error(`No live authorized model adapter available in fallback chain: ${candidateIds.join(", ")}`);
}

function selectedManuals(bindings: AgentBindings) {
  const selected = bindings.manualPackageIds ?? [];
  const entries = bindings.host.listFacets(agentSkillManualFacet).filter(entry => selected.includes(entry.packageId) &&
    allowedContext(bindings, entry, bindings.audience ?? "only_owner"));
  if (selected.some(id => !entries.some(entry => entry.packageId === id))) throw new Error("Selected skill unavailable");
  return entries;
}

function taintRank(level: TaintLevel): number {
  if (level === "untrusted_external") return 2;
  if (level === "semi_trusted_friend") return 1;
  return 0;
}

export function resolveTurnActiveTaint(bindings: AgentBindings | undefined, rounds: readonly AgentRound[]): TaintLevel {
  let active: TaintLevel = bindings?.initialTaint ?? "trusted_owner";
  if (!bindings || !rounds.length) return active;
  const taintByTool = new Map<string, TaintLevel>();
  for (const entry of bindings.host.listFacets(agentToolProviderFacet)) {
    for (const tool of entry.implementation.tools) {
      if (tool.resultTaint && (!taintByTool.has(tool.name) || taintRank(tool.resultTaint) > taintRank(taintByTool.get(tool.name)!))) {
        taintByTool.set(tool.name, tool.resultTaint);
      }
    }
  }
  for (const round of rounds) {
    for (const receipt of round.receipts) {
      const produced = taintByTool.get(receipt.call.name);
      if (produced && taintRank(produced) > taintRank(active)) {
        active = produced;
      }
    }
  }
  return active;
}

function bindTools(bindings?: AgentBindings, activeTurnTaint: TaintLevel = "trusted_owner") {
  const tools = new Map<string, BoundTool>();
  if (!bindings) return tools;
  const manuals = selectedManuals(bindings);
  const audience = bindings.audience ?? "only_owner";
  const allowed = (packageId: string, tool: AgentToolDefinition) =>
    bindings.allowsTool?.(packageId, tool.name, {
      capabilityRisk: tool.capabilityRisk,
      resultTaint: tool.resultTaint,
      activeTurnTaint
    }) === true &&
    (bindings.audience ?? "only_owner") === audience &&
    bindings.host.allowsAudienceScope(packageId, audience, agentToolProviderFacet.id) &&
    manuals.every(entry =>
      bindings.host.listFacets(agentSkillManualFacet).includes(entry) &&
      (!entry.implementation.allowedTools || entry.implementation.allowedTools.includes(tool.name)));

  const add = (entry: BoundTool["entry"], tool: AgentToolDefinition, mounted: () => boolean) => {
    const { name } = tool;
    if (!allowed(entry.packageId, tool)) return;
    if (tools.has(name)) {
      const existing = tools.get(name)!;
      if (bindings.toolPriority) {
        const candidatePrio = bindings.toolPriority(entry.packageId);
        const existingPrio = bindings.toolPriority(existing.entry.packageId);
        if (candidatePrio > existingPrio) return;
        if (candidatePrio === existingPrio) {
          throw new Error(`Ambiguous visible tool: ${name}`);
        }
      } else {
        throw new Error(`Ambiguous visible tool: ${name}`);
      }
    }
    const schema = (value: AgentToolDefinition["inputSchema"]) => ({ jsonSchema: structuredClone(value.jsonSchema), parse: value.parse.bind(value) });
    const definition: AgentToolDefinition = {
      name,
      description: tool.description,
      ...(tool.capabilityRisk ? { capabilityRisk: tool.capabilityRisk } : {}),
      ...(tool.resultTaint ? { resultTaint: tool.resultTaint } : {}),
      inputSchema: schema(tool.inputSchema),
      resultSchema: schema(tool.resultSchema),
      execute: tool.execute.bind(tool),
      project: tool.project.bind(tool)
    };
    tools.set(name, {
      entry,
      definition,
      live: () => mounted() && allowed(entry.packageId, tool),
      lease: () => bindings.host.leaseFacet(entry)
    });
  };
  for (const entry of bindings.host.listFacets(agentToolProviderFacet)) {
    for (const tool of entry.implementation.tools) {
      add(entry, tool, () => bindings.host.listFacets(agentToolProviderFacet).includes(entry));
    }
  }
  return tools;
}

interface Candidate extends AgentContextFragment {
  source: string;
  role: AuthorityRole;
  slot?: string;
  entry?: FacetRegistration<AgentContextContributor | AgentSkillManual>;
  mounted?: () => boolean;
}

const allowedContext = (bindings: AgentBindings, entry: FacetRegistration<unknown>, audience: AudienceScope) =>
  bindings.host.allowsAudienceScope(entry.packageId, audience, entry.facetId) && bindings.allowsContext?.(entry.packageId, audience) !== false;

async function collectContext(inputs: readonly AgentPromptInput[], step: number, signal: AbortSignal, bindings?: AgentBindings) {
  const candidates: Candidate[] = inputs.map((input, i) => {
    const value = AgentPromptInputSchema.parse(input);
    return { ...value, id: value.id ?? String(i), source: value.source ?? "input", version: value.version ?? "1" };
  });
  if (!bindings) return candidates;
  const audience = bindings.audience ?? "only_owner";
  for (const entry of selectedManuals(bindings)) {
    const manual = entry.implementation;
    candidates.push({
      id: manual.id,
      source: entry.packageId,
      version: String(entry.generation),
      role: "untrusted_observation",
      content: manual.instructions,
      entry,
      mounted: () => bindings.manualPackageIds?.includes(entry.packageId) === true &&
        bindings.host.listFacets(agentSkillManualFacet).includes(entry)
    });
  }
  const entries = [...bindings.host.listFacets(agentContextContributorFacet)].sort((a, b) =>
    (bindings.contextPriority?.(a.packageId) ?? 0) - (bindings.contextPriority?.(b.packageId) ?? 0) ||
    a.packageId.localeCompare(b.packageId));
  for (const entry of entries) {
    signal.throwIfAborted();
    if (!allowedContext(bindings, entry, audience)) continue;
    const lease = bindings.host.leaseFacet(entry);
    const combined = AbortSignal.any([signal, lease.signal]);
    const fragments = await bindings.host.invokeFacetAsync(entry, async implementation => {
      let result: readonly AgentContextFragment[];
      try { result = await abortable(() => implementation.contribute({ step, audience, signal: combined }), combined); }
      catch (error) { if (combined.aborted) return []; throw error; }
      if (!Array.isArray(result) || !result.every(item => typeof item?.id === "string" && item.id &&
        typeof item.version === "string" && item.version && typeof item.content === "string" &&
        (item.audience === undefined || AudienceScopeSchema.safeParse(item.audience).success) &&
        (item.maxChars === undefined || (Number.isSafeInteger(item.maxChars) && item.maxChars >= 0)))) {
        throw new TypeError("Invalid context fragments");
      }
      return result;
    }).finally(lease.dispose);
    signal.throwIfAborted();
    for (const item of fragments ?? []) {
      candidates.push({
        id: item.id,
        version: item.version,
        content: item.content,
        maxChars: item.maxChars,
        audience: item.audience,
        role: "untrusted_observation",
        source: entry.packageId,
        entry,
        mounted: () => bindings.host.listFacets(agentContextContributorFacet).includes(entry)
      });
    }
  }
  return candidates;
}

export async function assembleAgentStep(options: {
  stepId: string; step: number; signal: AbortSignal; inputs: readonly AgentPromptInput[]; rounds: readonly AgentRound[];
  bindings?: AgentBindings; contextBudgetChars?: number; profile?: AgentOutputProfile;
  modelId?: string; projections?: AgentStepManifest["projections"];
  model: KernelSelectedModel;
  disableTools?: boolean;
}) {
  const { stepId, step, signal, inputs, profile, model, bindings } = options;
  if (profile?.schema && !model.adapter.capabilities?.structuredOutput) throw new Error("Adapter does not support structured output");
  const candidates = await collectContext(inputs, step, signal, bindings);
  const audience = bindings?.audience ?? "only_owner";
  for (const part of candidates) if (part.entry && bindings) {
    part.role = AuthorityRoleSchema.parse(bindings.contextRole?.(part.source) ?? "untrusted_observation");
    part.slot = bindings.contextSlot?.(part.source, part.id);
  }
  const slot = (part: Candidate) => JSON.stringify(part.slot === undefined
    ? [part.entry ? "extension" : "input", part.source, part.id, part.role] : ["slot", part.slot, part.role]);
  const permitted = (part: Candidate) => !part.entry || (part.mounted?.() && allowedContext(bindings!, part.entry, audience));
  const visible = (part: Candidate) => permitted(part) && (!part.audience || part.audience === audience);
  const winners = new Map(candidates.filter(visible).map(part => [slot(part), part]));
  const messages: AgentRequestMessage[] = [];
  const promptInputs: AgentPromptInput[] = [];
  const fragments: AgentFragmentTrace[] = [];
  let budget = options.contextBudgetChars ?? Infinity;
  if (options.contextBudgetChars !== undefined && (!Number.isSafeInteger(budget) || budget < 0)) throw new RangeError("Invalid context budget");
  for (const part of winners.values()) if (part.role === "system_invariant") {
    if ((part.maxChars ?? Infinity) < part.content.length || budget < part.content.length) throw new RangeError("System invariants exceed context budget");
    budget -= part.content.length;
  }
  for (const part of candidates) {
    let reason: AgentFragmentTrace["reason"] = "included";
    let chars = 0;
    let messageIndex: number | undefined;
    if (!permitted(part)) reason = "revoked";
    else if (part.audience && part.audience !== audience) reason = "audience";
    else if (winners.get(slot(part)) !== part) reason = "replaced";
    else if (!budget && part.content.length && part.role !== "system_invariant") reason = "budget";
    else {
      const content = part.role === "system_invariant" ? part.content : part.content.slice(0, Math.min(budget, part.maxChars ?? Infinity));
      chars = content.length;
      if (chars < part.content.length) reason = "trimmed";
      if (part.role !== "system_invariant") budget -= chars;
      messageIndex = messages.length;
      messages.push({ role: part.role, content });
      promptInputs.push({ role: part.role, content });
    }
    fragments.push({
      source: part.source,
      sourceKind: part.entry ? "extension" : "input",
      generation: part.entry?.generation,
      id: part.id,
      version: part.version,
      role: part.role,
      chars,
      reason,
      originalChars: part.content.length,
      maxChars: part.maxChars,
      fingerprint: fingerprintContent(part.content),
      ...(messageIndex === undefined ? {} : { messageIndex, sentFingerprint: fingerprintContent(part.content.slice(0, chars)) })
    });
  }
  const rounds = structuredClone(options.rounds);
  for (const round of rounds) {
    messages.push({ role: "assistant", content: round.text, calls: round.receipts.map(receipt => receipt.call) });
    for (const { call, result } of round.receipts) messages.push({ role: "tool", callId: call.id, name: call.name, result });
  }
  const activeTurnTaint = resolveTurnActiveTaint(bindings, rounds);
  const bound = !options.disableTools && model.adapter.capabilities?.tools ? bindTools(bindings, activeTurnTaint) : new Map<string, BoundTool>();
  const tools = [...bound.values()].map(({ definition }) => ({
    name: definition.name, description: definition.description, inputSchema: structuredClone(definition.inputSchema.jsonSchema)
  }));
  const output =
    profile &&
    (tools.length > 0 && profile.schema
      ? undefined
      : { id: profile.id, version: profile.version, ...(profile.schema && { schema: structuredClone(profile.schema) }) });
  const manifest: AgentStepManifest = {
    stepId,
    step,
    fragments,
    projections: options.projections && structuredClone(options.projections),
    responseContract: profile?.id ?? "agent.standard_v1",
    model: { ...model.identity, ...(options.modelId && { requestedId: options.modelId }) },
    output,
    contextBudgetChars: options.contextBudgetChars,
    tools: [...bound.values()].map(({ entry, definition }) => ({
      name: definition.name,
      packageId: entry.packageId,
      generation: entry.generation,
      ...(definition.capabilityRisk ? { capabilityRisk: definition.capabilityRisk } : {})
    })),
    fingerprint: fingerprintContent(JSON.stringify({ messages, tools, output }))
  };
  const request: PreparedAgentRequest = { step, signal, rounds, messages, tools, output, manifest, prompt: projectPromptInputs(promptInputs) };
  const canSend = () => {
    if ((bindings?.audience ?? "only_owner") !== audience || [...bound.values()].some(tool => !tool.live())) return false;
    return candidates.every((part, index) => !part.entry || fragments[index]?.messageIndex === undefined ||
      (permitted(part) &&
        (bindings?.contextRole?.(part.source) ?? "untrusted_observation") === part.role &&
        bindings?.contextSlot?.(part.source, part.id) === part.slot));
  };
  return { request, bound, canSend };
}

export type ContextAssemblyManifest = AgentStepManifest;
export class ContextAssemblyCompiler {
  compile = assembleAgentStep;

  async preview(options: AgentOptions) {
    const model = selectAgentModel(options.bindings, options.adapter);
    const { request } = await this.compile({
      inputs: options.inputs,
      bindings: options.bindings,
      model,
      modelId: options.modelId,
      stepId: (options.runId ?? "preview") + "/0",
      step: 0,
      signal: options.signal,
      profile: options.profile,
      projections: options.projections,
      contextBudgetChars: options.contextBudgetChars,
      rounds: []
    });
    return { messages: request.messages, tools: request.tools, output: request.output, manifest: request.manifest };
  }
}

export async function runAgentTurn(options: AgentOptions | ApprovedActionTurn): Promise<AgentRunResult> {
  if ("action" in options) {
    return runKernelAgentTurn(options);
  }
  if (options.bindings && options.executeTool) {
    throw new Error("Explicit tool dispatch conflicts with host bindings");
  }
  if (!options.bindings) {
    return runKernelAgentTurn(options);
  }
  const bindings = options.bindings;
  const compiler = new ContextAssemblyCompiler();
  return runKernelAgentTurn({
    ...options,
    audience: bindings.audience,
    stepCompiler: {
      selectModel: direct => selectAgentModel(bindings, direct),
      compile: stepOptions => compiler.compile({ ...stepOptions, bindings })
    }
  });
}

export class AgentCoreRuntime {
  runTurn(options: AgentOptions) { return runAgentTurn(options); }
  startTurn(options: Omit<AgentOptions, "signal"> & { signal?: AbortSignal }) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    return { result: this.runTurn({ ...options, signal }), cancel: (reason?: unknown) => controller.abort(reason) };
  }
}
