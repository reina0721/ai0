import { createW1DialogueProfile } from "../dialogue.js";

// Production discovers the plugin through its manifest; this fixture explicitly opts in.
const { companionResponseContract } = await import(new URL(
  "../../../../../../plugins/cognitive-organs/companion-homeostasis/src/response-contract.ts", import.meta.url).href) as
  { companionResponseContract: import("@ai0/protocol").CognitionResponseContract };
export const companionProfile = createW1DialogueProfile(companionResponseContract);
