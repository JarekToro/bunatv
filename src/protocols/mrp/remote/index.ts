/**
 * MRP Remote Control Module
 *
 * Exports all remote control related classes and constants.
 */

// Constants
export {
  UsagePage,
  GenericDesktopUsage,
  ConsumerUsage,
  InputAction,
  type UsagePageType,
  type GenericDesktopUsageType,
  type ConsumerUsageType,
  type ButtonEvent,
} from "./hid-constants";

// Playback Control
export {
  MRPPlayback,
  Command,
  RepeatMode_Enum,
  ShuffleMode_Enum,
  type CommandResult,
} from "./MRPPlayback";

// Audio Control
export {
  MRPAudio,
  VolumeCapabilities,
  type OutputDevice,
  type VolumeControlState,
  type MRPAudioEvents,
} from "./MRPAudio";

// Touch/Gesture Control
export {
  MRPTouch,
  VirtualTouchPhase_Enum,
  type TouchEvent,
  type PackedTouchEvent,
  type SwipeOptions,
} from "./MRPTouch";

// Power Control
export {
  MRPPower,
  PowerState,
  type MRPPowerEvents,
  type MRPRemoteInterface,
} from "./MRPPower";

// Main Remote (Facade)
export { MRPRemote } from "./MRPRemote";

// Unified MRP API
export { MRPApi } from "../MRPApi";
