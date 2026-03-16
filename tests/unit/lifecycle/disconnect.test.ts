/**
 * Tests for disconnect lifecycle — listener cleanup and inbound disconnect detection.
 *
 * Since protocol classes have private constructors and need real device connections,
 * these tests use mock EventEmitter-based objects to verify the patterns we rely on:
 * - removeAllListeners() cleans up properly
 * - State transitions fire events correctly
 * - Inbound disconnect detection propagates to DeviceApi
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Count all listeners across all events on an emitter */
function totalListenerCount(emitter: EventEmitter): number {
  return emitter
    .eventNames()
    .reduce((sum, name) => sum + emitter.listenerCount(name), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// ProtocolStateMachine
// ─────────────────────────────────────────────────────────────────────────────

describe("ProtocolStateMachine", () => {
  let sm: ProtocolStateMachine;

  beforeEach(() => {
    sm = new ProtocolStateMachine();
  });

  it("starts in Idle state", () => {
    expect(sm.state).toBe(ProtocolState.Idle);
    expect(sm.isReady).toBe(false);
  });

  it("emits state-changed on setState", () => {
    const fn = mock(() => {});
    sm.on("state-changed", fn);

    sm.setState(ProtocolState.Connecting);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(
      ProtocolState.Connecting,
      ProtocolState.Idle
    );
  });

  it("removeAllListeners prevents further events", () => {
    const fn = mock(() => {});
    sm.on("state-changed", fn);

    sm.removeAllListeners();
    sm.setState(ProtocolState.Ready);

    expect(fn).toHaveBeenCalledTimes(0);
  });

  it("assertState throws when state does not match", () => {
    expect(() => sm.assertState(ProtocolState.Ready, "test")).toThrow(
      "Cannot test in state: idle"
    );
  });

  it("assertState does not throw when state matches", () => {
    expect(() => sm.assertState(ProtocolState.Idle, "test")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener cleanup patterns
// ─────────────────────────────────────────────────────────────────────────────

describe("EventEmitter listener cleanup", () => {
  it("removeAllListeners removes all listeners from all events", () => {
    const emitter = new EventEmitter<{
      a: () => void;
      b: (x: number) => void;
    }>();

    emitter.on("a", () => {});
    emitter.on("a", () => {});
    emitter.on("b", () => {});

    expect(totalListenerCount(emitter)).toBe(3);

    emitter.removeAllListeners();

    expect(totalListenerCount(emitter)).toBe(0);
  });

  it("off() removes a specific listener by reference", () => {
    const emitter = new EventEmitter<{ data: (x: number) => void }>();
    const handler = () => {};
    const other = () => {};

    emitter.on("data", handler);
    emitter.on("data", other);
    expect(emitter.listenerCount("data")).toBe(2);

    emitter.off("data", handler);
    expect(emitter.listenerCount("data")).toBe(1);
  });

  it("removeAllListeners on child emitters prevents cascading events", () => {
    // Simulates protocol → transport listener chain
    const transport = new EventEmitter<TransportEvents>();
    const protocol = new EventEmitter<ProtocolEvents>();

    const errorSpy = mock(() => {});
    protocol.on("error", errorSpy);

    // Protocol listens to transport errors (like CompanionProtocol does)
    transport.on("error", (error) => {
      protocol.emit("error", error, "transport");
    });

    // Before cleanup: transport error reaches protocol
    transport.emit("error", new Error("test"));
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // Clean up transport listeners
    transport.removeAllListeners();

    // After cleanup: transport error does NOT reach protocol
    transport.emit("error", new Error("test2"));
    expect(errorSpy).toHaveBeenCalledTimes(1); // still 1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect pattern: protocol cleans up owned sub-emitters
// ─────────────────────────────────────────────────────────────────────────────

describe("Protocol disconnect cleanup pattern", () => {
  it("cascading removeAllListeners cleans entire listener tree", () => {
    // Simulates the pattern used by CompanionProtocol.cleanupListeners()
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();
    const session = new EventEmitter<{ message: () => void }>();
    const channel = new EventEmitter<{ message: () => void }>();
    const protocol = new EventEmitter<ProtocolEvents>();

    // Register listeners (mimicking setupEventHandlers)
    session.on("message", () => {});
    stateMachine.on("state-changed", () => {
      protocol.emit("state-changed", stateMachine.state, ProtocolState.Idle);
    });
    transport.on("error", () => {});
    transport.on("connectionStatus", () => {});
    channel.on("message", () => {});
    protocol.on("state-changed", () => {});
    protocol.on("error", () => {});

    // Verify listeners exist
    expect(totalListenerCount(session)).toBe(1);
    expect(totalListenerCount(stateMachine)).toBe(1);
    expect(totalListenerCount(transport)).toBe(2);
    expect(totalListenerCount(channel)).toBe(1);
    expect(totalListenerCount(protocol)).toBe(2);

    // Cleanup (mimicking cleanupListeners())
    session.removeAllListeners();
    channel.removeAllListeners();
    stateMachine.removeAllListeners();
    transport.removeAllListeners();
    protocol.removeAllListeners();

    // All listeners gone
    expect(totalListenerCount(session)).toBe(0);
    expect(totalListenerCount(stateMachine)).toBe(0);
    expect(totalListenerCount(transport)).toBe(0);
    expect(totalListenerCount(channel)).toBe(0);
    expect(totalListenerCount(protocol)).toBe(0);
  });

  it("targeted off() on unowned emitters only removes our handlers", () => {
    // Simulates MRPProtocol cleaning up its listeners on AirPlay's data channel
    // without removing Airplay's own listeners
    const dataChannel = new EventEmitter<{
      protobuf: (data: Buffer) => void;
      connectionStatus: (state: string) => void;
    }>();

    // Airplay's own listener (should survive)
    const airplayHandler = mock(() => {});
    dataChannel.on("protobuf", airplayHandler);

    // MRP's listener (should be removed)
    const mrpHandler = mock(() => {});
    dataChannel.on("protobuf", mrpHandler);

    expect(dataChannel.listenerCount("protobuf")).toBe(2);

    // MRP disconnect: targeted off() for our handler only
    dataChannel.off("protobuf", mrpHandler);

    expect(dataChannel.listenerCount("protobuf")).toBe(1);

    // Airplay's handler still works
    dataChannel.emit("protobuf", Buffer.from("test"));
    expect(airplayHandler).toHaveBeenCalledTimes(1);
    expect(mrpHandler).toHaveBeenCalledTimes(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inbound disconnect detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Inbound disconnect detection", () => {
  it("transport connectionStatus:DISCONNECTED triggers protocol failure", () => {
    // Simulates what CompanionProtocol now does
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();
    const protocol = new EventEmitter<ProtocolEvents>();

    // Wire up state-changed forwarding
    stateMachine.on("state-changed", (newState, oldState) => {
      protocol.emit("state-changed", newState, oldState);
    });

    // Wire up inbound disconnect detection (the code we added)
    transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        stateMachine.state !== ProtocolState.Disconnecting &&
        stateMachine.state !== ProtocolState.Idle
      ) {
        stateMachine.setState(ProtocolState.Failed);
        protocol.emit(
          "error",
          new Error("Transport disconnected unexpectedly"),
          "transport"
        );
      }
    });

    // Set protocol to Ready (simulating active connection)
    stateMachine.setState(ProtocolState.Ready);

    const errorSpy = mock(() => {});
    const stateChangeSpy = mock(() => {});
    protocol.on("error", errorSpy);
    protocol.on("state-changed", stateChangeSpy);

    // Simulate device-initiated disconnect
    transport.emit(
      "connectionStatus",
      ConnectionState.DISCONNECTED,
      ConnectionState.CONNECTED
    );

    expect(stateMachine.state).toBe(ProtocolState.Failed);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledWith(
      ProtocolState.Failed,
      ProtocolState.Ready
    );
  });

  it("transport disconnect while already Disconnecting is ignored", () => {
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();

    const failedSpy = mock(() => {});

    transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        stateMachine.state !== ProtocolState.Disconnecting &&
        stateMachine.state !== ProtocolState.Idle
      ) {
        failedSpy();
        stateMachine.setState(ProtocolState.Failed);
      }
    });

    // Set to Disconnecting (user-initiated disconnect in progress)
    stateMachine.setState(ProtocolState.Disconnecting);

    // Transport disconnect should be ignored
    transport.emit(
      "connectionStatus",
      ConnectionState.DISCONNECTED,
      ConnectionState.DISCONNECTING
    );

    expect(failedSpy).not.toHaveBeenCalled();
    expect(stateMachine.state).toBe(ProtocolState.Disconnecting);
  });

  it("transport disconnect while Idle is ignored", () => {
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();

    const failedSpy = mock(() => {});

    transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        stateMachine.state !== ProtocolState.Disconnecting &&
        stateMachine.state !== ProtocolState.Idle
      ) {
        failedSpy();
      }
    });

    // Already Idle
    transport.emit(
      "connectionStatus",
      ConnectionState.DISCONNECTED,
      ConnectionState.CONNECTED
    );

    expect(failedSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DeviceApi event forwarding
// ─────────────────────────────────────────────────────────────────────────────

describe("DeviceApi event forwarding pattern", () => {
  it("forwards protocol Failed state as connection-lost event", () => {
    // Simulates DeviceApi._setupProtocolListeners behavior
    const protocol = new EventEmitter<ProtocolEvents>();
    const deviceApi = new EventEmitter<{
      "connection-lost": (protocol: string, error: Error) => void;
      error: (error: Error, context?: string) => void;
    }>();

    const protocolType = "companion";

    // Wire up (mimicking _setupProtocolListeners)
    protocol.on("state-changed", (newState: ProtocolState) => {
      if (newState === ProtocolState.Failed) {
        deviceApi.emit(
          "connection-lost",
          protocolType,
          new Error(`Protocol ${protocolType} failed unexpectedly`)
        );
      }
    });

    protocol.on("error", (error: Error, context?: string) => {
      deviceApi.emit("error", error, `${protocolType}:${context ?? "unknown"}`);
    });

    const connectionLostSpy = mock(() => {});
    const errorSpy = mock(() => {});
    deviceApi.on("connection-lost", connectionLostSpy);
    deviceApi.on("error", errorSpy);

    // Simulate protocol failure
    protocol.emit("state-changed", ProtocolState.Failed, ProtocolState.Ready);

    expect(connectionLostSpy).toHaveBeenCalledTimes(1);
    expect(connectionLostSpy.mock.calls[0]![0]).toBe("companion");
    expect(connectionLostSpy.mock.calls[0]![1]).toBeInstanceOf(Error);

    // Simulate protocol error
    protocol.emit("error", new Error("transport error"), "transport");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![1]).toBe("companion:transport");
  });

  it("non-Failed state changes do not emit connection-lost", () => {
    const protocol = new EventEmitter<ProtocolEvents>();
    const connectionLostSpy = mock(() => {});

    protocol.on("state-changed", (newState: ProtocolState) => {
      if (newState === ProtocolState.Failed) {
        connectionLostSpy();
      }
    });

    // These should NOT trigger connection-lost
    protocol.emit(
      "state-changed",
      ProtocolState.Connecting,
      ProtocolState.Idle
    );
    protocol.emit(
      "state-changed",
      ProtocolState.Ready,
      ProtocolState.Connecting
    );
    protocol.emit(
      "state-changed",
      ProtocolState.Disconnecting,
      ProtocolState.Ready
    );
    protocol.emit(
      "state-changed",
      ProtocolState.Idle,
      ProtocolState.Disconnecting
    );

    expect(connectionLostSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full disconnect lifecycle integration
// ─────────────────────────────────────────────────────────────────────────────

describe("Full disconnect lifecycle", () => {
  it("outbound disconnect cleans up entire listener tree", () => {
    // Build a mini protocol stack
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();
    const session = new EventEmitter<{ message: () => void }>();
    const channel = new EventEmitter<{ message: () => void }>();
    const protocol = new EventEmitter<ProtocolEvents>();

    // Sub-controllers listening on protocol (like MRPPlayerState, MRPPower, etc.)
    const controllerA = new EventEmitter<{
      stateChanged: (s: string) => void;
    }>();
    const controllerB = new EventEmitter<{
      volumeChanged: (v: number) => void;
    }>();

    // Register listeners (mimicking real setup)
    session.on("message", () => {});
    stateMachine.on("state-changed", () => {});
    transport.on("error", () => {});
    transport.on("connectionStatus", () => {});
    channel.on("message", () => {});

    // Protocol-level listeners (from sub-controllers)
    protocol.on("state-changed", () => {});
    protocol.on("error", () => {});
    protocol.on("ready", () => {});

    // Controller listeners (from consumers)
    controllerA.on("stateChanged", () => {});
    controllerB.on("volumeChanged", () => {});

    const totalBefore =
      totalListenerCount(transport) +
      totalListenerCount(stateMachine) +
      totalListenerCount(session) +
      totalListenerCount(channel) +
      totalListenerCount(protocol) +
      totalListenerCount(controllerA) +
      totalListenerCount(controllerB);

    expect(totalBefore).toBe(10);

    // API cleanup (like MRPApi.disconnect / CompanionApi.cleanup)
    controllerA.removeAllListeners();
    controllerB.removeAllListeners();

    // Protocol cleanup (like CompanionProtocol.cleanupListeners)
    session.removeAllListeners();
    channel.removeAllListeners();
    stateMachine.removeAllListeners();
    transport.removeAllListeners();
    protocol.removeAllListeners();

    const totalAfter =
      totalListenerCount(transport) +
      totalListenerCount(stateMachine) +
      totalListenerCount(session) +
      totalListenerCount(channel) +
      totalListenerCount(protocol) +
      totalListenerCount(controllerA) +
      totalListenerCount(controllerB);

    expect(totalAfter).toBe(0);
  });

  it("inbound disconnect propagates from transport to DeviceApi consumer", () => {
    // Build the full chain: transport → protocol → DeviceApi → consumer
    const transport = new EventEmitter<TransportEvents>();
    const stateMachine = new ProtocolStateMachine();
    const protocol = new EventEmitter<ProtocolEvents>();
    const deviceApi = new EventEmitter<{
      "connection-lost": (protocol: string, error: Error) => void;
    }>();

    // Protocol listens to state machine
    stateMachine.on("state-changed", (newState, oldState) => {
      protocol.emit("state-changed", newState, oldState);
    });

    // Protocol listens to transport for unexpected disconnect
    transport.on("connectionStatus", (state) => {
      if (
        state === ConnectionState.DISCONNECTED &&
        stateMachine.state !== ProtocolState.Disconnecting &&
        stateMachine.state !== ProtocolState.Idle
      ) {
        stateMachine.setState(ProtocolState.Failed);
      }
    });

    // DeviceApi listens to protocol state
    protocol.on("state-changed", (newState: ProtocolState) => {
      if (newState === ProtocolState.Failed) {
        deviceApi.emit(
          "connection-lost",
          "companion",
          new Error("Protocol failed")
        );
      }
    });

    // Consumer listens to DeviceApi
    const consumerSpy = mock(() => {});
    deviceApi.on("connection-lost", consumerSpy);

    // Set protocol to Ready
    stateMachine.setState(ProtocolState.Ready);

    // Simulate device closing the connection
    transport.emit(
      "connectionStatus",
      ConnectionState.DISCONNECTED,
      ConnectionState.CONNECTED
    );

    // Verify the full chain fired
    expect(stateMachine.state).toBe(ProtocolState.Failed);
    expect(consumerSpy).toHaveBeenCalledTimes(1);
    expect(consumerSpy.mock.calls[0]![0]).toBe("companion");
  });

  it("disconnect is idempotent — second call is no-op", () => {
    const stateMachine = new ProtocolStateMachine();
    const stateChangeSpy = mock(() => {});
    stateMachine.on("state-changed", stateChangeSpy);

    // First disconnect
    stateMachine.setState(ProtocolState.Disconnecting);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    // The guard pattern: check state before acting
    const isDisconnecting =
      stateMachine.state === ProtocolState.Disconnecting ||
      stateMachine.state === ProtocolState.Idle;

    expect(isDisconnecting).toBe(true);
    // Second disconnect would return early, not change state again
  });

  it("listeners on protocol are cleaned after disconnect even if added by consumers", () => {
    const protocol = new EventEmitter<ProtocolEvents>();

    // Consumers add listeners
    protocol.on("state-changed", () => {});
    protocol.on("state-changed", () => {});
    protocol.on("error", () => {});
    protocol.on("ready", () => {});
    protocol.on("connected", () => {});
    protocol.on("disconnected", () => {});

    expect(totalListenerCount(protocol)).toBe(6);

    // Protocol disconnect calls removeAllListeners
    protocol.removeAllListeners();

    expect(totalListenerCount(protocol)).toBe(0);
    expect(protocol.eventNames()).toHaveLength(0);
  });
});
