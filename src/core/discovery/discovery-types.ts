// ============================================================================
// Apple Service Types
// ============================================================================

/**
 * Apple mDNS service types commonly used by Apple TV and other Apple devices
 */
export const APPLE_SERVICE_TYPES = {
  AIRPLAY: "_airplay._tcp.local",
  RAOP: "_raop._tcp.local", // Remote Audio Output Protocol
  COMPANION_LINK: "_companion-link._tcp.local",
  DEVICE_INFO: "_device-info._tcp.local",
  HOMEKIT: "_hap._tcp.local",
} as const;

export type AppleServiceType =
  (typeof APPLE_SERVICE_TYPES)[keyof typeof APPLE_SERVICE_TYPES];

export type AppleServiceTypeMap = {
  [APPLE_SERVICE_TYPES.AIRPLAY]: AirPlayService;
  [APPLE_SERVICE_TYPES.RAOP]: RAOPService;
  [APPLE_SERVICE_TYPES.COMPANION_LINK]: CompanionLinkService;
  [APPLE_SERVICE_TYPES.DEVICE_INFO]: DeviceInfoService;
  [APPLE_SERVICE_TYPES.HOMEKIT]: undefined;
};

// ============================================================================
// Device Info (_device-info._tcp.local)
// ============================================================================

/**
 * Device information metadata
 */
export interface DeviceInfoMetadata extends Record<string, string | undefined> {
  /** Apple model identifier (e.g., "J305AP" for Apple TV 4K, "Mac14,9" for MacBook) */
  model: string;
  /** macOS version (e.g., "25" for macOS 15.x) - only on Macs */
  osxvers?: string;
  /** Icon color code - only on Macs */
  icolor?: string;
}

export const isDeviceInfoMetadata = (arg: any): arg is DeviceInfoMetadata => {
  return true;
};

// ============================================================================
// AirPlay (_airplay._tcp.local)
// ============================================================================

/**
 * AirPlay service metadata from TXT record
 */
export interface AirPlayMetadata extends Record<string, string | undefined> {
  /** Access control level (usually "0" or "2") */
  acl?: string;
  /** Activity level */
  act?: string;
  /** Bluetooth address (MAC format: XX:XX:XX:XX:XX:XX) */
  btaddr?: string;
  /** Device ID (MAC format) */
  deviceid: string;
  /** Feature exchange token (base64) */
  fex?: string;
  /** Feature flags (hex format: "0x4A7FDFD5,0x3C175FDE") */
  features: string;
  /** Status flags (hex format: "0x18644") */
  flags: string;
  /** Group ID (UUID or compound UUID) */
  gid?: string;
  /** iGLU flag */
  igl?: string;
  /** GC GL flag */
  gcgl?: string;
  /** Model identifier (e.g., "AppleTV11,1", "AudioAccessory5,1") */
  model: string;
  /** Protocol version (e.g., "1.1") */
  protovers: string;
  /** Public instance ID (UUID) */
  pi: string;
  /** Private service instance ID (UUID) */
  psi: string;
  /** Public key (hex string) */
  pk: string;
  /** Source version (e.g., "890.79.2") */
  srcvers: string;
  /** OS version (e.g., "26.0.1" for tvOS 18.0.1, "18.6" for HomePod) */
  osvers: string;
  /** Video codec version */
  vv: string;
  /** Firmware version (non-Apple devices) */
  fv?: string;
  /** Receiver session flags (non-Apple devices) */
  rsf?: string;
  /** Audio type (non-Apple devices) */
  at?: string;
  /** Company name (non-Apple devices, e.g., "LG Electronics") */
  company?: string;
  /** Manufacturer (non-Apple devices) */
  manufacturer?: string;
  /** Serial number (non-Apple devices) */
  serialNumber?: string;
  /** Configuration seed (non-Apple devices) */
  "protovers-seed"?: string;
}

export const isAirPlayMetadata = (arg: any): arg is AirPlayMetadata => {
  return (
    "features" in arg &&
    "flags" in arg &&
    "deviceid" in arg &&
    "model" in arg &&
    "osvers" in arg
  );
};

// ============================================================================
// RAOP - Remote Audio Output Protocol (_raop._tcp.local)
// ============================================================================

/**
 * RAOP (Remote Audio Output Protocol) metadata from TXT record
 * Used for audio streaming to AirPlay devices
 */
export interface RAOPMetadata extends Record<string, string | undefined> {
  /** Channels (e.g., "0,1,2,3") */
  cn: string;
  /** Device announcement (usually "true") */
  da: string;
  /** Encryption types (e.g., "0,3,5") */
  et: string;
  /** Feature flags (hex format) */
  ft: string;
  /** Status flags (hex format) */
  sf: string;
  /** Metadata support (e.g., "0,1,2") */
  md: string;
  /** Apple model (e.g., "AppleTV11,1", "AudioAccessory5,1") */
  am: string;
  /** Public key (hex string) */
  pk: string;
  /** Transport protocol (usually "UDP") */
  tp: string;
  /** Version number */
  vn: string;
  /** Version string (e.g., "890.79.2") */
  vs: string;
  /** OS version (e.g., "26.0.1") */
  ov: string;
  /** Video version */
  vv: string;
}

export const isRAOPMetadata = (arg: any): arg is RAOPMetadata => {
  return "ft" in arg;
};

// ============================================================================
// Companion Link (_companion-link._tcp.local)
// ============================================================================

/**
 * Companion Link metadata from TXT record
 * Used for Apple Continuity features and Companion protocol pairing
 */
export interface CompanionLinkMetadata
  extends Record<string, string | undefined> {
  /** Mac version - Used when publishing Companion services */
  rpMac?: string;
  /** Discovery Nonce - Changes periodically for privacy reasons (hex) */
  rpHN?: string;
  /** Status flags/supported features (hex) - Indicates pairing requirements (e.g., 0x36782 = mandatory pairing) */
  rpFl?: string;
  /** HomeKit AuthTag - Rotates periodically for security (hex) */
  rpHA?: string;
  /** Device model name - Identifies specific device model (e.g., "AppleTV11,1" for Apple TV 4K 2nd gen) */
  rpMd?: string;
  /** Protocol version - The Companion Link protocol version supported */
  rpVr?: string;
  /** Bonjour Auth Tag - Rotates periodically for security (hex) */
  rpAD?: string;
  /** HomeKit rotating ID - Changes periodically for privacy (hex) */
  rpHI?: string;
  /** Bluetooth Address - Can rotate for privacy reasons (MAC format) */
  rpBA?: string;
  /** Media Remote Route Identifier - Used for mediaRemoteRouteIdentifier in Companion protocol (UUID) */
  rpMRtID?: string;
}

export const isCompanionLinkMetadata = (
  arg: any
): arg is CompanionLinkMetadata => {
  return true;
};

// ============================================================================
// Service Instance Types
// ============================================================================

/**
 * Base service instance with common propertieisCompanionLinkMetadatas
 */
export interface BaseServiceInstance<
  TMetadata = Record<string, string | undefined>,
> {
  instanceName: string;
  serviceType: string;
  hostname: string;
  port: number;
  txt: TMetadata;
  expiresAt: number;
}

/**
 * AirPlay service instance
 */
export interface AirPlayService extends BaseServiceInstance<AirPlayMetadata> {
  serviceType: typeof APPLE_SERVICE_TYPES.AIRPLAY;
  features: bigint;
}

/**
 * RAOP service instance
 */
export interface RAOPService extends BaseServiceInstance<RAOPMetadata> {
  serviceType: typeof APPLE_SERVICE_TYPES.RAOP;
  features: bigint;
}

/**
 * Companion Link service instance
 */
export interface CompanionLinkService
  extends BaseServiceInstance<CompanionLinkMetadata> {
  serviceType: typeof APPLE_SERVICE_TYPES.COMPANION_LINK;
}

/**
 * Device Info service instance
 */
export interface DeviceInfoService
  extends BaseServiceInstance<DeviceInfoMetadata> {
  serviceType: typeof APPLE_SERVICE_TYPES.DEVICE_INFO;
}

/**
 * Union type for all Apple service instances
 */
export type AppleServiceInstance =
  | AirPlayService
  | RAOPService
  | CompanionLinkService
  | DeviceInfoService;

// ============================================================================
// Apple Device Types
// ============================================================================

/**
 * Common fields shared by all Apple device types.
 * Used as the base for concrete device interfaces and StoredDevice.
 */
export interface BaseAppleDevice {
  /** Display name (e.g., "Apple TV 4K", "Living Room") */
  name: string;
  /** Unique device identifier (Device ID from AirPlay TXT record) */
  identifier: string;
  /** Main address (first IPv4 or IPv6) */
  address: string;
  /** Hostname (e.g., "Apple-TV-4K.local") */
  hostname: string;
  /** IPv4 addresses */
  ipv4: string[];
  /** IPv6 addresses */
  ipv6: string[];
  /** Device model (e.g., "J305AP", "B520AP") */
  model: string;
  /** Last seen timestamp (epoch ms) */
  lastSeen: number;
}

/**
 * Apple TV device with all associated services
 */
export interface AppleTVDevice extends BaseAppleDevice {
  services: {
    airPlay?: AirPlayService;
    raop?: RAOPService;
    companionLink?: CompanionLinkService;
    deviceInfo?: DeviceInfoService;
  };
}

/**
 * HomePod device
 */
export interface HomePodDevice extends BaseAppleDevice {
  services: {
    airPlay?: AirPlayService;
    raop?: RAOPService;
    companionLink?: CompanionLinkService;
  };
}

/**
 * Mac device
 */
export interface MacDevice extends BaseAppleDevice {
  osxVersion?: string;
  services: {
    airPlay?: AirPlayService;
    raop?: RAOPService;
    companionLink?: CompanionLinkService;
    deviceInfo?: DeviceInfoService;
  };
}

/**
 * Union type for all Apple devices
 */
export type AppleDevice = AppleTVDevice | HomePodDevice | MacDevice;

// ============================================================================
// Model Identifiers
// ============================================================================

/**
 * Known Apple TV model identifiers
 */
export const APPLE_TV_MODELS = {
  // Apple TV 4K (3rd generation)
  J305AP: "Apple TV 4K (3rd gen)",
  // Apple TV 4K (2nd generation)
  J255AP: "Apple TV 4K (2nd gen)",
  // Apple TV 4K (1st generation)
  J105aAP: "Apple TV 4K (1st gen)",
  // Apple TV HD
  J42dAP: "Apple TV HD",
  // Internal model names
  "AppleTV11,1": "Apple TV 4K (2nd gen)",
  "AppleTV6,2": "Apple TV 4K (1st gen)",
  "AppleTV5,3": "Apple TV HD",
} as const;

/**
 * Known HomePod model identifiers
 */
export const HOMEPOD_MODELS = {
  "AudioAccessory1,1": "HomePod",
  "AudioAccessory1,2": "HomePod",
  "AudioAccessory5,1": "HomePod mini",
  "AudioAccessory6,1": "HomePod (2nd gen)",
  B520AP: "HomePod mini",
} as const;

/**
 * Type guard to check if a model is an Apple TV
 */
export function isAppleTVModel(model: string): boolean {
  return (
    model in APPLE_TV_MODELS ||
    model.startsWith("AppleTV") ||
    model.endsWith("AP")
  );
}

/**
 * Type guard to check if a model is a HomePod
 */
export function isHomePodModel(model: string): boolean {
  return (
    model in HOMEPOD_MODELS ||
    model.startsWith("AudioAccessory") ||
    model === "B520AP"
  );
}

/**
 * Get friendly device name from model identifier
 */
export function getFriendlyDeviceName(model: string): string {
  return (
    APPLE_TV_MODELS[model as keyof typeof APPLE_TV_MODELS] ||
    HOMEPOD_MODELS[model as keyof typeof HOMEPOD_MODELS] ||
    model
  );
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for AirPlay service
 */
export function isAirPlayService(
  service: BaseServiceInstance
): service is AirPlayService {
  return service.serviceType === APPLE_SERVICE_TYPES.AIRPLAY;
}

/**
 * Type guard for RAOP service
 */
export function isRAOPService(
  service: BaseServiceInstance
): service is RAOPService {
  return service.serviceType === APPLE_SERVICE_TYPES.RAOP;
}

/**
 * Type guard for Companion Link service
 */
export function isCompanionLinkService(
  service: BaseServiceInstance
): service is CompanionLinkService {
  return service.serviceType === APPLE_SERVICE_TYPES.COMPANION_LINK;
}

/**
 * Type guard for Device Info service
 */
export function isDeviceInfoService(
  service: BaseServiceInstance
): service is DeviceInfoService {
  return service.serviceType === APPLE_SERVICE_TYPES.DEVICE_INFO;
}
