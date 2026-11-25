import type { UniversalObservationFrame } from "@ai0/protocol";

export class TurnLifecycleGate<Draft, Warmup> {
  private startedAtMs?: number;
  private latestActivityMs?: number;
  private current?: { key: string; controller: AbortController; result?: { value: Warmup } };

  constructor(private readonly debounceMs: number, private readonly key: (value: Draft) => string,
    private readonly warmup: (value: Draft, signal: AbortSignal) => Promise<Warmup>) {}

  activity(nowMs: number) {
    this.startedAtMs ??= nowMs;
    this.latestActivityMs = Math.max(this.latestActivityMs ?? nowMs, nowMs);
    return this.latestActivityMs + this.debounceMs;
  }

  interim(draft: Draft, nowMs: number) {
    const deadlineMs = this.activity(nowMs);
    const key = this.key(draft);
    if (this.current?.key === key) return deadlineMs;
    this.current?.controller.abort();
    const controller = new AbortController();
    const current: NonNullable<typeof this.current> = { key, controller };
    this.current = current;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.warmup(draft, controller.signal);
    }).then(value => {
      if (!controller.signal.aborted) current.result = { value };
    }).catch(() => { /* Speculation is optional. */ });
    return deadlineMs;
  }

  commit(draft: Draft, frame: UniversalObservationFrame) {
    const speculative = this.current?.key === this.key(draft) ? this.current.result?.value : undefined;
    this.reset();
    return { frame: structuredClone(frame), speculative };
  }

  retract(nowMs: number) {
    const start = this.startedAtMs;
    this.reset();
    return start === undefined ? null : { kind: "retracted_observation" as const, durationMs: Math.max(0, nowMs - start) };
  }

  private reset() {
    this.current?.controller.abort();
    this.current = undefined;
    this.startedAtMs = undefined;
    this.latestActivityMs = undefined;
  }
}
