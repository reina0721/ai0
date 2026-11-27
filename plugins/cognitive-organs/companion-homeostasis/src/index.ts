import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import {
  cognitionProposalPolicyFacet,
  cognitionResponseContractFacet,
  cognitionStateDynamicsFacet,
  consoleConfigSchemaFacet,
  defineExtensionPackage
} from "@ai0/sdk";
import { COMPANION_HOMEOSTASIS_DESCRIPTORS } from "./dynamics.js";
import { companionResponseContract } from "./response-contract.js";

export * from "./dynamics.js";
export * from "./response-contract.js";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

export default defineExtensionPackage({
  manifest,
  activate(scope, config) {
    scope.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
    scope.contributeFacet(cognitionResponseContractFacet, companionResponseContract);
    const moodMinutes = Number(config.mood_half_life_minutes);
    const moodHalfLifeMs = Number.isFinite(moodMinutes) && moodMinutes >= 5 ? moodMinutes * 60_000 : 24 * 3_600_000;
    scope.contributeFacet(cognitionStateDynamicsFacet, {
      descriptors: COMPANION_HOMEOSTASIS_DESCRIPTORS.map((descriptor) =>
        descriptor.id === "mood_baseline_val"
          ? { ...descriptor, halfLifeMs: moodHalfLifeMs }
          : descriptor
      )
    });
    scope.contributeFacet(cognitionProposalPolicyFacet, {
      domain: "D5_IDENTITY_NARRATIVE",
      review(proposal) {
        const text = JSON.stringify(proposal.payload ?? "");
        if (/missed_login|login_streak|guilt_trip|cold_violence/iu.test(text)) {
          return { action: "reject", reason: "DARK_PATTERN_PUNISHMENT_REJECTED" };
        }
        return { action: "allow" };
      }
    });
  }
});
