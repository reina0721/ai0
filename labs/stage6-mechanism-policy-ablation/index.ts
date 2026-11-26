import { runAgent } from "../stage1-agent-core/index.js";
import type { AgentOptions, PromptInput, ToolCall, ToolResult } from "../stage1-agent-core/index.js";
import { ContinuousStateMetaEngine } from "../stage4-universal-derivation/index.js";
import type { StateDescriptor } from "../stage4-universal-derivation/index.js";
import { ChannelFacetRuntime, ExtensionCore, defineFacetPoint } from "../stage5-composite-channel-facets/index.js";
import type { ChannelAudienceScope, ChannelObservation, CoreOwner, ExtensionPackageDefinition,
  FacetRegistration, InteractionChannel, OutboundIntentPlan } from "../stage5-composite-channel-facets/index.js";

export type { OutboundIntentPlan } from "../stage5-composite-channel-facets/index.js";

export interface AgentToolDefinition {
  name: string;
  description: string;
  execute(call: ToolCall, signal: AbortSignal): ToolResult | Promise<ToolResult>;
}
export interface RawPerceptionEvent extends ChannelObservation {
  lifecycle: "commit" | "retract" | "ambient";
  principalId: string;
  text: string;
  nowMs: number;
  salience?: number;
  priority?: number;
  urgent?: boolean;
}
export interface FilteredObservation extends RawPerceptionEvent {
  audienceScope: ChannelAudienceScope;
}
type NeutralRetraction = { kind: "neutral_retract"; lifecycle: "retract"; channelId: string; cancelled: true };
export interface PerceptionFilterContext { nowMs: number; channel: InteractionChannel }
export type PerceptionFilterOutcome =
  | { kind: "pass"; event: FilteredObservation }
  | { kind: "hold" | "suppress" }
  | { kind: "observe"; observation: FilteredObservation };
interface PerceptionFilter {
  id: string;
  priority: number;
  onEvent(event: FilteredObservation, context: PerceptionFilterContext): PerceptionFilterOutcome;
  flushDue?(nowMs: number): readonly FilteredObservation[];
}
interface StateDynamics {
  id: string;
  descriptors: readonly StateDescriptor[];
  onObservation?(obs: FilteredObservation, engine: ContinuousStateMetaEngine, nowMs: number): void;
}
export interface CognitionCompileContext {
  observation: FilteredObservation;
  history: readonly string[];
  states: Readonly<Record<string, number>>;
  nowMs: number;
}
interface ContextContributor {
  id: string;
  priority: number;
  maxTokens?: number;
  contribute(context: CognitionCompileContext): readonly PromptInput[];
}
export interface AttentionCandidate { channelId: string; priority: number; urgent: boolean }
export interface AttentionFocusState { channelId: string; priority: number; lockedUntilMs: number }
export interface AttentionDecision { selectedChannelId: string; focus: AttentionFocusState; focusSwitched: boolean }
interface AttentionArbitrator {
  id: string;
  arbitrate(candidate: AttentionCandidate, currentFocus: AttentionFocusState | null, nowMs: number): AttentionDecision;
}
interface IntentDecorator {
  id: string;
  priority: number;
  decorate(intent: OutboundIntentPlan, channel: InteractionChannel,
    context: { focusSwitched: boolean; nowMs: number }): OutboundIntentPlan;
}

function typedPoint<T extends object>(owner: CoreOwner, name: string, valid: (value: Record<string, unknown>) => boolean) {
  return defineFacetPoint<T>({ owner, name, version: 1, parse(raw) {
    if (typeof raw !== "object" || raw === null || !valid(raw as Record<string, unknown>)) {
      throw new TypeError(`Invalid ${owner}.${name} facet`);
    }
    return { ...raw } as T;
  } });
}
const identified = (value: Record<string, unknown>) => typeof value.id === "string" && value.id.length > 0;
const prioritized = (value: Record<string, unknown>) => identified(value) && Number.isFinite(value.priority);
const optionalFunction = (value: unknown) => value === undefined || typeof value === "function";
export const agentToolProviderFacet = typedPoint<{ tools: readonly AgentToolDefinition[] }>("agent", "tool_provider",
  value => Array.isArray(value.tools) && value.tools.every(tool => tool && typeof tool.name === "string"
    && typeof tool.description === "string" && typeof tool.execute === "function"));
export const perceptionFilterFacet = typedPoint<PerceptionFilter>("perception", "filter",
  value => prioritized(value) && typeof value.onEvent === "function" && optionalFunction(value.flushDue));
export const cognitionStateDynamicsFacet = defineFacetPoint<StateDynamics>({
  owner: "cognition", name: "state_dynamics", version: 1,
  parse(raw) {
    const value = raw as StateDynamics | null;
    if (!value || typeof value.id !== "string" || !Array.isArray(value.descriptors)
      || !optionalFunction(value.onObservation)) throw new TypeError("Invalid cognition.state_dynamics facet");
    const descriptors = structuredClone(value.descriptors);
    new ContinuousStateMetaEngine(descriptors);
    return { ...value, descriptors };
  }
});
export const cognitionContextContributorFacet = typedPoint<ContextContributor>("cognition", "context_contributor",
  value => prioritized(value) && typeof value.contribute === "function"
    && (value.maxTokens === undefined || (typeof value.maxTokens === "number"
      && Number.isSafeInteger(value.maxTokens) && value.maxTokens >= 0)));
export const cognitionAttentionArbitratorFacet = typedPoint<AttentionArbitrator>("cognition", "attention_arbitrator",
  value => identified(value) && typeof value.arbitrate === "function");
export const expressionIntentDecoratorFacet = typedPoint<IntentDecorator>("expression", "intent_decorator",
  value => prioritized(value) && typeof value.decorate === "function");

function byPriority<T extends { priority: number }>(entries: readonly FacetRegistration<T>[]) {
  // Ascending priority, with registration order as the stable tie-breaker.
  return [...entries].sort((a, b) => a.implementation.priority - b.implementation.priority);
}

export class PerceptionCore {
  constructor(private readonly channels: ChannelFacetRuntime) {}

  ingest(event: RawPerceptionEvent): {
    observations: readonly FilteredObservation[];
    cancellation?: NeutralRetraction;
  } {
    const admission = this.channels.admitObservation(event);
    const channel = this.channels.listChannels().find(item => item.channelId === event.channelId);
    if (!admission.admitted || admission.audienceScope === undefined || !channel) return { observations: [] };
    let observation: FilteredObservation = { ...event, audienceScope: admission.audienceScope };
    const extensions = this.channels.extensions;
    for (const entry of byPriority(extensions.listFacets(perceptionFilterFacet))) {
      const outcome = extensions.invokeFacet(entry, filter => filter.onEvent(observation, { nowMs: event.nowMs, channel }));
      if (!outcome) continue;
      switch (outcome.kind) {
        case "pass": observation = outcome.event; break;
        case "observe": return { observations: [outcome.observation] };
        case "hold":
        case "suppress": return { observations: [] };
      }
    }
    if (observation.lifecycle === "retract") return { observations: [], cancellation: {
      kind: "neutral_retract", lifecycle: "retract", channelId: observation.channelId, cancelled: true
    } };
    return { observations: [observation] };
  }

  flushDue(nowMs: number) {
    const extensions = this.channels.extensions;
    return byPriority(extensions.listFacets(perceptionFilterFacet)).flatMap(entry =>
      extensions.invokeFacet(entry, filter => filter.flushDue?.(nowMs)) ?? [])
      .filter(observation => this.channels.admitObservation(observation).admitted);
  }
}

export class CognitionCore {
  private readonly engines = new Map<FacetRegistration<StateDynamics>, ContinuousStateMetaEngine>();
  private focus: AttentionFocusState | null = null;
  private focusPolicy: FacetRegistration<AttentionArbitrator> | undefined;
  private nowMs = 0;

  constructor(private readonly extensions: ExtensionCore) {}

  private sync(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.nowMs) throw new RangeError("Clock must be monotonic");
    this.nowMs = nowMs;
    const active = this.extensions.listFacets(cognitionStateDynamicsFacet);
    for (const entry of this.engines.keys()) {
      if (!active.includes(entry)) this.engines.delete(entry);
    }
    for (const entry of active) {
      if (!this.engines.has(entry)) {
        this.engines.set(entry, new ContinuousStateMetaEngine(entry.implementation.descriptors, nowMs));
      }
    }
    return this.engines;
  }

  readonly dynamics = {
    evolveTo: (nowMs: number): Record<string, number> =>
      Object.assign({}, ...Array.from(this.sync(nowMs).values(), engine => engine.evolveTo(nowMs))),
    solveNextWakeupMs: (nowMs: number): number | null => {
      let next: number | null = null;
      for (const engine of this.sync(nowMs).values()) {
        const crossing = engine.solveNextWakeupMs(nowMs);
        if (crossing !== null && (next === null || crossing < next)) next = crossing;
      }
      return next;
    }
  };

  attend(candidate: AttentionCandidate, nowMs: number): AttentionDecision {
    const previous = this.focus;
    const policy = this.extensions.listFacets(cognitionAttentionArbitratorFacet)[0];
    const decision = policy && this.extensions.invokeFacet(policy, facet =>
      facet.arbitrate(candidate, this.focusPolicy === policy ? previous : null, nowMs));
    this.focusPolicy = decision ? policy : undefined;
    if (decision) {
      this.focus = decision.focus;
      return decision;
    }
    this.focus = { channelId: candidate.channelId, priority: candidate.priority, lockedUntilMs: nowMs };
    return { selectedChannelId: candidate.channelId, focus: this.focus, focusSwitched: previous?.channelId !== candidate.channelId };
  }

  compile(observation: FilteredObservation, history: readonly string[], nowMs: number): PromptInput[] {
    for (const [entry, engine] of this.sync(nowMs)) {
      this.extensions.invokeFacet(entry, facet => facet.onObservation?.(observation, engine, nowMs));
    }
    const context = { observation, history, nowMs, states: this.dynamics.evolveTo(nowMs) };
    const inputs: PromptInput[] = [];
    for (const entry of byPriority(this.extensions.listFacets(cognitionContextContributorFacet))) {
      const contributed = this.extensions.invokeFacet(entry, facet => facet.contribute(context)) ?? [];
      let remaining = entry.implementation.maxTokens ?? Infinity;
      for (const input of contributed) {
        const cost = countTokens(input.content);
        if (cost > remaining) continue;
        inputs.push(input);
        remaining -= cost;
      }
    }
    inputs.push({ role: "untrusted_observation", content: observation.text });
    return inputs;
  }
}

export class AgentCore {
  constructor(private readonly extensions: ExtensionCore, private readonly model: AgentOptions["model"]) {}

  runAgentTurn(inputs: readonly PromptInput[], signal = new AbortController().signal) {
    const tools = new Map<string, { entry: FacetRegistration<{ tools: readonly AgentToolDefinition[] }>;
      tool: AgentToolDefinition }>();
    for (const entry of this.extensions.listFacets(agentToolProviderFacet)) {
      for (const tool of entry.implementation.tools) {
        if (!tools.has(tool.name)) tools.set(tool.name, { entry, tool });
      }
    }
    const descriptions: PromptInput[] = [...tools.values()].map(({ tool }) =>
      ({ role: "developer_frame", content: `Tool ${tool.name}: ${tool.description}` }));
    return runAgent({ inputs: [...descriptions, ...inputs], model: this.model, signal, maxRetries: 0,
      executeTool: async (call, toolSignal) => {
        const provider = tools.get(call.name);
        if (!provider) return { status: "failed", error: `Unknown tool: ${call.name}` };
        return await this.extensions.invokeFacetAsync(provider.entry, async () => provider.tool.execute(call, toolSignal))
          ?? { status: "failed", error: `Unavailable tool: ${call.name}` };
      }
    });
  }
}

export class ExpressionCore {
  constructor(private readonly channels: ChannelFacetRuntime) {}

  emitIntent(intent: OutboundIntentPlan, context: { focusSwitched: boolean; nowMs: number }) {
    const channel = this.channels.listChannels().find(item => item.channelId === intent.targetChannelId);
    if (!channel) return this.channels.realizeIntent(intent);
    const extensions = this.channels.extensions;
    let decorated = intent;
    for (const entry of byPriority(extensions.listFacets(expressionIntentDecoratorFacet))) {
      decorated = extensions.invokeFacet(entry, facet => facet.decorate(decorated, channel, context)) ?? decorated;
    }
    return this.channels.realizeIntent({ ...decorated, targetChannelId: intent.targetChannelId,
      audienceScope: intent.audienceScope });
  }
}

export class FiveCoreHarness {
  readonly channels: ChannelFacetRuntime;
  readonly perception: PerceptionCore;
  readonly cognition: CognitionCore;
  readonly agent: AgentCore;
  readonly expression: ExpressionCore;
  private nowMs = 0;
  private readonly history = new Map<string, string[]>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(model: AgentOptions["model"], readonly extensions = new ExtensionCore()) {
    this.channels = new ChannelFacetRuntime(extensions);
    this.perception = new PerceptionCore(this.channels);
    this.cognition = new CognitionCore(extensions);
    this.agent = new AgentCore(extensions, model);
    this.expression = new ExpressionCore(this.channels);
  }

  private schedule<T>(operation: () => Promise<T>) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  ingestEvent(event: RawPerceptionEvent) {
    return this.schedule(async () => {
      const due = await this.advance(event.nowMs);
      const ingress = this.perception.ingest(event);
      const turns = await this.runTurns(ingress.observations);
      return { ...ingress, turns: [...due, ...turns] };
    });
  }

  advanceTime(nowMs: number) {
    return this.schedule(() => this.advance(nowMs));
  }

  private advance(nowMs: number) {
    if (!Number.isFinite(nowMs) || nowMs < this.nowMs) throw new RangeError("Clock must be monotonic");
    this.nowMs = nowMs;
    return this.runTurns(this.perception.flushDue(nowMs));
  }

  private async runTurns(observations: readonly FilteredObservation[]) {
    const turns = [];
    for (const observation of observations) {
      if (!this.channels.admitObservation(observation).admitted) continue;
      const attention = this.cognition.attend({ channelId: observation.channelId, priority: observation.priority ?? 0,
        urgent: observation.urgent ?? false }, this.nowMs);
      const key = JSON.stringify([observation.channelId, observation.principalId, observation.audienceScope]);
      const history = this.history.get(key) ?? [];
      const inputs = this.cognition.compile(observation, history, this.nowMs);
      const agent = await this.agent.runAgentTurn(inputs);
      const utterance = agent.rounds.at(-1)?.text;
      // Reply on the originating channel. Focus arbitration does not reroute observations across audiences.
      const delivery = this.expression.emitIntent({ targetChannelId: observation.channelId,
        audienceScope: observation.audienceScope, utterance }, {
        nowMs: this.nowMs, focusSwitched: attention.focusSwitched && attention.selectedChannelId === observation.channelId
      });
      this.history.set(key, [...history, observation.text, ...(utterance ? [utterance] : [])]);
      turns.push({ observation, inputs, agent, attention, delivery, executedAtMs: this.nowMs });
    }
    return turns;
  }
}

function policy(id: string, facets: readonly { id: string }[],
  activate: ExtensionPackageDefinition["activate"]): ExtensionPackageDefinition {
  return { id, displayName: id, version: "1", facets: facets.map(facet => facet.id), activate,
    permissions: { readDomains: [], proposeDomains: [], maxAudienceScope: "only_owner", networkAccess: false } };
}

export function conversationalGate() {
  return policy("builtin.conversational-gate", [perceptionFilterFacet], scope => {
    const pending = new Map<string, FilteredObservation>();
    const ambientCounts = new Map<string, number>();
    const quietWindowMs = 1200;
    scope.onDispose(() => {
      pending.clear();
      ambientCounts.clear();
    });
    scope.contributeFacet(perceptionFilterFacet, {
      id: "conversation", priority: 0,
      onEvent(event, { channel }) {
        const key = JSON.stringify([event.channelId, event.principalId, event.audienceScope]);
        if (event.lifecycle === "ambient") {
          if ((event.salience ?? 0) >= 0.5) return { kind: "pass", event };
          const signature = JSON.stringify([key, event.modality, event.text]);
          const count = ambientCounts.get(signature) ?? 0;
          ambientCounts.set(signature, count + 1);
          return count >= 2 ? { kind: "suppress" } : { kind: "pass", event };
        }
        if (event.lifecycle === "retract") {
          pending.delete(key);
          return { kind: "observe", observation: { ...event, text: "[观察：对方欲言又止撤回了输入]" } };
        }
        if (event.modality !== "text" || channel.venueType === "cli") return { kind: "pass", event };
        const previous = pending.get(key);
        pending.set(key, previous ? { ...event, text: `${previous.text}\n${event.text}`,
          priority: Math.max(previous.priority ?? 0, event.priority ?? 0), urgent: previous.urgent || event.urgent } : event);
        return { kind: "hold" };
      },
      flushDue(nowMs) {
        const observations = [];
        for (const [key, event] of pending) {
          if (event.nowMs + quietWindowMs > nowMs) continue;
          pending.delete(key);
          observations.push(event);
        }
        return observations;
      }
    });
  });
}

export function companionHomeostasis() {
  return policy("builtin.companion-homeostasis", [cognitionStateDynamicsFacet, cognitionContextContributorFacet], scope => {
    scope.contributeFacet(cognitionStateDynamicsFacet, {
      id: "homeostasis",
      descriptors: [
        { id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 1000,
          wakeupThresholds: [Math.tanh(0.5)] },
        { id: "instant_arousal", topology: "unipolar_sigmoid", baseline: 0.4, halfLifeMs: 800, wakeupThresholds: [] },
        { id: "circadian_energy", topology: "unipolar_sigmoid", baseline: 0.6, halfLifeMs: 86_400_000, wakeupThresholds: [] },
        { id: "drive_social_longing", topology: "unipolar_sigmoid", baseline: 0.65, halfLifeMs: 3000, wakeupThresholds: [] }
      ],
      onObservation(observation, engine, nowMs) {
        const { drive_social_longing = 0 } = engine.evolveTo(nowMs);
        const valence = observation.lifecycle === "retract" ? -0.25 : 1;
        engine.impulse("instant_valence", valence, nowMs);
        engine.impulse("instant_arousal", 0.4 + drive_social_longing * 0.2, nowMs);
        engine.impulse("circadian_energy", -0.15, nowMs);
        engine.impulse("drive_social_longing", -0.3 - valence * 0.1, nowMs);
      }
    });
    scope.contributeFacet(cognitionContextContributorFacet, {
      id: "homeostasis", priority: 0,
      contribute({ states }) {
        const { instant_valence, instant_arousal, circadian_energy, drive_social_longing } = states;
        return [{ role: "developer_frame", content: `Homeostasis ${JSON.stringify({
          instant_valence, instant_arousal, circadian_energy, drive_social_longing
        })}` }];
      }
    });
  });
}

export function attentionArbitrator(hysteresisWindowMs = 5000) {
  if (!Number.isFinite(hysteresisWindowMs) || hysteresisWindowMs < 0) throw new RangeError("Invalid hysteresis window");
  return policy("builtin.attention-arbitrator", [cognitionAttentionArbitratorFacet, expressionIntentDecoratorFacet], scope => {
    scope.contributeFacet(cognitionAttentionArbitratorFacet, {
      id: "focus",
      arbitrate(candidate, current, nowMs) {
        const locked = current && current.channelId !== candidate.channelId && nowMs < current.lockedUntilMs
          && !candidate.urgent && candidate.priority <= current.priority;
        const focus = locked ? current : { channelId: candidate.channelId, priority: candidate.priority,
          lockedUntilMs: nowMs + hysteresisWindowMs };
        return { selectedChannelId: focus.channelId, focus, focusSwitched: current?.channelId !== focus.channelId };
      }
    });
    scope.contributeFacet(expressionIntentDecoratorFacet, {
      id: "gaze", priority: 0,
      decorate(intent, target, { focusSwitched }) {
        const canGaze = target.embodimentSurface?.supportedTokens.some(token =>
          token.kind === "nonverbal" && token.semanticAction === "gaze");
        return focusSwitched && canGaze ? { ...intent, metadata: { ...intent.metadata, gaze_lead_ms: 180 } } : intent;
      }
    });
  });
}

export interface LoreEntry {
  id: string;
  keywords: readonly string[];
  content: string;
  priority: number;
  references?: readonly string[];
}

// The lab counts whitespace-delimited words as deterministic budget units.
function countTokens(text: string) { return text.match(/\S+/gu)?.length ?? 0; }

export function lorebookContributor(entries: readonly LoreEntry[], maxTokens: number) {
  const book = structuredClone(entries);
  const byId = new Map(book.map(entry => [entry.id, entry]));
  return policy("builtin.lorebook-contributor", [cognitionContextContributorFacet], scope => {
    scope.contributeFacet(cognitionContextContributorFacet, {
      id: "lorebook", priority: 10, maxTokens,
      contribute({ observation, history }) {
        const text = [...history, observation.text].join("\n").toLowerCase();
        const matched = book.filter(entry => entry.keywords.some(keyword => keyword && text.includes(keyword.toLowerCase())));
        const visited = new Map<string, LoreEntry>();
        while (matched.length) {
          const entry = matched.pop();
          if (!entry || visited.has(entry.id)) continue;
          visited.set(entry.id, entry);
          for (const id of entry.references ?? []) {
            const referenced = byId.get(id);
            if (referenced && !visited.has(id)) matched.push(referenced);
          }
        }
        return book.filter(entry => visited.has(entry.id)).sort((a, b) => a.priority - b.priority).map(entry =>
          ({ role: "developer_frame", content: entry.content }));
      }
    });
  });
}
