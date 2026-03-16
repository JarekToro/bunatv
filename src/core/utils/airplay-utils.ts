import type {
  AirPlayService,
  AppleDevice,
  BaseServiceInstance,
  RAOPService,
} from "@/core/discovery/discovery-types.ts";

// ============================================================================
// Constants
// ============================================================================

const PIN_REQUIRED = 0x8;
const PASSWORD_BIT = 0x80;
const LEGACY_PAIRING_BIT = 0x200;

const UNSUPPORTED_MODELS = [/^Mac\d+,\d+$/];

export enum CredentialType {
  HAP = "HAP",
  Transient = "transient",
  None = "none",
}
// ============================================================================
// AirPlay Feature Flags (BigInt - values exceed 32 bits)
// ============================================================================

export const AirPlayFlags = {
  SupportsAirPlayVideoV1: 1n << 0n,
  SupportsAirPlayPhoto: 1n << 1n,
  SupportsAirPlaySlideShow: 1n << 5n,
  SupportsAirPlayScreen: 1n << 7n,
  SupportsAirPlayAudio: 1n << 9n,
  AudioRedundant: 1n << 11n,
  Authentication_4: 1n << 14n,
  MetadataFeatures_0: 1n << 15n,
  MetadataFeatures_1: 1n << 16n,
  MetadataFeatures_2: 1n << 17n,
  AudioFormats_0: 1n << 18n,
  AudioFormats_1: 1n << 19n,
  AudioFormats_2: 1n << 20n,
  AudioFormats_3: 1n << 21n,
  Authentication_1: 1n << 23n,
  Authentication_8: 1n << 26n,
  SupportsLegacyPairing: 1n << 27n,
  HasUnifiedAdvertiserInfo: 1n << 30n,
  IsCarPlay: 1n << 32n,
  SupportsAirPlayVideoPlayQueue: 1n << 33n,
  SupportsAirPlayFromCloud: 1n << 34n,
  SupportsTLS_PSK: 1n << 35n,
  SupportsUnifiedMediaControl: 1n << 38n,
  SupportsBufferedAudio: 1n << 40n,
  SupportsPTP: 1n << 41n,
  SupportsScreenMultiCodec: 1n << 42n,
  SupportsSystemPairing: 1n << 43n,
  IsAPValeriaScreenSender: 1n << 44n,
  SupportsHKPairingAndAccessControl: 1n << 46n,
  SupportsCoreUtilsPairingAndEncryption: 1n << 48n,
  SupportsAirPlayVideoV2: 1n << 49n,
  MetadataFeatures_3: 1n << 50n,
  SupportsUnifiedPairSetupAndMFi: 1n << 51n,
  SupportsSetPeersExtendedMessage: 1n << 52n,
  SupportsAPSync: 1n << 54n,
  SupportsWoL: 1n << 55n,
  SupportsWoL2: 1n << 56n,
  SupportsHangdogRemoteControl: 1n << 58n,
  SupportsAudioStreamConnectionSetup: 1n << 59n,
  SupportsAudioMetadataControl: 1n << 60n,
  SupportsRFC2198Redundancy: 1n << 61n,
} as const;

export type AirPlayFlagKey = keyof typeof AirPlayFlags;

// ============================================================================
// Enums
// ============================================================================

export enum AirPlayMajorVersion {
  AirPlayV1 = "AirPlayV1",
  AirPlayV2 = "AirPlayV2",
}

export enum AirPlayVersionPreference {
  Auto = "Auto",
  V1 = "V1",
  V2 = "V2",
}

export enum PairingRequirement {
  NotNeeded = "NotNeeded",
  Mandatory = "Mandatory",
  Disabled = "Disabled",
  Unsupported = "Unsupported",
}

// ============================================================================
// Feature Parsing
// ============================================================================

/**
 * Parse an AirPlay feature string into a BigInt bitmask.
 *
 * Formats:
 *  - "0x12345678"
 *  - "0x12345678,0xABCDEF12" => 0xABCDEF1212345678
 */
export function parseFeatures(features: string): bigint {
  const match = features.match(
    /^0x([0-9A-Fa-f]{1,8})(?:,0x([0-9A-Fa-f]{1,8}))?$/
  );
  if (!match) {
    throw new Error(`Invalid feature string: ${features}`);
  }

  const [, lower, upper] = match;
  const hex = upper ? upper + lower : lower;
  return BigInt(`0x${hex}`);
}

/** Check if a specific flag is set in a parsed feature bitmask. */
export function hasAirPlayFeatureFlag(
  features: bigint,
  flag: (typeof AirPlayFlags)[keyof typeof AirPlayFlags]
): boolean {
  return (features & flag) !== 0n;
}

/** Return all matching flag names for a parsed feature bitmask. */
export function describeFlags(features: bigint): AirPlayFlagKey[] {
  return (Object.entries(AirPlayFlags) as [AirPlayFlagKey, bigint][])
    .filter(([, value]) => hasAirPlayFeatureFlag(features, value))
    .map(([key]) => key);
}

// ============================================================================
// Service Property Helpers
// ============================================================================

type TxtRecord = Record<string, string | undefined>;

function getFlags(txt: TxtRecord): number {
  const raw = txt.sf ?? txt.flags ?? "0x0";
  return parseInt(raw, 16);
}

/**
 * Get the feature string from either AirPlay or RAOP TXT records.
 * AirPlay uses "features", RAOP uses "ft".
 */
function getFeatureString(txt: TxtRecord): string {
  return txt.ft ?? txt.features ?? "0x0";
}

// ============================================================================
// Device Query Utils
// ============================================================================

/** Check if password is required by an AirPlay/RAOP service. */
export function isPasswordRequired(txt: TxtRecord): boolean {
  if (txt.pw?.toLowerCase() === "true") return true;
  if (getFlags(txt) & PASSWORD_BIT) return true;
  return false;
}

/** Determine the pairing requirement from service TXT records. */
export function getPairingRequirement(txt: TxtRecord): PairingRequirement {
  if (getFlags(txt) & (LEGACY_PAIRING_BIT | PIN_REQUIRED)) {
    return PairingRequirement.Mandatory;
  }
  if (txt.act === "2") {
    return PairingRequirement.Unsupported;
  }
  return PairingRequirement.NotNeeded;
}

/** Detect AirPlay major version from feature flags. */
export function getProtocolVersion(
  txt: TxtRecord,
  preferred: AirPlayVersionPreference = AirPlayVersionPreference.Auto
): AirPlayMajorVersion {
  if (preferred === AirPlayVersionPreference.V2)
    return AirPlayMajorVersion.AirPlayV2;
  if (preferred === AirPlayVersionPreference.V1)
    return AirPlayMajorVersion.AirPlayV1;

  const features = parseFeatures(getFeatureString(txt));
  if (
    hasAirPlayFeatureFlag(features, AirPlayFlags.SupportsUnifiedMediaControl) ||
    hasAirPlayFeatureFlag(
      features,
      AirPlayFlags.SupportsCoreUtilsPairingAndEncryption
    )
  ) {
    return AirPlayMajorVersion.AirPlayV2;
  }
  return AirPlayMajorVersion.AirPlayV1;
}

/** Check if a device supports remote control tunneling over AirPlay. */
export function isRemoteControlSupported(
  service: AirPlayService | RAOPService
): boolean {
  const credentialType = getCredentialType(service);
  const txt = service.txt;
  const model = txt.model ?? txt.am ?? "";

  if (model.startsWith("AudioAccessory")) {
    return credentialType === "transient";
  }

  if (!model.startsWith("AppleTV")) return false;

  const osVersionStr = txt.osvers ?? txt.ov ?? "0.0";
  const version = parseFloat(osVersionStr);
  return version >= 13.0 && credentialType === "HAP";
}

export function getCredentialType(
  service: AirPlayService | RAOPService
): CredentialType {
  return CredentialType.HAP;
}

// def extract_credentials(service: BaseService) -> HapCredentials:
//   121    """Extract credentials from service based on what's supported."""
// 122    if service.credentials is not None:
//   123        return parse_credentials(service.credentials)
// 124
// 125    flags = parse_features(
//   126        service.properties.get("features", service.properties.get("ft", "0x0"))
// 127    )
// 128    if (
//   129        AirPlayFlags.SupportsSystemPairing in flags
// 130        or AirPlayFlags.SupportsCoreUtilsPairingAndEncryption in flags
// 131    ):
// 132        return TRANSIENT_CREDENTIALS
// 133
// 134    return NO_CREDENTIALS
