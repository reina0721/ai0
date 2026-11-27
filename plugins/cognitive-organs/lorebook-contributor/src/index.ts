import { Ai0ExtensionManifestSchema, LorebookYamlSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import {
  cognitionContextContributorFacet,
  consoleConfigSchemaFacet,
  defineExtensionPackage,
  extensionAssetCodecFacet
} from "@ai0/sdk";
import {
  distillSillyTavernCard,
  simulateLorebookActivation,
  type LorebookSimEntry
} from "./card-codec.js";

export * from "./card-codec.js";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

export default defineExtensionPackage({
  manifest,
  activate(scope, config) {
    scope.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
    scope.contributeFacet(extensionAssetCodecFacet, {
      format: "sillytavern.card",
      target: "ai0.distilled-card.v1",
      decode(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new TypeError("Expected card object");
        }
        return distillSillyTavernCard(input as Record<string, unknown>);
      }
    });
    scope.contributeFacet(extensionAssetCodecFacet, {
      format: "ai0.lorebook.simulation",
      target: "ai0.lorebook.activated.v1",
      decode(input) {
        const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
        const entries = Array.isArray(body.entries) ? body.entries as LorebookSimEntry[] : [];
        return simulateLorebookActivation(entries, String(body.utterance ?? ""));
      }
    });
    const maxDepth = Number(config.max_recursive_depth ?? 3);
    const tokenBudget = Number(config.default_token_budget ?? 240);
    scope.contributeFacet(cognitionContextContributorFacet, {
      priority: 10,
      contributeToBlackboard(snapshot, maxTokens) {
        const identity = snapshot.D5_IDENTITY_NARRATIVE as Record<string, unknown> | undefined;
        const working = snapshot.D1_WORKING_TURN as { recent_turns?: { role: string; text: string }[] } | undefined;
        const book = LorebookYamlSchema.safeParse(identity?.lorebook ?? config.lorebook);
        let frontier = working?.recent_turns?.findLast(turn => turn.role === "user")?.text ?? "";
        let remaining = Math.floor(Math.min(maxTokens, tokenBudget) * 2.5);
        if (!book.success || remaining <= 0 || !frontier) return null;
        const entries = book.data.entries.filter(entry => entry.enabled).sort((a, b) => b.priority - a.priority);
        const visited = new Set<string>();
        const results: string[] = [];
        for (let depth = 0; depth < maxDepth && frontier && remaining > 0; depth++) {
          const haystack = frontier.toLowerCase();
          const next: string[] = [];
          for (const entry of entries) {
            if (visited.has(entry.entry_id) || depth > entry.recursive_depth ||
                !entry.keys.some(key => key && haystack.includes(key.toLowerCase())) ||
                !(entry.secondary_keys ?? []).every(key => haystack.includes(key.toLowerCase()))) continue;
            visited.add(entry.entry_id);
            const budget = Math.min(remaining - Number(results.length > 0), Math.floor(entry.max_token_budget * 2.5));
            if (budget <= 0) continue;
            const text = entry.content.slice(0, budget);
            results.push(text);
            next.push(text);
            remaining -= text.length + Number(results.length > 1);
          }
          frontier = next.join("\n");
        }
        return results.length ? { slot_id: "slot.lorebook_triggered", text: results.join("\n") } : null;
      }
    });
  }
});
