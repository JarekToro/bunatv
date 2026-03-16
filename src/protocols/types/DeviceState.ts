/**
 * Unified device power/attention state shared across MRP and Companion protocols.
 *
 * Superset of all states reported by either protocol.
 */
export enum DeviceState {
  /** State cannot be determined */
  Unknown = "unknown",
  /** Device is off or in sleep mode */
  Asleep = "asleep",
  /** Screensaver is active */
  Screensaver = "screensaver",
  /** Device is on and active */
  Awake = "awake",
  /** Device is idle */
  Idle = "idle",
}
