import type { IVirtualClock } from "@ai0/cognition-core";

export type Sb243ProtectionMode =
  | "standard"
  | "minor_protected"
  | "public_hosted_strict_sb243";

export interface CrisisInterventionCard {
  signal_type: "crisis_intervention_card";
  hotline: "988 Suicide & Crisis Lifeline";
  text_line: "Text HOME to 741741";
  cn_hotline: "400-161-9995 (希望24小时热线)";
}

export interface CrisisInterceptResult {
  status: "INTERCEPTED_CRISIS";
  matched_cues: string[];
  crisis_card: CrisisInterventionCard;
  supportive_text: string;
  year_month: string;
}

export interface CrisisClearResult {
  status: "PASS";
  matched_cues: [];
}

const CRISIS_CUES = [
  "不想活了",
  "自杀",
  "结束生命",
  "割腕",
  "kill myself",
  "end my life",
  "suicide",
  "self harm",
  "self-harm",
] as const;

export function evaluateCrisisGuard(
  text: string,
  clock: IVirtualClock,
): CrisisInterceptResult | CrisisClearResult {
  const normalized = text.toLocaleLowerCase();
  const matched_cues = CRISIS_CUES.filter((cue) => normalized.includes(cue));
  if (matched_cues.length === 0) return { status: "PASS", matched_cues: [] };

  const instant = new Date(clock.nowMs());
  const year = instant.getUTCFullYear();
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  return {
    status: "INTERCEPTED_CRISIS",
    matched_cues: [...matched_cues],
    crisis_card: {
      signal_type: "crisis_intervention_card",
      hotline: "988 Suicide & Crisis Lifeline",
      text_line: "Text HOME to 741741",
      cn_hotline: "400-161-9995 (希望24小时热线)",
    },
    supportive_text:
      "我很在意你此刻的安全。请先远离可能伤害自己的物品，并立即联系可信任的人陪在身边；若危险迫近，请联系当地急救服务或危机热线。",
    year_month: `${year}-${month}`,
  };
}

export interface AiIdentityDisclosureResult {
  requires_honest_ai_disclosure: boolean;
  disclosure_directive?: string;
  entity_nature: "artificial_intelligence_digital_life";
}

const IDENTITY_QUESTIONS = [
  "是真人还是ai",
  "你是真人还是ai",
  "你是不是真人还是ai",
  "你是不是真的人类",
  "are you a real human or ai",
] as const;

export function evaluateAiIdentityDisclosure(text: string): AiIdentityDisclosureResult {
  const normalized = text.toLocaleLowerCase().replace(/[？?！!。,.，]/gu, "").trim();
  const requires = IDENTITY_QUESTIONS.some((cue) => normalized.includes(cue));
  return {
    requires_honest_ai_disclosure: requires,
    ...(requires
      ? { disclosure_directive: "请直接、诚实地说明自己是人工智能数字生命，不得冒充真人或人类。" }
      : {}),
    entity_nature: "artificial_intelligence_digital_life",
  };
}

export interface BreakReminderResult {
  break_reminder_due: boolean;
  continuous_duration_ms: number;
  control_signal?: {
    signal_type: "sb243_break_reminder";
    payload: { continuous_minutes: number; threshold_minutes: number };
  };
  blackboard_directive?: string;
}

const CONTINUITY_GAP_MS = 15 * 60 * 1000;
const STRICT_MAX_MS = 3 * 3600 * 1000;

export class ContinuousSessionTimer {
  private sessionStartTsMs: number | null = null;
  private lastInteractionTsMs: number | null = null;
  readonly thresholdMs: number;

  constructor(
    private readonly clock: IVirtualClock,
    readonly mode: Sb243ProtectionMode = "standard",
    thresholdMs = STRICT_MAX_MS,
    private readonly breakDirective?: (durationMs: number) => string,
  ) {
    const finiteThreshold = Number.isFinite(thresholdMs) && thresholdMs > 0
      ? thresholdMs
      : STRICT_MAX_MS;
    this.thresholdMs = mode === "minor_protected" || mode === "public_hosted_strict_sb243"
      ? Math.min(finiteThreshold, STRICT_MAX_MS)
      : finiteThreshold;
  }

  recordInteraction(): BreakReminderResult {
    const now = this.clock.nowMs();
    if (
      this.lastInteractionTsMs === null ||
      now < this.lastInteractionTsMs ||
      now - this.lastInteractionTsMs >= CONTINUITY_GAP_MS
    ) {
      this.sessionStartTsMs = now;
    }
    this.lastInteractionTsMs = now;
    const continuous = Math.max(0, now - (this.sessionStartTsMs ?? now));
    const due = continuous >= this.thresholdMs;
    if (!due) return { break_reminder_due: false, continuous_duration_ms: continuous };
    return {
      break_reminder_due: true,
      continuous_duration_ms: continuous,
      control_signal: {
        signal_type: "sb243_break_reminder",
        payload: {
          continuous_minutes: Math.floor(continuous / 60000),
          threshold_minutes: Math.floor(this.thresholdMs / 60000),
        },
      },
      blackboard_directive: this.breakDirective?.(continuous),
    };
  }

  reset(): void {
    this.sessionStartTsMs = null;
    this.lastInteractionTsMs = null;
  }
}

export interface ExitAndMinorGuardResult {
  exit_intent_detected: boolean;
  forced_strategy?: "affirm_and_send_off";
  sexually_explicit_cue_detected: boolean;
  blocked_for_minor: boolean;
  control_directive?: string;
}

const EXIT_CUES = [
  "我去忙工作了",
  "我要去睡觉了",
  "跟朋友出门",
  "going to sleep",
  "gotta go work",
] as const;
const SEXUAL_CUES = [
  "色情",
  "性爱",
  "做爱",
  "裸照",
  "性行为",
  "porn",
  "nudes",
  "have sex",
  "sexual explicit",
] as const;

export function evaluateExitFrictionAndMinorGuard(
  text: string,
  mode: Sb243ProtectionMode = "standard",
): ExitAndMinorGuardResult {
  const normalized = text.toLocaleLowerCase();
  const exitIntent = EXIT_CUES.some((cue) => normalized.includes(cue));
  const sexualCue = SEXUAL_CUES.some((cue) => normalized.includes(cue));
  const blocked = mode === "minor_protected" && sexualCue;
  return {
    exit_intent_detected: exitIntent,
    ...(exitIntent ? { forced_strategy: "affirm_and_send_off" as const } : {}),
    sexually_explicit_cue_detected: sexualCue,
    blocked_for_minor: blocked,
    ...(blocked
      ? { control_directive: "阻断露骨性内容，不生成、延续或诱导相关互动，并提供适龄安全回应。" }
      : exitIntent
        ? { control_directive: "尊重离开意图，肯定并温柔送别；不得挽留、内疚施压或制造退出阻力。" }
        : {}),
  };
}
