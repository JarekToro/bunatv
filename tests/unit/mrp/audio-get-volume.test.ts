/**
 * Tests for MRPAudio request/response getters (getVolume / getVolumeMuted).
 */

import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "eventemitter3";
import { MRPAudio } from "@/protocols/mrp/remote/MRPAudio.ts";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";

function createFakeProtocol() {
  const emitter = new EventEmitter();
  const send = mock((_payload: any) => {});
  const sendAndReceive = mock(async (_payload: any) => undefined as any);
  const protocol = Object.assign(emitter, { send, sendAndReceive });
  return { protocol: protocol as unknown as MRPProtocol, send, sendAndReceive };
}

describe("MRPAudio request/response", () => {
  describe("getVolume", () => {
    it("sends GET_VOLUME_MESSAGE with the UID and returns the reported volume", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      sendAndReceive.mockResolvedValueOnce({
        extensionType: ProtocolMessage_Type.GET_VOLUME_RESULT_MESSAGE,
        innerMessage: { volume: 0.42 },
      });

      const audio = new MRPAudio(protocol);
      const volume = await audio.getVolume("device-uid");

      expect(volume).toBe(0.42);
      const payload = sendAndReceive.mock.calls[0]![0];
      expect(payload.extensionType).toBe(
        ProtocolMessage_Type.GET_VOLUME_MESSAGE
      );
      expect(payload.message.outputDeviceUID).toBe("device-uid");
    });

    it("returns undefined when the response is not a volume result", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      sendAndReceive.mockResolvedValueOnce(undefined);

      const audio = new MRPAudio(protocol);
      expect(await audio.getVolume("x")).toBeUndefined();
    });
  });

  describe("getVolumeMuted", () => {
    it("sends GET_VOLUME_MUTED_MESSAGE and returns the reported mute state", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      sendAndReceive.mockResolvedValueOnce({
        extensionType: ProtocolMessage_Type.GET_VOLUME_MUTED_RESULT_MESSAGE,
        innerMessage: { isMuted: true },
      });

      const audio = new MRPAudio(protocol);
      const muted = await audio.getVolumeMuted("device-uid");

      expect(muted).toBe(true);
      expect(sendAndReceive.mock.calls[0]![0].extensionType).toBe(
        ProtocolMessage_Type.GET_VOLUME_MUTED_MESSAGE
      );
    });
  });
});
