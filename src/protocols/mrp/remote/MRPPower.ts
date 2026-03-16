/**
 * MRPPower - Power state management for Apple TV via MRP protocol
 *
 * Handles power state detection and device wake/sleep control.
 */

import { EventEmitter } from "eventemitter3";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import type { WakeDeviceMessage } from "@/protocols/mrp/generated/messages/device/WakeDeviceMessage.ts";
import type { DeviceInfoMessage } from "@/protocols/mrp/generated/messages/device/DeviceInfoMessage.ts";
import { createLogger } from "@/logging/logging.ts";
import { sleep } from "@/core/utils/timing";
import { DeviceState } from "@/protocols/types/DeviceState.ts";
import { InputAction } from "@/protocols/types/InputAction.ts";
const logger = createLogger("bunatv:mrp:power");

/** Delay between commands when turning off (ms) */
const DELAY_BETWEEN_COMMANDS = 500;

// ============================================================================
// Types
// ============================================================================

export { DeviceState } from "@/protocols/types/DeviceState.ts";

/**
 * Events emitted by MRPPower
 */
export type MRPPowerEvents = {
  /** Emitted when the power state changes */
  powerStateChanged: (oldState: DeviceState, newState: DeviceState) => void;
};

// ============================================================================
// MRPPower Class
// ============================================================================

/**
 * Power state interface for Apple TV via MRP protocol.
 *
 * Provides methods for:
 * - Querying current power state
 * - Turning device on (wake)
 * - Turning device off (sleep)
 * - Listening for power state changes
 *
 * @example
 * ```ts
 * const power = new MRPPower(protocol, remote);
 *
 * // Listen for power state changes
 * power.on("powerStateChanged", (oldState, newState) => {
 *   console.log(`Power changed from ${oldState} to ${newState}`);
 * });
 *
 * // Check current state
 * console.log("Power state:", power.powerState);
 *
 * // Control power
 * await power.turnOn();
 * await power.turnOff();
 *
 * // Wait for state to change
 * await power.turnOn({ awaitNewState: true });
 * ```
 */
export class MRPPower extends EventEmitter<MRPPowerEvents> {
  /** Cached device info for power state determination */
  private _deviceInfo: DeviceInfoMessage | undefined;

  /** Waiters for specific power states */
  private _waiters = new Map<
    DeviceState,
    { resolve: () => void; promise: Promise<void> }
  >();

  /** Reference to remote for turn off sequence */
  private _remote: MRPRemoteInterface | undefined;

  constructor(private readonly protocol: MRPProtocol) {
    super();
    this._setupListeners();
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Set the remote control interface for turn off functionality.
   *
   * This is required for `turnOff()` to work, as it needs to send
   * button presses (Home hold + Select) to trigger the sleep menu.
   *
   * @param remote - Remote control interface with pressHome and pressSelect methods
   */
  setRemote(remote: MRPRemoteInterface): void {
    this._remote = remote;
  }

  // ==========================================================================
  // State Accessors
  // ==========================================================================

  /**
   * Get the current power state of the device.
   */
  get powerState(): DeviceState {
    return this._getDeviceStateFromDeviceInfo(this._deviceInfo);
  }

  /**
   * Check if the device is currently on.
   */
  get isOn(): boolean {
    return this.powerState === DeviceState.Awake;
  }

  /**
   * Check if the device is currently off.
   */
  get isOff(): boolean {
    return this.powerState === DeviceState.Asleep;
  }

  // ==========================================================================
  // Event Listeners Setup
  // ==========================================================================

  private _setupListeners(): void {
    // Listen for DEVICE_INFO_MESSAGE
    this.protocol.on("message:DEVICE_INFO_MESSAGE", (message) => {
      const msg = message.innerMessage as DeviceInfoMessage;
      this._handleDeviceInfo(msg);
    });

    // Also listen for DEVICE_INFO_UPDATE_MESSAGE
    this.protocol.on("message:DEVICE_INFO_UPDATE_MESSAGE", (message) => {
      const msg = message.innerMessage as DeviceInfoMessage;
      this._handleDeviceInfo(msg);
    });
  }

  private _handleDeviceInfo(msg: DeviceInfoMessage): void {
    const oldState = this.powerState;
    this._deviceInfo = msg;
    const newState = this._getDeviceStateFromDeviceInfo(msg);

    logger.debug(
      {
        logicalDeviceCount: msg.logicalDeviceCount,
        oldState,
        newState,
      },
      "Received device info for power state"
    );

    if (newState !== oldState) {
      logger.info({ oldState, newState }, "Power state changed");
      this.emit("powerStateChanged", oldState, newState);
    }

    // Resolve any waiters for this state
    const waiter = this._waiters.get(newState);
    if (waiter) {
      waiter.resolve();
      this._waiters.delete(newState);
    }
  }

  private _getDeviceStateFromDeviceInfo(
    deviceInfo: DeviceInfoMessage | undefined
  ): DeviceState {
    if (!deviceInfo) {
      return DeviceState.Unknown;
    }

    const logicalDeviceCount = deviceInfo.logicalDeviceCount;

    if (logicalDeviceCount === undefined) {
      return DeviceState.Unknown;
    }

    if (logicalDeviceCount >= 1) {
      return DeviceState.Awake;
    }

    if (logicalDeviceCount === 0) {
      return DeviceState.Asleep;
    }

    return DeviceState.Unknown;
  }

  // ==========================================================================
  // Power Control
  // ==========================================================================

  /**
   * Turn on (wake) the Apple TV device.
   *
   * @param options - Options for the turn on operation
   * @param options.awaitNewState - If true, wait for the device to report it's on
   */
  async turnOn(options?: { awaitNewState?: boolean }): Promise<void> {
    logger.debug("Sending wake device message");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.WAKE_DEVICE_MESSAGE,
      message: {} satisfies WakeDeviceMessage,
    });

    if (options?.awaitNewState && this.powerState !== DeviceState.Awake) {
      await this._waitForState(DeviceState.Awake);
    }
  }

  /**
   * Turn off (sleep) the Apple TV device.
   *
   * This works by holding the Home button to open the control center,
   * then pressing Select to confirm sleep.
   *
   * @param options - Options for the turn off operation
   * @param options.awaitNewState - If true, wait for the device to report it's off
   * @throws Error if remote is not configured (call setRemote first)
   */
  async turnOff(options?: { awaitNewState?: boolean }): Promise<void> {
    if (!this._remote) {
      throw new Error(
        "Remote not configured. Call setRemote() before using turnOff()."
      );
    }

    logger.debug("Initiating turn off sequence (Home hold + Select)");

    // Hold Home button to open control center / sleep dialog
    await this._remote.pressHome(InputAction.Hold);

    // Wait for the UI to appear
    await sleep(DELAY_BETWEEN_COMMANDS);

    // Press Select to confirm sleep
    await this._remote.pressSelect();

    if (options?.awaitNewState && this.powerState !== DeviceState.Asleep) {
      await this._waitForState(DeviceState.Asleep);
    }
  }

  /**
   * Wake the device (alias for turnOn).
   */
  async wake(options?: { awaitNewState?: boolean }): Promise<void> {
    return this.turnOn(options);
  }

  /**
   * Put the device to sleep (alias for turnOff).
   */
  async sleep(options?: { awaitNewState?: boolean }): Promise<void> {
    return this.turnOff(options);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private _waitForState(state: DeviceState): Promise<void> {
    // Check if we already have a waiter for this state
    const existing = this._waiters.get(state);
    if (existing) {
      return existing.promise;
    }

    // Create a new waiter
    let resolve: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });

    this._waiters.set(state, { resolve: resolve!, promise });

    return promise;
  }
}

// ============================================================================
// Types for Remote Interface
// ============================================================================

/**
 * Interface for the remote control methods needed by MRPPower.
 * This avoids circular dependencies with MRPRemote.
 */
export interface MRPRemoteInterface {
  /** Press the Home button with the specified action */
  pressHome(action?: InputAction): Promise<void>;
  /** Press the Select button */
  pressSelect(action?: InputAction): Promise<void>;
}
