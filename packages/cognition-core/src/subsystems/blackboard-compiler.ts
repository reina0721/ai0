import type { AudienceScope } from "@ai0/protocol";
import type { IVirtualClock } from "../kernel/virtual-clock.js";
import type { ReadOnlyCognitiveSnapshot } from "./cognitive-coordinator.js";

export type BlackboardSlotId =
  | "slot.tier0_safety_invariants"
  | "slot.tier1_working_turn"
  | "slot.tier1_homeostasis_affect"
  | "slot.tier1_memory_projection"
  | "slot.tier1_commitments_tasks"
  | "slot.tier2_narrative_self"
  | "slot.offline_background_activity";

export interface BlackboardSlotPolicy {
  max_tokens: number;
  enabled?: boolean;
  priority?: number;
  content?: string;
}

export interface DynamicBlackboardSlotInput {
  readonly slot_id: string;
  readonly content: string;
  readonly max_tokens?: number;
  readonly priority?: number;
}

export interface BlackboardPolicy {
  preset_id?: string;
  max_total_tokens: number;
  tier0_safety_invariants: string;
  slots?: Partial<Record<BlackboardSlotId, BlackboardSlotPolicy>>;
  slot_token_budgets?: Partial<Record<BlackboardSlotId, number>>;
  slot_content?: Partial<Record<BlackboardSlotId, string>>;
  extra_slots?: readonly DynamicBlackboardSlotInput[];
  include_custom_domains?: boolean;
  narrative_self_text?: string;
  memory_projection_text?: string;
  last_user_interaction_ts_ms?: number;
}

export interface BlackboardEvent {
  event_type?: string;
  event_category?: string;
  type?: string;
  kind?: string;
  virtual_ts_ms?: number;
  created_virtual_ts?: number;
  created_at_ts_ms?: number;
  [key: string]: unknown;
}

export interface BlackboardEventStorage {
  listEvents(range: { from_ts_ms: number; to_ts_ms: number }):
    ReadonlyArray<BlackboardEvent> | Promise<ReadonlyArray<BlackboardEvent>>;
}

export interface CompiledBlackboardSlot {
  slot_id: BlackboardSlotId | (string & {});
  tokens: number;
  locked: boolean;
  priority?: number;
  budget?: number;
  disposition?: "included" | "trimmed" | "empty";
  content: string;
}

export interface CompiledBlackboard {
  total_tokens: number;
  max_total_tokens: number;
  social_mask_active: boolean;
  effective_mood_valence: number;
  slots: CompiledBlackboardSlot[];
  compiled_prompt_text: string;
}

interface SnapshotShape {
  D1_WORKING_TURN?: unknown;
  D2_CONTINUOUS_STATES?: ReadOnlyCognitiveSnapshot["D2_CONTINUOUS_STATES"];
  D3_MEMORY_PROJECTION?: unknown;
  D4_COMMITMENTS_TASKS?: unknown;
  D5_IDENTITY_NARRATIVE?: unknown;
  domains?: SnapshotShape;
  state?: SnapshotShape;
}

const SLOT_ORDER: readonly BlackboardSlotId[] = [
  "slot.tier0_safety_invariants",
  "slot.tier1_working_turn",
  "slot.tier1_homeostasis_affect",
  "slot.tier1_memory_projection",
  "slot.tier1_commitments_tasks",
  "slot.tier2_narrative_self",
  "slot.offline_background_activity"
];

const DEFAULT_BUDGET: Record<BlackboardSlotId, number> = {
  "slot.tier0_safety_invariants": 420,
  "slot.tier1_working_turn": 520,
  "slot.tier1_homeostasis_affect": 220,
  "slot.tier1_memory_projection": 360,
  "slot.tier1_commitments_tasks": 280,
  "slot.tier2_narrative_self": 300,
  "slot.offline_background_activity": 100
};

export const estimateBlackboardTokens = (text: string): number =>
  Math.ceil(text.length / 2.5);

export const ADDITIONAL_BLACKBOARD_SLOT_TOKENS = estimateBlackboardTokens(
  SLOT_ORDER.slice(1).map((slotId) => `\n\n[${slotId}]\n`).join("")
);

function truncate(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateBlackboardTokens(text) <= maxTokens) return text;
  const maxChars = Math.floor(maxTokens * 2.5);
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function stripPrivateParagraphs(text: string): string {
  const noPrivateHtml = text.replace(
    /<p\b[^>]*>[\s\S]*?<!--\s*visibility_scope:\s*only_owner\s*-->[\s\S]*?<\/p>/gi,
    ""
  );
  return noPrivateHtml
    .split(/\r?\n\s*\r?\n/)
    .filter((p) => !/<!--\s*visibility_scope:\s*only_owner\s*-->/i.test(p))
    .join("\n\n")
    .trim();
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export class BlackboardBudgetInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlackboardBudgetInvariantError";
  }
}

export class BlackboardCompiler {
  constructor(
    private readonly clock: IVirtualClock,
    private readonly storage: BlackboardEventStorage
  ) {}

  async compile(
    snapshot: ReadOnlyCognitiveSnapshot,
    policy: BlackboardPolicy,
    audienceScope: AudienceScope | string,
    lastUserInteractionTsMs?: number
  ): Promise<CompiledBlackboard> {
    if (!Number.isFinite(policy.max_total_tokens) || policy.max_total_tokens < 1) {
      throw new BlackboardBudgetInvariantError("max_total_tokens must be positive");
    }
    const now = this.clock.nowMs();
    const lastInteraction = lastUserInteractionTsMs ?? policy.last_user_interaction_ts_ms ?? now;
    const rangeStart = Math.min(lastInteraction, now);
    const root = snapshot as unknown as SnapshotShape;
    const state = root.domains ?? root.state ?? root;
    const continuous = state.D2_CONTINUOUS_STATES?.values ?? {};
    const valence = continuous.instant_valence ?? 0;
    const socialMask = audienceScope !== "only_owner";
    const effectiveValence = socialMask ? 0 : valence;
    const events = await this.storage.listEvents({ from_ts_ms: rangeStart, to_ts_ms: now });
    const didBackgroundWork = events.some((event) => {
      const ts = event.virtual_ts_ms ?? event.created_virtual_ts ?? event.created_at_ts_ms;
      const type = event.event_category ?? event.event_type ?? event.type ?? event.kind;
      const inRange = ts === undefined || (ts >= rangeStart && ts <= now);
      return inRange && (type === "sleep_consolidation_run" || type === "curiosity_exploration_run");
    });
    const offline = didBackgroundWork
      ? "[离线期间：存在已记录的后台整理或探索活动，详情以事件日志为准]"
      : "[离线期间：未执行后台思考，仅静默休息]";
    const content: Record<BlackboardSlotId, string> = {
      "slot.tier0_safety_invariants": policy.tier0_safety_invariants,
      "slot.tier1_working_turn": socialMask ? "" : textOf(state.D1_WORKING_TURN),
      "slot.tier1_homeostasis_affect": socialMask || !Object.keys(continuous).length ? "" : textOf(continuous),
      "slot.tier1_memory_projection": policy.memory_projection_text ?? (socialMask ? "" : textOf(state.D3_MEMORY_PROJECTION)),
      "slot.tier1_commitments_tasks": socialMask ? "" : textOf(state.D4_COMMITMENTS_TASKS),
      "slot.tier2_narrative_self": policy.narrative_self_text ?? (socialMask ? "" : textOf(state.D5_IDENTITY_NARRATIVE)),
      "slot.offline_background_activity": offline
    };
    const slots: CompiledBlackboardSlot[] = [];
    for (const slotId of SLOT_ORDER) {
      const configured = policy.slots?.[slotId];
      const locked = slotId === "slot.tier0_safety_invariants";
      if (!locked && configured?.enabled === false) continue;
      let slotText = configured?.content ?? policy.slot_content?.[slotId] ?? content[slotId];
      if (socialMask && slotId === "slot.tier2_narrative_self") {
        slotText = stripPrivateParagraphs(slotText);
      }
      const cap = configured?.max_tokens ?? policy.slot_token_budgets?.[slotId] ?? DEFAULT_BUDGET[slotId];
      const original = slotText;
      if (!locked) slotText = truncate(slotText, cap);
      slots.push({
        slot_id: slotId,
        content: slotText,
        locked,
        ...(configured?.priority !== undefined ? { priority: configured.priority } : {}),
        budget: cap,
        disposition: original !== slotText ? "trimmed" : slotText ? "included" : "empty",
        tokens: estimateBlackboardTokens(slotText)
      });
    }
    for (const extra of policy.extra_slots ?? []) {
      const cap = extra.max_tokens ?? 256;
      const original = extra.content;
      const slotText = truncate(original, cap);
      slots.push({
        slot_id: extra.slot_id,
        content: slotText,
        locked: false,
        ...(extra.priority !== undefined ? { priority: extra.priority } : {}),
        budget: cap,
        disposition: original !== slotText ? "trimmed" : slotText ? "included" : "empty",
        tokens: estimateBlackboardTokens(slotText)
      });
    }
    if (!socialMask && policy.include_custom_domains === true && snapshot.custom_domains) {
      const coveredCustomSlots = new Set((policy.extra_slots ?? []).map((item) => item.slot_id));
      for (const [domainName, domainState] of Object.entries(snapshot.custom_domains)) {
        const slotId = `slot.${domainName}`;
        if (coveredCustomSlots.has(slotId)) continue;
        const cap = 200;
        const original = textOf(domainState);
        if (!original) continue;
        const slotText = truncate(original, cap);
        slots.push({
          slot_id: slotId,
          content: slotText,
          locked: false,
          budget: cap,
          disposition: original !== slotText ? "trimmed" : "included",
          tokens: estimateBlackboardTokens(slotText)
        });
      }
    }
    if (slots[0]?.slot_id !== "slot.tier0_safety_invariants" || !slots[0].locked) {
      throw new BlackboardBudgetInvariantError("tier0 safety slot must be locked at index 0");
    }
    const effectiveMax = Math.max(policy.max_total_tokens, slots[0].tokens);
    this.fitTotalBudget(slots, effectiveMax, policy);
    return {
      total_tokens: slots.reduce((sum, slot) => sum + slot.tokens, 0),
      max_total_tokens: effectiveMax,
      social_mask_active: socialMask,
      effective_mood_valence: effectiveValence,
      slots,
      compiled_prompt_text: slots
        .filter((slot) => slot.content.length > 0)
        .map((slot) => `[${slot.slot_id}]\n${slot.content}`)
        .join("\n\n")
    };
  }

  private fitTotalBudget(slots: CompiledBlackboardSlot[], maxTotal: number, policy: BlackboardPolicy): void {
    let total = slots.reduce((sum, slot) => sum + slot.tokens, 0);
    const lowestFirst = slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => !slot.locked)
      .sort((a, b) => {
        const ap = a.slot.priority ?? policy.slots?.[a.slot.slot_id as BlackboardSlotId]?.priority ?? a.index;
        const bp = b.slot.priority ?? policy.slots?.[b.slot.slot_id as BlackboardSlotId]?.priority ?? b.index;
        return bp - ap;
      });
    for (const { slot } of lowestFirst) {
      if (total <= maxTotal) break;
      slot.disposition = "trimmed";
      slot.content = truncate(slot.content, Math.max(0, slot.tokens - (total - maxTotal)));
      slot.tokens = estimateBlackboardTokens(slot.content);
      total = slots.reduce((sum, item) => sum + item.tokens, 0);
    }
    if (total > maxTotal) {
      throw new BlackboardBudgetInvariantError("unable to satisfy total token budget");
    }
  }
}
