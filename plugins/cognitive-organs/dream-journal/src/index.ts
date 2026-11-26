import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

import { cognitionContextContributorFacet, cognitionSleepOrganFacet, consoleSurfaceFacet, consoleUiSlotFacet, defineExtensionPackage } from "@ai0/sdk";

type JsonMap = Record<string, unknown>;

const readPath = (value: unknown, ...path: string[]): unknown => {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as JsonMap)[key];
  }
  return cursor;
};

const words = (value: unknown, limit = 96): string => {
  const text = typeof value === "string" ? value : "";
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
};

const poeticLine = (seed: string): string => {
  const subject = seed || "今天未说完的心事";
  return `梦把「${subject}」折成一只纸船，停在记忆发亮的水面上。`;
};

const memoryProposal = (
  kind: "turn_afterglow" | "sleep_dream",
  sourceId: string,
  text: string,
): JsonMap => ({
  domain: "D3_MEMORY_PROJECTION",
  mutation_type: "append",
  source_extension_id: "community.organ.dream-journal",
  idempotency_key: `dream-journal:${kind}:${sourceId}`,
  payload: {
    memory_kind: "episodic_experience",
    content_text: text,
    tags: ["dream_journal", "poetic_reflection", kind],
    generation_depth: 1,
    confidence: 0.72,
  },
});

const hooks = {
  contributeToBlackboard(snapshot: unknown, maxTokens: number) {
    if (maxTokens < 12) return null;
    const latest = words(
      readPath(snapshot, "D3_MEMORY_PROJECTION", "latest_dream_journal"),
      Math.min(160, maxTokens * 3),
    );
    return {
      slot_id: "slot.memory.custom_tab",
      text: latest
        ? `梦境手记：${latest}`
        : "梦境手记：昨夜的梦还没有落笔，先留一页安静的月光。",
    };
  },

  onTurnCompleted(turnTrace: unknown) {
    const eventId = words(
      readPath(turnTrace, "event_id") ?? readPath(turnTrace, "trace_id"),
      80,
    ) || "anonymous-turn";
    const utterance = words(
      readPath(turnTrace, "steps", "step1_perception", "summary_text")
        ?? readPath(turnTrace, "steps", "step7_expression", "fallback_text"),
    );
    return [memoryProposal("turn_afterglow", eventId, poeticLine(utterance))];
  },

  onSleepCycleWakeup(_snapshot: unknown, rawDirtyEvents: ReadonlyArray<unknown>) {
    if (rawDirtyEvents.length === 0) return [];
    const fragments = rawDirtyEvents
      .slice(0, 4)
      .map((event) => words(
        readPath(event, "summary_text")
          ?? readPath(event, "content_text")
          ?? readPath(event, "text"),
        42,
      ))
      .filter(Boolean);
    const sourceId = words(
      readPath(rawDirtyEvents[0], "event_id")
        ?? readPath(rawDirtyEvents[0], "id"),
      80,
    ) || `batch-${rawDirtyEvents.length}`;
    const scene = fragments.join("、") || `${rawDirtyEvents.length}枚沉默的记忆碎片`;
    return [memoryProposal(
      "sleep_dream",
      sourceId,
      `睡眠把${scene}轻轻缝在一起；醒来时，它们像窗边将融未融的霜。`,
    )];
  },
};

export const dreamJournal = defineExtensionPackage({
  manifest,
  activate(scope, config) {
    if (config.inject_blackboard_slot !== false) scope.contributeFacet(cognitionContextContributorFacet, hooks);
    scope.contributeFacet(cognitionSleepOrganFacet, hooks);
    scope.contributeFacet(consoleSurfaceFacet, { pages: manifest.console_contributions?.pages ?? [] });
    scope.contributeFacet(consoleUiSlotFacet, { slots: manifest.console_contributions?.ui_slots ?? [] });
  }
});

export default dreamJournal;
