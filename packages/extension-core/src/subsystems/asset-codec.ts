import { defineFacetPoint } from "../kernel/facet-point.js";
import type { ExtensionHostView } from "./extension-host.js";

export interface AssetCodec {
  format: string;
  target: string;
  decode(asset: unknown): unknown | Promise<unknown>;
}
export const extensionAssetCodecFacet = defineFacetPoint<AssetCodec>({
  owner: "extension", name: "asset_codec", version: 1,
  parse(raw) {
    const codec = raw as AssetCodec | null;
    if (typeof codec?.format !== "string" || !codec.format || typeof codec.target !== "string" || !codec.target ||
      typeof codec.decode !== "function") throw new TypeError("Invalid extension.asset_codec");
    return codec;
  }
});

/** Select by source and destination formats. The target owner validates the decoded object before applying it. */
export async function decodeExtensionAsset(host: ExtensionHostView, format: string, target: string, asset: unknown, provider?: string) {
  const entries = host.listFacets(extensionAssetCodecFacet).filter(entry =>
    entry.implementation.format === format && entry.implementation.target === target && (!provider || entry.packageId === provider));
  if (entries.length !== 1 || !entries[0]) throw new Error(entries.length ? "AMBIGUOUS_ASSET_CODEC" : "ASSET_CODEC_UNAVAILABLE");
  const output = await host.invokeFacetAsync(entries[0], async codec => ({ value: await codec.decode(structuredClone(asset)) }));
  if (!output) throw new Error("ASSET_CODEC_UNAVAILABLE");
  return output.value;
}
