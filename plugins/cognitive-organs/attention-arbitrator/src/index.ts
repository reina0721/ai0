import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import { cognitionAttentionArbitratorFacet, consoleConfigSchemaFacet, defineExtensionPackage, expressionIntentDecoratorFacet } from "@ai0/sdk";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

export default defineExtensionPackage({
  manifest,
  activate(scope, config) {
    scope.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
    const windowMs = Number(config.focus_hysteresis_window_ms ?? 4000);
    const gazeLeadMs = Number(config.gaze_lead_ms ?? 180);
    scope.contributeFacet(cognitionAttentionArbitratorFacet, {
      arbitrate(params) {
        const ranked = [...params.candidates].sort((a, b) =>
          Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || b.salience - a.salience);
        const crisis = ranked.filter(candidate => candidate.l0_crisis).sort((a, b) => b.salience - a.salience)[0];
        const current = ranked.find(candidate => candidate.channel_id === params.current_channel_id);
        const locked = current && params.now_ts_ms - params.last_switch_ts_ms < (params.hysteresis_ms ?? windowMs);
        const selected = crisis ?? (locked ? current : ranked[0]);
        const selectedId = selected?.channel_id ?? null;
        const actions = (params.rules ?? []).flatMap(rule => (params.events ?? []).some(event =>
          event.event_type === rule.when.event_type &&
          (!rule.when.channel_id || rule.when.channel_id === event.channel_id) &&
          (!rule.if?.selected_channel_id || rule.if.selected_channel_id === selectedId) &&
          (rule.if?.min_salience === undefined || (selected?.salience ?? -Infinity) >= rule.if.min_salience)
        ) ? [{ ...rule.then }] : []);
        return { selected_channel_id: selectedId, switched: selectedId !== params.current_channel_id, actions };
      }
    });
    scope.contributeFacet(expressionIntentDecoratorFacet, {
      decorate(intent, channel) {
        const canGaze = channel.capabilities.embodiment_surface?.supported_tokens.some(token =>
          token.kind === "nonverbal" && token.semanticAction === "gaze");
        return canGaze && intent.attentionTarget
          ? { ...intent, expressiveStance: { ...intent.expressiveStance, gaze_lead_ms: gazeLeadMs } }
          : intent;
      }
    });

  }
});
