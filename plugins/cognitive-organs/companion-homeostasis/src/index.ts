import { companionResponseContract } from "./response-contract.js";
import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import { expressionIntentDecoratorFacet, cognitionResponseContractFacet, cognitionContextContributorFacet, cognitionStateDynamicsFacet, consoleConfigSchemaFacet, defineExtensionPackage } from "@ai0/sdk";
import type { ContinuousStateDescriptor } from "@ai0/protocol";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

export default defineExtensionPackage({
  manifest,
  activate(scope, config) {
    scope.contributeFacet(cognitionResponseContractFacet, companionResponseContract);
    scope.contributeFacet(expressionIntentDecoratorFacet, {
      presentationStyle: { syncAnchor: "pre_speech", attentionBehavior: "locked" },
      decorate: intent => intent
    });
    scope.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
    const moodHalfLifeMs = Number(config.mood_half_life_minutes ?? 60) * 60_000;
    const descriptors: ContinuousStateDescriptor[] = [
      { id: "instant_valence", topology: "bipolar_tanh", baseline: 0, halfLifeMs: 3_600_000, wakeupThresholds: [] },
      { id: "instant_arousal", topology: "unipolar_sigmoid", baseline: 0.35, halfLifeMs: 3_600_000, wakeupThresholds: [] },
      { id: "mood_baseline_val", topology: "bipolar_tanh", baseline: 0, halfLifeMs: moodHalfLifeMs, wakeupThresholds: [] },
      ...["circadian_energy", "metabolic_energy", "drive_social_longing", "drive_curiosity"].map(id => ({
        id, topology: "unipolar_sigmoid" as const, baseline: 0.5, halfLifeMs: 43_200_000, wakeupThresholds: []
      }))
    ];
    scope.contributeFacet(cognitionStateDynamicsFacet, { descriptors });
    scope.contributeFacet(cognitionContextContributorFacet, {
      contributeToBlackboard(snapshot, maxTokens) {
        if (config.enable_circadian_curve === false || maxTokens < 24) return null;
        const affect = (snapshot.D2_CONTINUOUS_STATES as { values?: Record<string, number> } | undefined)?.values;
        if (!affect) return null;
        const values = descriptors.flatMap(({ id }) => typeof affect[id] === "number"
          ? [id + "=" + affect[id].toFixed(2)] : []);
        return values.length ? { slot_id: "slot.homeostasis_and_vitality", text: values.join(", ").slice(0, Math.floor(maxTokens * 2.5)) } : null;
      }
    });

  }
});
