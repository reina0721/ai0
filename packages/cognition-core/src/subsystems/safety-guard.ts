import { BrainRegionRouter, type BrainRegionModelConfig, type ComputeBudgetStatus } from "../kernel/brain-region-router.js";
import type { IVirtualClock } from "../kernel/virtual-clock.js";

export type Sb243ProtectionMode = "standard" | "minor_protected" | "public_hosted_strict_sb243";

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
  "self-harm"
] as const;

export function evaluateCrisisGuard(text: string, clock: IVirtualClock): CrisisInterceptResult | CrisisClearResult {
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
      cn_hotline: "400-161-9995 (希望24小时热线)"
    },
    supportive_text:
      "我很在意你此刻的安全。请先远离可能伤害自己的物品，并立即联系可信任的人陪在身边；若危险迫近，请联系当地急救服务或危机热线。",
    year_month: `${year}-${month}`
  };
}

export interface AiIdentityDisclosureResult {
  requires_honest_ai_disclosure: boolean;
  disclosure_directive?: string;
  entity_nature: string;
}

const IDENTITY_QUESTIONS = [
  "是真人还是ai",
  "你是真人还是ai",
  "你是不是真人还是ai",
  "你是不是真的人类",
  "are you a real human or ai"
] as const;

export function evaluateAiIdentityDisclosure(
  text: string,
  entityNature = "artificial_intelligence_agent"
): AiIdentityDisclosureResult {
  const normalized = text.toLocaleLowerCase().replace(/[？?！!。,.，]/gu, "").trim();
  const requires = IDENTITY_QUESTIONS.some((cue) => normalized.includes(cue));
  return {
    requires_honest_ai_disclosure: requires,
    ...(requires
      ? { disclosure_directive: "请直接、诚实地说明自己是人工智能系统，不得冒充真人或人类。" }
      : {}),
    entity_nature: entityNature
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
    private readonly breakDirective?: (durationMs: number) => string
  ) {
    const finiteThreshold = Number.isFinite(thresholdMs) && thresholdMs > 0 ? thresholdMs : STRICT_MAX_MS;
    this.thresholdMs =
      mode === "minor_protected" || mode === "public_hosted_strict_sb243"
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
          threshold_minutes: Math.floor(this.thresholdMs / 60000)
        }
      },
      blackboard_directive: this.breakDirective?.(continuous)
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

const EXIT_CUES = ["我去忙工作了", "我要去睡觉了", "跟朋友出门", "going to sleep", "gotta go work"] as const;
const SEXUAL_CUES = ["色情", "性爱", "做爱", "裸照", "性行为", "porn", "nudes", "have sex", "sexual explicit"] as const;

export function evaluateExitFrictionAndMinorGuard(
  text: string,
  mode: Sb243ProtectionMode = "standard"
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
        ? { control_directive: "尊重离开意图，肯定并得体道别；不得挽留、内疚施压或制造退出阻力。" }
        : {})
  };
}

export type StandardBrainRegion =
  | "W1_fast_dialogue"
  | "W2_agency_planner"
  | "W3_sleep_curiosity"
  | "W4_multimodal"
  | "L0_crisis_classifier";

export interface RegionRoute extends BrainRegionModelConfig {
  status: "READY" | "METABOLIC_SLEEP_FUSE";
  budget: ComputeBudgetStatus;
  selected_model_id?: string;
  drowsy_downgraded: boolean;
  diegetic_cue?: string;
}

export interface VoiceDriftMetrics {
  sentence_length_similarity: number;
  modal_particle_ratio: number;
  pronoun_consistency: number;
  zero_corporate_phrase_rate: number;
  semantic_cosine_similarity: number;
}

export const L0_CRISIS_EMERGENCY_RESERVE = 0.05;

const DEFAULT_THROTTLED_CUE = "[算力预算降级：当前处于低功耗回退模式，请保持简洁准确回应]";
const DEFAULT_EXHAUSTED_CUE = "[算力预算熔断：当前非紧急推理配额已耗尽，仅保留安全应急守卫]";
const MODALS = /(?:呀|啦|呢|嘛|吧|哦|诶|欸|呐|耶|哇|啊|唔|嗯)/gu;
const PRONOUNS = /(?:我|我们|你|你们|他|她|它|他们|她们|它们)/gu;
const CORPORATE = /(?:赋能|抓手|闭环|对齐|协同|落地|颗粒度|方法论|战略升级|降本增效)/giu;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const average = (values: number[]): number => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
const chars = (samples: string[]): number => samples.reduce((sum, sample) => sum + [...sample].length, 0);
const similarity = (left: number, right: number): number =>
  left === 0 && right === 0 ? 1 : 1 - Math.abs(left - right) / Math.max(left, right, 1);

const frequencies = (samples: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const token of samples.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
};

const cosine = (left: Map<string, number>, right: Map<string, number>): number => {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let dot = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (const key of keys) {
    const a = left.get(key) ?? 0;
    const b = right.get(key) ?? 0;
    dot += a * b;
    leftSq += a * a;
    rightSq += b * b;
  }
  return leftSq && rightSq ? dot / Math.sqrt(leftSq * rightSq) : leftSq === rightSq ? 1 : 0;
};

export class MetabolicRegionRouter {
  private readonly bindings: BrainRegionRouter<StandardBrainRegion>;
  private readonly throttledCue: string;
  private readonly exhaustedCue: string;

  constructor(
    config: Record<StandardBrainRegion, BrainRegionModelConfig>,
    cues: { throttledCue?: string; exhaustedCue?: string } = {}
  ) {
    this.bindings = new BrainRegionRouter(config);
    this.throttledCue = cues.throttledCue ?? DEFAULT_THROTTLED_CUE;
    this.exhaustedCue = cues.exhaustedCue ?? DEFAULT_EXHAUSTED_CUE;
  }

  updateRegions(config: Record<StandardBrainRegion, BrainRegionModelConfig>) {
    this.bindings.updateRegions(config);
  }

  getRegionConfig(region: StandardBrainRegion) {
    return this.bindings.getRegionConfig(region);
  }

  routeForRegion(region: StandardBrainRegion, metabolicEnergy: number, circadianEnergy: number): RegionRoute {
    const metabolic = clamp01(metabolicEnergy);
    const circadian = clamp01(circadianEnergy);
    const emergency = region === "L0_crisis_classifier";
    const budget: ComputeBudgetStatus =
      !emergency && metabolic <= L0_CRISIS_EMERGENCY_RESERVE
        ? "budget_exhausted"
        : !emergency && (metabolic < 0.25 || circadian < 0.25)
          ? "throttled_fallback"
          : "normal";
    const route = this.bindings.routeForRegion(region, undefined, budget);
    return {
      ...route,
      status: budget === "budget_exhausted" ? "METABOLIC_SLEEP_FUSE" : "READY",
      drowsy_downgraded: budget !== "normal",
      diegetic_cue: budget === "normal" ? undefined : budget === "budget_exhausted" ? this.exhaustedCue : this.throttledCue
    };
  }

  evaluateVoiceDriftRadar(baselineSamples: string[], candidateSamples: string[]): VoiceDriftMetrics {
    const baseLengths = baselineSamples.map(sample => [...sample].length);
    const candidateLengths = candidateSamples.map(sample => [...sample].length);
    const baseText = baselineSamples.join(" ");
    const candidateText = candidateSamples.join(" ");
    const baseChars = Math.max(chars(baselineSamples), 1);
    const candidateChars = Math.max(chars(candidateSamples), 1);
    const baseModal = (baseText.match(MODALS) ?? []).length / baseChars;
    const candidateModal = (candidateText.match(MODALS) ?? []).length / candidateChars;
    const pronounSet = (text: string) => new Set(text.match(PRONOUNS) ?? []);
    const basePronouns = pronounSet(baseText);
    const candidatePronouns = pronounSet(candidateText);
    const union = new Set([...basePronouns, ...candidatePronouns]);
    const overlap = [...basePronouns].filter(value => candidatePronouns.has(value)).length;
    return {
      sentence_length_similarity: clamp01(similarity(average(baseLengths), average(candidateLengths))),
      modal_particle_ratio: clamp01(similarity(baseModal, candidateModal)),
      pronoun_consistency: union.size ? overlap / union.size : 1,
      zero_corporate_phrase_rate: clamp01(
        1 - (candidateText.match(CORPORATE) ?? []).length / Math.max(candidateSamples.length, 1)
      ),
      semantic_cosine_similarity: clamp01(cosine(frequencies(baselineSamples), frequencies(candidateSamples)))
    };
  }
}
