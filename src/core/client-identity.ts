/**
 * Client Device Identity for BunATV
 *
 * This module defines the client's identity that BunATV presents to Apple devices.
 * This identity is protocol-agnostic and can be used by any protocol that needs
 * to identify the BunATV client (Companion, AirPlay, etc.).
 *
 * The identity includes:
 * - Remote Pairing ID (rpId): Persistent identifier for pairing sessions
 * - Device ID: MAC address format identifier
 * - MAC Address: Network interface identifier (can differ from Device ID)
 * - Model: Apple device model identifier
 * - Name: Human-readable display name
 * - OS Information: Operating system name, version, and build
 * - Source Version: AirPlay protocol version
 *
 * This identity should be generated once and persisted in storage to ensure
 * consistent identification across all connections and protocols.
 */

/**
 * Client device identity information
 * Represents the BunATV client's identity presented to Apple devices
 */
export interface ClientDeviceInfo {
  /**
   * Remote Pairing ID - persistent identifier for pairing sessions
   * Format: MAC address format (e.g., "AB:CD:EF:12:34:56")
   * Used in Companion protocol's _systemInfo._i field
   */
  rpId: string;

  /**
   * Public Device ID - unique device identifier
   * Format: MAC address format (e.g., "AA:BB:CC:DD:EE:FF")
   * Used in Companion protocol's _systemInfo._pubID field
   * Used in AirPlay SETUP request's deviceID field
   * Apple TV uses this to track connections - same ID will disconnect older connections
   * Note: bunatv default is "62:75:6E:61:74:76" ("bunatv" in hex)
   */
  deviceId: string;

  /**
   * MAC Address - network interface identifier
   * Format: MAC address format (e.g., "02:70:79:61:74:76")
   * Used in AirPlay SETUP request's macAddress field
   * Note: bunatv default is "62:75:6E:61:74:76" ("bunatv" in hex)
   */
  mac: string;

  /**
   * Device Model - Apple model identifier
   * Examples: "iPhone10,6" (iPhone X), "iPad8,1" (iPad Pro), "MacBookPro15,1"
   * Used in Companion protocol's _systemInfo.model field
   * Used in AirPlay SETUP request's model field
   * Informs Apple TV what type of device is connecting (may affect UI/features)
   */
  model: string;

  /**
   * Device Display Name - human-readable name
   * Examples: "Pierre's iPhone", "Living Room iPad", "BunATV Remote"
   * Used in Companion protocol's _systemInfo.name field
   * Used in AirPlay SETUP request's name field
   * Shown in Apple TV's remote list
   */
  name: string;

  /**
   * Operating System Name - identifies the OS family
   * Examples: "iPhone OS", "macOS", "tvOS", "iPadOS"
   * Used in AirPlay SETUP request's osName field
   */
  osName: string;

  /**
   * Operating System Version - user-facing version string
   * Examples: "14.7.1", "17.0", "13.0"
   * Used in AirPlay SETUP request's osVersion field
   */
  osVersion: string;

  /**
   * Operating System Build - internal build identifier
   * Examples: "18G82", "21A5248v", "22A3354"
   * Used in AirPlay SETUP request's osBuildVersion field
   * Note: pyatv default is "18G82"
   */
  osBuild: string;

  /**
   * AirPlay Source Version - protocol version identifier
   * Examples: "550.10", "620.1.1"
   * Used in AirPlay SETUP request's sourceVersion field
   * Optional - pyatv hardcodes "550.10"
   */
  sourceVersion: string;

  /** Unique Identifier - UUID format identifier
   * Format: UUID string (e.g., "123E4567-E89B-12D3-A456-426614174000")
   * Used in MRP in the DeviceInfoMessage
   */
  uniqueIdentifier: string;
}

/**
 * Generate a new random client device identity
 *
 * This should only be called once during initial setup and the result should be
 * persisted in storage. Subsequent connections should reuse the saved identity.
 *
 * @param customName - Optional custom display name (defaults to "BunATV Remote")
 * @returns A new ClientDeviceInfo with randomly generated identifiers
 */
export function generateClientDeviceInfo(
  customName?: string
): ClientDeviceInfo {
  /**
   * Generate a random MAC address format string
   */

  return {
    rpId: "62:75:6E:61:74:76",
    deviceId: "62:75:6E:61:74:76",
    sourceVersion: "550.10",
    mac: "62:75:6E:61:74:76",
    osName: "iPhone OS",
    osVersion: "14.7.1",
    osBuild: "18G82",
    model: "iPhone10,6",
    name: customName || "BunATV Remote",
    uniqueIdentifier: Bun.randomUUIDv7(),
  };
}

/**
 * Validate that a ClientDeviceInfo object has all required fields
 *
 * @param info - The ClientDeviceInfo to validate
 * @returns true if valid, false otherwise
 */
export function isValidClientDeviceInfo(
  info: unknown
): info is ClientDeviceInfo {
  if (!info || typeof info !== "object") {
    return false;
  }

  const candidate = info as Partial<ClientDeviceInfo>;

  return (
    typeof candidate.rpId === "string" &&
    typeof candidate.deviceId === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.name === "string" &&
    candidate.rpId.length > 0 &&
    candidate.deviceId.length > 0 &&
    candidate.model.length > 0 &&
    candidate.name.length > 0
  );
}

export function generateClientId() {
  return crypto.randomUUID().toUpperCase();
}
