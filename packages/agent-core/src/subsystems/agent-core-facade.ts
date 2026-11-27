import type { DynamicContractSnapshot, ExtensionCoreHost, ExtensionHostView } from "@ai0/extension-core";
import type { AgentModelAdapter } from "@ai0/protocol";
import {
  ExecutionIdempotencyLedger,
  type ExecutionIdempotencyStorePort
} from "../kernel/idempotency-ledger.js";
import type { AgentRunResult, ApprovedActionTurn } from "../kernel/turn-runtime.js";
import {
  ContextAssemblyCompiler,
  runAgentTurn,
  selectAgentModel,
  type AgentBindings,
  type AgentOptions
} from "./request-assembly.js";

export interface AgentCoreOptions {
  readonly host?: ExtensionHostView;
  readonly idempotencyStore?: ExecutionIdempotencyStorePort;
  readonly defaultModelPackageIds?: readonly string[];
}

/**
 * Cohesive AgentCore uniting lifecycle, dynamic `agent_capability` contract discovery/validation,
 * X-axis resource bindings (`model_adapter / tool_provider / skill_manual / context_contributor`),
 * Z-axis execution guards (`agent.execution_guard@1` loop/oscillation/rate protection),
 * and durable `ExecutionIdempotencyLedger` replay safety.
 */
export class AgentCore {
  readonly host?: ExtensionHostView;
  readonly compiler: ContextAssemblyCompiler;
  readonly idempotencyLedger: ExecutionIdempotencyLedger;

  private active = true;
  private defaultModelPackageIds: readonly string[];
  private unsubscribeHost?: () => void;

  constructor(options: AgentCoreOptions = {}) {
    this.host = options.host;
    this.compiler = new ContextAssemblyCompiler();
    this.idempotencyLedger = new ExecutionIdempotencyLedger(options.idempotencyStore);
    this.defaultModelPackageIds = options.defaultModelPackageIds ?? [];

    const maybeCoreHost = options.host as Partial<ExtensionCoreHost> | undefined;
    if (typeof maybeCoreHost?.onDidChange === "function") {
      this.unsubscribeHost = maybeCoreHost.onDidChange(() => {
        // Dynamic model adapters, tool providers, execution guards, and agent_capability contracts resolve live per step.
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

  setDefaultModelPackageIds(packageIds: readonly string[]): void {
    this.defaultModelPackageIds = [...packageIds];
  }

  listDynamicCapabilities(): readonly DynamicContractSnapshot[] {
    return this.host?.listDynamicContracts("agent_capability") ?? [];
  }

  selectModel(bindings?: Partial<AgentBindings>, direct?: AgentModelAdapter) {
    const host = bindings?.host ?? this.host;
    if (!host && !direct) {
      throw new Error("ExtensionHostView or direct AgentModelAdapter is required");
    }
    return selectAgentModel(
      host
        ? {
            host,
            ...bindings,
            ...(!bindings?.modelPackageId && !bindings?.modelPackageIds && this.defaultModelPackageIds.length > 0
              ? { modelPackageIds: this.defaultModelPackageIds }
              : {})
          }
        : undefined,
      direct
    );
  }

  async runTurn(options: AgentOptions | ApprovedActionTurn): Promise<AgentRunResult> {
    if (!this.active) {
      throw new Error("AgentCore is stopped");
    }
    if ("action" in options) {
      return runAgentTurn(options);
    }
    const resolvedHost = options.bindings?.host ?? this.host;
    let mergedBindings: AgentBindings | undefined;
    if (resolvedHost) {
      const cloneWithGetters = options.bindings
        ? (Object.defineProperties({}, Object.getOwnPropertyDescriptors(options.bindings)) as AgentBindings)
        : ({ host: resolvedHost } as AgentBindings);
      cloneWithGetters.host = resolvedHost;
      if (!cloneWithGetters.idempotencyLedger) {
        cloneWithGetters.idempotencyLedger = this.idempotencyLedger;
      }
      if (
        !cloneWithGetters.modelPackageId &&
        !cloneWithGetters.modelPackageIds &&
        this.defaultModelPackageIds.length > 0
      ) {
        cloneWithGetters.modelPackageIds = this.defaultModelPackageIds;
      }
      mergedBindings = cloneWithGetters;
    }
    return runAgentTurn({
      ...options,
      ...(mergedBindings ? { bindings: mergedBindings } : {})
    });
  }

  async preview(options: AgentOptions) {
    if (!this.active) {
      throw new Error("AgentCore is stopped");
    }
    return this.compiler.preview(options);
  }
}
