/**
 * MRPAudio - Volume and output device control for Apple TV via MRP protocol
 *
 * Handles volume control and AirPlay speaker group management.
 * Also maintains internal state of available output devices.
 */

import { EventEmitter } from "eventemitter3";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import type { SetVolumeMessage } from "@/protocols/mrp/generated/messages/audio/SetVolumeMessage.ts";
import type { SetVolumeMutedMessage } from "@/protocols/mrp/generated/messages/audio/SetVolumeMutedMessage.ts";
import type { GetVolumeMessage } from "@/protocols/mrp/generated/messages/audio/GetVolumeMessage.ts";
import type { GetVolumeMutedMessage } from "@/protocols/mrp/generated/messages/audio/GetVolumeMutedMessage.ts";
import type { VolumeControlAvailabilityMessage } from "@/protocols/mrp/generated/messages/audio/VolumeControlAvailabilityMessage.ts";
import type { VolumeControlCapabilitiesDidChangeMessage } from "@/protocols/mrp/generated/messages/audio/VolumeControlCapabilitiesDidChangeMessage.ts";
import type { SendButtonEventMessage } from "@/protocols/mrp/generated/messages/input/SendButtonEventMessage.ts";
import {
  type ModifyOutputContextRequestMessage,
  ModifyOutputContextRequestMessage_Type,
} from "@/protocols/mrp/generated/messages/device/ModifyOutputContextRequestMessage.ts";
import type { AVOutputDeviceDescriptor } from "@/protocols/mrp/generated/types/device/AVOutputDeviceDescriptor.ts";
import type { UpdateOutputDeviceMessage } from "@/protocols/mrp/generated/messages/device/UpdateOutputDeviceMessage.ts";
import type { DeviceInfoMessage } from "@/protocols/mrp/generated/messages/device/DeviceInfoMessage.ts";
import { createLogger } from "@/logging/logging.ts";
import { UsagePage, ConsumerUsage } from "./hid-constants";
import { sleep } from "@/core/utils/timing";

const logger = createLogger("bunatv:mrp:audio");

// ============================================================================
// Types
// ============================================================================

/**
 * Volume control capabilities bitmask values
 */
export const VolumeCapabilities = {
  /** No volume control */
  None: 0x0,
  /** Mute control available */
  Mute: 0x1,
  /** Relative volume control (increment/decrement) */
  Relative: 0x2,
  /** Absolute volume control (direct set) */
  Absolute: 0x4,
  /** Route/device-level adjustment */
  Adjustment: 0x8,
} as const;

/**
 * Global volume control state
 */
export interface VolumeControlState {
  /** Whether volume control is available globally */
  isAvailable: boolean;
  /** Raw capabilities bitmask */
  capabilities: number;
  /** Whether mute control is available */
  canMute: boolean;
  /** Whether relative volume control is available */
  canRelative: boolean;
  /** Whether absolute volume control is available */
  canAbsolute: boolean;
}

/**
 * Simplified output device information
 */
export interface OutputDevice {
  /** Unique identifier for the device */
  uid: string;
  /** Display name of the device */
  name: string;
  /** Whether this device is the local/main device */
  isLocal: boolean;
  /** Whether this is the group leader */
  isGroupLeader: boolean;
  /** Current volume level (0.0 to 1.0) */
  volume?: number;
  /** Whether volume is muted */
  isMuted?: boolean;
  /** Whether volume control is available */
  isVolumeControlAvailable?: boolean;
  /** Volume capabilities bitmask for this device */
  volumeCapabilities?: number;
  /** Device model ID */
  modelId?: string;
  /** Device type */
  deviceType?: string;
}

/**
 * Events emitted by MRPAudio
 */
export type MRPAudioEvents = {
  /** Emitted when the list of output devices changes */
  outputDevicesChanged: (devices: OutputDevice[]) => void;
  /** Emitted when the active/current device changes */
  activeDeviceChanged: (device: OutputDevice | undefined) => void;
  /** Emitted when volume changes on a device */
  volumeChanged: (deviceUid: string, volume: number) => void;
  /** Emitted when global volume control availability changes */
  volumeControlChanged: (state: VolumeControlState) => void;
  /** Emitted when volume capabilities change for a specific device */
  deviceVolumeCapabilitiesChanged: (
    deviceUid: string,
    capabilities: number
  ) => void;
};

// ============================================================================
// MRPAudio Class
// ============================================================================

/**
 * Audio control interface for Apple TV via MRP protocol.
 *
 * Provides methods for:
 * - Volume control (absolute level setting)
 * - AirPlay speaker group management (add/remove/set devices)
 * - Output device state tracking
 *
 * @example
 * ```ts
 * const audio = new MRPAudio(protocol);
 *
 * // Listen for device changes
 * audio.on("outputDevicesChanged", (devices) => {
 *   console.log("Available devices:", devices);
 * });
 *
 * // Get current devices
 * const devices = audio.outputDevices;
 * const activeDevice = audio.activeDevice;
 *
 * // Volume control
 * audio.setVolume(deviceUID, 0.5); // 50% volume
 * audio.setVolumePercent(deviceUID, 75); // 75% volume
 *
 * // Speaker groups
 * audio.addOutputDevices("device-uid-1", "device-uid-2");
 * audio.removeOutputDevices("device-uid-1");
 * audio.setOutputDevices("device-uid-3"); // Replace all
 * ```
 */
export class MRPAudio extends EventEmitter<MRPAudioEvents> {
  /** Map of device UID to output device info */
  private _outputDevices = new Map<string, OutputDevice>();

  /** UID of the active/current device (from DEVICE_INFO_MESSAGE) */
  private _activeDeviceUid: string | undefined;

  /** Device UID from DEVICE_INFO_MESSAGE (our connected device) */
  private _connectedDeviceUid: string | undefined;

  /** Cluster ID from DEVICE_INFO_MESSAGE */
  private _clusterID: string | undefined;

  /** Global volume control state */
  private _volumeControlState: VolumeControlState = {
    isAvailable: false,
    capabilities: 0,
    canMute: false,
    canRelative: false,
    canAbsolute: false,
  };

  constructor(private readonly protocol: MRPProtocol) {
    super();
    this._setupListeners();
  }

  // ==========================================================================
  // State Accessors
  // ==========================================================================

  /**
   * Get all available output devices.
   */
  get outputDevices(): OutputDevice[] {
    return Array.from(this._outputDevices.values());
  }

  /**
   * Get the active/current output device.
   */
  get activeDevice(): OutputDevice | undefined {
    if (this._activeDeviceUid) {
      return this._outputDevices.get(this._activeDeviceUid);
    }
    // Fall back to connected device
    if (this._connectedDeviceUid) {
      return this._outputDevices.get(this._connectedDeviceUid);
    }
    return undefined;
  }

  /**
   * Get the UID of the connected device (our Apple TV).
   */
  get connectedDeviceUid(): string | undefined {
    return this._connectedDeviceUid;
  }

  /**
   * Get the cluster ID (for grouped devices).
   */
  get clusterID(): string | undefined {
    return this._clusterID;
  }

  /**
   * Get a device by UID.
   */
  getDevice(uid: string): OutputDevice | undefined {
    return this._outputDevices.get(uid);
  }

  /**
   * Get the global volume control state.
   */
  get volumeControlState(): VolumeControlState {
    return { ...this._volumeControlState };
  }

  /**
   * Check if volume control is available.
   */
  get isVolumeControlAvailable(): boolean {
    return this._volumeControlState.isAvailable;
  }

  /**
   * Check if absolute volume control (direct set) is available.
   */
  get canSetAbsoluteVolume(): boolean {
    return this._volumeControlState.canAbsolute;
  }

  /**
   * Check if relative volume control (increment/decrement) is available.
   */
  get canSetRelativeVolume(): boolean {
    return this._volumeControlState.canRelative;
  }

  /**
   * Check if mute control is available.
   */
  get canMute(): boolean {
    return this._volumeControlState.canMute;
  }

  // ==========================================================================
  // Event Listeners Setup
  // ==========================================================================

  private _setupListeners(): void {
    // Listen for UPDATE_OUTPUT_DEVICE_MESSAGE
    this.protocol.on("message:UPDATE_OUTPUT_DEVICE_MESSAGE", (message) => {
      const msg = message.innerMessage as UpdateOutputDeviceMessage;
      this._handleUpdateOutputDevice(msg);
    });

    // Listen for DEVICE_INFO_MESSAGE
    this.protocol.on("message:DEVICE_INFO_MESSAGE", (message) => {
      const msg = message.innerMessage as DeviceInfoMessage;
      this._handleDeviceInfo(msg);
    });

    // Also listen for DEVICE_INFO_UPDATE_MESSAGE if it exists
    this.protocol.on("message:DEVICE_INFO_UPDATE_MESSAGE", (message) => {
      const msg = message.innerMessage as DeviceInfoMessage;
      this._handleDeviceInfo(msg);
    });

    // Listen for VOLUME_CONTROL_AVAILABILITY_MESSAGE
    this.protocol.on(
      "message:VOLUME_CONTROL_AVAILABILITY_MESSAGE",
      (message) => {
        const msg = message.innerMessage as VolumeControlAvailabilityMessage;
        this._handleVolumeControlAvailability(msg);
      }
    );

    // Listen for VOLUME_CONTROL_CAPABILITIES_DID_CHANGE_MESSAGE
    this.protocol.on(
      "message:VOLUME_CONTROL_CAPABILITIES_DID_CHANGE_MESSAGE",
      (message) => {
        const msg =
          message.innerMessage as VolumeControlCapabilitiesDidChangeMessage;
        this._handleVolumeControlCapabilitiesChanged(msg);
      }
    );
  }

  private _handleUpdateOutputDevice(msg: UpdateOutputDeviceMessage): void {
    logger.debug(
      {
        deviceCount: msg.outputDevices.length,
        clusterAwareCount: msg.clusterAwareOutputDevices.length,
      },
      "Received UPDATE_OUTPUT_DEVICE_MESSAGE"
    );

    // Process output devices
    const devices =
      msg.clusterAwareOutputDevices.length > 0
        ? msg.clusterAwareOutputDevices
        : msg.outputDevices;

    for (const descriptor of devices) {
      this._updateDeviceFromDescriptor(descriptor);
    }

    this.emit("outputDevicesChanged", this.outputDevices);
  }

  private _handleDeviceInfo(msg: DeviceInfoMessage): void {
    logger.debug(
      {
        deviceUID: msg.deviceUID,
        uniqueIdentifier: msg.uniqueIdentifier,
        name: msg.name,
        isGroupLeader: msg.isGroupLeader,
        groupedDevicesCount: msg.groupedDevices?.length ?? 0,
      },
      "Received DEVICE_INFO_MESSAGE"
    );

    // Store the connected device UID
    this._connectedDeviceUid = msg.deviceUID ?? msg.uniqueIdentifier;
    this._clusterID = msg.clusterID;

    // Add the main device
    if (msg.uniqueIdentifier || msg.deviceUID) {
      const uid = msg.deviceUID ?? msg.uniqueIdentifier!;
      const device: OutputDevice = {
        uid,
        name: msg.name ?? "Apple TV",
        isLocal: true,
        isGroupLeader: msg.isGroupLeader ?? false,
        modelId: msg.modelID,
      };

      const existing = this._outputDevices.get(uid);
      if (existing) {
        // Merge with existing data
        this._outputDevices.set(uid, { ...existing, ...device });
      } else {
        this._outputDevices.set(uid, device);
      }
    }

    // Add grouped devices
    if (msg.groupedDevices && msg.groupedDevices.length > 0) {
      for (const grouped of msg.groupedDevices) {
        const uid = grouped.deviceUID ?? grouped.uniqueIdentifier;
        if (!uid) continue;

        const device: OutputDevice = {
          uid,
          name: grouped.name ?? "Unknown Device",
          isLocal: false,
          isGroupLeader: grouped.isGroupLeader ?? false,
          modelId: grouped.modelID,
        };

        const existing = this._outputDevices.get(uid);
        if (existing) {
          this._outputDevices.set(uid, { ...existing, ...device });
        } else {
          this._outputDevices.set(uid, device);
        }
      }
    }

    // Update active device
    const previousActive = this._activeDeviceUid;
    this._activeDeviceUid = this._connectedDeviceUid;

    if (previousActive !== this._activeDeviceUid) {
      this.emit("activeDeviceChanged", this.activeDevice);
    }

    this.emit("outputDevicesChanged", this.outputDevices);
  }

  private _updateDeviceFromDescriptor(
    descriptor: AVOutputDeviceDescriptor
  ): void {
    const uid = descriptor.uniqueIdentifier;
    if (!uid) return;

    const device: OutputDevice = {
      uid,
      name: descriptor.name ?? "Unknown Device",
      isLocal: descriptor.isLocalDevice ?? false,
      isGroupLeader: descriptor.isGroupLeader ?? false,
      volume: descriptor.volume,
      isMuted: descriptor.volumeMuted,
      isVolumeControlAvailable: descriptor.isVolumeControlAvailable,
      modelId: descriptor.modelID,
    };

    const existing = this._outputDevices.get(uid);
    if (existing) {
      // Check if volume changed
      if (existing.volume !== device.volume && device.volume !== undefined) {
        this.emit("volumeChanged", uid, device.volume);
      }
      this._outputDevices.set(uid, { ...existing, ...device });
    } else {
      this._outputDevices.set(uid, device);
    }
  }

  private _handleVolumeControlAvailability(
    msg: VolumeControlAvailabilityMessage
  ): void {
    logger.debug(
      {
        available: msg.volumeControlAvailable,
        capabilities: msg.volumeCapabilities,
      },
      "Received VOLUME_CONTROL_AVAILABILITY_MESSAGE"
    );

    this._updateVolumeControlState(
      msg.volumeControlAvailable ?? false,
      msg.volumeCapabilities ?? 0
    );
  }

  private _handleVolumeControlCapabilitiesChanged(
    msg: VolumeControlCapabilitiesDidChangeMessage
  ): void {
    const deviceUid = msg.outputDeviceUID;
    const capabilities = msg.capabilities;

    logger.debug(
      {
        deviceUid,
        endpointUID: msg.endpointUID,
        available: capabilities?.volumeControlAvailable,
        capabilities: capabilities?.volumeCapabilities,
      },
      "Received VOLUME_CONTROL_CAPABILITIES_DID_CHANGE_MESSAGE"
    );

    // Update global state if this is for our connected device
    if (
      deviceUid === this._connectedDeviceUid ||
      deviceUid === this._clusterID
    ) {
      this._updateVolumeControlState(
        capabilities?.volumeControlAvailable ??
          this._volumeControlState.isAvailable,
        capabilities?.volumeCapabilities ??
          this._volumeControlState.capabilities
      );
    }

    // Update device-specific capabilities
    if (deviceUid && capabilities) {
      const device = this._outputDevices.get(deviceUid);
      if (device) {
        const prevCapabilities = device.volumeCapabilities;
        device.isVolumeControlAvailable = capabilities.volumeControlAvailable;
        device.volumeCapabilities = capabilities.volumeCapabilities;
        this._outputDevices.set(deviceUid, device);

        if (prevCapabilities !== capabilities.volumeCapabilities) {
          this.emit(
            "deviceVolumeCapabilitiesChanged",
            deviceUid,
            capabilities.volumeCapabilities ?? 0
          );
        }
      }
    }
  }

  private _updateVolumeControlState(
    isAvailable: boolean,
    capabilities: number
  ): void {
    const newState: VolumeControlState = {
      isAvailable,
      capabilities,
      canMute: (capabilities & VolumeCapabilities.Mute) !== 0,
      canRelative: (capabilities & VolumeCapabilities.Relative) !== 0,
      canAbsolute: (capabilities & VolumeCapabilities.Absolute) !== 0,
    };

    const changed =
      this._volumeControlState.isAvailable !== newState.isAvailable ||
      this._volumeControlState.capabilities !== newState.capabilities;

    this._volumeControlState = newState;

    if (changed) {
      logger.debug(
        {
          isAvailable: newState.isAvailable,
          canMute: newState.canMute,
          canRelative: newState.canRelative,
          canAbsolute: newState.canAbsolute,
        },
        "Volume control state changed"
      );
      this.emit("volumeControlChanged", newState);
    }
  }

  // ==========================================================================
  // Volume Control
  // ==========================================================================

  /**
   * Set volume on a specific output device.
   *
   * @param deviceUID - The output device UID (e.g., from device info)
   * @param volume - Volume level from 0.0 to 1.0
   */
  setVolume(deviceUID: string, volume: number): void {
    logger.debug({ deviceUID, volume }, "Setting volume");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SET_VOLUME_MESSAGE,
      message: {
        outputDeviceUID: deviceUID,
        volume: Math.max(0, Math.min(1, volume)),
      } satisfies SetVolumeMessage,
    });
  }

  /**
   * Set volume as a percentage (0-100).
   *
   * @param deviceUID - The output device UID
   * @param percent - Volume percentage from 0 to 100
   */
  setVolumePercent(deviceUID: string, percent: number): void {
    this.setVolume(deviceUID, percent / 100);
  }

  /**
   * Query the current volume of an output device (request/response).
   *
   * @param deviceUID - The output device UID. Defaults to the active/connected
   *   device when omitted.
   * @returns The volume level from 0.0 to 1.0, or `undefined` if the device did
   *   not report one.
   */
  async getVolume(deviceUID?: string): Promise<number | undefined> {
    const uid = deviceUID ?? this._activeDeviceUid ?? this._connectedDeviceUid;
    logger.debug({ deviceUID: uid }, "Querying volume");

    const response = await this.protocol.sendAndReceive({
      extensionType: ProtocolMessage_Type.GET_VOLUME_MESSAGE,
      message: { outputDeviceUID: uid } satisfies GetVolumeMessage,
    });

    if (
      response?.extensionType === ProtocolMessage_Type.GET_VOLUME_RESULT_MESSAGE
    ) {
      return response.innerMessage.volume;
    }
    return undefined;
  }

  /**
   * Query the current mute state of an output device (request/response).
   *
   * @param deviceUID - The output device UID. Defaults to the active/connected
   *   device when omitted.
   * @returns Whether the device is muted, or `undefined` if it did not report.
   */
  async getVolumeMuted(deviceUID?: string): Promise<boolean | undefined> {
    const uid = deviceUID ?? this._activeDeviceUid ?? this._connectedDeviceUid;
    logger.debug({ deviceUID: uid }, "Querying mute state");

    const response = await this.protocol.sendAndReceive({
      extensionType: ProtocolMessage_Type.GET_VOLUME_MUTED_MESSAGE,
      message: { outputDeviceUID: uid } satisfies GetVolumeMutedMessage,
    });

    if (
      response?.extensionType ===
      ProtocolMessage_Type.GET_VOLUME_MUTED_RESULT_MESSAGE
    ) {
      return response.innerMessage.isMuted;
    }
    return undefined;
  }

  // ==========================================================================
  // Mute Control
  // ==========================================================================

  /**
   * Set mute state using the SET_VOLUME_MUTED_MESSAGE.
   * This is the preferred method when absolute volume control is available.
   *
   * @param deviceUID - The output device UID
   * @param muted - Whether to mute (true) or unmute (false)
   */
  setMuted(deviceUID: string, muted: boolean): void {
    logger.debug({ deviceUID, muted }, "Setting muted state via message");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SET_VOLUME_MUTED_MESSAGE,
      message: {
        outputDeviceUID: deviceUID,
        isMuted: muted,
      } satisfies SetVolumeMutedMessage,
    });
  }

  /**
   * Toggle mute using the HID mute button (press and release).
   * This sends a single mute button press which toggles the current mute state.
   */
  async toggleMuteHID(): Promise<void> {
    logger.debug("Toggling mute via HID button");

    // Press mute button
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.Mute, true);
    await sleep(50);
    // Release mute button
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.Mute, false);
  }

  /**
   * Force mute ON by holding the mute button down.
   * This keeps the mute button pressed without releasing.
   * Call `muteOffForced()` to release and restore audio.
   */
  muteOnForced(): void {
    logger.debug("Forcing mute ON (button down)");
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.Mute, true);
  }

  /**
   * Force mute OFF by releasing the mute button and sending volume adjustments.
   * This releases any held mute button, then sends volume up/down to ensure
   * the audio system is in an unmuted state.
   */
  async muteOffForced(): Promise<void> {
    logger.debug("Forcing mute OFF (button up + volume adjustment)");

    // Release mute button
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.Mute, false);
    await sleep(50);

    // Send volume up press/release
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.VolumeUp, true);
    await sleep(50);
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.VolumeUp, false);
    await sleep(50);

    // Send volume down press/release to restore original volume
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.VolumeDown, true);
    await sleep(50);
    this._sendButtonEvent(UsagePage.Consumer, ConsumerUsage.VolumeDown, false);
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private _sendButtonEvent(
    usagePage: number,
    usage: number,
    buttonDown: boolean
  ): void {
    this.protocol.send({
      extensionType: ProtocolMessage_Type.SEND_BUTTON_EVENT_MESSAGE,
      message: {
        usagePage,
        usage,
        buttonDown,
      } satisfies SendButtonEventMessage,
    });
  }

  // ==========================================================================
  // Output Device Management (AirPlay Speaker Groups)
  // ==========================================================================

  /**
   * Add AirPlay devices to the speaker group.
   *
   * @param deviceUIDs - Device UIDs to add
   */
  addOutputDevices(...deviceUIDs: string[]): void {
    logger.debug({ deviceUIDs }, "Adding output devices");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.MODIFY_OUTPUT_CONTEXT_REQUEST_MESSAGE,
      message: {
        type: ModifyOutputContextRequestMessage_Type.SharedAudioPresentation,
        addingDevices: deviceUIDs,
        clusterAwareAddingDevices: deviceUIDs,
        removingDevices: [],
        settingDevices: [],
        clusterAwareRemovingDevices: [],
        clusterAwareSettingDevices: [],
      } satisfies ModifyOutputContextRequestMessage,
    });
  }

  /**
   * Remove AirPlay devices from the speaker group.
   *
   * @param deviceUIDs - Device UIDs to remove
   */
  removeOutputDevices(...deviceUIDs: string[]): void {
    logger.debug({ deviceUIDs }, "Removing output devices");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.MODIFY_OUTPUT_CONTEXT_REQUEST_MESSAGE,
      message: {
        type: ModifyOutputContextRequestMessage_Type.SharedAudioPresentation,
        addingDevices: [],
        removingDevices: deviceUIDs,
        clusterAwareRemovingDevices: deviceUIDs,
        settingDevices: [],
        clusterAwareAddingDevices: [],
        clusterAwareSettingDevices: [],
      } satisfies ModifyOutputContextRequestMessage,
    });
  }

  /**
   * Set specific AirPlay devices as the speaker group (replaces current group).
   *
   * @param deviceUIDs - Device UIDs to set as the output group
   */
  setOutputDevices(...deviceUIDs: string[]): void {
    logger.debug({ deviceUIDs }, "Setting output devices");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.MODIFY_OUTPUT_CONTEXT_REQUEST_MESSAGE,
      message: {
        type: ModifyOutputContextRequestMessage_Type.SharedAudioPresentation,
        addingDevices: [],
        removingDevices: [],
        settingDevices: deviceUIDs,
        clusterAwareSettingDevices: deviceUIDs,
        clusterAwareAddingDevices: [],
        clusterAwareRemovingDevices: [],
      } satisfies ModifyOutputContextRequestMessage,
    });
  }
}
