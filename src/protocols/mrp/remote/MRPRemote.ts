/**
 * MRPRemote - High-level remote control facade for Apple TV via MRP protocol
 *
 * This is the main entry point for controlling an Apple TV. It provides:
 * - Direct button/navigation methods
 * - Access to specialized controllers via properties (playback, audio, touch)
 * - Low-level HID event methods
 * - Device power control
 */

import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import type { SendButtonEventMessage } from "@/protocols/mrp/generated/messages/input/SendButtonEventMessage.ts";
import type { SendHIDEventMessage } from "@/protocols/mrp/generated/messages/input/SendHIDEventMessage.ts";
import type { SendHIDReportMessage } from "@/protocols/mrp/generated/messages/input/SendHIDReportMessage.ts";
import type { WakeDeviceMessage } from "@/protocols/mrp/generated/messages/device/WakeDeviceMessage.ts";
import { createLogger } from "@/logging/logging.ts";

import { MRPPlayback } from "./MRPPlayback";
import { MRPAudio } from "./MRPAudio";
import { MRPTouch } from "./MRPTouch";
import { MRPPower } from "./MRPPower";
import {
  UsagePage,
  GenericDesktopUsage,
  ConsumerUsage,
  InputAction,
  type ButtonEvent,
} from "./hid-constants";
import { sleep } from "@/core/utils/timing";

const logger = createLogger("bunatv:mrp:remote");

// Re-export for convenience
export { InputAction, UsagePage, GenericDesktopUsage, ConsumerUsage };
export type { ButtonEvent };

// ============================================================================
// MRPRemote Class
// ============================================================================

/**
 * High-level remote control interface for Apple TV via MRP protocol.
 *
 * This class serves as the main facade for controlling an Apple TV.
 * It provides direct access to navigation/media buttons and exposes
 * specialized controllers for playback, audio, and touch input.
 *
 * @example
 * ```ts
 * const remote = new MRPRemote(protocol);
 *
 * // Navigation buttons
 * await remote.pressMenu();
 * await remote.pressSelect();
 * await remote.pressUp();
 *
 * // Playback control
 * await remote.playback.play();
 * await remote.playback.nextTrack();
 * await remote.playback.seekTo(120);
 *
 * // Audio control
 * remote.audio.setVolumePercent(deviceUID, 50);
 * remote.audio.addOutputDevices("speaker-1", "speaker-2");
 *
 * // Touch/gestures
 * await remote.touch.tap();
 * await remote.touch.swipeRight();
 *
 * // Power control
 * await remote.power.turnOn();
 * await remote.power.turnOff();
 * console.log("Power state:", remote.power.powerState);
 * ```
 */
export class MRPRemote {
  /** Playback control (play, pause, skip, seek, etc.) */
  readonly playback: MRPPlayback;

  /** Audio control (volume, output devices) */
  readonly audio: MRPAudio;

  /** Touch and gesture control */
  readonly touch: MRPTouch;

  /** Power state and control */
  readonly power: MRPPower;

  /** Default duration for button press/release in milliseconds */
  private readonly defaultButtonPressDuration = 50;

  /** Default duration for hold/long press in milliseconds */
  private readonly holdDuration = 1000;

  constructor(private readonly protocol: MRPProtocol) {
    this.playback = new MRPPlayback(protocol);
    this.audio = new MRPAudio(protocol);
    this.touch = new MRPTouch(protocol);
    this.power = new MRPPower(protocol);

    // Wire up power controller with remote reference for turnOff
    this.power.setRemote(this);
  }

  // ==========================================================================
  // Button Events
  // ==========================================================================

  /**
   * Send a raw button event (press or release).
   */
  sendButtonEvent(event: ButtonEvent): void {
    logger.debug(
      {
        usagePage: event.usagePage,
        usage: event.usage,
        down: event.buttonDown,
      },
      "Sending button event"
    );

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SEND_BUTTON_EVENT_MESSAGE,
      message: {
        usagePage: event.usagePage,
        usage: event.usage,
        buttonDown: event.buttonDown,
      } satisfies SendButtonEventMessage,
    });
  }

  /**
   * Press and release a button with a small delay between.
   */
  async pressButton(
    usagePage: number,
    usage: number,
    duration: number = this.defaultButtonPressDuration
  ): Promise<void> {
    this.sendButtonEvent({ usagePage, usage, buttonDown: true });
    await sleep(duration);
    this.sendButtonEvent({ usagePage, usage, buttonDown: false });
  }

  /**
   * Perform a button action with support for SingleTap, DoubleTap, and Hold.
   *
   * @param usagePage - USB HID usage page
   * @param usage - USB HID usage code
   * @param action - Input action type (SingleTap, DoubleTap, Hold)
   */
  async performAction(
    usagePage: number,
    usage: number,
    action: InputAction
  ): Promise<void> {
    switch (action) {
      case InputAction.SingleTap:
        await this.pressButton(usagePage, usage);
        break;
      case InputAction.DoubleTap:
        await this.pressButton(usagePage, usage);
        await sleep(this.defaultButtonPressDuration);
        await this.pressButton(usagePage, usage);
        break;
      case InputAction.Hold:
        this.sendButtonEvent({ usagePage, usage, buttonDown: true });
        await sleep(this.holdDuration);
        this.sendButtonEvent({ usagePage, usage, buttonDown: false });
        break;
    }
  }

  // ── Navigation Buttons ─────────────────────────────────────────────────────

  /** Press the Select/OK button */
  async pressSelect(
    action: InputAction = InputAction.SingleTap
  ): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Select,
      action
    );
  }

  /** Press the Menu/Back button */
  async pressMenu(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Menu,
      action
    );
  }

  /** Press the Home button */
  async pressHome(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(UsagePage.Consumer, ConsumerUsage.Home, action);
  }

  /** Long press Home button (for control center) */
  async pressHomeHold(): Promise<void> {
    await this.performAction(
      UsagePage.Consumer,
      ConsumerUsage.Home,
      InputAction.Hold
    );
  }

  /** Press the Top Menu / TV button */
  async pressTopMenu(): Promise<void> {
    await this.performAction(
      UsagePage.Consumer,
      ConsumerUsage.TopMenu,
      InputAction.SingleTap
    );
  }

  /** Press the Up navigation button */
  async pressUp(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Up,
      action
    );
  }

  /** Press the Down navigation button */
  async pressDown(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Down,
      action
    );
  }

  /** Press the Left navigation button */
  async pressLeft(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Left,
      action
    );
  }

  /** Press the Right navigation button */
  async pressRight(action: InputAction = InputAction.SingleTap): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Right,
      action
    );
  }

  /** Suspend/Sleep the device via HID button */
  async pressSuspend(): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Suspend,
      InputAction.SingleTap
    );
  }

  /** Wake up the device via HID button */
  async pressWakeup(): Promise<void> {
    await this.performAction(
      UsagePage.GenericDesktop,
      GenericDesktopUsage.Wakeup,
      InputAction.SingleTap
    );
  }

  // ── Media Buttons ──────────────────────────────────────────────────────────

  /** Toggle play/pause via button */
  async pressPlayPause(): Promise<void> {
    await this.pressButton(UsagePage.Consumer, ConsumerUsage.PlayPause);
  }

  /** Toggle mute */
  async pressMute(): Promise<void> {
    await this.pressButton(UsagePage.Consumer, ConsumerUsage.Mute);
  }

  /** Press volume up */
  async pressVolumeUp(): Promise<void> {
    await this.pressButton(UsagePage.Consumer, ConsumerUsage.VolumeUp);
  }

  /** Press volume down */
  async pressVolumeDown(): Promise<void> {
    await this.pressButton(UsagePage.Consumer, ConsumerUsage.VolumeDown);
  }

  // ==========================================================================
  // HID Events (Low-level)
  // ==========================================================================

  /**
   * Send a raw HID event with keyboard data.
   *
   * The hidEventData corresponds to a "keyboardEvent" in IOHIDEvent.h encoded as raw data.
   *
   * @see https://opensource.apple.com/source/IOHIDFamily/IOHIDFamily-308/IOHIDFamily/IOHIDEvent.h.auto.html
   */
  sendHIDEvent(hidEventData: Buffer): void {
    logger.debug({ dataLength: hidEventData.length }, "Sending HID event");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SEND_HID_EVENT_MESSAGE,
      message: {
        hidEventData,
      } satisfies SendHIDEventMessage,
    });
  }

  /**
   * Build and send a HID keyboard event.
   *
   * @param usagePage - USB HID usage page
   * @param usage - USB HID usage code
   * @param down - Whether the key is pressed
   */
  sendHIDKeyboardEvent(usagePage: number, usage: number, down: boolean): void {
    // Build HID event data according to Apple's IOHIDEvent format
    // Magic prefix + timestamp (8 bytes) + event data
    const magicPrefix = Buffer.from(
      "438922cf08020000000000000000000001000000000000000200000020000000030000000100000000000000",
      "hex"
    );

    // Key data: usagePage (2 bytes BE) + usage (2 bytes BE) + down (2 bytes BE)
    const keyData = Buffer.alloc(6);
    keyData.writeUInt16BE(usagePage, 0);
    keyData.writeUInt16BE(usage, 2);
    keyData.writeUInt16BE(down ? 1 : 0, 4);

    const suffix = Buffer.from("0000000000000001000000", "hex");

    const hidEventData = Buffer.concat([magicPrefix, keyData, suffix]);
    this.sendHIDEvent(hidEventData);
  }

  /**
   * Send a raw HID report to a virtual device.
   */
  sendHIDReport(virtualDeviceID: string, report: Buffer): void {
    logger.debug(
      { virtualDeviceID, reportLength: report.length },
      "Sending HID report"
    );

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SEND_HID_REPORT_MESSAGE,
      message: {
        virtualDeviceID,
        report,
      } satisfies SendHIDReportMessage,
    });
  }

  // ==========================================================================
  // Device Control
  // ==========================================================================

  /**
   * Wake the Apple TV device from sleep.
   */
  wakeDevice(): void {
    logger.debug("Sending wake device message");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.WAKE_DEVICE_MESSAGE,
      message: {} satisfies WakeDeviceMessage,
    });
  }
}
