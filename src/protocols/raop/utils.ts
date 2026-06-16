import { EncryptionType, MetadataType } from "./types.ts";

/**
 * Convert a linear volume percentage (0-100) to dBFS.
 * Returns -144 for silence (mute) and 0 for full volume.
 */
export function pctToDbfs(volume: number): number {
  if (volume <= 0) return -144;
  if (volume >= 100) return 0;
  return 20 * Math.log10(volume / 100);
}

/**
 * Parse the `et` TXT record field into an EncryptionType bitmask.
 * The field is a comma-separated list of numeric values (e.g. "0,1").
 */
export function parseEncryptionTypes(
  properties: Map<string, string>
): EncryptionType {
  const et = properties.get("et");
  if (!et) return EncryptionType.Unknown;

  let types = EncryptionType.Unknown;
  for (const t of et.split(",")) {
    const num = parseInt(t.trim(), 10);
    if (num === 0) types |= EncryptionType.Unencrypted;
    if (num === 1) types |= EncryptionType.MFiSAP;
  }
  return types;
}

/**
 * Parse the `md` TXT record field into a MetadataType bitmask.
 * The field is a comma-separated list of numeric values (e.g. "0,1,2").
 */
export function parseMetadataTypes(
  properties: Map<string, string>
): MetadataType {
  const md = properties.get("md");
  if (!md) return MetadataType.NotSupported;

  let types = MetadataType.NotSupported;
  for (const t of md.split(",")) {
    const num = parseInt(t.trim(), 10);
    if (num === 0) types |= MetadataType.Text;
    if (num === 1) types |= MetadataType.Artwork;
    if (num === 2) types |= MetadataType.Progress;
  }
  return types;
}

/**
 * Extract [sampleRate, channels, bytesPerChannel] from mDNS TXT properties.
 * Falls back to CD-quality defaults (44100, 2, 2) when fields are absent.
 */
export function parseAudioProperties(
  properties: Map<string, string>
): [sampleRate: number, channels: number, bytesPerChannel: number] {
  const sr = parseInt(properties.get("sr") ?? "44100", 10);
  const ch = parseInt(properties.get("ch") ?? "2", 10);
  const ss = parseInt(properties.get("ss") ?? "16", 10);
  return [sr, ch, ss / 8];
}
