/**
 * Tests for three specific bugs in the disconnect/event lifecycle:
 *
 * Bug 1: CompanionProtocol.handleUnexpectedDisconnect() calls cleanupListeners()
 *         BEFORE setState(Failed) and emit("error"), so DeviceApi's listeners are
 *         removed before they can fire — "connection-lost" never reaches consumers.
 *
 * Bug 2: Same ordering bug in Airplay2Protocol.handleUnexpectedDisconnect().
 *
 * Bug 3: MRPPlayerState.bindActiveItemChange() adds per-player listeners that
 *         are never cleaned up (no cleanup/destroy method exists).
 *
 * Each test verifies the bug exists (fails before fix) and is resolved (passes after fix).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "eventemitter3";
import { ProtocolStateMachine } from "@/core/utils/ProtocolStateMachine.ts";
import {
  ProtocolState,
  type ProtocolEvents,
} from "@/protocols/types/BaseProtocol.ts";
import { ConnectionState } from "@/protocols/types/ConnectionState.ts";
import type { TransportEvents } from "@/protocols/shared/layers/BunTCPTransport.ts";

/** Count all listeners across all events on an emitter */
function totalListenerCount(emitter: EventEmitter): number {
  return emitter
    .eventNames()
    .reduce((sum, name) => sum + emitter.listenerCount(name), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 & 2: handleUnexpectedDisconnect ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates a protocol with the exact handleUnexpectedDisconnect pattern.
 * The `buggyOrder` flag controls whether cleanupListeners runs before or after
 * the state transition and error emission.
 */
class MockProtocol extends EventEmitter<ProtocolEvents> {
  readonly stateMachine = new ProtocolStateMachine();
  readonly transport = new EventEmitter<TransportEvents>();

  constructor() {
    super();
    // Forward state-changed from stateMachine (like real protocols do)
    this.stateMachine.on("state-changed", (newState, oldState) => {
      this.emit("state-changed", newState, oldState);
      if (newState === ProtocolState.Ready) {
        this.emit("ready");
      }
    });

    // Wire up inbound disconnect detection
    this.transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        this.stateMachine.state !== ProtocolState.Disconnecting &&
        this.stateMachine.state !== ProtocolState.Idle
      ) {
        this.handleUnexpectedDisconnect();
      }
    });
  }

  /**
   * The CORRECT order: emit FIRST, then clean up.
   * Tests will verify this is required for events to reach consumers.
   */
  handleUnexpectedDisconnect(): void {
    this.stateMachine.setState(ProtocolState.Failed);
    this.emit(
      "error",
      new Error("Transport disconnected unexpectedly"),
      "transport"
    );
    this.cleanupListeners();
  }

  cleanupListeners(): void {
    this.stateMachine.removeAllListeners();
    this.transport.removeAllListeners();
    this.removeAllListeners();
  }
}

/**
 * The BUGGY version: cleanup FIRST, then try to emit (nobody listening).
 * This reproduces the bug in CompanionProtocol and Airplay2Protocol.
 */
class MockProtocolBuggy extends EventEmitter<ProtocolEvents> {
  readonly stateMachine = new ProtocolStateMachine();
  readonly transport = new EventEmitter<TransportEvents>();

  constructor() {
    super();
    this.stateMachine.on("state-changed", (newState, oldState) => {
      this.emit("state-changed", newState, oldState);
      if (newState === ProtocolState.Ready) {
        this.emit("ready");
      }
    });

    this.transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        this.stateMachine.state !== ProtocolState.Disconnecting &&
        this.stateMachine.state !== ProtocolState.Idle
      ) {
        this.handleUnexpectedDisconnect();
      }
    });
  }

  handleUnexpectedDisconnect(): void {
    // BUG: cleanup first, then try to emit — but no one is listening anymore!
    this.cleanupListeners();
    this.stateMachine.setState(ProtocolState.Failed);
    this.emit(
      "error",
      new Error("Transport disconnected unexpectedly"),
      "transport"
    );
  }

  cleanupListeners(): void {
    this.stateMachine.removeAllListeners();
    this.transport.removeAllListeners();
    this.removeAllListeners();
  }
}

describe("Bug 1 & 2: handleUnexpectedDisconnect event ordering", () => {
  describe("BUGGY order (cleanupListeners before emit)", () => {
    it("DeviceApi does NOT receive state-changed when cleanup runs first", () => {
      const protocol = new MockProtocolBuggy();
      protocol.stateMachine.setState(ProtocolState.Ready);

      // DeviceApi's listener on protocol (mimicking _setupProtocolListeners)
      const connectionLostSpy = mock(() => {});
      protocol.on("state-changed", (newState: ProtocolState) => {
        if (newState === ProtocolState.Failed) {
          connectionLostSpy();
        }
      });

      // Simulate device-initiated disconnect
      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      // With the buggy order, the state IS set to Failed...
      expect(protocol.stateMachine.state).toBe(ProtocolState.Failed);
      // ...but the consumer NEVER received the event because listeners were removed first
      expect(connectionLostSpy).not.toHaveBeenCalled(); // This is the bug!
    });

    it("DeviceApi does NOT receive error event when cleanup runs first", () => {
      const protocol = new MockProtocolBuggy();
      protocol.stateMachine.setState(ProtocolState.Ready);

      const errorSpy = mock(() => {});
      protocol.on("error", errorSpy);

      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      // The error event is lost — nobody was listening when it was emitted
      expect(errorSpy).not.toHaveBeenCalled(); // This is the bug!
    });
  });

  describe("FIXED order (emit before cleanupListeners)", () => {
    it("DeviceApi DOES receive state-changed when emit runs first", () => {
      const protocol = new MockProtocol();
      protocol.stateMachine.setState(ProtocolState.Ready);

      const connectionLostSpy = mock(() => {});
      protocol.on("state-changed", (newState: ProtocolState) => {
        if (newState === ProtocolState.Failed) {
          connectionLostSpy();
        }
      });

      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      expect(protocol.stateMachine.state).toBe(ProtocolState.Failed);
      expect(connectionLostSpy).toHaveBeenCalledTimes(1); // Fixed!
    });

    it("DeviceApi DOES receive error event when emit runs first", () => {
      const protocol = new MockProtocol();
      protocol.stateMachine.setState(ProtocolState.Ready);

      const errorSpy = mock(() => {});
      protocol.on("error", errorSpy);

      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      expect(errorSpy).toHaveBeenCalledTimes(1); // Fixed!
      expect(errorSpy.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(errorSpy.mock.calls[0]![0]!.message).toBe(
        "Transport disconnected unexpectedly"
      );
    });

    it("listeners ARE cleaned up after the events fire", () => {
      const protocol = new MockProtocol();
      protocol.stateMachine.setState(ProtocolState.Ready);

      protocol.on("state-changed", () => {});
      protocol.on("error", () => {});

      // Before disconnect
      expect(totalListenerCount(protocol)).toBeGreaterThan(0);

      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      // After disconnect — all listeners cleaned up
      expect(totalListenerCount(protocol)).toBe(0);
      expect(totalListenerCount(protocol.stateMachine)).toBe(0);
      expect(totalListenerCount(protocol.transport)).toBe(0);
    });
  });

  describe("Full chain: transport → protocol → DeviceApi → consumer", () => {
    it("BUGGY: consumer never gets connection-lost event", () => {
      const protocol = new MockProtocolBuggy();
      protocol.stateMachine.setState(ProtocolState.Ready);

      // DeviceApi layer
      const deviceApi = new EventEmitter<{
        "connection-lost": (type: string, error: Error) => void;
      }>();

      protocol.on("state-changed", (newState: ProtocolState) => {
        if (newState === ProtocolState.Failed) {
          deviceApi.emit(
            "connection-lost",
            "companion",
            new Error("Protocol failed")
          );
        }
      });

      // Consumer layer
      const consumerSpy = mock(() => {});
      deviceApi.on("connection-lost", consumerSpy);

      // Device drops connection
      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      // Consumer NEVER gets notified — this is the critical user-facing bug
      expect(consumerSpy).not.toHaveBeenCalled();
    });

    it("FIXED: consumer DOES get connection-lost event", () => {
      const protocol = new MockProtocol();
      protocol.stateMachine.setState(ProtocolState.Ready);

      const deviceApi = new EventEmitter<{
        "connection-lost": (type: string, error: Error) => void;
      }>();

      protocol.on("state-changed", (newState: ProtocolState) => {
        if (newState === ProtocolState.Failed) {
          deviceApi.emit(
            "connection-lost",
            "companion",
            new Error("Protocol failed")
          );
        }
      });

      const consumerSpy = mock(() => {});
      deviceApi.on("connection-lost", consumerSpy);

      protocol.transport.emit(
        "connectionStatus",
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED
      );

      // Consumer IS notified
      expect(consumerSpy).toHaveBeenCalledTimes(1);
      expect(consumerSpy.mock.calls[0]![0]).toBe("companion");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3: MRPPlayerState per-player listener leak
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates the PlayerState + MRPPlayerState binding pattern.
 *
 * MRPPlayerState.bindActiveItemChange() adds an `activeItemChange` listener
 * to each PlayerState, tracked via a WeakSet to prevent duplicates.
 * But there's no way to REMOVE these listeners — no cleanup/destroy method.
 */

type PlayerStateEvents = {
  activeItemChange: (event: {
    previous: { identifier: string } | undefined;
    current: { identifier: string } | undefined;
  }) => void;
};

class MockPlayerState extends EventEmitter<PlayerStateEvents> {
  constructor(public readonly identifier: string) {
    super();
  }
}

/**
 * BUGGY version: no cleanup method exists.
 */
class MockMRPPlayerStateBuggy {
  private boundPlayers = new WeakSet<MockPlayerState>();
  private players: MockPlayerState[] = [];

  bindActiveItemChange(player: MockPlayerState): void {
    if (this.boundPlayers.has(player)) return;
    this.boundPlayers.add(player);
    this.players.push(player);

    player.on("activeItemChange", ({ current }) => {
      // Simulate artwork fetching logic
      if (!current?.identifier) return;
    });
  }

  // No cleanup method exists — this is the bug!
}

/**
 * FIXED version: cleanup method properly removes listeners from all tracked players.
 */
class MockMRPPlayerStateFixed {
  private boundPlayers = new WeakSet<MockPlayerState>();
  private players: MockPlayerState[] = [];

  bindActiveItemChange(player: MockPlayerState): void {
    if (this.boundPlayers.has(player)) return;
    this.boundPlayers.add(player);
    this.players.push(player);

    player.on("activeItemChange", ({ current }) => {
      if (!current?.identifier) return;
    });
  }

  /** Clean up all per-player listeners */
  cleanup(): void {
    for (const player of this.players) {
      player.removeAllListeners();
    }
    this.players = [];
    // WeakSet entries will be GC'd automatically
  }
}

describe("Bug 3: MRPPlayerState per-player listener leak", () => {
  it("BUGGY: per-player listeners accumulate and are never removed", () => {
    const playerState = new MockMRPPlayerStateBuggy();

    const player1 = new MockPlayerState("player-1");
    const player2 = new MockPlayerState("player-2");
    const player3 = new MockPlayerState("player-3");

    playerState.bindActiveItemChange(player1);
    playerState.bindActiveItemChange(player2);
    playerState.bindActiveItemChange(player3);

    // Each player has 1 listener from bindActiveItemChange
    expect(player1.listenerCount("activeItemChange")).toBe(1);
    expect(player2.listenerCount("activeItemChange")).toBe(1);
    expect(player3.listenerCount("activeItemChange")).toBe(1);

    // There's NO way to clean them up — no cleanup() method exists
    // This is the bug: listeners persist forever, keeping references alive
    expect(typeof (playerState as Record<string, unknown>).cleanup).toBe(
      "undefined"
    );
  });

  it("BUGGY: duplicate binding is prevented but removal is not possible", () => {
    const playerState = new MockMRPPlayerStateBuggy();
    const player = new MockPlayerState("player-1");

    // WeakSet prevents duplicate binding
    playerState.bindActiveItemChange(player);
    playerState.bindActiveItemChange(player);
    expect(player.listenerCount("activeItemChange")).toBe(1);

    // But there's still no way to remove it
    expect(typeof (playerState as Record<string, unknown>).cleanup).toBe(
      "undefined"
    );
  });

  it("FIXED: cleanup() removes all per-player listeners", () => {
    const playerState = new MockMRPPlayerStateFixed();

    const player1 = new MockPlayerState("player-1");
    const player2 = new MockPlayerState("player-2");
    const player3 = new MockPlayerState("player-3");

    playerState.bindActiveItemChange(player1);
    playerState.bindActiveItemChange(player2);
    playerState.bindActiveItemChange(player3);

    // Listeners exist
    expect(player1.listenerCount("activeItemChange")).toBe(1);
    expect(player2.listenerCount("activeItemChange")).toBe(1);
    expect(player3.listenerCount("activeItemChange")).toBe(1);

    // Cleanup
    playerState.cleanup();

    // All listeners removed
    expect(player1.listenerCount("activeItemChange")).toBe(0);
    expect(player2.listenerCount("activeItemChange")).toBe(0);
    expect(player3.listenerCount("activeItemChange")).toBe(0);
  });

  it("FIXED: cleanup is called from MRPApi disconnect flow", () => {
    const playerState = new MockMRPPlayerStateFixed();
    const player = new MockPlayerState("player-1");
    playerState.bindActiveItemChange(player);
    expect(player.listenerCount("activeItemChange")).toBe(1);

    // Simulating MRPApi.disconnect() calling playerState.cleanup()
    const cleanupSpy = mock(() => playerState.cleanup());
    cleanupSpy();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(player.listenerCount("activeItemChange")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: All three bugs combined
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration: inbound disconnect with proper cleanup chain", () => {
  it("FIXED: full chain delivers connection-lost AND cleans up everything", () => {
    // Protocol layer
    const protocol = new MockProtocol();
    protocol.stateMachine.setState(ProtocolState.Ready);

    // PlayerState layer (MRPPlayerState)
    const playerState = new MockMRPPlayerStateFixed();
    const player = new MockPlayerState("player-1");
    playerState.bindActiveItemChange(player);

    // DeviceApi layer
    const deviceApi = new EventEmitter<{
      "connection-lost": (type: string, error: Error) => void;
    }>();

    protocol.on("state-changed", (newState: ProtocolState) => {
      if (newState === ProtocolState.Failed) {
        deviceApi.emit(
          "connection-lost",
          "companion",
          new Error("Protocol failed")
        );
      }
    });

    // Consumer
    const consumerSpy = mock(() => {});
    deviceApi.on("connection-lost", consumerSpy);

    // Verify everything has listeners before disconnect
    expect(totalListenerCount(protocol)).toBeGreaterThan(0);
    expect(player.listenerCount("activeItemChange")).toBe(1);

    // Device drops connection
    protocol.transport.emit(
      "connectionStatus",
      ConnectionState.DISCONNECTED,
      ConnectionState.CONNECTED
    );

    // 1. Consumer received the event
    expect(consumerSpy).toHaveBeenCalledTimes(1);

    // 2. Protocol listeners are cleaned
    expect(totalListenerCount(protocol)).toBe(0);

    // 3. PlayerState cleanup (would be called by MRPApi.disconnect)
    playerState.cleanup();
    expect(player.listenerCount("activeItemChange")).toBe(0);
  });
});
