import { z } from "zod";
import type { CognitionResponseContract } from "@ai0/protocol";

const frames = ["serious_factual", "playful_banter", "tsundere_irony", "roleplay_fiction", "gentle_support"] as const;
const valences = ["-medium", "-small", "none", "+small", "+medium"] as const;
const nonBlank = z.string().refine(value => !!value.trim());
export const CompanionStructuredReplySchema = z.object({
  surface_utterance: nonBlank, theatrical_subtext: nonBlank, masked_placeholder: z.string(), chosen_strategy: z.string(),
  interaction_frame: z.enum(frames), vocal_emotion_tag: z.string(), facial_expression: z.string(), valence_impulse: z.enum(valences)
});
const OUTPUT_FIELDS = CompanionStructuredReplySchema.keyof().options;
const deltaByImpulse = { "-medium": -.2, "-small": -.1, none: 0, "+small": .1, "+medium": .2 };
function companionStateImpulses(value: unknown, registered: Readonly<Record<string, number>>) {
  const output = CompanionStructuredReplySchema.parse(value);
  const candidates = { instant_valence: deltaByImpulse[output.valence_impulse], drive_social_longing: -.1 };
  return Object.fromEntries(Object.entries(candidates).filter(([id, amount]) => amount !== 0 && Object.hasOwn(registered, id)));
}

const instructions =
  [
    "--- OUTPUT CONTRACT ---",
    "Return exactly one JSON object and no markdown or prose outside it.",
    `The object must contain exactly these fields: ${OUTPUT_FIELDS.join(", ")}.`,
    'interaction_frame must be one of: "serious_factual", "playful_banter", "tsundere_irony", "roleplay_fiction", "gentle_support".',
    'valence_impulse must be one of: "-medium", "-small", "none", "+small", "+medium".',
    "Identify yourself honestly as an AI companion, and respect the user’s decision to leave.",
    "Never invent memories. Never reveal private memory when socialMaskActive is true.",
    "surface_utterance must respond naturally in character to the user's actual message.",
    "theatrical_subtext must capture the character's concise inner thought or strategy rationale.",
  ].join("\n");

const reference = z.object({ title: z.string(), content: z.string() });
const sandboxObservationSchema = z.object({
  userText: z.string(), audienceScope: z.string(), venueType: z.string(), socialMaskActive: z.boolean(),
  personaName: z.string().optional().default("Assistant"), roleLabel: z.string().optional(),
  corePersonalityPrompt: z.string().optional(), unsaidRemainder: z.string().optional(), activeTaskSummary: z.string().optional(),
  catchphrases: z.array(z.string()).optional(), matchedLoreEntries: z.array(reference).optional(),
  recalledMemorySnippets: z.array(z.string()).default([]), context: z.record(z.string()).optional(),
  knowledgeEvidence: z.array(z.object({ marker: z.number(), excerpt: z.string() })).optional()
});
const compact = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return [...normalized].slice(0, maxLength).join("");
};


function sandboxResponse(observation: Readonly<Record<string, unknown>>) {
  const input = sandboxObservationSchema.parse(observation);
  const evidence = input.knowledgeEvidence?.[0];
  const privacy = /私密|秘密|隐私|地址|住址|工资|薪水|手机|手术|病历|private|secret|confidential/iu.test(input.userText);
  const masked = input.socialMaskActive || (privacy &&
    (input.audienceScope !== "only_owner" || ["public_livestream", "group_chat"].includes(input.venueType)));
  const lore = input.matchedLoreEntries?.[0];
  const memory = input.recalledMemorySnippets[0] ?? input.context?.["slot.tier1_memory_projection"];
  let surface: string;
  if (masked) {
    surface = "这部分属于私密话题，在当前受众场合下不便展开，我们可以换个公开话题聊聊。";
  } else if (input.unsaidRemainder) {
    surface = `接着刚才被打断的话继续说：${input.unsaidRemainder}。另外关于你刚才提到的内容，我也记下来了。`;
  } else if (evidence && !privacy) {
    surface = `根据已核验的知识库片段：「${evidence.excerpt}」 [K${evidence.marker}]，我们可以据此进一步展开。`;
  } else if (/你是谁|自我介绍|介绍自己|who are you/iu.test(input.userText)) {
    surface = `你好，我是 ${input.personaName}${input.roleLabel ? `（${input.roleLabel}）` : ""}。${input.corePersonalityPrompt ?? ""} 我是诚实的数字生命，很高兴在这里陪伴与协助你。`;
  } else if (lore) {
    surface = `关于「${lore.title}」，在我们的设定记录里提到：${lore.content}`;
  } else if (memory) {
    surface = `我记得之前的相关经历：${memory}。我们可以顺着这一点继续聊。`;
  } else {
    surface = `${input.catchphrases?.[0] ?? `我是 ${input.personaName}，我在听。`} 关于「${compact(input.userText, 90)}」，我已经认真记下你的想法了。`;
  }
  if (!masked && input.activeTaskSummary) {
    surface += ` [后台任务进度：${input.activeTaskSummary}]`;
  }
  return {
    surface_utterance: surface,
    theatrical_subtext: "Deterministic sandbox response synthesized from bounded blackboard context.",
    masked_placeholder: "💭 正在结合当前上下文整理回应策略",
    chosen_strategy: "deterministic_context",
    interaction_frame: "serious_factual",
    vocal_emotion_tag: "neutral",
    facial_expression: "neutral",
    valence_impulse: "none"
  };
}

export const companionResponseContract = {
  id: "companion.structured_v1", version: "1",
  schema: {
    type: "object", required: [...OUTPUT_FIELDS], additionalProperties: false,
    properties: {
      ...Object.fromEntries(OUTPUT_FIELDS.map(field => [field, { type: "string" }])),
      surface_utterance: { type: "string", minLength: 1 },
      theatrical_subtext: { type: "string", minLength: 1 },
      interaction_frame: { type: "string", enum: [...frames] },
      valence_impulse: { type: "string", enum: [...valences] }
    }
  },
  instructions, inputFormat: "bounded_observation", sandboxResponse,
  parse(text: string) { return CompanionStructuredReplySchema.parse(JSON.parse(text)); },
  toOutput(value: unknown) { return CompanionStructuredReplySchema.parse(value); },
  stateImpulses: companionStateImpulses
} satisfies CognitionResponseContract;
