import { z } from "zod";
import {
  agentToolDefinitionFacet, cognitionContextContributorFacet, defineExtensionPackage, defineServiceContract,
  expressionRealizerFacet, perceptionFilterFacet, type SdkDebounceInputEvent
} from "@ai0/sdk";
import type { InteractionChannel } from "@ai0/protocol";

const cue = z.object({ id: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })
  .refine(item => item.endMs > item.startMs, "Cue must have positive duration");
const pair = z.object({ left: cue, right: cue });
const interval = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() });
const finding = z.object({
  kind: z.enum(["clear", "overlap"]), ids: z.tuple([z.string(), z.string()]), overlapMs: z.number().int().nonnegative(),
  interval: interval.nullable()
});
const audit = defineServiceContract({ owner: "caption", name: "audit", version: 1, parseInput: pair.parse, parseOutput: finding.parse });
export { audit as captionAudit };
const grant = { max_audience_scope: "only_owner" as const, read_blackboard_domains: [], propose_mutation_domains: [], network_access: false };
const author = { author: "caption editor", version: "1", carrier_kind: "native_code_plugin" as const, permissions: grant };

export const captionService = defineExtensionPackage({
  manifest: { ...author, extension_id: audit.owner, display_name: "Caption audit", facets: [],
    services: { defines: [audit], provides: [audit] } },
  activate(scope) {
    scope.defineService(audit);
    scope.provideService(audit, ({ left, right }) => {
      const startMs = Math.max(left.startMs, right.startMs);
      const endMs = Math.min(left.endMs, right.endMs);
      const overlapMs = Math.max(0, endMs - startMs);
      return { kind: overlapMs ? "overlap" : "clear", ids: [left.id, right.id], overlapMs, interval: overlapMs ? { startMs, endMs } : null };
    });
  }
});

const cueSchema = { type: "object", properties: { id: { type: "string" }, startMs: { type: "integer" }, endMs: { type: "integer" } },
  required: ["id", "startMs", "endMs"] };
const intervalSchema = { type: "object", properties: { startMs: {type: "integer"}, endMs: {type: "integer"} }, required: ["startMs", "endMs"] };
const editorChannel: InteractionChannel = { protocol_version: "0.1.0", channel_id: "caption.editor", channel_kind: "custom.editor",
  display_name: "Subtitle timeline", venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 },
  latency_budget_ms: 50, capabilities: { supported_extensions: [], sensors: ["custom.caption"], actuators: [
    { actuator_id: "highlight", description: "Highlight the selected interval", parameters_json_schema: intervalSchema, requires_local_user_consent: false }
  ] } };

/** The editor owns the independent record of explicit human review. Model queries never write it. */
export function captionEditor(ports: {
  reviewed(): { eventId: string; revision: number; accepted: boolean } | undefined;
  highlight(value: z.infer<typeof interval>): void;
}) {
  return defineExtensionPackage({
    manifest: { ...author, extension_id: "caption.editor", display_name: "Caption editor", facets: [
      agentToolDefinitionFacet.id, perceptionFilterFacet.id, cognitionContextContributorFacet.id, expressionRealizerFacet.id
    ], services: { requires: [{ ...audit, facet: agentToolDefinitionFacet.id }, { ...audit, facet: perceptionFilterFacet.id }] } },
    activate(scope, config) {
      if (config.tool !== false) {
        const service = scope.consumeService(audit, agentToolDefinitionFacet.id);
        scope.contributeFacet(agentToolDefinitionFacet, { tools: [{
          name: "caption_overlap", description: "Measure the overlap between two cues",
          inputSchema: { jsonSchema: { type: "object", properties: { left: cueSchema, right: cueSchema }, required: ["left", "right"] }, parse: pair.parse },
          resultSchema: { jsonSchema: { type: "object", properties: { kind: { enum: ["overlap", "clear"] }, overlapMs: { type: "integer" },
            ids: { type: "array", items: { type: "string" } }, interval: { anyOf: [intervalSchema, { type: "null" }] } },
            required: ["kind", "ids", "overlapMs", "interval"] }, parse: finding.parse },
          async execute(call, signal, context) { return { status: "verified", value: await service.bind(context?.audience)(pair.parse(call.input), signal) }; },
          project(value) { return { overlapMs: finding.parse(value).overlapMs }; }
        }] });
      }
      if (config.perception !== false) {
        const service = scope.consumeService(audit, perceptionFilterFacet.id);
        const revisions = new Map<string, number>();
        const ready = new Map<string, SdkDebounceInputEvent>();
        const controller = new AbortController();
        scope.onDispose(() => controller.abort());
        scope.contributeFacet(perceptionFilterFacet, {
          onEvent(event, channelId) {
            const frame = event.frame;
            if (channelId !== editorChannel.channel_id || !frame || frame.channel.modality !== "custom.caption") return { kind: "pass", event };
            const { turnId, revision } = frame.chronology;
            if (revision <= (revisions.get(turnId) ?? -1)) return { kind: "suppress" };
            revisions.set(turnId, revision);
            ready.delete(turnId);
            const input = pair.safeParse(frame.domain_payload);
            if (!input.success || event.lifecycle === "retract") return { kind: "pass", event };
            void service.bind()(input.data, controller.signal).then(result => {
              if (revisions.get(turnId) === revision) ready.set(turnId, { ...event, frame: { ...frame, domain_payload: result } });
            }, () => { /* A revoked or invalid observation supplies no evidence. */ });
            return { kind: "hold" };
          },
          flushDue() { const batch = [...ready.values()]; ready.clear(); return batch; }
        });
      }
      if (config.cognition !== false) {
        scope.contributeFacet(cognitionContextContributorFacet, { contributeToBlackboard() {
          const review = ports.reviewed();
          return review ? { slot_id: "caption.review", text: JSON.stringify(review) } : null;
        } });
      }
      if (config.expression !== false) {
        scope.contributeFacet(expressionRealizerFacet, { channel: editorChannel, deliver(envelope) {
          const action = envelope.actuator_invocation;
          if (envelope.action_type === "invoke_actuator" && action?.actuator_id === "highlight") ports.highlight(interval.parse(action.arguments));
        } });
      }
    }
  });
}
