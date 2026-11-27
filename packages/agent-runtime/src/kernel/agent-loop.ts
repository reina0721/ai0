export type ToolRoutingMode = "direct_inline" | "dual_speed_w1_w2";

export interface LoopIngressDisposition<TObservation> {
  readonly observations: readonly TObservation[];
  readonly cancelledChannelId?: string;
}

export interface LoopStageAdapters<TInput, TObservation, TState, TContext, TActionResult, TDelivery> {
  perceive(input: TInput, nowMs: number): LoopIngressDisposition<TObservation> | Promise<LoopIngressDisposition<TObservation>>;
  flushDue?(nowMs: number): readonly TObservation[] | Promise<readonly TObservation[]>;
  updateState(observation: TObservation, nowMs: number): TState | Promise<TState>;
  buildContext(observation: TObservation, state: TState, nowMs: number): TContext | Promise<TContext>;
  execute(context: TContext, state: TState, observation: TObservation, signal: AbortSignal): TActionResult | Promise<TActionResult>;
  observeAndExpress(
    result: TActionResult,
    observation: TObservation,
    state: TState,
    nowMs: number,
    signal: AbortSignal
  ): TDelivery | Promise<TDelivery>;
  channelKey?(observation: TObservation): string;
}

export interface LoopCycleReport<TObservation, TState, TActionResult, TDelivery> {
  readonly observation: TObservation;
  readonly state: TState;
  readonly action: TActionResult;
  readonly delivery: TDelivery;
  readonly executedAtMs: number;
}

/**
 * L0 Universal Agent Outer Loop:
 * Maintains lifecycle, monotonic clock progression, channel-scoped interruption/cancellation,
 * and the canonical Perceive -> UpdateState -> BuildContext -> Execute -> ObserveAndExpress cycle.
 */
export class UniversalAgentLoop<TInput, TObservation, TState, TContext, TActionResult, TDelivery> {
  private active = true;
  private nowMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly activeChannelTurns = new Map<string, Set<AbortController>>();

  constructor(
    private readonly stages: LoopStageAdapters<TInput, TObservation, TState, TContext, TActionResult, TDelivery>,
    initialNowMs = 0
  ) {
    if (!Number.isFinite(initialNowMs)) throw new RangeError("Initial clock timestamp must be finite");
    this.nowMs = initialNowMs;
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentNowMs(): number {
    return this.nowMs;
  }

  start(): void {
    this.active = true;
  }

  stop(reason = "Agent runtime stopped"): void {
    this.active = false;
    for (const controllers of this.activeChannelTurns.values()) {
      for (const controller of controllers) {
        controller.abort(new DOMException(reason, "AbortError"));
      }
    }
    this.activeChannelTurns.clear();
  }

  interruptChannel(channelKey: string, reason = "Channel turn interrupted"): number {
    const set = this.activeChannelTurns.get(channelKey);
    if (!set || set.size === 0) return 0;
    const count = set.size;
    for (const controller of set) {
      controller.abort(new DOMException(reason, "AbortError"));
    }
    set.clear();
    return count;
  }

  ingest(
    input: TInput,
    nowMs = this.nowMs,
    signal?: AbortSignal
  ): Promise<{
    cancelledChannelId?: string;
    cycles: LoopCycleReport<TObservation, TState, TActionResult, TDelivery>[];
  }> {
    this.ensureActive();
    return this.enqueue(async () => {
      const dueCycles = await this.advanceInternal(nowMs, signal);
      const ingress = await this.stages.perceive(input, this.nowMs);
      if (ingress.cancelledChannelId) {
        this.interruptChannel(ingress.cancelledChannelId, "Retracted or interrupted by interlocutor");
      }
      const currentCycles = await this.runObservations(ingress.observations, signal);
      return {
        ...(ingress.cancelledChannelId ? { cancelledChannelId: ingress.cancelledChannelId } : {}),
        cycles: [...dueCycles, ...currentCycles]
      };
    });
  }

  advanceTime(
    nowMs: number,
    signal?: AbortSignal
  ): Promise<LoopCycleReport<TObservation, TState, TActionResult, TDelivery>[]> {
    this.ensureActive();
    return this.enqueue(() => this.advanceInternal(nowMs, signal));
  }

  private ensureActive(): void {
    if (!this.active) throw new Error("Agent loop is stopped");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async advanceInternal(
    nowMs: number,
    signal?: AbortSignal
  ): Promise<LoopCycleReport<TObservation, TState, TActionResult, TDelivery>[]> {
    if (!Number.isFinite(nowMs) || nowMs < this.nowMs) {
      throw new RangeError("Agent loop clock must be monotonic");
    }
    this.nowMs = nowMs;
    if (!this.stages.flushDue) return [];
    const due = await this.stages.flushDue(nowMs);
    return this.runObservations(due, signal);
  }

  private async runObservations(
    observations: readonly TObservation[],
    externalSignal?: AbortSignal
  ): Promise<LoopCycleReport<TObservation, TState, TActionResult, TDelivery>[]> {
    const reports: LoopCycleReport<TObservation, TState, TActionResult, TDelivery>[] = [];
    for (const observation of observations) {
      if (!this.active) break;
      const key = this.stages.channelKey?.(observation) ?? "default";
      const controller = new AbortController();
      const set = this.activeChannelTurns.get(key) ?? new Set<AbortController>();
      set.add(controller);
      this.activeChannelTurns.set(key, set);
      const combinedSignal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
      try {
        const state = await this.stages.updateState(observation, this.nowMs);
        const context = await this.stages.buildContext(observation, state, this.nowMs);
        const action = await this.stages.execute(context, state, observation, combinedSignal);
        const delivery = await this.stages.observeAndExpress(action, observation, state, this.nowMs, combinedSignal);
        reports.push({
          observation,
          state,
          action,
          delivery,
          executedAtMs: this.nowMs
        });
      } finally {
        set.delete(controller);
        if (set.size === 0) this.activeChannelTurns.delete(key);
      }
    }
    return reports;
  }
}
