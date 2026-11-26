import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import { consoleConfigSchemaFacet, defineExtensionPackage, perceptionFilterFacet, type SdkDebounceInputEvent } from "@ai0/sdk";

const hesitation = "[观察：对方刚才似乎想说什么（打字良久、欲言又止），但最终删掉了]";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);

export default defineExtensionPackage({
  manifest,
  activate(scope, config) {
    scope.contributeFacet(consoleConfigSchemaFacet, { fields: manifest.console_contributions?.config_fields ?? [] });
    const windowMs = Number(config.debounce_window_ms ?? 1200);
    const confidenceThreshold = Number(config.min_salience_confidence ?? 0.6);
    const pending = new Map<string, { event: SdkDebounceInputEvent; due: number }>();
    const ambient = new Map<string, number>();
    scope.onDispose(() => { pending.clear(); ambient.clear(); });
    scope.contributeFacet(perceptionFilterFacet, {
      onEvent(event, channelId, nowMs) {
        const frame = event.frame;
        const key = JSON.stringify([channelId, frame?.attribution.principalId, frame?.contextFrame.audienceScope]);
        if (event.lifecycle === "retract") {
          pending.delete(key);
          return config.enable_retract_hesitation !== false
            ? { kind: "observe", event: { ...event, text: hesitation } }
            : { kind: "suppress" };
        }
        if (event.lifecycle !== "commit") return { kind: "pass", event };
        if (frame && frame.channel.modality !== "text") {
          const raw = frame.interpretation.rawPayload as { confidence?: number } | null;
          if ((raw?.confidence ?? 1) >= confidenceThreshold) return { kind: "pass", event };
          const signature = JSON.stringify([key, frame.channel.modality, event.text]);
          const last = ambient.get(signature);
          ambient.delete(signature);
          ambient.set(signature, nowMs);
          if (ambient.size > 256) ambient.delete(ambient.keys().next().value!);
          return last !== undefined && nowMs - last <= 30_000 ? { kind: "suppress" } : { kind: "pass", event };
        }
        if (!windowMs || channelId === "builtin.terminal.default") return { kind: "pass", event };
        const previous = pending.get(key)?.event;
        const text = [previous?.text, event.text].filter(Boolean).join("\n");
        pending.set(key, { event: { ...event, text }, due: nowMs + windowMs });
        return { kind: "hold" };
      },
      flushDue(nowMs) {
        const due: SdkDebounceInputEvent[] = [];
        for (const [key, entry] of pending) {
          if (entry.due > nowMs) continue;
          pending.delete(key);
          due.push(entry.event);
        }
        return due;
      }
    });

  }
});
