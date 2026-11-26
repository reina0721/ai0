import { createHash } from "node:crypto";
import type { ExtensionCoreHost, FacetRegistration } from "@ai0/extension-core";
import {
  AgentPromptInputSchema, AuthorityRoleSchema, AudienceScopeSchema, type AgentContextContributor, type AgentContextFragment,
  type AgentFragmentTrace, type AgentModelAdapter, type AgentOutputProfile, type AgentPromptInput,
  type AgentRequestMessage, type AgentRound, type AgentStepManifest, type AgentToolDefinition,
  type AgentSkillManual, type AgentToolProvider, type AudienceScope, type AuthorityRole, type PreparedAgentRequest
} from "@ai0/protocol";
import { agentContextContributorFacet, agentModelAdapterFacet, agentSkillManualFacet, agentToolDefinitionFacet, agentToolProviderFacet } from "./facets.js";
import { abortable } from "./abortable.js";

/** These grants belong to the host. An extension cannot promote its own fragments to instructions. */
export interface AgentBindings {
  host: ExtensionCoreHost;
  modelPackageId?: string;
  manualPackageIds?: readonly string[];
  allowsTool?(packageId: string, name: string): boolean;
  /** A v1 tool needs host-supplied validation and a model-visible projection before advertisement. */
  legacyToolContract?(packageId: string, name: string): Pick<AgentToolDefinition, "inputSchema" | "resultSchema" | "project"> | undefined;
  allowsContext?(packageId: string, audience: AudienceScope): boolean;
  contextRole?(packageId: string): AuthorityRole;
  contextPriority?(packageId: string): number;
  /** An explicit shared slot allows otherwise independent sources to replace one another. */
  contextSlot?(packageId: string, fragmentId: string): string | undefined;
  audience?: AudienceScope;
}
export interface BoundTool {
  entry: FacetRegistration<AgentToolProvider>;
  definition: AgentToolDefinition;
  live(): boolean;
}
export function projectPromptInputs(inputs: readonly AgentPromptInput[]) {
  return {
    system: inputs.filter(input => input.role === "system_invariant").map(input => input.content),
    developer: inputs.filter(input => input.role === "developer_frame").map(input => input.content),
    users: inputs.filter(input => input.role === "user").map(input => input.content),
    observations: inputs.filter(input => input.role === "untrusted_observation").map(input => ({ content: input.content }))
  };
}
function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function selectAgentModel(bindings: AgentBindings | undefined, direct: AgentModelAdapter | undefined) {
  if (!bindings?.modelPackageId) {
    if (!direct) throw new Error("Select an agent model adapter");
    return { adapter: direct, identity: { id: "direct" }, live: () => true, lease: undefined };
  }
  if (direct) throw new Error("Select one model adapter per run");
  const entries = bindings.host.listFacets(agentModelAdapterFacet).filter(entry => entry.packageId === bindings.modelPackageId);
  const entry = entries[0];
  if (entries.length !== 1 || !entry) throw new Error(`Model adapter unavailable or ambiguous: ${bindings.modelPackageId}`);
  const live = () => bindings.host.listFacets(agentModelAdapterFacet).includes(entry) &&
    bindings.host.allowsAudienceScope(entry.packageId, bindings.audience ?? "only_owner", entry.facetId);
  if (!live()) throw new Error("Model adapter audience denied");
  return {
    adapter: agentModelAdapterFacet.parse(entry.implementation),
    identity: { id: entry.packageId, generation: entry.generation },
    live, lease: () => bindings.host.leaseFacet(entry)
  };
}
function selectedManuals(bindings: AgentBindings) {
  const selected = bindings.manualPackageIds ?? [];
  const entries = bindings.host.listFacets(agentSkillManualFacet).filter(entry => selected.includes(entry.packageId) &&
    allowedContext(bindings, entry, bindings.audience ?? "only_owner"));
  if (selected.some(id => !entries.some(entry => entry.packageId === id))) throw new Error("Selected skill unavailable");
  return entries;
}

function bindTools(bindings?: AgentBindings) {
  const tools = new Map<string, BoundTool>();
  if (!bindings) return tools;
  const manuals = selectedManuals(bindings);
  const audience = bindings.audience ?? "only_owner";
  const allowed = (packageId: string, name: string) => bindings.allowsTool?.(packageId, name) === true &&
    (bindings.audience ?? "only_owner") === audience && bindings.host.allowsAudienceScope(packageId, audience, agentToolDefinitionFacet.id) && manuals.every(entry =>
      bindings.host.listFacets(agentSkillManualFacet).includes(entry) &&
      (!entry.implementation.allowedTools || entry.implementation.allowedTools.includes(name)));
  const add = (entry: BoundTool["entry"], tool: AgentToolDefinition, mounted: () => boolean) => {
    const { name } = tool;
    if (!allowed(entry.packageId, name)) return;
    if (tools.has(name)) throw new Error(`Ambiguous visible tool: ${name}`);
    const schema = (value: AgentToolDefinition["inputSchema"]) => ({ jsonSchema: structuredClone(value.jsonSchema), parse: value.parse.bind(value) });
    const definition = { name, description: tool.description, inputSchema: schema(tool.inputSchema), resultSchema: schema(tool.resultSchema),
      execute: tool.execute.bind(tool), project: tool.project.bind(tool) };
    tools.set(name, { entry, definition, live: () => mounted() && allowed(entry.packageId, name) });
  };
  for (const entry of bindings.host.listFacets(agentToolDefinitionFacet)) {
    for (const tool of entry.implementation.tools) add(entry, tool, () => bindings.host.listFacets(agentToolDefinitionFacet).includes(entry));
  }
  if (bindings.legacyToolContract) for (const entry of bindings.host.listFacets(agentToolProviderFacet)) {
    for (const tool of entry.implementation.tools) {
      const contract = bindings.legacyToolContract(entry.packageId, tool.name);
      if (contract) add(entry, { ...tool, ...contract }, () => bindings.host.listFacets(agentToolProviderFacet).includes(entry));
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
    candidates.push({ id: manual.id, source: entry.packageId, version: String(entry.generation), role: "untrusted_observation",
      content: manual.instructions, entry, mounted: () => bindings.manualPackageIds?.includes(entry.packageId) === true &&
        bindings.host.listFacets(agentSkillManualFacet).includes(entry) });
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
      candidates.push({ id: item.id, version: item.version, content: item.content, maxChars: item.maxChars, audience: item.audience,
        role: "untrusted_observation", source: entry.packageId, entry, mounted: () => bindings.host.listFacets(agentContextContributorFacet).includes(entry) });
    }
  }
  return candidates;
}
export async function assembleAgentStep(options: {
  stepId: string; step: number; signal: AbortSignal; inputs: readonly AgentPromptInput[]; rounds: readonly AgentRound[];
  bindings?: AgentBindings; contextBudgetChars?: number; profile?: AgentOutputProfile;
  modelId?: string; projections?: AgentStepManifest["projections"];
  model: ReturnType<typeof selectAgentModel>;
}) {
  const { stepId, step, signal, inputs, profile, model, bindings } = options;
  if (profile?.schema && !model.adapter.capabilities?.structuredOutput) throw new Error("Adapter does not support structured output");
  const candidates = await collectContext(inputs, step, signal, bindings);
  const audience = bindings?.audience ?? "only_owner";
  for (const part of candidates) if (part.entry && bindings) {
    part.role = AuthorityRoleSchema.parse(bindings.contextRole?.(part.source) ?? "untrusted_observation");
    part.slot = bindings.contextSlot?.(part.source, part.id);
  }
  // Namespaces are isolated unless the host explicitly assigns the same replacement slot and authority.
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
    fragments.push({ source: part.source, sourceKind: part.entry ? "extension" : "input", generation: part.entry?.generation,
      id: part.id, version: part.version, role: part.role, chars, reason, originalChars: part.content.length, maxChars: part.maxChars,
      fingerprint: fingerprint(part.content), ...(messageIndex === undefined ? {} : { messageIndex, sentFingerprint: fingerprint(part.content.slice(0, chars)) }) });
  }
  const rounds = structuredClone(options.rounds);
  for (const round of rounds) {
    messages.push({ role: "assistant", content: round.text, calls: round.receipts.map(receipt => receipt.call) });
    for (const { call, result } of round.receipts) messages.push({ role: "tool", callId: call.id, name: call.name, result });
  }
  const bound = model.adapter.capabilities?.tools ? bindTools(bindings) : new Map<string, BoundTool>();
  const tools = [...bound.values()].map(({ definition }) => ({
    name: definition.name, description: definition.description, inputSchema: structuredClone(definition.inputSchema.jsonSchema)
  }));
  const output = profile && { id: profile.id, version: profile.version, ...(profile.schema && { schema: structuredClone(profile.schema) }) };
  const manifest: AgentStepManifest = { stepId, step, fragments, projections: options.projections && structuredClone(options.projections), responseContract: profile?.id ?? "agent.standard_v1",
    model: { ...model.identity, ...(options.modelId && { requestedId: options.modelId }) }, output,
    contextBudgetChars: options.contextBudgetChars,
    tools: [...bound.values()].map(({ entry, definition }) => ({ name: definition.name, packageId: entry.packageId, generation: entry.generation })),
    fingerprint: fingerprint(JSON.stringify({ messages, tools, output })) };
  const request: PreparedAgentRequest = { step, signal, rounds, messages, tools, output, manifest, prompt: projectPromptInputs(promptInputs) };
  // Recheck immediately before each transport attempt, including after an asynchronous retry delay.
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

  async preview(options: import("./agent-runtime.js").AgentOptions) {
    const model = selectAgentModel(options.bindings, options.adapter);
    const { request } = await this.compile({ inputs: options.inputs, bindings: options.bindings, model, modelId: options.modelId,
      stepId: (options.runId ?? "preview") + "/0", step: 0, signal: options.signal, profile: options.profile,
      projections: options.projections, contextBudgetChars: options.contextBudgetChars, rounds: [] });
    return { messages: request.messages, tools: request.tools, output: request.output, manifest: request.manifest };
  }
}
