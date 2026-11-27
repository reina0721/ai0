import type { AudienceScope, BodyAnchorDescriptor, HandshakeManifest } from "@ai0/protocol";

export class EmbodimentAffordanceRegistry {
  private readonly channels = new Map<string, { manifest: HandshakeManifest; anchors: BodyAnchorDescriptor[] }>();

  mount(manifest: HandshakeManifest, cardAnchors: readonly BodyAnchorDescriptor[] = []) {
    const capabilities = manifest.capabilities;
    const anchors = new Map<string, BodyAnchorDescriptor>();
    for (const id of capabilities.embodiment_anchors ?? []) anchors.set(id, { id });
    for (const anchor of capabilities.supports_card_assets ? cardAnchors : []) anchors.set(anchor.id, anchor);
    for (const anchor of capabilities.body_anchors ?? []) anchors.set(anchor.id, anchor);
    this.channels.set(manifest.channel_id, structuredClone({ manifest, anchors: [...anchors.values()] }));
  }

  unmount(channelId: string) { this.channels.delete(channelId); }
  disconnect(channelId: string) { this.unmount(channelId); }

  coverage(channelId: string, modality: string, sourceKey?: string) {
    const capabilities = this.channels.get(channelId)?.manifest.capabilities;
    if (!capabilities) return "disconnected" as const;
    if (!capabilities.sensors.includes(modality)) return "blind" as const;
    return capabilities.sensor_affordances?.find(sensor => sensor.modality === modality
      && (sourceKey === undefined || sourceKey === sensor.source_key))?.coverage ?? "unknown";
  }

  connectedChannels(audience?: AudienceScope) {
    return structuredClone([...this.channels.values()].filter(({ manifest }) =>
      audience === undefined || manifest.current_audience.scope === audience));
  }
}
