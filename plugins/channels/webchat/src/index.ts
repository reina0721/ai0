export {
  WebChatProtocolClient,
  type BargeInResult,
  type CommitPerceptionInput,
  type WebChatBargeInSignal,
  type WebChatInterruptionReceipt,
  type WebChatOutboundFrame,
  type WebChatProtocolClientOptions,
  type WebChatProtocolTransport
} from "./client/webchat-protocol-client.js";
export {
  WEBCHAT_STAGE_ROUTE,
  createWebChatStageViewModel,
  type UnsaidRemainderBadge,
  type WebChatCuePill,
  type WebChatQuickSensor,
  type WebChatStageViewModel,
  type WebChatStageViewProps,
  type WebChatTranscriptBubble
} from "./ui/WebChatStageView.js";

import { channelBridgeFacet, consoleSurfaceFacet, defineChannelPlugin, expressionRealizerFacet, perceptionIngressFacet } from "@ai0/sdk";
import manifestJson from "../ai0.extension.json" with { type: "json" };
import { Ai0ExtensionManifestSchema } from "@ai0/protocol";
import { WebChatProtocolClient } from "./client/webchat-protocol-client.js";

const manifest = Ai0ExtensionManifestSchema.parse(manifestJson);
export const webChatChannelExtension = defineChannelPlugin({
  manifest,
  activate(scope) {
    const { auth_token, ...channel } = new WebChatProtocolClient({ send() {} }).buildHandshakeManifest();
    scope.contributeFacet(channelBridgeFacet, { channel_id: channel.channel_id, protocol_path: "/protocol/v0/channel" });
    scope.contributeFacet(perceptionIngressFacet, channel);
    scope.contributeFacet(expressionRealizerFacet, { channel });
    scope.contributeFacet(consoleSurfaceFacet, { pages: manifest.console_contributions?.pages ?? [] });
  }
});
export default webChatChannelExtension;
