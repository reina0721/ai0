import { createHash } from "node:crypto";
import {
  AgentPromptInputSchema,
  type AgentFragmentTrace,
  type AgentOutputProfile,
  type AgentPromptInput,
  type AgentRequestMessage,
  type AgentRound,
  type AgentStepManifest,
  type AgentToolAdvertisement,
  type AudienceScope,
  type PreparedAgentRequest
} from "@ai0/protocol";

export function fingerprintContent(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function projectPromptInputs(inputs: readonly AgentPromptInput[]) {
  return {
    system: inputs.filter(input => input.role === "system_invariant").map(input => input.content),
    developer: inputs.filter(input => input.role === "developer_frame").map(input => input.content),
    users: inputs.filter(input => input.role === "user").map(input => input.content),
    observations: inputs.filter(input => input.role === "untrusted_observation").map(input => ({ content: input.content }))
  };
}

export interface KernelStepAssemblyInput {
  stepId: string;
  step: number;
  signal: AbortSignal;
  inputs: readonly AgentPromptInput[];
  rounds: readonly AgentRound[];
  tools?: readonly AgentToolAdvertisement[];
  toolManifest?: AgentStepManifest["tools"];
  audience?: AudienceScope;
  contextBudgetChars?: number;
  profile?: AgentOutputProfile;
  modelIdentity?: { id: string; generation?: number; requestedId?: string };
  projections?: AgentStepManifest["projections"];
}

export function assembleKernelStep(options: KernelStepAssemblyInput): PreparedAgentRequest {
  const { stepId, step, signal, inputs, profile } = options;
  const candidates = inputs.map((input, i) => {
    const value = AgentPromptInputSchema.parse(input);
    return { ...value, id: value.id ?? String(i), source: value.source ?? "input", version: value.version ?? "1" };
  });
  const slot = (part: typeof candidates[number]) => JSON.stringify(["input", part.source, part.id, part.role]);
  const winners = new Map(candidates.map(part => [slot(part), part]));
  const messages: AgentRequestMessage[] = [];
  const promptInputs: AgentPromptInput[] = [];
  const fragments: AgentFragmentTrace[] = [];
  let budget = options.contextBudgetChars ?? Infinity;
  if (options.contextBudgetChars !== undefined && (!Number.isSafeInteger(budget) || budget < 0)) {
    throw new RangeError("Invalid context budget");
  }
  for (const part of winners.values()) {
    if (part.role === "system_invariant") {
      if (budget < part.content.length) throw new RangeError("System invariants exceed context budget");
      budget -= part.content.length;
    }
  }
  for (const part of candidates) {
    let reason: AgentFragmentTrace["reason"] = "included";
    let chars = 0;
    let messageIndex: number | undefined;
    if (winners.get(slot(part)) !== part) reason = "replaced";
    else if (!budget && part.content.length && part.role !== "system_invariant") reason = "budget";
    else {
      const content = part.role === "system_invariant" ? part.content : part.content.slice(0, budget);
      chars = content.length;
      if (chars < part.content.length) reason = "trimmed";
      if (part.role !== "system_invariant") budget -= chars;
      messageIndex = messages.length;
      messages.push({ role: part.role, content });
      promptInputs.push({ role: part.role, content });
    }
    fragments.push({
      source: part.source,
      sourceKind: "input",
      id: part.id,
      version: part.version,
      role: part.role,
      chars,
      reason,
      originalChars: part.content.length,
      fingerprint: fingerprintContent(part.content),
      ...(messageIndex === undefined ? {} : { messageIndex, sentFingerprint: fingerprintContent(part.content.slice(0, chars)) })
    });
  }
  const rounds = structuredClone(options.rounds);
  for (const round of rounds) {
    messages.push({ role: "assistant", content: round.text, calls: round.receipts.map(receipt => receipt.call) });
    for (const { call, result } of round.receipts) messages.push({ role: "tool", callId: call.id, name: call.name, result });
  }
  const tools = options.tools ? structuredClone([...options.tools]) : [];
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
    model: options.modelIdentity ?? { id: "direct" },
    output,
    contextBudgetChars: options.contextBudgetChars,
    tools: options.toolManifest ? structuredClone([...options.toolManifest]) : [],
    fingerprint: fingerprintContent(JSON.stringify({ messages, tools, output }))
  };
  return { step, signal, rounds, messages, tools, output, manifest, prompt: projectPromptInputs(promptInputs) };
}
