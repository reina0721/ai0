import { z } from "zod";

export const StateTopologySchema = z.enum(["bipolar_tanh", "unipolar_sigmoid"]);
export const ContinuousStateDescriptorSchema = z.object({
  id: z.string().min(1), topology: StateTopologySchema, baseline: z.number().finite(),
  halfLifeMs: z.number().finite().positive().optional(), decayRatePerSec: z.number().finite().positive().optional(),
  wakeupThresholds: z.array(z.number().finite()).default([])
}).superRefine((entry, ctx) => {
  const min = entry.topology === "bipolar_tanh" ? -1 : 0;
  if ([entry.baseline, ...entry.wakeupThresholds].some(value => value <= min || value >= 1))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "State values must be inside the topology's open interval" });
  if ((entry.halfLifeMs === undefined) === (entry.decayRatePerSec === undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Specify exactly one decay parameter" });
});
export const StateAttributionEntrySchema = z.object({
  state_id: z.string(), event_id: z.string(), audience_scope: z.string(), amount: z.number().finite()
}).passthrough();
export const ContinuousStateCheckpointMapSchema = z.record(z.string(), z.number().finite());
export type StateTopology = z.infer<typeof StateTopologySchema>;
export type ContinuousStateDescriptor = z.infer<typeof ContinuousStateDescriptorSchema>;
export type StateAttributionEntry = z.infer<typeof StateAttributionEntrySchema>;
export type ContinuousStateCheckpointMap = z.infer<typeof ContinuousStateCheckpointMapSchema>;

/** An opt-in projection of a model response into a deliverable utterance. */
export interface CognitionResponseContract {
  id: string;
  version: string;
  schema?: Readonly<Record<string, unknown>>;
  instructions?: string;
  inputFormat?: "messages" | "bounded_observation";
  sandboxResponse?(observation: Readonly<Record<string, unknown>>): unknown;
  parse(text: string): unknown;
  toOutput(value: unknown): { surface_utterance: string; [field: string]: unknown };
  stateImpulses?(value: unknown, registered: Readonly<Record<string, number>>): Readonly<Record<string, number>>;
}

export const cognitionResponseContractPoint = {
  owner: "cognition", name: "response_contract", version: 1,
  parse(raw: unknown): CognitionResponseContract {
    const value = raw as CognitionResponseContract | null;
    if (!value || typeof value.id !== "string" || !value.id.trim() ||
        typeof value.version !== "string" || !value.version.trim() ||
        (value.schema !== undefined && (typeof value.schema !== "object" || !value.schema || Array.isArray(value.schema))) ||
        (value.instructions !== undefined && typeof value.instructions !== "string") ||
        (value.inputFormat !== undefined && (!value.schema || !["messages", "bounded_observation"].includes(value.inputFormat))) ||
        (value.sandboxResponse !== undefined && typeof value.sandboxResponse !== "function") ||
        typeof value.parse !== "function" || typeof value.toOutput !== "function" ||
        (value.stateImpulses !== undefined && typeof value.stateImpulses !== "function")) {
      throw new TypeError("Invalid cognition.response_contract facet");
    }
    return value;
  }
} as const;
export interface CognitionProposalPolicy {
  domain: string;
  review(proposal: Readonly<{ domain: string; base_rev: number; source_event_ids: readonly string[]; payload: unknown }>):
    { action: "allow" } | { action: "reject"; reason: string } | { action: "replace_payload"; payload: Record<string, unknown> };
}
export const cognitionProposalPolicyContract = {
  owner: "cognition", name: "proposal_policy", version: 1,
  parse(raw: unknown): CognitionProposalPolicy {
    const value = raw as CognitionProposalPolicy | null;
    if (typeof value?.domain !== "string" || !value.domain || typeof value.review !== "function")
      throw new TypeError("Invalid cognition.proposal_policy");
    return value;
  }
} as const;
