import type { DynamicContractSnapshot, ExtensionCoreHost, ExtensionHostView } from "@ai0/extension-core";
import type { AudienceScope, CognitionMemoryRecord } from "@ai0/protocol";
import { VirtualClock, type IVirtualClock } from "../kernel/virtual-clock.js";
import { BlackboardCompiler, type BlackboardEventStorage, type BlackboardPolicy, type CompiledBlackboard } from "./blackboard-compiler.js";
import { CapabilityPolicyGate } from "./capability-gate.js";
import {
  AuthoritativeStateCoordinator,
  type BeliefRevisionRequest,
  type BeliefRevisionResult,
  type CoordinatorStorageMutator,
  type ReadOnlyCognitiveSnapshot,
  type SerializableTransactionOptions,
  type SerializableTransactionResult,
  type StateMutationProposal,
  type StateMutationResult,
  type StateTransactionBundle,
  type StateTransactionBundleResult
} from "./cognitive-coordinator.js";
import { InMemoryCognitiveMemoryProvider } from "./memory-provider.js";
import { AgencyTaskWorker, SleepConsolidationWorker, type MilestoneThresholdRule, type ReadOnlyCognitiveEventView } from "./worker-loops.js";

export interface CognitionCoreOptions {
  readonly clock?: IVirtualClock;
  readonly host?: ExtensionHostView;
  readonly storage?: CoordinatorStorageMutator;
  readonly eventStorage?: BlackboardEventStorage & ReadOnlyCognitiveEventView;
  readonly nonLiteralFrames?: Iterable<string>;
  readonly milestoneRules?: readonly MilestoneThresholdRule[];
}

/**
 * Cohesive CognitionCore uniting lifecycle, dynamic `cognition_protocol` / `cognition.state_domain@1`
 * state slots, authoritative two-phase cross-domain atomic transactions, epistemic belief revision,
 * monotonic capability policy gating, crash-recovery task reconciliation, and blackboard compilation.
 * Contains zero hardcoded AI companion personality or milestone presets.
 */
export class CognitionCore {
  readonly clock: IVirtualClock;
  readonly host?: ExtensionHostView;
  readonly defaultMemory: InMemoryCognitiveMemoryProvider;
  readonly policyGate: CapabilityPolicyGate;
  readonly coordinator: AuthoritativeStateCoordinator;
  readonly blackboard: BlackboardCompiler;
  readonly taskWorker: AgencyTaskWorker;
  readonly sleepWorker: SleepConsolidationWorker;

  private active = true;
  private unsubscribeHost?: () => void;

  constructor(options: CognitionCoreOptions = {}) {
    this.clock = options.clock ?? new VirtualClock({ targetInstance: "sandbox:cognition-core", initialVirtualTsMs: 0 });
    this.host = options.host;
    this.defaultMemory = new InMemoryCognitiveMemoryProvider();
    this.policyGate = new CapabilityPolicyGate(options.host);
    const defaultStorage: CoordinatorStorageMutator = options.storage ?? {
      getEventById: () => undefined,
      saveTurnDecisionTrace: () => {}
    };
    this.coordinator = new AuthoritativeStateCoordinator(this.clock, defaultStorage, options.host, {
      nonLiteralFrames: options.nonLiteralFrames
    });
    const eventView = options.eventStorage ?? { listEvents: () => [] };
    this.blackboard = new BlackboardCompiler(this.clock, eventView);
    this.taskWorker = new AgencyTaskWorker(this.coordinator, this.policyGate, this.clock, options.host);
    this.sleepWorker = new SleepConsolidationWorker(
      this.coordinator,
      eventView,
      this.clock,
      options.host,
      options.milestoneRules ?? []
    );

    const reconciled = this.coordinator.reconcileInterruptedWorkOnRestore();
    if (reconciled.length > 0) {
      this.taskWorker.hydrateFromCoordinator();
    }

    const maybeCoreHost = options.host as Partial<ExtensionCoreHost> | undefined;
    if (typeof maybeCoreHost?.onDidChange === "function") {
      this.unsubscribeHost = maybeCoreHost.onDidChange(() => {
        this.coordinator.synchronizeCustomDomains();
      });
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  dispose(): void {
    this.active = false;
    this.unsubscribeHost?.();
    this.unsubscribeHost = undefined;
  }

  restoreAndReconcile(): readonly string[] {
    this.coordinator.restoreCheckpoint();
    const reconciled = this.coordinator.reconcileInterruptedWorkOnRestore();
    this.taskWorker.hydrateFromCoordinator();
    if (reconciled.length > 0) {
      return reconciled;
    }
    return Object.entries(this.getSnapshot().D4_COMMITMENTS_TASKS.active_tasks)
      .filter(([, task]) => task.status === "interrupted_recoverable")
      .map(([taskId]) => taskId);
  }

  getSnapshot(): ReadOnlyCognitiveSnapshot {
    return this.coordinator.getSnapshot();
  }

  listDynamicProtocols(): readonly DynamicContractSnapshot[] {
    return this.host?.listDynamicContracts("cognition_protocol") ?? [];
  }

  submitProposal(proposal: StateMutationProposal): StateMutationResult {
    if (!this.active) throw new Error("CognitionCore is stopped");
    return this.coordinator.submitProposal(proposal);
  }

  submitTransaction(bundle: StateTransactionBundle): StateTransactionBundleResult {
    if (!this.active) throw new Error("CognitionCore is stopped");
    return this.coordinator.submitTransactionBundle(bundle);
  }

  runSerializableTransaction(
    txPrefix: string,
    buildProposals: (snapshot: ReadOnlyCognitiveSnapshot, attempt: number) => readonly StateMutationProposal[],
    options?: SerializableTransactionOptions
  ): SerializableTransactionResult {
    if (!this.active) throw new Error("CognitionCore is stopped");
    return this.coordinator.runSerializableTransaction(txPrefix, buildProposals, options);
  }

  reviseBelief(request: BeliefRevisionRequest): BeliefRevisionResult {
    if (!this.active) throw new Error("CognitionCore is stopped");
    const memOutcome = this.defaultMemory.revise({
      targetMemoryId: request.target_memory_id,
      relation: request.relation,
      revisedAtMs: this.clock.nowMs(),
      ...(request.reason ? { reason: request.reason } : {}),
      ...(request.replacement_memory
        ? {
            replacementRecord: {
              memoryId: request.replacement_memory.memoryId,
              content: request.replacement_memory.content,
              memoryTier: request.replacement_memory.memoryTier,
              audienceScope: request.replacement_memory.audienceScope,
              createdAtMs: this.clock.nowMs(),
              ...(request.source_event_ids ? { sourceEventIds: request.source_event_ids } : {}),
              ...(request.taint_level ? { taintLevel: request.taint_level } : {})
            }
          }
        : {})
    });
    const res = this.coordinator.reviseMemoryBelief({
      ...request,
      extra_invalidated_memory_ids: [
        ...(request.extra_invalidated_memory_ids ?? []),
        ...memOutcome.invalidatedMemoryIds
      ]
    });
    if (res.accepted && res.paused_task_ids.length > 0) {
      this.taskWorker.abortOnPremiseInvalidation(res.paused_task_ids, request.reason);
    }
    return res;
  }

  runConsolidationCycle(signal?: AbortSignal): Promise<readonly CognitionMemoryRecord[]> {
    if (!this.active) throw new Error("CognitionCore is stopped");
    return this.sleepWorker.runExperienceConsolidation(this.defaultMemory, signal);
  }

  compileBlackboard(
    policy: BlackboardPolicy,
    audienceScope: AudienceScope | string,
    lastUserInteractionTsMs?: number
  ): Promise<CompiledBlackboard> {
    return this.blackboard.compile(
      this.getSnapshot(),
      { include_custom_domains: true, ...policy },
      audienceScope,
      lastUserInteractionTsMs
    );
  }
}
