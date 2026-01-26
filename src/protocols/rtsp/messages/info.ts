export interface InfoMessage {
  deviceID: string
  features: number
  featuresEx: string
  initialVolume: number
  macAddress: string
  model: string
  name: string
  pi: string
  pk: Uint8Array
  protocolVersion: string
  sourceVersion: string
  statusFlags: number
  volumeControlType: number
  vv: number
}
