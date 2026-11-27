import { agentToolProviderFacet } from "@ai0/agent-core";
import type { AgencyTaskRecord } from "@ai0/cognition-core";
import type {
  ExtensionHostView,
  ExtensionPackageState,
  FacetPoint,
  FacetRegistration,
  ScopedExtensionPolicy,
  ServiceContract
} from "@ai0/extension-core";
import type {
  AgentToolDefinition,
  AgentToolProvider,
  AgentValueSchema,
  AudienceScope,
  CapabilityRisk,
  CognitionMemoryQuery,
  CognitionMemoryRecord,
  CognitionMemoryTier,
  StateDomain
} from "@ai0/protocol";

export const INTRINSIC_TOOLS_PACKAGE_ID = "runtime.intrinsic";

export type AgentPlanStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface AgentPlanStep {
  readonly stepId: string;
  readonly title: string;
  readonly status: AgentPlanStepStatus;
}

export interface AgentActivePlan {
  readonly planId: string;
  readonly goal: string;
  readonly steps: readonly AgentPlanStep[];
  readonly updatedAtMs: number;
}

export interface SubagentDelegationParams {
  readonly task: string;
  readonly allowedPackages?: readonly string[];
  readonly deniedPackages?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly allowNetwork?: boolean;
  readonly maxSteps?: number;
}

export interface SubagentDelegationResult {
  readonly summary: string;
  readonly stopReason: string;
  readonly rounds: number;
  readonly toolCallsExecuted: number;
  readonly goalVerification: string;
}

export interface SkillDirectoryEntry {
  readonly packageId: string;
  readonly skillId: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly summary: string;
  readonly allowedTools?: readonly string[];
  readonly active: boolean;
}

export interface ActivatedSkillManual {
  readonly packageId: string;
  readonly skillId: string;
  readonly instructions: string;
  readonly allowedTools?: readonly string[];
}

export interface IntrinsicToolRuntimePort {
  updatePlan(goal: string | undefined, steps: readonly AgentPlanStep[]): AgentActivePlan;
  delegateSubagent(params: SubagentDelegationParams, signal: AbortSignal): Promise<SubagentDelegationResult>;
  listSkills(query?: string): readonly SkillDirectoryEntry[];
  activateSkill(packageOrSkillId: string): ActivatedSkillManual;
  dispatchBackgroundGoal(params: {
    goal: string;
    capabilityRisk?: CapabilityRisk;
    steps?: Array<{ step_title: string; actuator_or_tool_id?: string }>;
  }): AgencyTaskRecord;
  recallMemories(
    query: Omit<CognitionMemoryQuery, "audienceScope">,
    signal: AbortSignal
  ): Promise<readonly CognitionMemoryRecord[]>;
  proposeMemory(
    params: { content: string; memoryTier: CognitionMemoryTier; interactionFrame?: string },
    signal: AbortSignal
  ): Promise<{ accepted: boolean; reason?: string; record?: CognitionMemoryRecord }>;
}

const VALID_PLAN_STATUSES = new Set<AgentPlanStepStatus>(["pending", "in_progress", "completed", "blocked"]);
const VALID_MEMORY_TIERS = new Set<CognitionMemoryTier>([
  "episodic_trace",
  "perceptual_hypothesis",
  "non_literal_frame",
  "semantic_fact"
]);
const VALID_CAPABILITY_RISKS = new Set<CapabilityRisk>([
  "read_only_safe",
  "low_read_and_scoped_write",
  "high_side_effect_privileged"
]);

function expectRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Expected object for ${label}`);
  }
  return input as Record<string, unknown>;
}

const passthroughResultSchema: AgentValueSchema = {
  jsonSchema: { type: "object" },
  parse: (value) => expectRecord(value, "tool result")
};

export function createIntrinsicAgentTools(
  port: IntrinsicToolRuntimePort,
  options: { subagentCapabilityRisk?: CapabilityRisk } = {}
): AgentToolDefinition[] {
  return [
    {
      name: "agent.update_plan",
      description: "Create or update the agent's structured multi-step execution plan in cognitive domain D4.",
      capabilityRisk: "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["steps"],
          properties: {
            goal: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["stepId", "title", "status"],
                properties: {
                  stepId: { type: "string" },
                  title: { type: "string" },
                  status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] }
                }
              }
            }
          }
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.update_plan");
          if (obj.goal !== undefined && typeof obj.goal !== "string") {
            throw new TypeError("goal must be a string");
          }
          if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
            throw new TypeError("steps must be a non-empty array");
          }
          const steps: AgentPlanStep[] = obj.steps.map((item, idx) => {
            const step = expectRecord(item, `steps[${idx}]`);
            const stepId = typeof step.stepId === "string" && step.stepId.trim() ? step.stepId.trim() : "";
            const title = typeof step.title === "string" && step.title.trim() ? step.title.trim() : "";
            const status = step.status as AgentPlanStepStatus;
            if (!stepId || !title || !VALID_PLAN_STATUSES.has(status)) {
              throw new TypeError(`Invalid plan step at index ${idx}`);
            }
            return { stepId, title, status };
          });
          return { ...(typeof obj.goal === "string" ? { goal: obj.goal } : {}), steps };
        }
      },
      resultSchema: passthroughResultSchema,
      execute(call) {
        try {
          const parsed = call.input as { goal?: string; steps: readonly AgentPlanStep[] };
          const plan = port.updatePlan(parsed.goal, parsed.steps);
          return { status: "verified", value: plan };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.delegate_subagent",
      description:
        "Delegate a self-contained subtask to an isolated subagent turn running under a monotonically attenuated ScopedExtensionView.",
      capabilityRisk: options.subagentCapabilityRisk ?? "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string" },
            allowedPackages: { type: "array", items: { type: "string" } },
            deniedPackages: { type: "array", items: { type: "string" } },
            allowedTools: { type: "array", items: { type: "string" } },
            allowNetwork: { type: "boolean" },
            maxSteps: { type: "integer", minimum: 1, maximum: 16 }
          }
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.delegate_subagent");
          if (typeof obj.task !== "string" || !obj.task.trim()) {
            throw new TypeError("task must be a non-empty string");
          }
          const toStringList = (field: unknown, name: string): readonly string[] | undefined => {
            if (field === undefined) return undefined;
            if (!Array.isArray(field) || field.some((x) => typeof x !== "string")) {
              throw new TypeError(`${name} must be an array of strings`);
            }
            return field as string[];
          };
          if (obj.allowNetwork !== undefined && typeof obj.allowNetwork !== "boolean") {
            throw new TypeError("allowNetwork must be a boolean");
          }
          if (
            obj.maxSteps !== undefined &&
            (typeof obj.maxSteps !== "number" || !Number.isInteger(obj.maxSteps) || obj.maxSteps < 1 || obj.maxSteps > 16)
          ) {
            throw new TypeError("maxSteps must be an integer between 1 and 16");
          }
          return {
            task: obj.task.trim(),
            ...(toStringList(obj.allowedPackages, "allowedPackages")
              ? { allowedPackages: toStringList(obj.allowedPackages, "allowedPackages")! }
              : {}),
            ...(toStringList(obj.deniedPackages, "deniedPackages")
              ? { deniedPackages: toStringList(obj.deniedPackages, "deniedPackages")! }
              : {}),
            ...(toStringList(obj.allowedTools, "allowedTools")
              ? { allowedTools: toStringList(obj.allowedTools, "allowedTools")! }
              : {}),
            ...(typeof obj.allowNetwork === "boolean" ? { allowNetwork: obj.allowNetwork } : {}),
            ...(typeof obj.maxSteps === "number" ? { maxSteps: obj.maxSteps } : {})
          };
        }
      },
      resultSchema: passthroughResultSchema,
      async execute(call, signal) {
        try {
          const parsed = call.input as SubagentDelegationParams;
          const outcome = await port.delegateSubagent(parsed, signal);
          return {
            status: outcome.stopReason === "finished" ? "verified" : "unverified",
            value: outcome
          };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.list_skills",
      description:
        "List available SKILL.md methodology manuals visible in the current scope without loading full bodies into context.",
      capabilityRisk: "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          additionalProperties: false
        },
        parse(raw) {
          const obj = raw === undefined || raw === null ? {} : expectRecord(raw, "agent.list_skills");
          if (obj.query !== undefined && typeof obj.query !== "string") {
            throw new TypeError("query must be a string");
          }
          return { ...(typeof obj.query === "string" ? { query: obj.query } : {}) };
        }
      },
      resultSchema: passthroughResultSchema,
      execute(call) {
        try {
          const parsed = call.input as { query?: string };
          const skills = port.listSkills(parsed.query);
          return { status: "verified", value: { count: skills.length, skills } };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.activate_skill",
      description:
        "Activate a SKILL.md manual by packageId or skillId so its full SOP instructions are loaded and bound for this session.",
      capabilityRisk: "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["packageId"],
          properties: {
            packageId: { type: "string" }
          },
          additionalProperties: false
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.activate_skill");
          if (typeof obj.packageId !== "string" || !obj.packageId.trim()) {
            throw new TypeError("packageId must be a non-empty string");
          }
          return { packageId: obj.packageId.trim() };
        }
      },
      resultSchema: passthroughResultSchema,
      execute(call) {
        try {
          const parsed = call.input as { packageId: string };
          const manual = port.activateSkill(parsed.packageId);
          return {
            status: "verified",
            value: {
              ...manual,
              active: true
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.dispatch_background_goal",
      description: "Register an asynchronous background goal in cognitive domain D4 for W2 worker execution.",
      capabilityRisk: "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["goal"],
          properties: {
            goal: { type: "string" },
            capabilityRisk: {
              type: "string",
              enum: ["read_only_safe", "low_read_and_scoped_write", "high_side_effect_privileged"]
            },
            steps: { type: "array", items: { type: "string" } }
          }
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.dispatch_background_goal");
          if (typeof obj.goal !== "string" || !obj.goal.trim()) {
            throw new TypeError("goal must be a non-empty string");
          }
          const risk = obj.capabilityRisk as CapabilityRisk | undefined;
          if (risk !== undefined && !VALID_CAPABILITY_RISKS.has(risk)) {
            throw new TypeError("Invalid capabilityRisk");
          }
          const steps =
            Array.isArray(obj.steps) && obj.steps.every((s) => typeof s === "string" && s.trim())
              ? (obj.steps as string[]).map((step_title) => ({ step_title }))
              : undefined;
          return {
            goal: obj.goal.trim(),
            ...(risk ? { capabilityRisk: risk } : {}),
            ...(steps ? { steps } : {})
          };
        }
      },
      resultSchema: passthroughResultSchema,
      execute(call) {
        try {
          const parsed = call.input as {
            goal: string;
            capabilityRisk?: CapabilityRisk;
            steps?: Array<{ step_title: string }>;
          };
          const task = port.dispatchBackgroundGoal(parsed);
          return {
            status: "verified",
            value: {
              taskId: task.task_id,
              goal: task.goal,
              status: task.status,
              capabilityRisk: task.capability_risk
            }
          };
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.recall_memory",
      description: "Retrieve audience-authorized cognitive memories matching a query.",
      capabilityRisk: "read_only_safe",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 20 }
          }
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.recall_memory");
          if (typeof obj.query !== "string") throw new TypeError("query must be a string");
          if (
            obj.limit !== undefined &&
            (typeof obj.limit !== "number" || !Number.isInteger(obj.limit) || obj.limit < 1 || obj.limit > 20)
          ) {
            throw new TypeError("limit must be an integer between 1 and 20");
          }
          return {
            query: obj.query,
            ...(typeof obj.limit === "number" ? { limit: obj.limit } : {})
          };
        }
      },
      resultSchema: passthroughResultSchema,
      async execute(call, signal) {
        try {
          const parsed = call.input as { query: string; limit?: number };
          const memories = await port.recallMemories(parsed, signal);
          return { status: "verified", value: { count: memories.length, memories } };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    },
    {
      name: "agent.propose_memory",
      description:
        "Propose a durable cognitive memory record through the EpistemicMemoryFirewall and active memory provider.",
      capabilityRisk: "low_read_and_scoped_write",
      inputSchema: {
        jsonSchema: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string" },
            memoryTier: {
              type: "string",
              enum: ["episodic_trace", "perceptual_hypothesis", "non_literal_frame", "semantic_fact"]
            },
            interactionFrame: { type: "string" }
          }
        },
        parse(raw) {
          const obj = expectRecord(raw, "agent.propose_memory");
          if (typeof obj.content !== "string" || !obj.content.trim()) {
            throw new TypeError("content must be a non-empty string");
          }
          const tier = (obj.memoryTier ?? "episodic_trace") as CognitionMemoryTier;
          if (!VALID_MEMORY_TIERS.has(tier)) {
            throw new TypeError("Invalid memoryTier");
          }
          if (obj.interactionFrame !== undefined && typeof obj.interactionFrame !== "string") {
            throw new TypeError("interactionFrame must be a string");
          }
          return {
            content: obj.content.trim(),
            memoryTier: tier,
            ...(typeof obj.interactionFrame === "string" ? { interactionFrame: obj.interactionFrame } : {})
          };
        }
      },
      resultSchema: passthroughResultSchema,
      async execute(call, signal) {
        try {
          const parsed = call.input as {
            content: string;
            memoryTier: CognitionMemoryTier;
            interactionFrame?: string;
          };
          const outcome = await port.proposeMemory(parsed, signal);
          if (!outcome.accepted) {
            return { status: "failed", error: outcome.reason ?? "MEMORY_PROPOSAL_REJECTED" };
          }
          return { status: "verified", value: outcome };
        } catch (error) {
          if (signal.aborted) throw error;
          return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      },
      project: (value) => value
    }
  ];
}

/**
 * Non-mutating ExtensionHostView overlay that exposes replaceable L1 intrinsic agent tools
 * without polluting or colliding on a shared ExtensionCoreHost. Any external `agent.tool_provider@1`
 * contributing a tool with the same name automatically overrides the intrinsic default.
 */
export class IntrinsicToolsHostOverlay implements ExtensionHostView {
  private cachedKey = "";
  private cachedEntry?: FacetRegistration<AgentToolProvider>;

  constructor(
    private readonly base: ExtensionHostView,
    private readonly isEnabled: () => boolean,
    private readonly intrinsicTools: readonly AgentToolDefinition[]
  ) {}

  listPackages(): ExtensionPackageState[] {
    return this.base.listPackages();
  }

  getPackage(id: string): ExtensionPackageState | undefined {
    return this.base.getPackage(id);
  }

  listFacets<T>(point: FacetPoint<T>): readonly FacetRegistration<T>[] {
    const baseEntries = this.base.listFacets(point);
    if (!this.isEnabled() || point.id !== agentToolProviderFacet.id || point.version !== agentToolProviderFacet.version) {
      return baseEntries;
    }
    const overriddenNames = new Set<string>();
    for (const entry of baseEntries as readonly FacetRegistration<AgentToolProvider>[]) {
      for (const tool of entry.implementation.tools) {
        overriddenNames.add(tool.name);
      }
    }
    const activeTools = this.intrinsicTools.filter((tool) => !overriddenNames.has(tool.name));
    if (activeTools.length === 0) return baseEntries;

    const key = activeTools.map((t) => t.name).join(",");
    if (!this.cachedEntry || this.cachedKey !== key) {
      this.cachedKey = key;
      this.cachedEntry = Object.freeze({
        packageId: INTRINSIC_TOOLS_PACKAGE_ID,
        facetId: agentToolProviderFacet.id,
        generation: 1,
        implementation: { tools: activeTools }
      });
    }
    return [...baseEntries, this.cachedEntry as unknown as FacetRegistration<T>];
  }

  invokeFacet<T, R>(entry: FacetRegistration<T>, invoke: (implementation: T) => R): R | undefined {
    if (entry.packageId === INTRINSIC_TOOLS_PACKAGE_ID) {
      return this.isEnabled() ? invoke(entry.implementation) : undefined;
    }
    return this.base.invokeFacet(entry, invoke);
  }

  async invokeFacetAsync<T, R>(
    entry: FacetRegistration<T>,
    invoke: (implementation: T) => R | Promise<R>
  ): Promise<R | undefined> {
    if (entry.packageId === INTRINSIC_TOOLS_PACKAGE_ID) {
      return this.isEnabled() ? await invoke(entry.implementation) : undefined;
    }
    return this.base.invokeFacetAsync(entry, invoke);
  }

  leaseFacet<T>(entry: FacetRegistration<T>): { signal: AbortSignal; dispose(): void } {
    if (entry.packageId === INTRINSIC_TOOLS_PACKAGE_ID) {
      const controller = new AbortController();
      return { signal: controller.signal, dispose() {} };
    }
    return this.base.leaseFacet(entry);
  }

  bindService<I, O>(
    contract: ServiceContract<I, O>,
    providerPackageId: string,
    audience?: AudienceScope
  ): (input: I, signal?: AbortSignal) => Promise<O> {
    return this.base.bindService(contract, providerPackageId, audience);
  }

  allowsReadDomain(id: string, domain: StateDomain): boolean {
    return this.base.allowsReadDomain(id, domain);
  }

  allowsProposeDomain(id: string, domain: StateDomain): boolean {
    return this.base.allowsProposeDomain(id, domain);
  }

  allowsAudienceScope(id: string, audience: AudienceScope, facet?: string): boolean {
    if (id === INTRINSIC_TOOLS_PACKAGE_ID) {
      return this.isEnabled() && (facet === undefined || facet === agentToolProviderFacet.id);
    }
    return this.base.allowsAudienceScope(id, audience, facet);
  }

  allowsNetworkAccess(id: string): boolean {
    if (id === INTRINSIC_TOOLS_PACKAGE_ID) return false;
    return this.base.allowsNetworkAccess(id);
  }

  createScopedView(policy: ScopedExtensionPolicy): ExtensionHostView {
    return this.base.createScopedView(policy);
  }
}
