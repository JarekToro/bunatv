/**
 * USB HID Constants for Apple TV Remote Control
 * @see https://github.com/Daij-Djan/DDHidLib/blob/master/usb_hid_usages.txt
 */

// ============================================================================
// HID Usage Pages
// ============================================================================

/**
 * USB HID Usage Page constants
 */
export const UsagePage = {
  /** Generic Desktop (keyboard, pointer, etc.) */
  GenericDesktop: 0x01,
  /** Consumer Devices (media controls, etc.) */
  Consumer: 0x0c,
} as const;

export type UsagePageType = (typeof UsagePage)[keyof typeof UsagePage];

// ============================================================================
// Generic Desktop Usage Codes (0x01)
// ============================================================================

/**
 * USB HID Usage codes for Generic Desktop page (0x01)
 * These map to navigation buttons on the Apple TV remote
 */
export const GenericDesktopUsage = {
  /** Select/OK button */
  Select: 0x89,
  /** Menu/Back button */
  Menu: 0x86,
  /** Left navigation */
  Left: 0x8b,
  /** Right navigation */
  Right: 0x8a,
  /** Up navigation */
  Up: 0x8c,
  /** Down navigation */
  Down: 0x8d,
  /** Suspend/Sleep button */
  Suspend: 0x82,
  /** Wakeup button */
  Wakeup: 0x83,
} as const;

export type GenericDesktopUsageType =
  (typeof GenericDesktopUsage)[keyof typeof GenericDesktopUsage];

// ============================================================================
// Consumer Usage Codes (0x0C)
// ============================================================================

/**
 * USB HID Usage codes for Consumer page (0x0C) - Media Controls
 */
export const ConsumerUsage = {
  /** Play/Pause toggle */
  PlayPause: 0xcd,
  /** Volume Mute toggle */
  Mute: 0xe2,
  /** Volume Increment (Volume Up) */
  VolumeUp: 0xe9,
  /** Volume Decrement (Volume Down) */
  VolumeDown: 0xea,
  /** Top Menu (TV button) */
  TopMenu: 0x60,
  /** Home button */
  Home: 0x40,
  /** Stop playback */
  Stop: 0xb7,
  /** Next track */
  Next: 0xb5,
  /** Previous track */
  Previous: 0xb6,
} as const;

export type ConsumerUsageType =
  (typeof ConsumerUsage)[keyof typeof ConsumerUsage];

// ============================================================================
// Input Action Types
// ============================================================================

/**
 * Input action types for button presses
 */
export enum InputAction {
  /** Single tap/press and release */
  SingleTap = "single_tap",
  /** Double tap (two quick presses) */
  DoubleTap = "double_tap",
  /** Long press/hold */
  Hold = "hold",
}

// ============================================================================
// Button Event Types
// ============================================================================

export interface ButtonEvent {
  /** USB HID usage page (e.g., 0x01 for generic desktop, 0x0c for consumer) */
  usagePage: number;
  /** USB HID usage code within the usage page */
  usage: number;
  /** Whether the button is being pressed (true) or released (false) */
  buttonDown: boolean;
}
