import { createLogger } from '@/logging/logging.ts'
import {
  createFastForwardBeginCommand,
  createFastForwardEndCommand,
  createGetVolumeCommand,
  createNextTrackCommand,
  createPauseCommand,
  createPlayCommand,
  createPreviousTrackCommand,
  createRewindBeginCommand,
  createRewindEndCommand,
  createSetVolumeCommand,
  createSkipByCommand,
  MediaControl,
} from '@/protocols/companion/messages/mediaControl.ts'
import { InputAction } from '@/protocols/companion/messages/CompanionOpackMessage.ts'
import {
  createHidCommand,
  HidCommandModifier,
  HidCommandType,
} from '@/protocols/companion/messages/hidCommand.ts'
import {
  AttentionState,
  createFetchAttentionStateCommand,
} from '@/protocols/companion/messages/systemPower.ts'
import { sleep } from '@/core/utils/timing.ts'
import type { CompanionProtocol } from '@/protocols/companion/CompanionProtocol.ts'
import { EventEmitter } from 'eventemitter3'
import { CompanionEventTypes } from '@/protocols/companion/messages/interest.ts'
import { ProtocolState } from '../types/BaseProtocol'
import { createSystemInfoCommand } from './messages/systemInfo'
import type { ClientDeviceInfo } from '@/core/client-identity'
import { createTextInputStartCommand } from './messages/textInput'
import { createTouchStartCommand } from '@/protocols/companion/messages/touchSession.ts'
import type { SystemState } from '@/protocols/companion/messages/systemStatus.ts'

const logger = createLogger("bunatv:companion:api");

export interface CompanionState {
  // Volume control
  volume: number
  systemState: SystemState | null
  textInput: {
    documentText: string
    cursorPosition: number
    selectionLength: number
    isSecure: boolean
    keyboardType: number
    autoCorrection: boolean
    autoCapitalization: boolean
  } | null
  // Media controls
  mediaControls: MediaControl[]
  // Touch state (last touch event)
  lastTouch: {
    timestamp: number
    fingerId: number
    x: number
    y: number
    phase: number
    phaseName: string
  } | null
}

export interface CompanionApiEvents {
  'volume-change': (volume: number) => void
  'power-change': (state: AttentionState) => void
  'text-input-change': (isActive: boolean) => void
  'state-change': (state: CompanionState) => void
}

export class CompanionApi extends EventEmitter<CompanionApiEvents> {
  private _state: CompanionState = {
    volume: 0,
    systemState: null,
    lastTouch: null,
    mediaControls: [],
    textInput: null,
  }

  constructor(
    private readonly protocol: CompanionProtocol,
    private readonly device: ClientDeviceInfo
  ) {
    super()
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    if (this.protocol.isReady) {
      logger.debug('Protocol is ready, initializing')
      this.initialize()
    } else if (this.protocol.state === ProtocolState.Connecting) {
      logger.debug('Protocol is connecting, waiting for connected event')
      this.protocol.once('connected', () => {
        logger.debug('Protocol is ready, initializing')
        this.initialize()
      })
    } else {
      logger.debug('Protocol is not ready, connecting')
      this.protocol.connect()
    }

    this.protocol.on('media-control', data => {
      this.updateState({
        mediaControls: data.controls,
      })
    })

    this.protocol.on('system-status', data => {
      this.updateState({
        systemState: data.state,
      })
    })

    this.protocol.on('text-input-started', data => {
      this.updateState({
        textInput: {
          documentText: data.documentText,
          cursorPosition: data.cursorPosition,
          selectionLength: data.selectionLength,
          isSecure: data.isSecure,
          keyboardType: data.keyboardType,
          autoCorrection: data.autoCorrection,
          autoCapitalization: data.autoCapitalization,
        },
      })
    })

    this.protocol.on('text-input-stopped', () => {
      this.updateState({ textInput: null })
    })
  }

  private async initialize() {
    try {
      logger.debug('Initializing Companion API')
      await this.systemInfo()

      await this.protocol.sendCommand(createTouchStartCommand())
      await this.protocol.sendCommand(createTextInputStartCommand())
      await this.getVolume()

      // Subscribe to all events
      await this.protocol.subscribeToInterest([CompanionEventTypes.MediaControl])
      await this.protocol.subscribeToInterest([CompanionEventTypes.SystemStatus])
      await this.protocol.subscribeToInterest([CompanionEventTypes.TVSystemStatus])
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Companion API')
    }
  }

  private updateState(partial: Partial<CompanionState>) {
    this._state = { ...this._state, ...partial }
    this.emit('state-change', this._state)
  }

  get state(): CompanionState {
    return { ...this._state }
  }

  async systemInfo() {
    const clientId = this.protocol.getClientId()
    if (!clientId) {
      throw new Error('clientid is missing from protocol, has it authenticated?')
    }
    const resp = await this.protocol.sendCommand(
      createSystemInfoCommand({
        _i: this.device.rpId,
        _idsID: clientId,
        _pubID: this.device.deviceId,
        model: this.device.model,
        name: this.device.name,
      })
    )
    return resp
  }

  async getVolume(): Promise<number> {
    logger.debug('Getting volume level')
    const volume = await this.protocol.sendCommand(createGetVolumeCommand())
    this.updateState({ volume })
    logger.debug({ volume }, 'Volume retrieved')
    return volume
  }

  async setVolume(level: number): Promise<void> {
    logger.debug({ level }, 'Setting volume level')
    if (level < 0 || level > 1) {
      throw new Error('Volume level must be between 0.0 and 1.0')
    }
    await this.protocol.sendCommand(createSetVolumeCommand({ _vol: level }))
    logger.debug({ level }, 'Volume set successfully')
  }

  async toggleMute(): Promise<void> {
    logger.debug('Toggling mute')
    await this.pressButton(HidCommandType.PageUp, InputAction.Single)
    logger.debug('Mute toggled')
  }

  async pressButton(command: HidCommandType, action: InputAction, delay = 0.2): Promise<void> {
    logger.debug({ command, action, delay }, 'Pressing button')
    if (action === InputAction.Single) {
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Down))
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Up))
    } else if (action === InputAction.Hold) {
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Down))
      await sleep(delay * 1000)
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Up))
    } else if (action === InputAction.Double) {
      // First press
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Down))
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Up))
      // Second press
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Down))
      await this.protocol.sendCommand(createHidCommand(command, HidCommandModifier.Up))
    }
  }

  async getAttentionState(): Promise<AttentionState> {
    logger.debug('Getting system status')
    const status = await this.protocol.sendCommand(createFetchAttentionStateCommand())
    logger.debug({ status }, 'System status retrieved')
    return status
  }

  // Media Control Commands

  async play(): Promise<void> {
    logger.debug('Sending play command')
    await this.protocol.sendCommand(createPlayCommand())
    logger.debug('Play command sent')
  }

  async pause(): Promise<void> {
    logger.debug('Sending pause command')
    await this.protocol.sendCommand(createPauseCommand())
    logger.debug('Pause command sent')
  }

  async nextTrack(): Promise<void> {
    logger.debug('Sending next track command')
    await this.protocol.sendCommand(createNextTrackCommand())
    logger.debug('Next track command sent')
  }

  async previousTrack(): Promise<void> {
    logger.debug('Sending previous track command')
    await this.protocol.sendCommand(createPreviousTrackCommand())
    logger.debug('Previous track command sent')
  }

  async skipBy(seconds: number): Promise<void> {
    logger.debug({ seconds }, 'Sending skip by command')
    await this.protocol.sendCommand(createSkipByCommand({ _skpS: seconds }))
    logger.debug({ seconds }, 'Skip by command sent')
  }

  async fastForwardBegin(): Promise<void> {
    logger.debug('Starting fast forward')
    await this.protocol.sendCommand(createFastForwardBeginCommand())
    logger.debug('Fast forward started')
  }

  async fastForwardEnd(): Promise<void> {
    logger.debug('Ending fast forward')
    await this.protocol.sendCommand(createFastForwardEndCommand())
    logger.debug('Fast forward ended')
  }

  async rewindBegin(): Promise<void> {
    logger.debug('Starting rewind')
    await this.protocol.sendCommand(createRewindBeginCommand())
    logger.debug('Rewind started')
  }

  async rewindEnd(): Promise<void> {
    logger.debug('Ending rewind')
    await this.protocol.sendCommand(createRewindEndCommand())
    logger.debug('Rewind ended')
  }

  async disconnect(): Promise<void> {
    logger.info('Disposing CompanionApi resources')
    await this.protocol.disconnect('CompanionApi disposed')
  }
}
