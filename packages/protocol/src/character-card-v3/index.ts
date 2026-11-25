import { z } from "zod";

import { ContinuousStateDescriptorSchema } from "../cognition/index.js";
const text = z.string().default("");
export const CharacterCardV3Schema = z.object({
  spec: z.literal("chara_card_v3"), spec_version: z.literal("3.0"),
  data: z.object({
    name: z.string().trim().min(1), description: text, personality: text, scenario: text, first_mes: text,
    mes_example: text, creator_notes: text, system_prompt: text, post_history_instructions: text,
    alternate_greetings: z.array(z.string()).default([]), tags: z.array(z.string()).default([]),
    creator: text, character_version: text,
    character_book: z.object({ entries: z.array(z.object({ content: z.string() }).passthrough()) }).passthrough().optional(),
    extensions: z.record(z.string(), z.unknown()).default({})
  }).passthrough()
}).passthrough();
export const ModuleSelectionModeSchema = z.enum(["Inherit", "Override"]);
const ModuleSelectionSchema = z.object({
  mode: ModuleSelectionModeSchema, sourceId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
  voice_id: z.string().optional()
});
export const SoulModuleOverridesSchema = z.object({
  consciousness: ModuleSelectionSchema.optional(), vision: ModuleSelectionSchema.optional(), speech: ModuleSelectionSchema.optional()
});
export const Ai0SoulCardExtensionV1Schema = z.object({
  module_overrides: SoulModuleOverridesSchema.optional(), state_descriptors: z.array(ContinuousStateDescriptorSchema).optional()
}).passthrough();
export type CharacterCardV3 = z.infer<typeof CharacterCardV3Schema>;
export type ModuleSelectionMode = z.infer<typeof ModuleSelectionModeSchema>;
export type SoulModuleOverrides = z.infer<typeof SoulModuleOverridesSchema>;
export type Ai0SoulCardExtensionV1 = z.infer<typeof Ai0SoulCardExtensionV1Schema>;
