// More common type for binary data in TypeScript/Bun
import {
  type CompanionCommand,
  type CompanionOpackMessage,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  createCompanionCommand,
  type PlistBuffer,
} from '@/protocols/companion/messages/CompanionOpackMessage.ts'
import { parse } from '@plist/plist'
import protobuf from 'protobufjs'

export interface SystemInfoResponse extends CompanionResponseOpackMessage {
  _i: '_systemInfo'
  _c: RawDeviceConfiguration
}

export interface SystemInfoRequest extends CompanionRequestOpackMessage {
  _i: '_systemInfo' // Request identifier (literal type)
  _c: SystemInfoRequestContent
  // _btHP?: boolean; // Bluetooth pairing flag
}

type RequiredSystemInfoFields = Pick<
  SystemInfoRequestContent,
  '_i' | '_idsID' | '_pubID' | 'model' | 'name'
>
type OptionalSystemInfoFields = Partial<
  Pick<SystemInfoRequestContent, '_siriInfo' | '_stA' | '_sigHKU' | '_sigRP' | '_hkUID' | '_dC'>
>
/**
 * Factory function for creating SystemInfo commands
 */
export function createSystemInfoCommand(
  info: RequiredSystemInfoFields & OptionalSystemInfoFields
): CompanionCommand<SystemInfoRequest, SystemInfoResponse, DeviceConfiguration> {
  return createCompanionCommand({
    identifier: '_systemInfo',
    name: `SystemInfo:${info.name}`,
    buildContent: () => ({
      _bf: 0,
      _cf: 512,
      _clFl: 128,
      _sf: 256,
      _sv: '170.18',
      ...info,
    }),
    parse: response => {
      return { ...response._c }
    },
  })
}

interface RawDeviceConfiguration {
  // Core required fields
  _i: string // Device Bluetooth address (rp_id)
  _pubID: string // Device/Bluetooth ID
  _idsID: string // IDS identifier
  _sv: string // Software/protocol version
  _stA: string[] // Supported service types
  model: string
  name: string

  // Optional state and capability fields
  _msSt?: number // Media state (1 = playing/active)
  _msRo?: number // Media role (3 = main device)
  _lP?: number // Listening port
  _sf?: number // Status flags
  _cf?: number // Capability flags
  _bf?: number // Boolean flags
  _clFl?: number // Client flags
  _dCapF?: number // Device capability flags

  // Optional identifiers
  _hkID?: string // HomeKit ID
  _hkUID?: string[] // HomeKit user IDs
  _idHKU?: string // HomeKit user identifier
  _spID?: string // Shared user ID
  _mrID?: string // Media remote ID
  _mRtID?: string // Media remote route ID
  _accID?: string // Account ID
  _accAltDSID?: string // Account alternative DSID
  _aaltDSID?: string // Alternative DSID
  _idsCID?: string // IDS connection ID

  // Optional metadata
  _osV?: string // OS version
  _roomName?: string // Room name (often not present)
  _dC?: string // Device class/category
  _sigHKU?: string // HomeKit user signature
  _sigRP?: string // Rapport signature

  // Optional Siri info
  _siriInfo?: RawSiriInfo
}

type DeviceConfiguration = RawDeviceConfiguration & {
  _siriInfo?: SiriInfo
}

interface RawSiriInfo {
  // Core fields
  collectorElectionVersion?: number
  isCollector?: boolean
  stationaryScore?: number

  // Binary plist data requiring separate decoding
  deviceCapabilitiesV2?: Buffer[]
  sharedDataProtoBuf?: Buffer

  // Structured data
  peerData?: PeerData
  deviceCapabilities?: {
    seymourEnabled?: number
    voiceTriggerEnabled?: number
  }

  'audio-session-coordination.system-info'?: AudioSessionInfo
}

type SiriInfo = RawSiriInfo & {
  deviceCapabilitiesV2?: any[]
}

interface PeerData {
  userAssignedDeviceName?: string
  assistantIdentifier?: string
  buildVersion?: string
  productType?: string
  aceVersion?: string
  userInterfaceIdiom?: string
  myriadTrialTreatment?: string
  isLocationSharingDevice?: boolean
  isSiriCloudSyncEnabled?: boolean
  homeAccessoryInfo?: HomeAccessoryInfo
}

interface HomeAccessoryInfo {
  name?: string
  roomName?: string
  uniqueIdentifier?: string
  loggingUniqueIdentifier?: string
  assistantIdentifier?: string
  manufacturer?: string
  model?: string
  categoryType?: string
  schemaCategoryType?: number
  isSpeaker?: boolean
  hasActiveThirdPartyMusicSubscription?: boolean
}

interface AudioSessionInfo {
  mediaRemoteGroupIdentifier?: string
  mediaRemoteRouteIdentifier?: string
  homeKitRoomName?: string
  isSupportedAndEnabled?: boolean
}

interface SystemInfoRequestContent {
  _i: string // Device Bluetooth address (rp_id)
  _idsID: string // Client/device IDS ID
  _pubID: string // Device/Bluetooth public ID
  _sv: string // Software version (e.g., "170.18" or "230.1")
  model: string // Device model (e.g., "iPhone10,6")
  name: string // Device name
  _bf: number // Boolean flags
  _cf: number // Capability flags
  _clFl: number // Client flags
  _sf: number // Status flags

  // Optional fields that may be included
  _siriInfo?: SiriInfo
  _stA?: string[] // Supported service types
  _sigHKU?: string
  _sigRP?: string
  _hkUID?: string[]
  _dC?: string
}
