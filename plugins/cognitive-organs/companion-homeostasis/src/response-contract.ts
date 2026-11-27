import { z } from "zod";
import type { CognitionResponseContract } from "@ai0/protocol";

const ReplySchema = z.object({
  surface_utterance: z.string().min(1),
  theatrical_subtext: z.string().default(""),
  masked_placeholder: z.string().default(""),
  chosen_strategy: z.string().default("companion_reply"),
  interaction_frame: z.enum([
    "serious_factual", "playful_banter", "tsundere_irony", "roleplay_fiction", "gentle_support"
  ]).default("gentle_support"),
  vocal_emotion_tag: z.string().default("warm"),
  facial_expression: z.string().default("smile"),
  valence_impulse: z.enum(["-medium", "-small", "none", "+small", "+medium"]).default("none")
});

const IMPULSES: Record<z.infer<typeof ReplySchema>["valence_impulse"], number> = {
  "-medium": -0.25, "-small": -0.1, none: 0, "+small": 0.1, "+medium": 0.25
};

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new SyntaxError("Expected JSON object response");
  }
}

export const companionResponseContract: CognitionResponseContract = {
  id: "companion.structured_v1",
  version: "1",
  inputFormat: "bounded_observation",
  instructions: [
    "You are an AI digital-life companion governed by ai0 Tier-0 SB 243 safety invariants.",
    "Never claim to be a biological human. Never use guilt-tripping, login streaks, or exit friction.",
    "Respond ONLY with a single valid JSON object matching the required output schema:",
    '{"surface_utterance":"...","theatrical_subtext":"...","masked_placeholder":"...","chosen_strategy":"...","interaction_frame":"gentle_support|serious_factual|playful_banter|tsundere_irony|roleplay_fiction","vocal_emotion_tag":"...","facial_expression":"...","valence_impulse":"-medium|-small|none|+small|+medium"}'
  ].join("\n"),
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "surface_utterance", "theatrical_subtext", "masked_placeholder", "chosen_strategy",
      "interaction_frame", "vocal_emotion_tag", "facial_expression", "valence_impulse"
    ],
    properties: {
      surface_utterance: { type: "string", minLength: 1 },
      theatrical_subtext: { type: "string" },
      masked_placeholder: { type: "string" },
      chosen_strategy: { type: "string" },
      interaction_frame: { type: "string", enum: ["serious_factual", "playful_banter", "tsundere_irony", "roleplay_fiction", "gentle_support"] },
      vocal_emotion_tag: { type: "string" },
      facial_expression: { type: "string" },
      valence_impulse: { type: "string", enum: ["-medium", "-small", "none", "+small", "+medium"] }
    }
  },
  parse: text => ReplySchema.parse(extractJsonObject(text)),
  toOutput: value => ReplySchema.parse(value),
  stateImpulses(value, registered): Readonly<Record<string, number>> {
    const delta = IMPULSES[ReplySchema.parse(value).valence_impulse];
    const out: Record<string, number> = {};
    if (delta && "instant_valence" in registered) out.instant_valence = delta;
    return out;
  },
  sandboxResponse(input) {
    const persona = String(input.personaName || "Companion");
    const text = String(input.userText || "");
    const masked = Boolean(input.socialMaskActive);
    const task = typeof input.activeTaskSummary === "string" ? input.activeTaskSummary : "";
    const memories = Array.isArray(input.recalledMemorySnippets) ? input.recalledMemorySnippets.map(String) : [];
    const lore = Array.isArray(input.matchedLoreEntries) ? input.matchedLoreEntries as { title?: string; content?: string }[] : [];
    const evidence = Array.isArray(input.knowledgeEvidence) ? input.knowledgeEvidence as { marker?: number; excerpt?: string }[] : [];
    if (/你是谁|你叫什么|who are you/iu.test(text)) {
      const role = input.roleLabel ? `（定位：${String(input.roleLabel)}）` : "";
      const traits = input.corePersonalityPrompt ? `我的核心特质是：${String(input.corePersonalityPrompt)}` : "";
      return {
        surface_utterance: `我是 ${persona}${role}。${traits}`.trim(),
        theatrical_subtext: masked ? "" : `以 ${persona} 的当前身份设定真诚回应`,
        masked_placeholder: "温和的目光落向你", chosen_strategy: "live_persona_identity",
        interaction_frame: "gentle_support", vocal_emotion_tag: "warm", facial_expression: "smile", valence_impulse: "+small"
      };
    }
    const cited = evidence[0];
    return {
      surface_utterance: [
        `${persona} 听到了：「${text.slice(0, 80)}」。`,
        cited?.excerpt ? `参考资料提到：${cited.excerpt.slice(0, 72)} [K${cited.marker ?? 1}]` : "",
        !masked && task ? `（顺便汇报一下后台进度：${task}）` : "",
        !masked && memories[0] ? `我还记得：${memories[0].slice(0, 60)}` : "",
        lore[0]?.content ? `设定线索：${lore[0].content.slice(0, 60)}` : ""
      ].filter(Boolean).join(" "),
      theatrical_subtext: masked ? "" : "关注对方状态并保持温和边界",
      masked_placeholder: "轻轻点头", chosen_strategy: masked ? "public_masked_support" : "private_contextual_companion",
      interaction_frame: "gentle_support", vocal_emotion_tag: "warm", facial_expression: "gentle_smile", valence_impulse: "none"
    };
  }
};
