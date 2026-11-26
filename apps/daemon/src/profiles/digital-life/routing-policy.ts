import { BrainRegionRouter, type BrainRegionModelConfig, type ComputeBudgetStatus } from "@ai0/cognition-core";
export type BrainRegion =
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

const DROWSY_CUE =
  "[认知代谢状态：今天已经高强度动脑思考了很久，现在脑子有点转不动、犯迷糊发困，切换为轻松简短模式]";
const SLEEP_CUE = "今天真的困得睁不开眼啦，我先钻进被窝睡一觉充充电~";
const MODALS = /(?:呀|啦|呢|嘛|吧|哦|诶|欸|呐|耶|哇|啊|唔|嗯)/gu;
const PRONOUNS = /(?:我|我们|你|你们|他|她|它|他们|她们|它们)/gu;
const CORPORATE = /(?:赋能|抓手|闭环|对齐|协同|落地|颗粒度|方法论|战略升级|降本增效)/giu;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const chars = (samples: string[]): number =>
  samples.reduce((sum, sample) => sum + [...sample].length, 0);

const similarity = (left: number, right: number): number =>
  left === 0 && right === 0 ? 1 : 1 - Math.abs(left - right) / Math.max(left, right, 1);

const frequencies = (samples: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const token of samples.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    map.set(token, (map.get(token) ?? 0) + 1);
  return map;
};

const cosine = (left: Map<string, number>, right: Map<string, number>): number => {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let dot = 0, leftSq = 0, rightSq = 0;
  for (const key of keys) {
    const a = left.get(key) ?? 0, b = right.get(key) ?? 0;
    dot += a * b; leftSq += a * a; rightSq += b * b;
  }
  return leftSq && rightSq ? dot / Math.sqrt(leftSq * rightSq) : leftSq === rightSq ? 1 : 0;
};

export class DigitalLifeBrainRegionRouter {
  private readonly bindings: BrainRegionRouter<BrainRegion>;
  constructor(config: Record<BrainRegion, BrainRegionModelConfig>) { this.bindings = new BrainRegionRouter(config); }
  updateRegions(config: Record<BrainRegion, BrainRegionModelConfig>) { this.bindings.updateRegions(config); }
  getRegionConfig(region: BrainRegion) { return this.bindings.getRegionConfig(region); }

  routeForRegion(region: BrainRegion, metabolicEnergy: number, circadianEnergy: number): RegionRoute {
    const metabolic = clamp01(metabolicEnergy);
    const circadian = clamp01(circadianEnergy);
    const emergency = region === "L0_crisis_classifier";
    const budget: ComputeBudgetStatus = !emergency && metabolic <= L0_CRISIS_EMERGENCY_RESERVE ? "budget_exhausted"
      : !emergency && (metabolic < 0.25 || circadian < 0.25) ? "throttled_fallback" : "normal";
    const route = this.bindings.routeForRegion(region, undefined, budget);
    return { ...route, status: budget === "budget_exhausted" ? "METABOLIC_SLEEP_FUSE" : "READY",
      drowsy_downgraded: budget !== "normal",
      diegetic_cue: budget === "normal" ? undefined : budget === "budget_exhausted" ? SLEEP_CUE : DROWSY_CUE };
  }

  evaluateVoiceDriftRadar(baselineSamples: string[], candidateSamples: string[]): VoiceDriftMetrics {
    const baseLengths = baselineSamples.map(sample => [...sample].length);
    const candidateLengths = candidateSamples.map(sample => [...sample].length);
    const baseText = baselineSamples.join(" "), candidateText = candidateSamples.join(" ");
    const baseChars = Math.max(chars(baselineSamples), 1), candidateChars = Math.max(chars(candidateSamples), 1);
    const baseModal = (baseText.match(MODALS) ?? []).length / baseChars;
    const candidateModal = (candidateText.match(MODALS) ?? []).length / candidateChars;
    const pronounSet = (text: string) => new Set(text.match(PRONOUNS) ?? []);
    const basePronouns = pronounSet(baseText), candidatePronouns = pronounSet(candidateText);
    const union = new Set([...basePronouns, ...candidatePronouns]);
    const overlap = [...basePronouns].filter(value => candidatePronouns.has(value)).length;
    return {
      sentence_length_similarity: clamp01(similarity(average(baseLengths), average(candidateLengths))),
      modal_particle_ratio: clamp01(similarity(baseModal, candidateModal)),
      pronoun_consistency: union.size ? overlap / union.size : 1,
      zero_corporate_phrase_rate: clamp01(1 - (candidateText.match(CORPORATE) ?? []).length / Math.max(candidateSamples.length, 1)),
      semantic_cosine_similarity: clamp01(cosine(frequencies(baselineSamples), frequencies(candidateSamples))),
    };
  }
}
