import type { CognitionResponseContract } from "@ai0/protocol";
import type { AudienceScope, ChannelTokenUsage, VenueType } from "@ai0/protocol";
import { UpstreamModelClient, ProviderNotConfiguredError, planContextWindow, estimateTokens, type LlmProviderConfig } from "@ai0/agent-core";
import type { PromptFragmentSource } from "@ai0/agent-core";
import { ProfiledInferenceClient, type StructuredInferenceProfile } from "@ai0/cognition-core";
import { ADDITIONAL_BLACKBOARD_SLOT_TOKENS } from "./blackboard.js";

export interface LlmDialogueSynthesisInput {
  userText: string;
  stepId?: string;
  promptSources?: readonly PromptFragmentSource[];
  /** Bounded, audience-filtered data rendered in the user observation. */
  contextData?: Readonly<Record<string, string>>;
  organContexts?: readonly { title: string; content: string }[];
  compiledBlackboardText: string;
  knowledgeEvidence?: readonly {marker:number;excerpt:string;taint_level:"untrusted_external"}[];
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
  usage?: ChannelTokenUsage;
  projectStateImpulses?: (registered: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
  surface_utterance: string;
  theatrical_subtext?: string;
  masked_placeholder?: string;
  chosen_strategy?: string;
  interaction_frame?:
    | "serious_factual"
    | "playful_banter"
    | "tsundere_irony"
    | "roleplay_fiction"
    | "gentle_support";
  vocal_emotion_tag?: string;
  facial_expression?: string;
  valence_impulse?: "-medium" | "-small" | "none" | "+small" | "+medium";
  provider_used: string;
  model_used: string;
}

const safeRemoteInput = (input: LlmDialogueSynthesisInput): Record<string, unknown> => {
  const masked = input.socialMaskActive;
  return {
    userText: input.userText,
    context: input.contextData,
    knowledgeEvidence: input.knowledgeEvidence,
    personaName: input.personaName,
    roleLabel: input.roleLabel,
    corePersonalityPrompt: input.corePersonalityPrompt,
    catchphrases: input.catchphrases,
    activeTaskSummary: masked ? undefined : input.activeTaskSummary,
    venueType: input.venueType,
    audienceScope: input.audienceScope,
    socialMaskActive: input.socialMaskActive,
    moodValence: masked ? undefined : input.moodValence,
    metabolicEnergy: masked ? undefined : input.metabolicEnergy,
    unsaidRemainder: masked ? undefined : input.unsaidRemainder,
    recalledMemorySnippets: masked ? [] : input.recalledMemorySnippets.filter(text => !(input.contextData?.['slot.tier1_memory_projection'] ?? input.compiledBlackboardText).includes(text)),
    matchedLoreEntries: input.matchedLoreEntries ?? [],
  };
};

type DigitalLifeReply = Omit<LlmDialogueSynthesisOutput, "provider_used" | "model_used">;

export interface W1DialogueProfile extends StructuredInferenceProfile<LlmDialogueSynthesisInput, DigitalLifeReply> {
  synthesizeSandbox?(input: LlmDialogueSynthesisInput): LlmDialogueSynthesisOutput;
}

export function createW1DialogueProfile(contract: CognitionResponseContract): W1DialogueProfile {
  const decode = (value: Record<string, unknown>) => {
    try {
      const parsed = contract.parse(JSON.stringify(value));
      const result = contract.toOutput(parsed);
      if (typeof result.surface_utterance !== "string") return undefined;
      return { ...result, projectStateImpulses: contract.stateImpulses &&
        ((registered: Readonly<Record<string, number>>) => contract.stateImpulses!(parsed, registered)) };
    } catch { return undefined; }
  };
  return {
    id: contract.id, version: contract.version, outputSchema: contract.schema,
    compile(input) {
      if (contract.inputFormat !== "bounded_observation") {
        const plain = plainDialogueProfile.compile(input);
        return { ...plain, system: [plain.system, contract.instructions].filter(Boolean).join("\n"),
          fragments: [...plain.fragments ?? [], { id: contract.id, version: contract.version, authority: "host", field: "system", text: contract.instructions }] };
      }
      const prefix = input.customSystemPrompt || input.compiledBlackboardText;
      const suffix = [input.knowledgeEvidence?.length && "Cite supporting knowledgeEvidence markers [K1], [K2], etc.", contract.instructions].filter(Boolean).join("\n");
      const observation = safeRemoteInput(input);
      const fragments: PromptFragmentSource[] = [
        ...(input.promptSources ?? []),
        { id: input.customSystemPrompt ? "custom.system" : "digital-life.system", version: "1", authority: "host",
          field: "system", text: prefix },
        { id: contract.id, version: contract.version, authority: "host", field: "system", text: suffix },
        ...Object.entries(observation).filter(([,value]) => value !== undefined).map(([key,value]) => ({
          id: "dialogue." + key, version: "1", authority: "data", field: "observation" as const, text: JSON.stringify(value)
        }))
      ];
      return { system: prefix + "\n\n" + suffix, observation: JSON.stringify(observation), fragments };
    },
    decode,
    synthesizeSandbox(input) {
      if (!contract.sandboxResponse) throw new ProviderNotConfiguredError();
      const observation = contract.inputFormat === "bounded_observation" ? safeRemoteInput(input) : { userText: input.userText };
      const demo = contract.sandboxResponse(observation);
      if (!demo || typeof demo !== "object" || Array.isArray(demo)) throw new TypeError("Invalid sandbox output");
      const decoded = decode(demo as Record<string, unknown>);
      if (!decoded) throw new TypeError("Sandbox output does not satisfy selected response contract");
      return { ...decoded, provider_used: "deterministic-sandbox", model_used: "deterministic-sandbox" };
    }
  };
}

export const plainDialogueProfile: W1DialogueProfile = {
  id: "agent.standard_v1", version: "1",
  compile(input) {
    const instructions = [input.customSystemPrompt, input.corePersonalityPrompt,
      input.knowledgeEvidence?.length ? "Cite supporting reference markers as [K1], [K2], etc." : undefined,
      ...(input.promptSources ?? []).filter(part => part.field === "system" && part.id.startsWith("studio/")).map(part => part.text)];
    const data = [input.contextData?.["slot.tier1_working_turn"], input.contextData?.["slot.tier1_memory_projection"],
      input.knowledgeEvidence?.length ? JSON.stringify(input.knowledgeEvidence) : undefined,
      ...(input.matchedLoreEntries ?? []).map(item => item.content), input.unsaidRemainder, input.userText];
    return { system: instructions.filter(Boolean).join("\n"), observation: data.filter(Boolean).join("\n"),
      fragments: input.promptSources ? [...input.promptSources] : [] };
  },
  decode(value) { return typeof value.surface_utterance === "string" ? { surface_utterance: value.surface_utterance } : undefined; },
  synthesizeSandbox(input) { return { surface_utterance: input.userText, provider_used: "deterministic-sandbox", model_used: "deterministic-sandbox" }; }
};

export function estimateDialogueInputTokens(input: LlmDialogueSynthesisInput, profile = plainDialogueProfile): number {
  const request = profile.compile(input);
  return estimateTokens(request.system) + estimateTokens(request.observation) + 32;
}
export function planDialogueWindow(config: LlmProviderConfig | undefined, input: LlmDialogueSynthesisInput, profileBudget: number,
  profile = plainDialogueProfile) {
  return planContextWindow(config, estimateDialogueInputTokens(input, profile), profileBudget, ADDITIONAL_BLACKBOARD_SLOT_TOKENS);
}
export class UniversalLlmProviderClient {
  private readonly client: ProfiledInferenceClient<LlmDialogueSynthesisInput, DigitalLifeReply>;
  constructor(config?: LlmProviderConfig, private readonly allowDeterministicSandbox = false,
    readonly profile = plainDialogueProfile,
    transport: Pick<UpstreamModelClient, "generateStructured"> = new UpstreamModelClient(config)) {
    this.client = new ProfiledInferenceClient(transport, profile);
  }
  synthesizeContextAwareResponse = (input: LlmDialogueSynthesisInput) => {
    if (!this.profile.synthesizeSandbox) throw new ProviderNotConfiguredError();
    return this.profile.synthesizeSandbox(input);
  };
  async generateDialogue(input: LlmDialogueSynthesisInput, signal?: AbortSignal, onReasoning?: (delta: string | null) => void): Promise<LlmDialogueSynthesisOutput> {
    try {
      const { value, ...metadata } = await this.client.generate(input, { model: input.routedModelId,
        stepId: input.stepId, dynamicLlmConfig: input.dynamicLlmConfig }, signal, onReasoning);
      return { ...value, ...metadata };
    } catch (error) {
      if (this.allowDeterministicSandbox && this.profile.synthesizeSandbox && error instanceof ProviderNotConfiguredError)
        return this.profile.synthesizeSandbox(input);
      throw error;
    }
  }
}
