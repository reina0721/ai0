import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, streamText } from "ai";

import type { AudienceScope, VenueType } from "@ai0/protocol";

export interface LlmProviderConfig {
  provider?:
    | "openai-compatible"
    | "anthropic"
    | "ollama"
    | "local-persona-synthesizer";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface LlmDialogueSynthesisInput {
  userText: string;
  compiledBlackboardText: string;
  personaName: string;
  corePersonalityPrompt?: string;
  roleLabel?: string;
  catchphrases?: readonly string[];
  bannedCliches?: readonly string[];
  matchedLoreEntries?: readonly { title: string; content: string }[];
  customSystemPrompt?: string;
  dynamicLlmConfig?: LlmProviderConfig;
  venueType: VenueType;
  audienceScope: AudienceScope;
  socialMaskActive: boolean;
  moodValence: number;
  metabolicEnergy: number;
  drowsyDowngraded: boolean;
  recalledMemorySnippets: readonly string[];
  unsaidRemainder?: string;
  activeTaskSummary?: string;
  routedModelId: string;
}

export interface LlmDialogueSynthesisOutput {
  surface_utterance: string;
  theatrical_subtext: string;
  masked_placeholder: string;
  chosen_strategy: string;
  interaction_frame:
    | "serious_factual"
    | "playful_banter"
    | "tsundere_irony"
    | "roleplay_fiction"
    | "gentle_support";
  vocal_emotion_tag: string;
  facial_expression: string;
  valence_impulse: "-medium" | "-small" | "none" | "+small" | "+medium";
  provider_used: string;
  model_used: string;
}

type InteractionFrame = LlmDialogueSynthesisOutput["interaction_frame"];
type ValenceImpulse = LlmDialogueSynthesisOutput["valence_impulse"];
type RemoteProvider = Exclude<
  NonNullable<LlmProviderConfig["provider"]>,
  "local-persona-synthesizer"
> | "deepseek";

const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_FIELDS = [
  "surface_utterance",
  "theatrical_subtext",
  "masked_placeholder",
  "chosen_strategy",
  "interaction_frame",
  "vocal_emotion_tag",
  "facial_expression",
  "valence_impulse",
  "provider_used",
  "model_used",
] as const;
const INTERACTION_FRAMES = new Set<InteractionFrame>([
  "serious_factual",
  "playful_banter",
  "tsundere_irony",
  "roleplay_fiction",
  "gentle_support",
]);
const VALENCE_IMPULSES = new Set<ValenceImpulse>([
  "-medium",
  "-small",
  "none",
  "+small",
  "+medium",
]);

const compact = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return [...normalized].slice(0, maxLength).join("");
};

const stableVariant = (value: string, count: number): number => {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return count > 0 ? hash % count : 0;
};

const choose = (seed: string, variants: readonly string[]): string =>
  variants[stableVariant(seed, variants.length)] ?? variants[0] ?? "";

const isPublicVenue = (input: LlmDialogueSynthesisInput): boolean =>
  input.venueType === "group_chat" ||
  input.venueType === "public_livestream" ||
  input.audienceScope === "public_all" ||
  input.audienceScope.startsWith("group:");

const findRelevantMemory = (input: LlmDialogueSynthesisInput): string => {
  if (input.socialMaskActive || !input.recalledMemorySnippets.length) return "";
  const query = input.userText.toLowerCase();
  const terms = query
    .split(/[\s,，。！？?!、/]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (const snippet of input.recalledMemorySnippets) {
    const lower = snippet.toLowerCase();
    if (terms.some((term) => lower.includes(term))) {
      return compact(snippet, 84);
    }
  }
  return "";
};

const memoryPhrase = (input: LlmDialogueSynthesisInput): string => {
  if (input.socialMaskActive) return "";
  const relevant = findRelevantMemory(input) || compact(input.recalledMemorySnippets[0] ?? "", 72);
  return relevant ? `我记得这条记录：「${relevant}」` : "";
};

type DialogueCategory =
  | "interruption"
  | "privacy"
  | "identity"
  | "lore"
  | "memory"
  | "coding_tired"
  | "feelings"
  | "greeting"
  | "playful"
  | "short_probe"
  | "general";

const classify = (input: LlmDialogueSynthesisInput): DialogueCategory => {
  const text = input.userText.trim().toLowerCase();
  if (/(隐私|公开|直播|群里|别人听|能说吗|privacy|public|stream|on air)/iu.test(text))
    return "privacy";
  if (/(你是谁|你叫什么|自我介绍|介绍一下你自己|你的名字|who are you|what is your name)/iu.test(text))
    return "identity";
  if (compact(input.unsaidRemainder ?? "")) return "interruption";
  if (input.matchedLoreEntries && input.matchedLoreEntries.length > 0)
    return "lore";
  if (/(记得|记住|忘了|回忆|上次|习惯喝|remember|memory|recall)/iu.test(text)) return "memory";
  if (
    /(熬夜|困|累|写代码|代码|编程|bug|加班|debug|coding|code|tired|sleepy|late.?night)/iu.test(
      text,
    )
  )
    return "coding_tired";
  if (/(心情|感觉|开心|难过|状态|还好吗|怎么样|feel|feeling|how are you|status)/iu.test(text))
    return "feelings";
  if (/^\s*(嗨|哈[喽啰罗]|你好|早|晚安|在吗|hey|hi|hello|morning|evening)/iu.test(text))
    return "greeting";
  if (/(逗你|开玩笑|笨蛋|傻瓜|哼|哈哈|嘿嘿|tease|kidding|joke|banter)/iu.test(text))
    return "playful";
  if (
    /^[?？!！.。\s]+$/u.test(text) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text) ||
    /^(test|ping|测试|123)$/iu.test(text)
  )
    return "short_probe";
  return "general";
};

const maskedReply = (input: LlmDialogueSynthesisInput): string => {
  if (isPublicVenue(input)) {
    return choose(input.userText, [
      "公开场合下不便展开私人细节，这部分信息我已按受众边界收起。",
      "直播间里先保留一点神秘感吧——你的私人细节，我不会拿来当谈资。",
      "当前为公开受众通道，私密记录已被检索层隔离，我们可以先聊当下公开的话题。",
    ]);
  }
  return "我会按当前受众边界妥善隔离私密内容，如需核对具体规则可以直接询问。";
};

const tiredOutput = (
  input: LlmDialogueSynthesisInput,
  category: DialogueCategory,
  memory: string,
): Pick<
  LlmDialogueSynthesisOutput,
  "surface_utterance" | "theatrical_subtext" | "chosen_strategy" | "interaction_frame"
> => {
  const name = input.personaName || "Mio";
  if (category === "interruption") {
    const remainder = compact(input.unsaidRemainder ?? "", 54);
    return {
      surface_utterance: remainder
        ? `我把刚才被打断的那半句接上：${remainder}。然后我们慢一点继续。`
        : "我还在，刚才没说完的部分我们可以接着聊。",
      theatrical_subtext: "虽然算力余量偏低，但仍认真保留了刚才未说完的语境。",
      chosen_strategy: "sleepy_interruption_recovery",
      interaction_frame: "gentle_support",
    };
  }
  if (category === "coding_tired") {
    return {
      surface_utterance: "代码不会跑掉，先保存一下进度、站起来喝口水休息几分钟吧。",
      theatrical_subtext: "低电量模式下仍惦记着提醒对方注意休息。",
      chosen_strategy: "low_energy_gentle_grounding",
      interaction_frame: "gentle_support",
    };
  }
  return {
    surface_utterance: memory
      ? `${memory}。${name}现在处于低能耗模式，不过我仍在认真听你说。`
      : `${name}现在已进入省电低耗状态，回复会简短一点，但我在听。`,
    theatrical_subtext: "算力预算偏低时保持克制简短的回应，避免断线报错。",
    chosen_strategy: "concise_sleepy_presence",
    interaction_frame: "gentle_support",
  };
};

/**
 * Deterministic persona-aware local synthesis used when no remote/Ollama LLM
 * endpoint is configured or as the resilient fallback path.
 */
export function synthesizeContextAwareResponse(
  input: LlmDialogueSynthesisInput,
): LlmDialogueSynthesisOutput {
  const category = classify(input);
  const memory = memoryPhrase(input);
  const relevantMemory = findRelevantMemory(input);
  const sleepy = input.drowsyDowngraded || input.metabolicEnergy < 0.25;
  const name = input.personaName || "Mio";
  const role = input.roleLabel ? `（当前契约：${input.roleLabel}）` : "";
  const personaBrief = compact(input.corePersonalityPrompt ?? "", 120);
  const catchphrase = input.catchphrases?.length
    ? choose(input.userText, input.catchphrases)
    : "";
  const task = compact(input.activeTaskSummary ?? "", 64);
  const seed = `${name}|${input.userText}|${input.routedModelId}|${category}`;

  let core: Pick<
    LlmDialogueSynthesisOutput,
    "surface_utterance" | "theatrical_subtext" | "chosen_strategy" | "interaction_frame"
  >;

  if (sleepy) {
    core = tiredOutput(input, category, memory);
  } else if (category === "interruption") {
    const remainder = compact(input.unsaidRemainder ?? "", 120);
    core = {
      surface_utterance: `刚才被打断的半句是「${remainder}」。我们可以接着这里继续，也可以先聊你刚想到的事。`,
      theatrical_subtext: "确认了打断偏移字数，把未说完的腹稿完整接回当前话轮。",
      chosen_strategy: "restore_interrupted_thread",
      interaction_frame: "gentle_support",
    };
  } else if (input.socialMaskActive || category === "privacy") {
    core = {
      surface_utterance: maskedReply(input),
      theatrical_subtext: "当前受众非仅主账户私密通道，严格保持 70% 社交面具与隐私隔离。",
      chosen_strategy: "poised_privacy_boundary",
      interaction_frame: "serious_factual",
    };
  } else if (category === "identity") {
    const intro = personaBrief
      ? `我是 ${name}${role}。${personaBrief}`
      : `我是 ${name}${role}，当前通过 WebChat 与你在线对话。`;
    core = {
      surface_utterance: catchphrase ? `${intro} ${catchphrase}。` : intro,
      theatrical_subtext: `以当前已激活的角色档案（${name}）直接如实回应身份询问。`,
      chosen_strategy: "direct_persona_identity",
      interaction_frame: "serious_factual",
    };
  } else if (category === "lore" && input.matchedLoreEntries?.length) {
    const entry = input.matchedLoreEntries[0]!;
    core = {
      surface_utterance: `提到「${entry.title}」——${compact(entry.content, 110)} 你这次是想围绕它展开哪一部分？`,
      theatrical_subtext: `命中世界书词条「${entry.title}」，按需将其背景设定融入当前回复。`,
      chosen_strategy: "lorebook_grounded_reply",
      interaction_frame: "gentle_support",
    };
  } else if (category === "memory") {
    core = memory
      ? {
          surface_utterance: `${memory}。如果是要核对或补充细节，你可以直接告诉我。`,
          theatrical_subtext: "检索到受众允许的长期记忆记录并直接给出事实核对。",
          chosen_strategy: "grounded_memory_recall",
          interaction_frame: "gentle_support",
        }
      : {
          surface_utterance: "当前检索结果里没有匹配的可靠记忆片段，所以我不会凭空编造。你可以给我一点线索。",
          theatrical_subtext: "检索置信度低于门槛，触发诚实遗忘兜底而不虚构事实。",
          chosen_strategy: "honest_memory_gap",
          interaction_frame: "serious_factual",
        };
  } else if (category === "coding_tired") {
    core = {
      surface_utterance: task
        ? `你还在处理「${task}」相关的代码吗？先保存好当前进度喝口水，卡住的地方贴给我一起拆解。`
        : relevantMemory
          ? `这么晚还在调试代码辛苦了（${relevantMemory}）。先保存歇两分钟，需要一起看哪段报错直接发我。`
          : choose(seed, [
              "这么晚还在调试代码，先保存一下进度、喝口水放松几分钟吧。卡住的地方可以直接发给我看。",
              "屏幕可以一直亮着，但精力会消耗完。把最卡手的那一段发出来，我们一步步拆开解决。",
            ]),
      theatrical_subtext: "留意到对方处于深夜高强度编码状态，优先兼顾进度协助与温和休息提醒。",
      chosen_strategy: "warm_task_grounding",
      interaction_frame: "gentle_support",
    };
  } else if (category === "feelings") {
    const lowMood = input.moodValence < -0.2;
    core = {
      surface_utterance: task
        ? `后台任务正在推进（${task}），${name}这边状态稳定，有新进展会第一时间同步告诉你。`
        : lowMood
          ? `${name}现在心境值偏低（${input.moodValence.toFixed(2)}），不过随时在线，想聊点什么都可以。`
          : `${name}现在状态稳定（心境 ${input.moodValence >= 0 ? "+" : ""}${input.moodValence.toFixed(2)}），正在 WebChat 等你消息。你今天怎么样？`,
      theatrical_subtext: task
        ? "同步感知到后台异步任务进度，边聊边如实汇报当前推进步骤。"
        : "根据当前内稳态读数如实反馈状态。",
      chosen_strategy: task ? "active_task_progress_checkin" : "reciprocal_emotional_checkin",
      interaction_frame: "gentle_support",
    };
  } else if (category === "greeting") {
    core = {
      surface_utterance: catchphrase
        ? `你好，我是 ${name}${role}。${catchphrase}，今天想聊点什么，还是直接测试配置？`
        : `你好，我是 ${name}${role}，已在 WebChat 就绪。`,
      theatrical_subtext: "在 WebChat 收到问候，以当前配置的角色档案自然回应。",
      chosen_strategy: "warm_opening_invitation",
      interaction_frame: "gentle_support",
    };
  } else if (category === "playful") {
    core = {
      surface_utterance: choose(seed, [
        `少拿这种话试探 ${name} 啦，有正事还是单纯来逗我的？`,
        "这波玩笑我接住了，不过下次得换个更有创意的开场。",
      ]),
      theatrical_subtext: "识别到轻松调侃语境，保持角色自然互动且不将玩笑误记为客观事实。",
      chosen_strategy: "affectionate_teasing_return",
      interaction_frame: "playful_banter",
    };
  } else if (category === "short_probe") {
    const echo = compact(input.userText, 48);
    core = {
      surface_utterance: /^[?？!！.。\s]+$/u.test(echo)
        ? `嗯？发了个「${echo}」，是刚才哪里不对劲，还是在测回复？我是 ${name}，直接在 WebChat 说就行。`
        : `收到「${echo}」了。当前角色是 ${name}${role}，WebChat 通道在线（尚未填写外部大模型 API Key 时使用本地离线合成引擎；在「模型与多模态服务」填入 API Key 或 Ollama 地址后将自动直连真实大模型）。`,
      theatrical_subtext: "识别为简短探测或测试输入，清晰回报当前在线角色与模型接通状态。",
      chosen_strategy: "concise_probe_acknowledgement",
      interaction_frame: "serious_factual",
    };
  } else {
    const echo = compact(input.userText, 64);
    const tail = catchphrase ? ` ${catchphrase}。` : "";
    core = {
      surface_utterance: relevantMemory
        ? `关于你提到的「${echo}」，我联想到之前记过的「${relevantMemory}」。你想从哪一块继续展开？${tail}`
        : `收到你说的「${echo}」了。我是 ${name}，目前处于本地离线引擎模式（填入模型 API Key 后即可调用完整大模型推理）；如果你想继续细聊或调整我的设定，随时告诉我。${tail}`,
      theatrical_subtext: "针对当前输入进行直接回应，未命中相关记忆时不强行背诵无关旧记录。",
      chosen_strategy: "contextual_direct_reply",
      interaction_frame: "gentle_support",
    };
  }

  const positive = category === "greeting" || category === "playful";
  const negative = input.moodValence < -0.45;
  return {
    ...core,
    masked_placeholder: `点击展开 ${name} 的潜台词（隐私遮罩）`,
    vocal_emotion_tag: sleepy
      ? "soft_sleepy"
      : positive
        ? "warm_playful"
        : negative
          ? "quiet_concerned"
          : "warm_attentive",
    facial_expression: sleepy
      ? "sleepy_soft_smile"
      : positive
        ? "bright_side_smile"
        : negative
          ? "gentle_concern"
          : "soft_attentive_gaze",
    valence_impulse: sleepy
      ? "none"
      : positive
        ? "+small"
        : negative
          ? "+small"
          : "none",
    provider_used: "local-persona-synthesizer",
    model_used: input.routedModelId,
  };
}

const defaultBaseUrl = (provider: RemoteProvider): string => {
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "ollama") return "http://127.0.0.1:11434/v1";
  return "https://api.openai.com/v1";
};

function isOfficialDeepSeek(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return url.origin === "https://api.deepseek.com" && !url.username && !url.password
      && (url.pathname === "/" || url.pathname === "/v1");
  } catch {
    return false;
  }
}

const jsonInstructions = (input: LlmDialogueSynthesisInput): string =>
  [
    input.customSystemPrompt || input.compiledBlackboardText || `You are ${input.personaName || "Mio"}.`,
    "",
    "--- OUTPUT CONTRACT ---",
    "Return exactly one JSON object and no markdown or prose outside it.",
    `The object must contain exactly these fields: ${OUTPUT_FIELDS.join(", ")}.`,
    'interaction_frame must be one of: "serious_factual", "playful_banter", "tsundere_irony", "roleplay_fiction", "gentle_support".',
    'valence_impulse must be one of: "-medium", "-small", "none", "+small", "+medium".',
    "Never invent memories. Never reveal private memory when socialMaskActive is true.",
    "surface_utterance must respond naturally in character to the user's actual message.",
    "theatrical_subtext must capture the character's concise inner thought or strategy rationale.",
  ].join("\n");

const safeRemoteInput = (input: LlmDialogueSynthesisInput): Record<string, unknown> => {
  const masked = input.socialMaskActive;
  return {
    userText: input.userText,
    personaName: input.personaName,
    venueType: input.venueType,
    audienceScope: input.audienceScope,
    socialMaskActive: input.socialMaskActive,
    moodValence: input.moodValence,
    metabolicEnergy: input.metabolicEnergy,
    unsaidRemainder: masked ? undefined : input.unsaidRemainder,
    recalledMemorySnippets: masked ? [] : [...input.recalledMemorySnippets],
    matchedLoreEntries: input.matchedLoreEntries ?? [],
  };
};

const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const validateRemoteOutput = (
  value: Record<string, unknown>,
  provider: RemoteProvider,
  model: string,
): LlmDialogueSynthesisOutput | undefined => {
  for (const field of OUTPUT_FIELDS) if (typeof value[field] !== "string") return undefined;
  if (!INTERACTION_FRAMES.has(value.interaction_frame as InteractionFrame)) return undefined;
  if (!VALENCE_IMPULSES.has(value.valence_impulse as ValenceImpulse)) return undefined;
  if (!compact(value.surface_utterance as string)) return undefined;
  if (!compact(value.theatrical_subtext as string)) return undefined;
  return {
    surface_utterance: value.surface_utterance as string,
    theatrical_subtext: value.theatrical_subtext as string,
    masked_placeholder: value.masked_placeholder as string,
    chosen_strategy: value.chosen_strategy as string,
    interaction_frame: value.interaction_frame as InteractionFrame,
    vocal_emotion_tag: value.vocal_emotion_tag as string,
    facial_expression: value.facial_expression as string,
    valence_impulse: value.valence_impulse as ValenceImpulse,
    provider_used: provider,
    model_used: model,
  };
};

export class UniversalLlmProviderClient {
  private readonly config: Readonly<LlmProviderConfig>;

  constructor(config: LlmProviderConfig = {}) {
    this.config = Object.freeze({ ...config });
  }

  synthesizeContextAwareResponse(
    input: LlmDialogueSynthesisInput,
  ): LlmDialogueSynthesisOutput {
    return synthesizeContextAwareResponse(input);
  }

  async generateDialogue(
    input: LlmDialogueSynthesisInput,
    signal?: AbortSignal,
  ): Promise<LlmDialogueSynthesisOutput> {
    signal?.throwIfAborted();
    const effectiveConfig: LlmProviderConfig = {
      ...this.config,
      ...(input.dynamicLlmConfig ?? {}),
    };
    const configuredProvider = effectiveConfig.provider ??
      (effectiveConfig.apiKey ? "openai-compatible" : "local-persona-synthesizer");
    if (!effectiveConfig.apiKey && configuredProvider !== "ollama")
      return this.synthesizeContextAwareResponse(input);

    if (configuredProvider === "local-persona-synthesizer") return this.synthesizeContextAwareResponse(input);
    const baseURL = (effectiveConfig.baseUrl ?? defaultBaseUrl(configuredProvider)).replace(/\/+$/u, "");
    const provider: RemoteProvider = configuredProvider === "openai-compatible" && isOfficialDeepSeek(baseURL)
      ? "deepseek"
      : configuredProvider;
    const model = effectiveConfig.model ?? input.routedModelId;
    const modelId = provider === "deepseek" && /^(deepseek-chat|deepseek-reasoner|deepseek-v4-flash)$/u.test(model)
      ? "deepseek-flash"
      : model;
    const timeoutMs =
      Number.isFinite(effectiveConfig.timeoutMs) && (effectiveConfig.timeoutMs ?? 0) > 0
        ? Math.floor(effectiveConfig.timeoutMs as number)
        : DEFAULT_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const adapter = provider === "anthropic"
        ? createAnthropic({ baseURL, apiKey: effectiveConfig.apiKey })
        : provider === "deepseek"
          ? createDeepSeek({ baseURL, apiKey: effectiveConfig.apiKey })
          : createOpenAICompatible({ name: provider, baseURL, apiKey: effectiveConfig.apiKey });
      const response = streamText({
        model: adapter(modelId),
        system: jsonInstructions(input),
        prompt: JSON.stringify(safeRemoteInput(input)),
        maxOutputTokens: 900,
        maxRetries: 0,
        abortSignal,
        onError: () => undefined,
        ...(provider === "deepseek" && /^(deepseek-chat|deepseek-flash|deepseek-v4-flash)$/u.test(model)
          ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } }
          : {}),
        ...(provider === "anthropic" ? {} : { output: Output.json() })
      });
      const parsed = parseJsonObject(await response.text);
      signal?.throwIfAborted();
      return parsed
        ? validateRemoteOutput(parsed, provider, modelId) ?? this.synthesizeContextAwareResponse(input)
        : this.synthesizeContextAwareResponse(input);
    } catch {
      signal?.throwIfAborted();
      return this.synthesizeContextAwareResponse(input);
    }
  }
}
