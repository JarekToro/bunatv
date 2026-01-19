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
 * - Model: Apple device model identifier
 * - Name: Human-readable display name
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
  rpId: string

  /**
   * Public Device ID - unique device identifier
   * Format: MAC address format (e.g., "AA:BB:CC:DD:EE:FF")
   * Used in Companion protocol's _systemInfo._pubID field
   * Apple TV uses this to track connections - same ID will disconnect older connections
   */
  deviceId: string

  /**
   * Device Model - Apple model identifier
   * Examples: "iPhone10,6" (iPhone X), "iPad8,1" (iPad Pro), "MacBookPro15,1"
   * Used in Companion protocol's _systemInfo.model field
   * Informs Apple TV what type of device is connecting (may affect UI/features)
   */
  model: string

  /**
   * Device Display Name - human-readable name
   * Examples: "Pierre's iPhone", "Living Room iPad", "BunATV Remote"
   * Used in Companion protocol's _systemInfo.name field
   * Shown in Apple TV's remote list
   */
  name: string
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
export function generateClientDeviceInfo(customName?: string): ClientDeviceInfo {
  /**
   * Generate a random MAC address format string
   */
  const generateMacAddress = (): string => {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':')
      .toUpperCase()
  }

  return {
    rpId: generateMacAddress(),
    deviceId: generateMacAddress(),
    model: 'iPhone10,6', // iPhone X - widely compatible with Apple TV
    name: customName || 'BunATV Remote',
  }
}

/**
 * Validate that a ClientDeviceInfo object has all required fields
 *
 * @param info - The ClientDeviceInfo to validate
 * @returns true if valid, false otherwise
 */
export function isValidClientDeviceInfo(info: unknown): info is ClientDeviceInfo {
  if (!info || typeof info !== 'object') {
    return false
  }

  const candidate = info as Partial<ClientDeviceInfo>

  return (
    typeof candidate.rpId === 'string' &&
    typeof candidate.deviceId === 'string' &&
    typeof candidate.model === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.rpId.length > 0 &&
    candidate.deviceId.length > 0 &&
    candidate.model.length > 0 &&
    candidate.name.length > 0
  )
}
