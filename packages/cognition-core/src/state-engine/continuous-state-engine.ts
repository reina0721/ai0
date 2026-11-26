import { ContinuousStateDescriptorSchema, type ContinuousStateDescriptor } from "@ai0/protocol";

function encode(value: number, topology: ContinuousStateDescriptor["topology"]) {
  const minimum = topology === "bipolar_tanh" ? -1 : 0;
  if (!(value > minimum && value < 1)) throw new RangeError("State outside open interval");
  return topology === "bipolar_tanh" ? Math.atanh(value) : Math.log(value) - Math.log1p(-value);
}

function decode(latent: number, topology: ContinuousStateDescriptor["topology"]) {
  return topology === "bipolar_tanh"
    ? Math.min(1 - Number.EPSILON / 2, Math.max(-1 + Number.EPSILON / 2, Math.tanh(latent)))
    : Math.min(1 - Number.EPSILON / 2, Math.max(Number.MIN_VALUE, 1 / (1 + Math.exp(-latent))));
}

interface State {
  topology: ContinuousStateDescriptor["topology"];
  baseline: number;
  rate: number;
  thresholds: readonly number[];
  displacement: number;
  impulseAtMs: number;
}

export class ContinuousStateMetaEngine {
  private readonly impulseIds = new Set<string>();
  private readonly states = new Map<string, State>();

  constructor(descriptors: readonly ContinuousStateDescriptor[] = [], private nowMs = 0) {
    if (!Number.isFinite(nowMs)) throw new RangeError("Invalid initial clock");
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register(input: ContinuousStateDescriptor) {
      const descriptor = ContinuousStateDescriptorSchema.parse(input);
      const { id, topology, baseline, wakeupThresholds } = descriptor;
      const rate = descriptor.halfLifeMs === undefined ? descriptor.decayRatePerSec! / 1000 : Math.LN2 / descriptor.halfLifeMs;
      if (!id || this.states.has(id) || !Number.isFinite(rate) || rate <= 0) throw new Error("Invalid state descriptor");
      this.states.set(id, { topology, rate, baseline: encode(baseline, topology),
        thresholds: wakeupThresholds.map(value => encode(value, topology)), displacement: 0, impulseAtMs: this.nowMs });
  }

  private displacementAt(state: State, nowMs: number) {
    return state.displacement * Math.exp(-state.rate * (nowMs - state.impulseAtMs));
  }

  private checkTime(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.nowMs) throw new RangeError("Clock must be monotonic");
  }

  evolveTo(nowMs: number) {
    this.checkTime(nowMs);
    this.nowMs = nowMs;
    return Object.fromEntries([...this.states].map(([id, state]) =>
      [id, decode(state.baseline + this.displacementAt(state, nowMs), state.topology)]));
  }

  setValue(id: string, value: number, nowMs: number) {
    this.checkTime(nowMs);
    const state = this.states.get(id);
    if (!state || !Number.isFinite(value)) throw new RangeError("Invalid state value");
    const min = state.topology === "bipolar_tanh" ? -1 + Number.EPSILON : Number.EPSILON;
    state.displacement = encode(Math.max(min, Math.min(1 - Number.EPSILON, value)), state.topology) - state.baseline;
    state.impulseAtMs = nowMs;
    this.nowMs = nowMs;
  }

  impulse(id: string, amount: number, nowMs: number, impulseId?: string) {
    if (impulseId !== undefined && this.impulseIds.has(impulseId)) return;
    this.checkTime(nowMs);
    const state = this.states.get(id);
    if (!state || !Number.isFinite(amount)) throw new Error("Invalid impulse");
    const displacement = this.displacementAt(state, nowMs) + amount;
    if (!Number.isFinite(displacement)) throw new RangeError("Latent impulse exceeds numeric range");
    if (impulseId !== undefined) this.impulseIds.add(impulseId);
    state.displacement = displacement;
    state.impulseAtMs = nowMs;
    this.nowMs = nowMs;
  }

  solveNextWakeupMs(nowMs: number): number | null {
    this.checkTime(nowMs);
    let next = Infinity;
    for (const state of this.states.values()) {
      for (const threshold of state.thresholds) {
        const target = threshold - state.baseline;
        if (!target || Math.sign(target) !== Math.sign(state.displacement)) continue;
        const crossing = state.impulseAtMs + (Math.log(Math.abs(state.displacement)) - Math.log(Math.abs(target))) / state.rate;
        if (crossing > nowMs) next = Math.min(next, crossing);
      }
    }
    return Number.isFinite(next) ? next : null;
  }
}
