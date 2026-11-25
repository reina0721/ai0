import { runAgent } from "../stage1-agent-core/index.js";
import type { AgentOptions, PromptInput } from "../stage1-agent-core/index.js";
import type { AudienceScope, Coverage } from "../stage2-airi-dissection/index.js";

export interface RealizerCapability {
  token: string;
  semanticAction: string;
  kind: "verbal" | "nonverbal";
  quiet: boolean;
  latencyMs?: number;
}

export interface ShellAffordances {
  id: string;
  connected: boolean;
  anchors: readonly string[];
  sensors: Readonly<Record<string, Coverage>>;
  actuators: readonly RealizerCapability[];
  audienceScope: AudienceScope;
}

export class EmbodimentAffordanceRegistry {
  private readonly shells = new Map<string, ShellAffordances>();

  mount(shell: ShellAffordances) {
    this.shells.set(shell.id, structuredClone(shell));
  }

  unmount(id: string) { this.shells.delete(id); }

  disconnect(id: string) {
    const shell = this.shells.get(id);
    if (shell) this.shells.set(id, { ...shell, connected: false });
  }

  setCoverage(id: string, modality: string, coverage: Coverage) {
    const shell = this.shells.get(id);
    if (!shell) throw new Error("Unknown shell");
    this.shells.set(id, { ...shell, sensors: { ...shell.sensors, [modality]: coverage } });
  }

  coverage(id: string, modality: string): Coverage {
    const shell = this.shells.get(id);
    return shell?.connected ? shell.sensors[modality] ?? "blind" : "disconnected";
  }

  connectedShells() {
    return structuredClone([...this.shells.values()].filter(shell => shell.connected));
  }
}

export interface UniversalObservationFrame {
  channel: { modality: string; shellId: string; sensorCoverage: Coverage };
  attribution: { subjectAnchor: string; principalId: string };
  contextFrame: { socialFrame: string; audienceScope: AudienceScope };
  provenance: { epistemicTier: "direct_sensor" | "verified_telemetry" | "untrusted_utterance" | "system_chronoception"; trustedGrant: boolean };
  interpretation: { rawPayload: unknown; primaryCue: string; competingHypotheses?: readonly string[] };
  chronology: { observedAtMs: number; freshnessTtlMs: number; turnId: string; revision: number };
}

export function runObservationTurn(options: AgentOptions, frames: readonly UniversalObservationFrame[]) {
  const observations = frames.map((frame): PromptInput => ({
    role: "untrusted_observation", content: JSON.stringify(frame)
  }));
  return runAgent({ ...options, inputs: [...options.inputs, ...observations] });
}

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
    return start === undefined ? null : { kind: "unspoken_hesitation" as const, durationMs: Math.max(0, nowMs - start) };
  }

  private reset() {
    this.current?.controller.abort();
    this.current = undefined;
    this.startedAtMs = undefined;
    this.latestActivityMs = undefined;
  }
}

export interface Hibernation { startMs: number; endMs: number }

export class ChronoceptiveSignalSynthesizer {
  private readonly windows: Hibernation[] = [];

  constructor(private lastInteractionMs: number) {}

  interact(nowMs: number) { this.lastInteractionMs = Math.max(this.lastInteractionMs, nowMs); }

  recordHibernation(window: Hibernation) {
    if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.endMs < window.startMs) {
      throw new RangeError("Invalid hibernation window");
    }
    this.windows.push({ ...window });
  }

  unattendedMs(nowMs: number) {
    let cursor = this.lastInteractionMs;
    let slept = 0;
    for (const { startMs, endMs } of [...this.windows].sort((a, b) => a.startMs - b.startMs)) {
      const start = Math.max(cursor, startMs);
      const end = Math.min(endMs, nowMs);
      if (end > start) {
        slept += end - start;
        cursor = end;
      }
    }
    return Math.max(0, nowMs - this.lastInteractionMs - slept);
  }

  synthesize(nowMs: number) {
    const unattendedMs = this.unattendedMs(nowMs);
    return { epistemicTier: "system_chronoception" as const, unattendedMs,
      description: `${unattendedMs / 3_600_000} hours unattended` };
  }
}

type IntentContent =
  | { intent: "explicit_silence" | "actuate" | "request_observation"; utterance?: never }
  | { intent: "communicate"; utterance?: string };

export type CommunicativeIntentEnvelope = IntentContent & {
  attentionTarget?: string;
  expressiveStance?: { valence?: number; arousal?: number; warmth?: number; urgency?: number; semanticCue?: string };
  actuationHint?: { semanticAction: string; intensity?: "subtle" | "moderate" | "strong" };
  deliveryConstraints: {
    audienceScope: AudienceScope;
    requireNonVerbalQuiet?: boolean;
    maxLatencyMs?: number;
  };
};

export class RealizerVocabularyNegotiator {
  constructor(private readonly registry: EmbodimentAffordanceRegistry) {}

  vocabulary() {
    return this.registry.connectedShells().flatMap(shell => shell.actuators.map(capability => ({
      ...capability, shellId: shell.id, audienceScope: shell.audienceScope
    })));
  }

  negotiate(envelope: CommunicativeIntentEnvelope, requestedToken?: string) {
    if (envelope.intent === "explicit_silence") return { disposition: "silent" as const };
    const constraints = envelope.deliveryConstraints;
    const action = envelope.actuationHint?.semanticAction ?? envelope.intent;
    const selection = this.vocabulary().find(capability =>
      capability.semanticAction === action && (!requestedToken || requestedToken === capability.token)
      && capability.audienceScope === constraints.audienceScope
      && (!constraints.requireNonVerbalQuiet || (capability.kind === "nonverbal" && capability.quiet))
      && (constraints.maxLatencyMs === undefined || (capability.latencyMs ?? Infinity) <= constraints.maxLatencyMs)
    );
    return selection ? { disposition: "bound" as const, selection }
      : { disposition: "held_pending_compliant_shell" as const };
  }
}

export interface TimedSegment { text: string; endsAtMs: number }
export interface PlaybackReceipt { eventId: string; presentedThroughMs: number }
export type GroundingReceipt = {
  eventId: string;
  presentedText: string;
  unsaidRemainder: string | null;
  groundingStatus: "grounded" | "interrupted_partial" | "unknown";
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

export class GroundingReceiptTracker {
  private readonly segments: readonly TimedSegment[];
  private readonly events = new Map<string, { receipt: GroundingReceipt; acknowledge: () => void;
    silenced: Promise<PlaybackReceipt | null>; done: Promise<GroundingReceipt> }>();
  private confirmedThroughMs = -Infinity;

  constructor(segments: readonly TimedSegment[]) {
    if (segments.some((item, index) => !Number.isFinite(item.endsAtMs) || item.endsAtMs < 0
      || item.endsAtMs <= (segments[index - 1]?.endsAtMs ?? -Infinity))) {
      throw new Error("Segments require increasing, nonnegative receipt offsets");
    }
    this.segments = structuredClone(segments);
  }

  confirmPresentation(throughMs: number) {
    if (!Number.isFinite(throughMs) || throughMs < 0) throw new RangeError("Invalid playback offset");
    this.confirmedThroughMs = Math.max(this.confirmedThroughMs, throughMs);
  }

  interrupt(eventId: string, playback: PlaybackReceipt | null, userConfirmed = false) {
    const prior = this.events.get(eventId);
    if (prior) return prior;
    if (playback && playback.eventId !== eventId) throw new Error("Mismatched receipt");
    if (playback) this.confirmPresentation(playback.presentedThroughMs);
    const presented = this.segments.filter(segment => segment.endsAtMs <= this.confirmedThroughMs);
    const receipt: GroundingReceipt = Object.freeze({
      eventId,
      presentedText: presented.map(segment => segment.text).join(""),
      unsaidRemainder: playback ? this.segments.slice(presented.length).map(segment => segment.text).join("") : null,
      groundingStatus: !playback ? "unknown" : userConfirmed && presented.length === this.segments.length
        ? "grounded" : "interrupted_partial"
    });
    const done = deferred<GroundingReceipt>();
    const event = { receipt, silenced: Promise.resolve(playback && { ...playback }), done: done.promise,
      acknowledge: () => done.resolve(receipt) };
    this.events.set(eventId, event);
    return event;
  }

  acknowledge(eventId: string) {
    const event = this.events.get(eventId);
    if (!event) throw new Error("Unknown interruption event");
    event.acknowledge();
  }
}
