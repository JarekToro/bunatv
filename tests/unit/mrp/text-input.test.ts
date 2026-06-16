/**
 * Tests for MRPTextInput — outbound TEXT_INPUT_MESSAGE construction and inbound
 * KEYBOARD_MESSAGE state tracking.
 */

import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "eventemitter3";
import { MRPTextInput } from "@/protocols/mrp/remote/MRPTextInput.ts";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import { ActionType_Enum } from "@/protocols/mrp/generated/messages/input/TextInputMessage.ts";
import { KeyboardState_Enum } from "@/protocols/mrp/generated/messages/input/KeyboardMessage.ts";

/** Minimal MRPProtocol stand-in: an event emitter plus send/sendAndReceive spies. */
function createFakeProtocol() {
  const emitter = new EventEmitter();
  const send = mock((_payload: any) => {});
  const sendAndReceive = mock(async (_payload: any) => undefined as any);

  const protocol = Object.assign(emitter, {
    send,
    sendAndReceive,
  });

  return { protocol: protocol as unknown as MRPProtocol, send, sendAndReceive };
}

function emitKeyboard(
  protocol: MRPProtocol,
  innerMessage: { state?: KeyboardState_Enum; attributes?: any }
) {
  (protocol as unknown as EventEmitter).emit("message:KEYBOARD_MESSAGE", {
    extensionType: ProtocolMessage_Type.KEYBOARD_MESSAGE,
    innerMessage,
  });
}

describe("MRPTextInput", () => {
  describe("outbound text input", () => {
    it("setText sends TEXT_INPUT_MESSAGE with Set action and the text", () => {
      const { protocol, send } = createFakeProtocol();
      const text = new MRPTextInput(protocol);

      text.setText("hello");

      expect(send).toHaveBeenCalledTimes(1);
      const payload = send.mock.calls[0]![0];
      expect(payload.extensionType).toBe(
        ProtocolMessage_Type.TEXT_INPUT_MESSAGE
      );
      expect(payload.message.text).toBe("hello");
      expect(payload.message.actionType).toBe(ActionType_Enum.Set);
      expect(typeof payload.message.timestamp).toBe("number");
    });

    it("appendText uses Insert action", () => {
      const { protocol, send } = createFakeProtocol();
      new MRPTextInput(protocol).appendText("!");

      const payload = send.mock.calls[0]![0];
      expect(payload.message.text).toBe("!");
      expect(payload.message.actionType).toBe(ActionType_Enum.Insert);
    });

    it("clearText uses ClearAction with empty text", () => {
      const { protocol, send } = createFakeProtocol();
      new MRPTextInput(protocol).clearText();

      const payload = send.mock.calls[0]![0];
      expect(payload.message.text).toBe("");
      expect(payload.message.actionType).toBe(ActionType_Enum.ClearAction);
    });
  });

  describe("getKeyboardSession", () => {
    it("requests the session and returns the inner KeyboardMessage", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      const inner = { state: KeyboardState_Enum.Editing };
      sendAndReceive.mockResolvedValueOnce({
        extensionType: ProtocolMessage_Type.KEYBOARD_MESSAGE,
        innerMessage: inner,
      });

      const text = new MRPTextInput(protocol);
      const result = await text.getKeyboardSession();

      expect(sendAndReceive).toHaveBeenCalledTimes(1);
      expect(sendAndReceive.mock.calls[0]![0].extensionType).toBe(
        ProtocolMessage_Type.GET_KEYBOARD_SESSION_MESSAGE
      );
      expect(result).toBe(inner as any);
    });

    it("returns undefined when the response is not a KeyboardMessage", async () => {
      const { protocol, sendAndReceive } = createFakeProtocol();
      sendAndReceive.mockResolvedValueOnce(undefined);

      const result = await new MRPTextInput(protocol).getKeyboardSession();
      expect(result).toBeUndefined();
    });
  });

  describe("inbound keyboard state", () => {
    it("tracks state and emits keyboardStateChanged", () => {
      const { protocol } = createFakeProtocol();
      const text = new MRPTextInput(protocol);
      const onState = mock(() => {});
      text.on("keyboardStateChanged", onState);

      emitKeyboard(protocol, {
        state: KeyboardState_Enum.DidBeginEditing,
        attributes: { title: "Search", prompt: "Movies" },
      });

      expect(text.state).toBe(KeyboardState_Enum.DidBeginEditing);
      expect(text.isEditing).toBe(true);
      expect(text.attributes?.title).toBe("Search");
      expect(onState).toHaveBeenCalledTimes(1);
    });

    it("emits editingBegan once when a field gains focus", () => {
      const { protocol } = createFakeProtocol();
      const text = new MRPTextInput(protocol);
      const began = mock(() => {});
      text.on("editingBegan", began);

      emitKeyboard(protocol, { state: KeyboardState_Enum.DidBeginEditing });
      emitKeyboard(protocol, { state: KeyboardState_Enum.TextDidChange });

      // Still editing across the two states → only one editingBegan.
      expect(began).toHaveBeenCalledTimes(1);
      expect(text.isEditing).toBe(true);
    });

    it("emits editingEnded and drops attributes when the field loses focus", () => {
      const { protocol } = createFakeProtocol();
      const text = new MRPTextInput(protocol);
      const ended = mock(() => {});
      text.on("editingEnded", ended);

      emitKeyboard(protocol, {
        state: KeyboardState_Enum.DidBeginEditing,
        attributes: { title: "Search" },
      });
      emitKeyboard(protocol, { state: KeyboardState_Enum.DidEndEditing });

      expect(ended).toHaveBeenCalledTimes(1);
      expect(text.isEditing).toBe(false);
      expect(text.attributes).toBeUndefined();
    });
  });

  describe("cleanup", () => {
    it("detaches the protocol listener and stops tracking state", () => {
      const { protocol } = createFakeProtocol();
      const text = new MRPTextInput(protocol);

      text.cleanup();
      emitKeyboard(protocol, { state: KeyboardState_Enum.DidBeginEditing });

      // Listener removed → state stays at its initial Unknown value.
      expect(text.state).toBe(KeyboardState_Enum.Unknown);
      expect(
        (protocol as unknown as EventEmitter).listenerCount(
          "message:KEYBOARD_MESSAGE"
        )
      ).toBe(0);
    });
  });
});
