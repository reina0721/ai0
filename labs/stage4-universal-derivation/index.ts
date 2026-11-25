import type { AgentOptions } from "../stage1-agent-core/index.js";
import { ReflexGate, ScopedContextRegistry } from "../stage2-airi-dissection/index.js";
import type { AudienceScope, Coverage, ReflexSignal } from "../stage2-airi-dissection/index.js";
import { EmbodimentAffordanceRegistry, RealizerVocabularyNegotiator, runObservationTurn } from "../stage3-perception-expression/index.js";
import type { CommunicativeIntentEnvelope, UniversalObservationFrame } from "../stage3-perception-expression/index.js";

export type StateDescriptor = {
  id: string;
  topology: "bipolar_tanh" | "unipolar_sigmoid";
  baseline: number;
  wakeupThresholds: readonly number[];
} & ({ halfLifeMs: number; decayRatePerSec?: never } | { decayRatePerSec: number; halfLifeMs?: never });

function encode(value: number, topology: StateDescriptor["topology"]) {
  const minimum = topology === "bipolar_tanh" ? -1 : 0;
  if (!(value > minimum && value < 1)) throw new RangeError("State outside open interval");
  return topology === "bipolar_tanh" ? Math.atanh(value) : Math.log(value) - Math.log1p(-value);
}

function decode(latent: number, topology: StateDescriptor["topology"]) {
  return topology === "bipolar_tanh"
    ? Math.min(1 - Number.EPSILON / 2, Math.max(-1 + Number.EPSILON / 2, Math.tanh(latent)))
    : Math.min(1 - Number.EPSILON / 2, Math.max(Number.MIN_VALUE, 1 / (1 + Math.exp(-latent))));
}

interface State {
  topology: StateDescriptor["topology"];
  baseline: number;
  rate: number;
  thresholds: readonly number[];
  displacement: number;
  impulseAtMs: number;
}

export class ContinuousStateMetaEngine {
  private readonly states = new Map<string, State>();

  constructor(descriptors: readonly StateDescriptor[], private nowMs = 0) {
    if (!Number.isFinite(nowMs)) throw new RangeError("Invalid initial clock");
    for (const descriptor of descriptors) {
      const { id, topology, baseline, wakeupThresholds } = descriptor;
      const rate = descriptor.halfLifeMs === undefined ? descriptor.decayRatePerSec / 1000 : Math.LN2 / descriptor.halfLifeMs;
      if (!id || this.states.has(id) || !Number.isFinite(rate) || rate <= 0) throw new Error("Invalid state descriptor");
      this.states.set(id, { topology, rate, baseline: encode(baseline, topology),
        thresholds: wakeupThresholds.map(value => encode(value, topology)), displacement: 0, impulseAtMs: nowMs });
    }
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

  impulse(id: string, amount: number, nowMs: number) {
    this.checkTime(nowMs);
    const state = this.states.get(id);
    if (!state || !Number.isFinite(amount)) throw new Error("Invalid impulse");
    const displacement = this.displacementAt(state, nowMs) + amount;
    if (!Number.isFinite(displacement)) throw new RangeError("Latent impulse exceeds numeric range");
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

export type MemoryTier = "episodic_trace" | "perceptual_hypothesis" | "non_literal_frame" | "semantic_fact";
interface MemoryRecord {
  id: string;
  tier: MemoryTier;
  frame: UniversalObservationFrame;
  supersededBy?: string;
}
interface Admission {
  confirmedByPrincipal?: string;
  revises?: string;
  hypotheses?: readonly string[];
}

export class EpistemicMemoryFirewall {
  private readonly records = new Map<string, MemoryRecord>();

  admit(input: UniversalObservationFrame, admission: Admission = {}) {
    const frame = structuredClone(input);
    const { epistemicTier, trustedGrant } = frame.provenance;
    const id = JSON.stringify([frame.channel.shellId, frame.chronology.turnId, frame.chronology.revision]);
    if (this.records.has(id)) throw new Error("Duplicate memory event");
    const previous = admission.revises ? this.records.get(admission.revises) : undefined;
    const confirmed = Boolean(admission.confirmedByPrincipal)
      && admission.confirmedByPrincipal === frame.attribution.principalId;
    const nonLiteral = ["playful_banter", "joke", "roleplay", "non_literal"].includes(frame.contextFrame.socialFrame);
    const hypotheses = frame.interpretation.competingHypotheses ?? admission.hypotheses ?? [];
    const tier: MemoryTier = nonLiteral ? "non_literal_frame"
      : hypotheses.length ? "perceptual_hypothesis"
        : (epistemicTier === "verified_telemetry" && trustedGrant) || confirmed ? "semantic_fact"
          : "episodic_trace";
    if (admission.revises && (!confirmed || nonLiteral || previous?.tier !== "perceptual_hypothesis"
      || previous.supersededBy || previous.frame.attribution.principalId !== frame.attribution.principalId
      || previous.frame.attribution.subjectAnchor !== frame.attribution.subjectAnchor
      || previous.frame.contextFrame.audienceScope !== frame.contextFrame.audienceScope)) {
      throw new Error("Clarification does not carry matching authority");
    }
    if (hypotheses.length) frame.interpretation.competingHypotheses = [...hypotheses];
    const record = { id, tier, frame };
    this.records.set(id, record);
    if (previous) previous.supersededBy = id;
    return structuredClone(record);
  }

  read(tier: MemoryTier, audience: AudienceScope, subjectAnchor?: string) {
    return structuredClone([...this.records.values()].filter(record => record.tier === tier
      && (audience === "only_owner" || record.frame.contextFrame.audienceScope === "public_all")
      && (subjectAnchor === undefined || record.frame.attribution.subjectAnchor === subjectAnchor)));
  }
}

export interface CognitiveOrgan {
  id: string;
  appraise(frame: UniversalObservationFrame, context: { state: Readonly<Record<string, number>> }): {
    impulses?: readonly { id: string; amount: number }[];
    hypotheses?: readonly string[];
    intentProposal?: readonly CommunicativeIntentEnvelope[];
  };
}

type SensoryFrame = Pick<UniversalObservationFrame, "channel">;
function writerKey(shellId: string, modality: string) {
  return JSON.stringify([shellId, modality]);
}
function unavailable(coverage: Coverage) {
  return coverage === "blind" || coverage === "stale" || coverage === "disconnected";
}

export class EmbodimentRuntime<S extends ReflexSignal> {
  readonly contexts = new ScopedContextRegistry();
  readonly affordances = new EmbodimentAffordanceRegistry();
  readonly realizer = new RealizerVocabularyNegotiator(this.affordances);
  readonly memory = new EpistemicMemoryFirewall();
  private readonly organs = new Map<string, CognitiveOrgan>();
  private readonly sensors = new Map<string, SensoryFrame["channel"]>();

  constructor(readonly dynamics: ContinuousStateMetaEngine, private readonly reflex: ReflexGate<S>) {}

  install(organ: CognitiveOrgan) { this.organs.set(organ.id, organ); }

  setSensorCoverage(shellId: string, modality: string, coverage: Coverage) {
    this.affordances.setCoverage(shellId, modality, coverage);
    const key = writerKey(shellId, modality);
    if (coverage === "disconnected") this.contexts.disconnect(key);
    else if (unavailable(coverage)) this.contexts.lockBlindness(key, coverage);
    else this.contexts.readmit(key);
  }

  ingest(frame: UniversalObservationFrame, signal: S, nowMs: number, admission: Admission = {}) {
    const { shellId, modality, sensorCoverage } = frame.channel;
    const key = writerKey(shellId, modality);
    const sensory = frame.provenance.epistemicTier === "direct_sensor" || frame.provenance.epistemicTier === "verified_telemetry";
    if (sensory) {
      const { observedAtMs, freshnessTtlMs } = frame.chronology;
      if (!frame.provenance.trustedGrant || unavailable(sensorCoverage)
        || this.affordances.coverage(shellId, modality) !== sensorCoverage
        || !Number.isFinite(observedAtMs) || !Number.isFinite(freshnessTtlMs)
        || observedAtMs > nowMs || nowMs - observedAtMs > freshnessTtlMs) {
        throw new Error("Sensory frame failed admission");
      }
      this.sensors.set(key, { ...frame.channel });
    }
    const reflex = this.reflex.evaluate(signal);
    const state = this.dynamics.evolveTo(nowMs);
    const decisions = reflex.escalateToConscious
      ? [...this.organs.values()].map(organ => organ.appraise(structuredClone(frame), { state: { ...state } })) : [];
    const hypotheses = decisions.flatMap(decision => decision.hypotheses ?? []);
    const memory = this.memory.admit(frame, { ...admission, hypotheses });
    this.contexts.update(sensory ? key : JSON.stringify([shellId, modality, "input"]), "replace-self", {
      audienceScope: frame.contextFrame.audienceScope,
      coverage: sensory ? sensorCoverage : undefined,
      observedAtMs: frame.chronology.observedAtMs,
      freshnessTtlMs: frame.chronology.freshnessTtlMs,
      payload: memory.frame
    });
    for (const decision of decisions) {
      for (const impulse of decision.impulses ?? []) this.dynamics.impulse(impulse.id, impulse.amount, nowMs);
    }
    const intents = decisions.flatMap(decision => decision.intentProposal ?? []);
    return { reflex, memory, intents, realizations: intents.map(intent => this.realizer.negotiate(intent)) };
  }

  respond(options: AgentOptions, audience: AudienceScope, nowMs: number) {
    // Apply expiry even when the next reader may only access public entries.
    for (const entry of this.contexts.snapshotForAudience("only_owner", nowMs)) {
      const sensor = this.sensors.get(entry.sourceKey);
      if (!sensor) continue;
      const coverage = this.affordances.coverage(sensor.shellId, sensor.modality);
      if (coverage === "disconnected") this.contexts.disconnect(entry.sourceKey);
      else if (entry.coverage === "stale" && !unavailable(coverage)) {
        this.affordances.setCoverage(sensor.shellId, sensor.modality, "stale");
      }
    }
    const frames = this.contexts.snapshotForAudience(audience, nowMs).flatMap(entry => {
      if (entry.payload && typeof entry.payload === "object") return [entry.payload as UniversalObservationFrame];
      if (entry.coverage === undefined || !unavailable(entry.coverage)) return [];
      const sensor = this.sensors.get(entry.sourceKey);
      if (!sensor) return [];
      const status: UniversalObservationFrame = {
        channel: { ...sensor, sensorCoverage: entry.coverage },
        attribution: { subjectAnchor: "source", principalId: entry.sourceKey },
        contextFrame: { audienceScope: entry.audienceScope, socialFrame: "availability" },
        provenance: { epistemicTier: "system_chronoception", trustedGrant: true },
        interpretation: { rawPayload: null, primaryCue: "sensor_unavailable" },
        chronology: { observedAtMs: nowMs, freshnessTtlMs: 0, turnId: entry.sourceKey, revision: 0 }
      };
      return [status];
    });
    return runObservationTurn(options, frames);
  }
}
