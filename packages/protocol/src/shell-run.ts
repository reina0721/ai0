import type { ShellKnowledgeReferences } from "./control-plane/knowledge.js";

/** Channel A projection of a turn. Optional values are omitted when unavailable. */
export const shellRunStages = ["accepted", "gate", "recall", "blackboard", "generating", "committed", "delivering"] as const;
export type ShellRunStage = typeof shellRunStages[number];

export interface ShellStageEvent {
  stage: ShellRunStage;
  elapsedMs?: number;
}

export interface ShellTokenUsage {
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export interface ShellRunProcess {
  stages: ShellStageEvent[];
  error?: "MODEL_CONTEXT_LIMIT";
  elapsedMs?: number;
  reasoning?: string;
  provider?: { name: string; model: string };
  usage?: ShellTokenUsage;
  /** Resolved under the current viewer's permissions at read time. */
  memories?: { id: string; text: string }[];
}

/** Shared by run snapshots, history entries and data-turn notifications. */
export interface ShellRunPresentation extends ShellKnowledgeReferences {
  process?: ShellRunProcess;
  error?: ShellRunProcess["error"];
}

export interface ShellReasoningEvent {
  type: "data-turn-reasoning";
  /** null withdraws a discarded provider attempt. */
  data: { delta: string | null };
}
