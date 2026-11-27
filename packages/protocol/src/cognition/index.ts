import { z } from "zod";
import type { PrincipalTrust, TaintLevel } from "../control-plane/index.js";
import type { AudienceScope } from "../core-v0/audience.js";
import {
  CustomStateDomainSchema,
  type CapabilityRisk,
  type CustomStateDomain
} from "../plugin-manifests/index.js";

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

export type CognitionMemoryTier =
  | "episodic_trace"
  | "perceptual_hypothesis"
  | "non_literal_frame"
  | "semantic_fact";

export type CognitionMemoryValidityStatus =
  | "active"
  | "superseded"
  | "refuted_invalidated"
  | "stale_premise_invalidated";

export type CognitionEpistemicType =
  | "observed_firsthand"
  | "reported_hearsay"
  | "inferred_hypothesis"
  | "imagined_narrative";

export interface CognitionMemoryRecord {
  readonly memoryId: string;
  readonly content: string;
  readonly memoryTier: CognitionMemoryTier;
  readonly audienceScope: AudienceScope;
  readonly createdAtMs: number;
  readonly score?: number;
  readonly sourceEventIds?: readonly string[];
  readonly basedOnMemoryIds?: readonly string[];
  readonly premiseQuantifier?: "all_of" | "any_of";
  readonly minPremiseCount?: number;
  readonly validFromMs?: number;
  readonly validUntilMs?: number;
  readonly epistemicType?: CognitionEpistemicType;
  readonly taintLevel?: TaintLevel;
  readonly validityStatus?: CognitionMemoryValidityStatus;
  readonly supersededByMemoryId?: string;
  readonly invalidatedAtMs?: number;
  readonly invalidatedReason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CognitionMemoryQuery {
  readonly query: string;
  readonly audienceScope: AudienceScope;
  readonly limit?: number;
  readonly tiers?: readonly CognitionMemoryTier[];
  readonly includeInvalidated?: boolean;
  readonly nowMs?: number;
}

export interface CognitionMemoryRevisionInput {
  readonly targetMemoryId: string;
  readonly relation: "supersedes" | "contradicts";
  readonly replacementRecord?: CognitionMemoryRecord;
  readonly reason?: string;
  readonly revisedAtMs: number;
}

export interface CognitionMemoryRevisionOutcome {
  readonly updatedTarget: boolean;
  readonly invalidatedMemoryIds: readonly string[];
  readonly replacementRecord?: CognitionMemoryRecord;
}

export interface CognitionMemoryProvider {
  readonly priority?: number;
  retrieve(
    query: CognitionMemoryQuery,
    signal?: AbortSignal
  ): readonly CognitionMemoryRecord[] | Promise<readonly CognitionMemoryRecord[]>;
  store?(record: CognitionMemoryRecord, signal?: AbortSignal): void | Promise<void>;
  revise?(
    input: CognitionMemoryRevisionInput,
    signal?: AbortSignal
  ): CognitionMemoryRevisionOutcome | Promise<CognitionMemoryRevisionOutcome>;
}

export const cognitionMemoryProviderContract = {
  owner: "cognition",
  name: "memory_provider",
  version: 1,
  parse(raw: unknown): CognitionMemoryProvider {
    const value = raw as CognitionMemoryProvider | null;
    if (
      !value ||
      typeof value.retrieve !== "function" ||
      (value.store !== undefined && typeof value.store !== "function") ||
      (value.revise !== undefined && typeof value.revise !== "function") ||
      (value.priority !== undefined && !Number.isFinite(value.priority))
    ) {
      throw new TypeError("Invalid cognition.memory_provider facet");
    }
    return value;
  }
} as const;

export interface CognitionStateDomainDeclaration<S = unknown> {
  readonly domain: CustomStateDomain;
  readonly description?: string;
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  readonly initialState: S;
  readonly acceptsOlderRevision?: (proposal: {
    readonly domain: string;
    readonly base_rev: number;
    readonly payload: unknown;
  }) => boolean;
  reduce(
    snapshot: S,
    proposal: {
      readonly domain: string;
      readonly base_rev: number;
      readonly source_event_ids?: readonly string[];
      readonly payload: unknown;
    }
  ): { readonly value: S } | { readonly reason: string };
}

export const cognitionStateDomainContract = {
  owner: "cognition",
  name: "state_domain",
  version: 1,
  parse(raw: unknown): CognitionStateDomainDeclaration {
    const value = raw as CognitionStateDomainDeclaration | null;
    if (
      !value ||
      !CustomStateDomainSchema.safeParse(value.domain).success ||
      typeof value.reduce !== "function" ||
      (value.acceptsOlderRevision !== undefined && typeof value.acceptsOlderRevision !== "function") ||
      (value.jsonSchema !== undefined &&
        (typeof value.jsonSchema !== "object" || value.jsonSchema === null || Array.isArray(value.jsonSchema)))
    ) {
      throw new TypeError("Invalid cognition.state_domain facet");
    }
    return value;
  }
} as const;

export type CapabilityPolicyVote = "ALLOW" | "ALLOW_REDACTED" | "REQUIRE_OWNER_CONFIRM" | "DENY";

export interface CognitionCapabilityPolicy {
  readonly priority?: number;
  evaluate(context: {
    readonly principalTrust: PrincipalTrust;
    readonly audienceScope: AudienceScope;
    readonly capabilityRisk: CapabilityRisk;
    readonly triggerTaintLevel?: TaintLevel;
    readonly toolName?: string;
  }): { readonly decision: CapabilityPolicyVote; readonly reason?: string };
}

export const cognitionCapabilityPolicyContract = {
  owner: "cognition",
  name: "capability_policy",
  version: 1,
  parse(raw: unknown): CognitionCapabilityPolicy {
    const value = raw as CognitionCapabilityPolicy | null;
    if (
      !value ||
      typeof value.evaluate !== "function" ||
      (value.priority !== undefined && !Number.isFinite(value.priority))
    ) {
      throw new TypeError("Invalid cognition.capability_policy facet");
    }
    return value;
  }
} as const;

export interface CognitionConsolidationCandidate {
  readonly content: string;
  readonly memoryTier?: CognitionMemoryTier;
  readonly audienceScope?: AudienceScope;
  readonly supportingMemoryIds: readonly string[];
  readonly minPremiseCount?: number;
  readonly validUntilMs?: number;
}

export interface CognitionConsolidationStrategy {
  readonly priority?: number;
  consolidate(
    context: {
      readonly episodes: readonly CognitionMemoryRecord[];
      readonly nowMs: number;
    },
    signal?: AbortSignal
  ): readonly CognitionConsolidationCandidate[] | Promise<readonly CognitionConsolidationCandidate[]>;
}

export const cognitionConsolidationStrategyContract = {
  owner: "cognition",
  name: "consolidation_strategy",
  version: 1,
  parse(raw: unknown): CognitionConsolidationStrategy {
    const value = raw as CognitionConsolidationStrategy | null;
    if (
      !value ||
      typeof value.consolidate !== "function" ||
      (value.priority !== undefined && !Number.isFinite(value.priority))
    ) {
      throw new TypeError("Invalid cognition.consolidation_strategy facet");
    }
    return value;
  }
} as const;
