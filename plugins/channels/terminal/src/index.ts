import { Ai0ExtensionManifestSchema, type InteractionChannel } from "@ai0/protocol";
import { channelBridgeFacet, defineChannelPlugin, expressionRealizerFacet, perceptionIngressFacet } from "@ai0/sdk";
import manifestJson from "../ai0.extension.json" with { type: "json" };

export default defineChannelPlugin({
  manifest: Ai0ExtensionManifestSchema.parse(manifestJson),
  activate(scope) {
    const channel: InteractionChannel = {
      protocol_version: "0.1.0", channel_id: "builtin.terminal.default", channel_kind: "cli",
      display_name: "终端文字交互通道", venue_type: "private_1on1",
      current_audience: { scope: "only_owner", member_count: 1 }, latency_budget_ms: 1200,
      capabilities: { embodiment_surface: null, sensors: ["text"], supported_extensions: [], actuators: [] }
    };
    scope.contributeFacet(channelBridgeFacet, { channel_id: channel.channel_id, protocol_path: "/protocol/v0/channel" });
    scope.contributeFacet(perceptionIngressFacet, channel);
    scope.contributeFacet(expressionRealizerFacet, { channel });
  }
});
