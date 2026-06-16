/**
 * Tests for the DeviceApi.raop() accessor.
 *
 * Verifies that RAOP is exposed without being part of the managed
 * connect/disconnect lifecycle: the accessor returns a RaopApi when the
 * device advertises `_raop._tcp`, throws otherwise, opens no connection,
 * and returns a stable cached instance.
 */

import { describe, expect, it } from "bun:test";
import { DeviceApi, ProtocolType } from "@/core/DeviceApi.ts";
import { MemoryStorage } from "@/core/storage/memory-storage.ts";
import { RaopApi } from "@/protocols/raop/RaopApi.ts";
import {
  APPLE_SERVICE_TYPES,
  type AppleTVDevice,
  type RAOPService,
} from "@/core/discovery/discovery-types.ts";

function makeRaopService(): RAOPService {
  return {
    instanceName: "Living Room",
    serviceType: APPLE_SERVICE_TYPES.RAOP,
    hostname: "192.168.1.50",
    port: 7000,
    expiresAt: Date.now() + 60_000,
    features: 0n,
    txt: {
      cn: "0,1",
      da: "true",
      et: "0,1",
      ft: "0x4A7FDFD5",
      sf: "0x4",
      md: "0,1,2",
      am: "AppleTV11,1",
      pk: "abc",
      tp: "UDP",
      vn: "65537",
      vs: "890.79.2",
      ov: "26.0.1",
      vv: "2",
    },
  };
}

function makeDevice(withRaop: boolean): AppleTVDevice {
  return {
    name: "Apple TV 4K",
    identifier: "AA:BB:CC:DD:EE:FF",
    address: "192.168.1.50",
    hostname: "Apple-TV.local",
    ipv4: ["192.168.1.50"],
    ipv6: [],
    model: "J305AP",
    lastSeen: Date.now(),
    services: withRaop ? { raop: makeRaopService() } : {},
  };
}

describe("DeviceApi.raop()", () => {
  it("returns a RaopApi when the device advertises RAOP", async () => {
    const api = new DeviceApi(makeDevice(true), new MemoryStorage());
    await api.connect();
    expect(api.raop()).toBeInstanceOf(RaopApi);
  });

  it("throws when the device does not advertise RAOP", async () => {
    const api = new DeviceApi(makeDevice(false), new MemoryStorage());
    await api.connect();
    expect(() => api.raop()).toThrow(/RAOP protocol not initialized/);
  });

  it("returns the same cached instance across calls", async () => {
    const api = new DeviceApi(makeDevice(true), new MemoryStorage());
    await api.connect();
    expect(api.raop()).toBe(api.raop());
  });

  it("reports RAOP support via hasProtocol", () => {
    const withRaop = new DeviceApi(makeDevice(true), new MemoryStorage());
    const withoutRaop = new DeviceApi(makeDevice(false), new MemoryStorage());
    expect(withRaop.hasProtocol(ProtocolType.RAOP)).toBe(true);
    expect(withoutRaop.hasProtocol(ProtocolType.RAOP)).toBe(false);
  });
});
