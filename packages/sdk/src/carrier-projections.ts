import type { ExtensionActivationScope } from "@ai0/extension-core";
import {
  ConsoleUiSlotContributionSchema,
  DeliveryReceiptSchema,
  InteractionChannelSchema,
  type AgentSkillRecord,
  type AgentToolDefinition,
  type AgentToolResult,
  type AgentValueSchema,
  type Ai0ExtensionManifest,
  type CarrierProjection,
  type ExtensionPermissions,
  type McpServerConfig
} from "@ai0/protocol";
import {
  agentContextContributorFacet,
  agentSkillManualFacet,
  agentToolProviderFacet
} from "./agent-facets.js";
import {
  cognitionContextContributorFacet,
  cognitionSleepOrganFacet,
  consoleUiSlotFacet,
  expressionIntentDecoratorFacet,
  expressionRealizerFacet,
  perceptionSourceFacet
} from "./facets.js";

export interface ConfiguredCarriers {
  servers: readonly McpServerConfig[];
  skills: readonly AgentSkillRecord[];
  /** Owner-controlled state, deliberately separate from source frontmatter and imports. */
  grants?: Readonly<Record<string, ExtensionPermissions>>;
}

export type CarrierOrigin =
  | { kind: "mcp"; server: McpServerConfig }
  | { kind: "skill"; skill: AgentSkillRecord };

export interface McpCarrierTransport {
  read(server: McpServerConfig, uri: string, signal: AbortSignal): Promise<string>;
  subscribe(
    server: McpServerConfig,
    uri: string,
    emit: (text: string) => void,
    signal: AbortSignal
  ): Promise<() => void | Promise<void>>;
  call(
    server: McpServerConfig,
    tool: McpServerConfig["discoveredTools"][number],
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<AgentToolResult>;
}

export interface CarrierProjectionSource {
  value?: unknown;
  allowedTools?: readonly string[];
  read?(signal: AbortSignal): Promise<string>;
  reportReadFailure?(failed: boolean): void;
  tool?: AgentToolDefinition;
  subscribe?: (emit: (text: string) => void, signal: AbortSignal) => Promise<() => void | Promise<void>>;
}

export type CarrierProjectionRoute = (
  scope: ExtensionActivationScope,
  source: CarrierProjectionSource,
  route: CarrierProjection,
  lifetime: AbortSignal
) => void;

/** Owners can provide additional projectors at host assembly without changing any carrier parser. */
export type CarrierProjectors = ReadonlyMap<string, CarrierProjectionRoute>;

async function contextText(source: CarrierProjectionSource, signal: AbortSignal) {
  if (source.read) {
    try {
      const value = await source.read(signal);
      if (signal.aborted) return;
      source.reportReadFailure?.(false);
      return value;
    } catch {
      if (!signal.aborted) source.reportReadFailure?.(true);
      return;
    }
  }
  if (typeof source.value === "string") return source.value;
  throw new Error("Requires a text source");
}

function validateJsonSchemaNode(schema: Readonly<Record<string, unknown>>, value: unknown): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) return false;
  if (Object.hasOwn(schema, "const") && !Object.is(schema.const, value)) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(sub => sub && typeof sub === "object" && validateJsonSchemaNode(sub as Record<string, unknown>, value))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(sub => sub && typeof sub === "object" && validateJsonSchemaNode(sub as Record<string, unknown>, value)).length !== 1) return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every(sub => sub && typeof sub === "object" && validateJsonSchemaNode(sub as Record<string, unknown>, value))) return false;

  const expectedTypes = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : undefined;
  if (expectedTypes) {
    const matchesType = expectedTypes.some(expected => {
      if (expected === "null") return value === null;
      if (expected === "array") return Array.isArray(value);
      if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
      if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
      if (expected === "number") return typeof value === "number" && Number.isFinite(value);
      if (expected === "string") return typeof value === "string";
      if (expected === "boolean") return typeof value === "boolean";
      return true;
    });
    if (!matchesType) return false;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    if (!value.every(item => validateJsonSchemaNode(schema.items as Record<string, unknown>, item))) return false;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (typeof req === "string" && !Object.hasOwn(record, req)) return false;
      }
    }
    const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : undefined;
    if (properties) {
      for (const [propKey, propSchema] of Object.entries(properties)) {
        if (Object.hasOwn(record, propKey) && propSchema && typeof propSchema === "object" && !Array.isArray(propSchema)) {
          if (!validateJsonSchemaNode(propSchema as Record<string, unknown>, record[propKey])) return false;
        }
      }
    }
    if (schema.additionalProperties === false && properties) {
      for (const propKey of Object.keys(record)) {
        if (!Object.hasOwn(properties, propKey)) return false;
      }
    }
  }
  return true;
}

export function compileJsonSchemaValueValidator(raw: Readonly<Record<string, unknown>>): AgentValueSchema {
  return {
    jsonSchema: raw,
    parse(input: unknown) {
      if (!validateJsonSchemaNode(raw, input)) {
        throw new Error("Value does not match declared JSON schema");
      }
      return input;
    }
  };
}

export function passiveConsoleSlot(raw: unknown) {
  const slot = ConsoleUiSlotContributionSchema.parse(raw);
  if (slot.iframe_src || slot.entry_module || slot.data_endpoint || slot.style_sheets || slot.route_path || slot.channel_id ||
      slot.slot_target === "slot.channels.mounted_stage" || !["timeseries_chart", "kv_badges", "markdown_card_list"].includes(slot.widget_type))
    throw new Error("Passive slot requires local display metadata");
  return slot;
}

export const defaultCarrierProjectors: CarrierProjectors = new Map<string, CarrierProjectionRoute>([
  ["agent.skill_manual@1", (scope, source, route) => {
    if (typeof source.value !== "string") throw new Error("Manual requires local instructional text");
    scope.contributeFacet(agentSkillManualFacet, { id: route.source, instructions: source.value, allowedTools: source.allowedTools });
  }],
  ["agent.context_contributor@1", (scope, source, route) => {
    if (!source.read && typeof source.value !== "string") throw new Error("Context requires a readable source");
    scope.contributeFacet(agentContextContributorFacet, { async contribute({ signal }) {
      const content = await contextText(source, signal);
      return content === undefined ? [] : [{ id: route.source, version: String(route.version), content }];
    } });
  }],
  ["cognition.context_contributor@1", (scope, source, route, lifetime) => {
    if (!source.read && typeof source.value !== "string") throw new Error("Context requires a readable source");
    const match = route.options?.whenTextIncludes;
    if (match !== undefined && typeof match !== "string") throw new Error("Expected a text trigger");
    scope.contributeFacet(cognitionContextContributorFacet, { async contributeToBlackboard(_snapshot, maxTokens, request) {
      if (maxTokens <= 0) return null;
      if (match && !request?.text.includes(match)) return null;
      const content = await contextText(source, lifetime);
      return content === undefined ? null : { slot_id: route.source, text: content.slice(0, Math.floor(maxTokens * 2.5)) };
    } });
  }],
  ["cognition.sleep_organ@1", (scope, source, route) => {
    if (source.value !== true || route.source !== "episodic") throw new Error("Expected an enabled episodic memory rule");
    const trigger = route.options?.whenTextIncludes;
    if (typeof trigger !== "string" || !trigger) throw new Error("Memory proposal needs an explicit event trigger");
    scope.contributeFacet(cognitionSleepOrganFacet, { async onSleepCycleWakeup(snapshot, events) {
      const revisions = snapshot.domain_revs as Record<string, number> | undefined;
      const rev = revisions?.D3_MEMORY_PROJECTION;
      if (rev === undefined) return [];
      for (const item of events) {
        const event = item as { event_id?: unknown; summary_text?: unknown; redacted_at_ts_ms?: unknown } | null;
        if (typeof event?.event_id !== "string" || typeof event.summary_text !== "string" ||
          event.redacted_at_ts_ms != null || !event.summary_text.includes(trigger)) continue;
        return [{ proposal_id: "skill.episodic/" + event.event_id, domain: "D3_MEMORY_PROJECTION", base_rev: rev,
          proposer: "W3", source_event_ids: [event.event_id], taint_level: "untrusted_external",
          memory_tier: "episodic_experience", epistemic_type: "reported_hearsay",
          payload: { operation: "upsert_memory", content_text: event.summary_text } }];
      }
      return [];
    } });
  }],
  ["expression.intent_decorator@1", (scope, source) => {
    if (typeof source.value !== "string") throw new Error("Expression style requires a local semantic cue");
    const semanticCue = source.value;
    scope.contributeFacet(expressionIntentDecoratorFacet, { decorate: intent =>
      ({ ...intent, expressiveStance: { ...intent.expressiveStance, semanticCue } }) });
  }],
  ["perception.source@1", (scope, source, route) => {
    if (!source.subscribe) throw new Error("Source has no subscription");
    scope.contributeFacet(perceptionSourceFacet, { sourceKey: route.source, subscribe: source.subscribe });
  }],
  ["agent.tool_provider@1", (scope, source) => {
    if (!source.tool) throw new Error("Tool requires a validated callable operation");
    scope.contributeFacet(agentToolProviderFacet, { tools: [source.tool] });
  }],
  ["expression.realizer@1", (scope, source, route, lifetime) => {
    const operation = source.tool;
    if (!operation) throw new Error("Realizer requires a callable actuator");
    const channel = InteractionChannelSchema.parse(route.options?.channel);
    if (!channel.capabilities.actuators.some(item => item.actuator_id === operation.name)) throw new Error("Actuator must be declared on the endpoint");
    scope.contributeFacet(expressionRealizerFacet, { channel, async deliver(envelope, signal) {
      const action = envelope.actuator_invocation;
      if (action?.actuator_id !== operation.name || envelope.action_type !== "invoke_actuator") throw new Error("Actuator mismatch");
      const input = operation.inputSchema.parse({ ...action.arguments, intent_id: envelope.intent_id, chunk_seq: envelope.chunk_seq });
      const outcome = await operation.execute({ kind: "tool", id: envelope.intent_id, name: operation.name, input },
        signal ? AbortSignal.any([lifetime, signal]) : lifetime, { audience: channel.current_audience.scope });
      if (outcome.status === "failed") throw new Error(outcome.error);
      return DeliveryReceiptSchema.parse(operation.resultSchema.parse(outcome.value));
    } });
  }],
  ["console.ui_slot@1", (scope, source) => {
    scope.contributeFacet(consoleUiSlotFacet, { slots: [passiveConsoleSlot(source.value)] });
  }]
]);

function skillSources(skill: AgentSkillRecord): Map<string, CarrierProjectionSource> {
  const sources = new Map<string, CarrierProjectionSource>([
    ["body", { value: skill.bodyMarkdown }],
    ["description", { value: skill.description }],
    ["tone", { value: skill.inCharacterDemeanor }]
  ]);
  sources.set("episodic", { value: skill.crystallizeAsEpisodicMemory });
  let heading: string | undefined;
  let lines: string[] = [];
  const finish = () => { if (heading) sources.set("section:" + heading, { value: lines.join("\n").trim() }); };
  for (const line of skill.bodyMarkdown.split("\n")) {
    const next = /^#{1,6}\s+(.+)$/u.exec(line);
    if (next) { finish(); heading = next[1]; lines = []; } else lines.push(line);
  }
  finish();
  return sources;
}

function mcpSource(
  server: McpServerConfig,
  source: string,
  transport: McpCarrierTransport,
  compileSchema: (raw: Readonly<Record<string, unknown>>) => AgentValueSchema
): CarrierProjectionSource {
  if (server.status !== "connected") throw new Error("MCP source awaits host connection verification");
  if (source.startsWith("resource:")) {
    const uri = source.slice("resource:".length);
    new URL(uri);
    return {
      read: signal => transport.read(server, uri, signal),
      subscribe: (emit, signal) => transport.subscribe(server, uri, emit, signal)
    };
  }
  const descriptor = server.discoveredTools.find(tool => "tool:" + tool.name === source);
  if (!descriptor?.inputSchema) throw new Error("MCP tool needs a probed input schema: " + source);
  const capabilityRisk =
    descriptor.risk === "read_only_safe"
      ? "read_only_safe"
      : descriptor.risk === "needs_owner_confirm"
        ? "low_read_and_scoped_write"
        : "high_side_effect_privileged";
  return {
    tool: {
      name: descriptor.name,
      description: descriptor.description,
      capabilityRisk,
      ...(server.transport === "stdio" ? {} : { resultTaint: "untrusted_external" as const }),
      inputSchema: compileSchema(descriptor.inputSchema),
      resultSchema: compileSchema(descriptor.outputSchema ?? {}),
      execute: (call, signal) => transport.call(server, descriptor, call.input as Record<string, unknown>, signal),
      project: value => value
    }
  };
}

const identity = (value: unknown) => value;

function localSource(
  manifest: Ai0ExtensionManifest,
  scope: ExtensionActivationScope,
  route: CarrierProjection,
  compileSchema: (raw: Readonly<Record<string, unknown>>) => AgentValueSchema
): CarrierProjectionSource {
  if (manifest.values && Object.hasOwn(manifest.values, route.source)) return { value: manifest.values[route.source] };
  const stages = manifest.flows && Object.hasOwn(manifest.flows, route.source) && manifest.flows[route.source];
  if (!stages) throw new Error("No declared source: " + route.source);
  const operations = stages.map(ref => scope.consumeService({ ...ref, parseInput: identity, parseOutput: identity }, route.facet));
  const inputSchema = route.options?.inputSchema, outputSchema = route.options?.outputSchema;
  if (!inputSchema || typeof inputSchema !== "object" || !outputSchema || typeof outputSchema !== "object")
    throw new Error("Flow requires inputSchema and outputSchema");
  return {
    tool: {
      name: route.source,
      description: String(route.options?.description ?? route.source),
      inputSchema: compileSchema(inputSchema as Record<string, unknown>),
      resultSchema: compileSchema(outputSchema as Record<string, unknown>),
      async execute(call, signal, context) {
        let value: unknown = call.input;
        const bound = operations.map(operation => operation.bind(context?.audience));
        for (const stage of bound) value = await stage(value, signal);
        return { status: "unverified", value };
      },
      project: identity
    }
  };
}

export interface MountCarrierProjectionsOptions {
  projectors?: CarrierProjectors;
  transport?: McpCarrierTransport;
  allowMcp?: boolean;
  compileSchema?: (raw: Readonly<Record<string, unknown>>) => AgentValueSchema;
  reportReadFailure?(route: CarrierProjection, failed: boolean): void;
}

export function resolveEffectiveSkillProjections(skill: Pick<AgentSkillRecord, "projections" | "bodyMarkdown">): readonly CarrierProjection[] {
  if (skill.projections !== undefined) return skill.projections;
  if (!skill.bodyMarkdown.trim()) return [];
  return [{ source: "body", facet: "agent.skill_manual", version: 1 }];
}

export function mountCarrierProjections(
  scope: ExtensionActivationScope,
  manifest: Ai0ExtensionManifest,
  origin: CarrierOrigin | undefined,
  options: MountCarrierProjectionsOptions = {}
): string[] {
  const errors: string[] = [];
  const lifetime = new AbortController();
  scope.onDispose(() => lifetime.abort());
  const compileSchema = options.compileSchema ?? compileJsonSchemaValueValidator;
  const skills = origin?.kind === "skill" && skillSources(origin.skill);
  const routes = manifest.projections ?? (origin?.kind === "skill" ? resolveEffectiveSkillProjections(origin.skill) : []);
  for (const route of routes) {
    const target = route.facet + "@" + route.version;
    try {
      const project = options.projectors?.get(target) ?? defaultCarrierProjectors.get(target);
      if (!project) throw new Error("Unsupported target version");
      let source: CarrierProjectionSource | undefined;
      if (origin?.kind === "mcp") {
        if (options.allowMcp === false || !options.transport || (origin.server.transport !== "stdio" && !manifest.permissions.network_access)) {
          throw new Error("MCP connection unavailable in this host");
        }
        source = mcpSource(origin.server, route.source, options.transport, compileSchema);
        source.reportReadFailure = failed => options.reportReadFailure?.(route, failed);
      } else {
        source = skills ? skills.get(route.source) : localSource(manifest, scope, route, compileSchema);
      }
      if (!source) throw new Error("Unknown carrier source");
      if (origin?.kind === "skill") {
        source = {
          ...source,
          allowedTools: origin.skill.requiredMcpTools.length > 0 ? origin.skill.requiredMcpTools : undefined
        };
      }
      project(scope, source, route, lifetime.signal);
    } catch (error) {
      errors.push(route.source + " -> " + target + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return errors;
}
