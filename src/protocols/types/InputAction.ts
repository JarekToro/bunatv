/**
 * Unified input action types shared across MRP and Companion protocols.
 *
 * Each protocol maps these to its own wire format internally.
 */
export enum InputAction {
  /** Single tap/press and release */
  Single = "single",
  /** Double tap (two quick presses) */
  Double = "double",
  /** Long press/hold */
  Hold = "hold",
}
