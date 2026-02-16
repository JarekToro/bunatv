/**
 * MRPTouch - Touch and gesture input for Apple TV via MRP protocol
 *
 * Handles virtual touchpad events and swipe gestures.
 */

import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import type { SendVirtualTouchEventMessage } from "@/protocols/mrp/generated/messages/input/SendVirtualTouchEventMessage.ts";
import type { SendPackedVirtualTouchEventMessage } from "@/protocols/mrp/generated/messages/input/SendPackedVirtualTouchEventMessage.ts";
import { VirtualTouchPhase_Enum } from "@/protocols/mrp/generated/foundation/Common.ts";
import { createLogger } from "@/logging/logging.ts";
import { sleep } from "@/core/utils/timing";

const logger = createLogger("bunatv:mrp:touch");

// ============================================================================
// Types
// ============================================================================

export interface TouchEvent {
  /** X coordinate (0.0 to 1.0, relative to touchpad) */
  x: number;
  /** Y coordinate (0.0 to 1.0, relative to touchpad) */
  y: number;
  /** Touch phase (began, moved, ended, etc.) */
  phase: VirtualTouchPhase_Enum;
  /** Finger index for multi-touch (default: 0) */
  finger?: number;
}

export interface PackedTouchEvent {
  /** X coordinate as 16-bit integer */
  x: number;
  /** Y coordinate as 16-bit integer */
  y: number;
  /** Touch phase */
  phase: VirtualTouchPhase_Enum;
  /** Virtual device ID */
  deviceId: number;
  /** Finger index */
  finger: number;
}

export interface SwipeOptions {
  /** Number of intermediate steps (default: 10) */
  steps?: number;
  /** Total duration in milliseconds (default: 200) */
  duration?: number;
}

// Re-export for convenience
export { VirtualTouchPhase_Enum };

// ============================================================================
// MRPTouch Class
// ============================================================================

/**
 * Touch and gesture interface for Apple TV via MRP protocol.
 *
 * Provides methods for:
 * - Raw touch events (began, moved, ended)
 * - Packed touch events (efficient multi-touch)
 * - High-level gestures (tap, swipe)
 *
 * @example
 * ```ts
 * const touch = new MRPTouch(protocol);
 *
 * // Tap at center
 * await touch.tap();
 *
 * // Tap at specific position
 * await touch.tap(0.25, 0.75);
 *
 * // Swipe gestures
 * await touch.swipeUp();
 * await touch.swipeRight();
 *
 * // Custom swipe
 * await touch.swipe(0.2, 0.5, 0.8, 0.5, { duration: 300 });
 * ```
 */
export class MRPTouch {
  /** Default duration for swipe gestures in milliseconds */
  private readonly defaultSwipeDuration = 200;

  /** Default number of steps for swipe gestures */
  private readonly defaultSwipeSteps = 10;

  /** Virtual device ID for touch events */
  private virtualDeviceId = 1;

  constructor(private readonly protocol: MRPProtocol) {}

  // ==========================================================================
  // Raw Touch Events
  // ==========================================================================

  /**
   * Send a single virtual touch event.
   *
   * @param event - Touch event data
   * @param virtualDeviceId - Virtual device ID (optional)
   */
  sendTouchEvent(
    event: TouchEvent,
    virtualDeviceId: number = this.virtualDeviceId
  ): void {
    logger.debug(
      { x: event.x, y: event.y, phase: event.phase, finger: event.finger },
      "Sending virtual touch event"
    );

    this.protocol.send({
      extensionType: ProtocolMessage_Type.SEND_VIRTUAL_TOUCH_EVENT_MESSAGE,
      message: {
        virtualDeviceID: virtualDeviceId,
        event: {
          x: event.x,
          y: event.y,
          phase: event.phase,
          finger: event.finger ?? 0,
        },
      } satisfies SendVirtualTouchEventMessage,
    });
  }

  /**
   * Send a packed virtual touch event (more efficient for multiple touches).
   *
   * The packed format stores X, Y, phase, deviceID, and finger as 16-bit
   * little-endian integers in a byte array.
   *
   * @param events - Array of packed touch events
   */
  sendPackedTouchEvents(events: PackedTouchEvent[]): void {
    logger.debug({ eventCount: events.length }, "Sending packed touch events");

    // Each event is 10 bytes: X(2) + Y(2) + phase(2) + deviceId(2) + finger(2)
    const data = Buffer.alloc(events.length * 10);

    for (let i = 0; i < events.length; i++) {
      const offset = i * 10;
      const event = events[i]!;
      data.writeUInt16LE(event.x, offset);
      data.writeUInt16LE(event.y, offset + 2);
      data.writeUInt16LE(event.phase, offset + 4);
      data.writeUInt16LE(event.deviceId, offset + 6);
      data.writeUInt16LE(event.finger, offset + 8);
    }

    this.protocol.send({
      extensionType:
        ProtocolMessage_Type.SEND_PACKED_VIRTUAL_TOUCH_EVENT_MESSAGE,
      message: {
        data,
      } satisfies SendPackedVirtualTouchEventMessage,
    });
  }

  // ==========================================================================
  // Gesture Methods
  // ==========================================================================

  /**
   * Perform a tap gesture.
   *
   * @param x - X coordinate (0.0 to 1.0, default: 0.5)
   * @param y - Y coordinate (0.0 to 1.0, default: 0.5)
   */
  async tap(x: number = 0.5, y: number = 0.5): Promise<void> {
    this.sendTouchEvent({ x, y, phase: VirtualTouchPhase_Enum.Began });
    await sleep(50);
    this.sendTouchEvent({ x, y, phase: VirtualTouchPhase_Enum.Ended });
  }

  /**
   * Perform a swipe gesture.
   *
   * @param startX - Starting X coordinate (0.0 to 1.0)
   * @param startY - Starting Y coordinate (0.0 to 1.0)
   * @param endX - Ending X coordinate (0.0 to 1.0)
   * @param endY - Ending Y coordinate (0.0 to 1.0)
   * @param options - Swipe options (steps, duration)
   */
  async swipe(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: SwipeOptions
  ): Promise<void> {
    const steps = options?.steps ?? this.defaultSwipeSteps;
    const duration = options?.duration ?? this.defaultSwipeDuration;
    const stepDelay = duration / steps;
    const deltaX = (endX - startX) / steps;
    const deltaY = (endY - startY) / steps;

    // Begin touch
    this.sendTouchEvent({
      x: startX,
      y: startY,
      phase: VirtualTouchPhase_Enum.Began,
    });

    // Move through intermediate points
    for (let i = 1; i < steps; i++) {
      await sleep(stepDelay);
      this.sendTouchEvent({
        x: startX + deltaX * i,
        y: startY + deltaY * i,
        phase: VirtualTouchPhase_Enum.Moved,
      });
    }

    // End touch
    await sleep(stepDelay);
    this.sendTouchEvent({
      x: endX,
      y: endY,
      phase: VirtualTouchPhase_Enum.Ended,
    });
  }

  /**
   * Swipe up on the touchpad.
   *
   * @param options - Swipe options (steps, duration)
   */
  async swipeUp(options?: SwipeOptions): Promise<void> {
    await this.swipe(0.5, 0.7, 0.5, 0.3, options);
  }

  /**
   * Swipe down on the touchpad.
   *
   * @param options - Swipe options (steps, duration)
   */
  async swipeDown(options?: SwipeOptions): Promise<void> {
    await this.swipe(0.5, 0.3, 0.5, 0.7, options);
  }

  /**
   * Swipe left on the touchpad.
   *
   * @param options - Swipe options (steps, duration)
   */
  async swipeLeft(options?: SwipeOptions): Promise<void> {
    await this.swipe(0.7, 0.5, 0.3, 0.5, options);
  }

  /**
   * Swipe right on the touchpad.
   *
   * @param options - Swipe options (steps, duration)
   */
  async swipeRight(options?: SwipeOptions): Promise<void> {
    await this.swipe(0.3, 0.5, 0.7, 0.5, options);
  }
}
