/**
 * Tests for MRPPlayback rating / library / album-playlist convenience commands.
 * Verifies each helper sends SEND_COMMAND_MESSAGE with the right Command value
 */

import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "eventemitter3";
import { MRPPlayback } from "@/protocols/mrp/remote/MRPPlayback.ts";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import { Command } from "@/protocols/mrp/generated/types/media/CommandInfo.ts";

function createFakeProtocol() {
  const emitter = new EventEmitter();
  // sendCommand reads result.innerMessage.sendError → 0 means success.
  const sendAndReceive = mock(async (_payload: any) => ({
    innerMessage: { sendError: 0 },
  }));
  const protocol = Object.assign(emitter, {
    send: mock(() => {}),
    sendAndReceive,
  });
  return { protocol: protocol as unknown as MRPProtocol, sendAndReceive };
}

function lastCommand(sendAndReceive: ReturnType<typeof mock>) {
  const payload = sendAndReceive.mock.calls.at(-1)![0];
  expect(payload.extensionType).toBe(ProtocolMessage_Type.SEND_COMMAND_MESSAGE);
  return payload.message;
}

describe("MRPPlayback convenience commands", () => {
  it("maps simple helpers to their Command values", async () => {
    const { protocol, sendAndReceive } = createFakeProtocol();
    const playback = new MRPPlayback(protocol);

    const cases: [() => Promise<unknown>, Command][] = [
      [() => playback.likeTrack(), Command.LikeTrack],
      [() => playback.dislikeTrack(), Command.DislikeTrack],
      [() => playback.banTrack(), Command.BanTrack],
      [() => playback.bookmarkTrack(), Command.BookmarkTrack],
      [() => playback.addToWishList(), Command.AddTrackToWishList],
      [() => playback.removeFromWishList(), Command.RemoveTrackFromWishList],
      [() => playback.nextAlbum(), Command.NextAlbum],
      [() => playback.previousAlbum(), Command.PreviousAlbum],
      [() => playback.nextPlaylist(), Command.NextPlaylist],
      [() => playback.previousPlaylist(), Command.PreviousPlaylist],
    ];

    for (const [invoke, expected] of cases) {
      await invoke();
      expect(lastCommand(sendAndReceive).command).toBe(expected);
    }
  });

  it("returns success based on the command result", async () => {
    const { protocol } = createFakeProtocol();
    const result = await new MRPPlayback(protocol).likeTrack();
    expect(result.success).toBe(true);
  });

  describe("rateTrack", () => {
    it("sends RateTrack with the rating in options", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      await new MRPPlayback(protocol).rateTrack(0.5);

      const message = lastCommand(sendAndReceive);
      expect(message.command).toBe(Command.RateTrack);
      expect(message.options.rating).toBe(0.5);
    });

    it("clamps the rating to [0, 1]", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      const playback = new MRPPlayback(protocol);

      await playback.rateTrack(5);
      expect(lastCommand(sendAndReceive).options.rating).toBe(1);

      await playback.rateTrack(-3);
      expect(lastCommand(sendAndReceive).options.rating).toBe(0);
    });
  });
});
