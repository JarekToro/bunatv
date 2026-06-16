/**
 * MRPTextInput - Keyboard / text-field control for Apple TV via MRP protocol.
 *
 * When a text field is focused on the Apple TV (search boxes, login forms, …) the
 * device advertises an editing session through KEYBOARD_MESSAGE notifications. This
 * controller exposes that session directly:
 *
 * - Outbound: send the field's contents via TEXT_INPUT_MESSAGE, choosing the raw
 *   action (replace / insert / clear) rather than hiding it behind a single "type".
 * - Inbound: surface the device's keyboard state transitions and the focused field's
 *   editing attributes (title, prompt, input traits) as events and getters.
 *
 * Text is sent in cleartext using TEXT_INPUT_MESSAGE, matching the path used by
 * Apple's own remotes for standard fields. Secure fields negotiate an encrypted
 * channel (KeyboardMessage.encryptedTextCyphertext) which could be done in the future
 */

import { EventEmitter } from "eventemitter3";
import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import {
  ActionType_Enum,
  type TextInputMessage,
} from "@/protocols/mrp/generated/messages/input/TextInputMessage.ts";
import {
  type KeyboardMessage,
  KeyboardState_Enum,
  type TextEditingAttributes,
} from "@/protocols/mrp/generated/messages/input/KeyboardMessage.ts";
import { GetKeyboardSessionMessage } from "@/protocols/mrp/generated/messages/input/GetKeyboardSessionMessage.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:mrp:textinput");

/**
 * The text-mutation action requested of the device.
 *
 * Maps directly onto the MRP `TextInputMessage` action type.
 */
export const TextInputAction = {
  /** Replace the entire field contents with the provided text. */
  Set: ActionType_Enum.Set,
  /** Insert the provided text at the current cursor position. */
  Insert: ActionType_Enum.Insert,
  /** Delete (backspace) — clears using an empty payload. */
  Delete: ActionType_Enum.Delete,
  /** Clear the entire field. */
  Clear: ActionType_Enum.ClearAction,
} as const;

/** Events emitted by {@link MRPTextInput}. */
export type MRPTextInputEvents = {
  /** Emitted on every KEYBOARD_MESSAGE with the decoded keyboard state. */
  keyboardStateChanged: (
    state: KeyboardState_Enum,
    attributes: TextEditingAttributes | undefined
  ) => void;
  /** Emitted when a text field becomes focused (editing begins). */
  editingBegan: (attributes: TextEditingAttributes | undefined) => void;
  /** Emitted when the focused text field loses focus (editing ends). */
  editingEnded: () => void;
};

/**
 * Keyboard and text-field controller for Apple TV via MRP.
 *
 * @example
 * ```ts
 * const text = new MRPTextInput(protocol);
 *
 * text.on("editingBegan", (attrs) => {
 *   console.log("Field focused:", attrs?.title, attrs?.prompt);
 * });
 *
 * // Only act while a field is actually focused.
 * if (text.isEditing) {
 *   await text.setText("hello world"); // replace contents
 *   await text.appendText("!");        // insert at cursor
 *   await text.clearText();            // empty the field
 * }
 * ```
 */
export class MRPTextInput extends EventEmitter<MRPTextInputEvents> {
  /** Last keyboard state reported by the device. */
  private _state: KeyboardState_Enum = KeyboardState_Enum.Unknown;

  /** Editing attributes of the currently focused field, if any. */
  private _attributes: TextEditingAttributes | undefined;

  private readonly boundKeyboardHandler: (message: {
    innerMessage: KeyboardMessage;
  }) => void;

  constructor(private readonly protocol: MRPProtocol) {
    super();
    this.boundKeyboardHandler = (message) => {
      this._handleKeyboardMessage(message.innerMessage);
    };
    this.protocol.on("message:KEYBOARD_MESSAGE", this.boundKeyboardHandler);
  }

  // ==========================================================================
  // State Accessors
  // ==========================================================================

  /** The most recent keyboard state reported by the device. */
  get state(): KeyboardState_Enum {
    return this._state;
  }

  /**
   * Whether a text field is currently focused (accepting input).
   *
   * True for the editing-related states (begin/editing/text-changed); false once
   * the device reports the field is no longer editing.
   */
  get isEditing(): boolean {
    return (
      this._state === KeyboardState_Enum.DidBeginEditing ||
      this._state === KeyboardState_Enum.Editing ||
      this._state === KeyboardState_Enum.TextDidChange
    );
  }

  /** Editing attributes (title, prompt, input traits) of the focused field. */
  get attributes(): TextEditingAttributes | undefined {
    return this._attributes;
  }

  // ==========================================================================
  // Outbound Text Input
  // ==========================================================================

  /**
   * Send text to the focused field with an explicit action.
   *
   * This is the low-level primitive; {@link setText}/{@link appendText}/
   * {@link clearText} are conveniences over it.
   *
   * @param text - The text payload (ignored by the device for Clear/Delete).
   * @param action - The mutation to apply.
   */
  sendText(text: string, action: ActionType_Enum): void {
    logger.debug({ length: text.length, action }, "Sending text input");

    this.protocol.send({
      extensionType: ProtocolMessage_Type.TEXT_INPUT_MESSAGE,
      message: {
        timestamp: Date.now() / 1000,
        text,
        actionType: action,
      } satisfies TextInputMessage,
    });
  }

  /**
   * Replace the entire field contents with the given text.
   *
   * @param text - The new field contents.
   */
  setText(text: string): void {
    this.sendText(text, ActionType_Enum.Set);
  }

  /**
   * Insert text at the current cursor position, keeping existing contents.
   *
   * @param text - The text to insert.
   */
  appendText(text: string): void {
    this.sendText(text, ActionType_Enum.Insert);
  }

  /**
   * Clear the focused field.
   */
  clearText(): void {
    this.sendText("", ActionType_Enum.ClearAction);
  }

  /**
   * Request the current keyboard session from the device.
   *
   * Returns the device's KEYBOARD_MESSAGE response, which describes the focused
   * field (if any) and its editing attributes.
   */
  async getKeyboardSession(): Promise<KeyboardMessage | undefined> {
    logger.debug("Requesting keyboard session");

    const response = await this.protocol.sendAndReceive({
      extensionType: ProtocolMessage_Type.GET_KEYBOARD_SESSION_MESSAGE,
      message: GetKeyboardSessionMessage.create(),
    });

    if (response?.extensionType === ProtocolMessage_Type.KEYBOARD_MESSAGE) {
      return response.innerMessage;
    }
    return undefined;
  }

  // ==========================================================================
  // Inbound Keyboard State
  // ==========================================================================

  private _handleKeyboardMessage(msg: KeyboardMessage): void {
    const previousState = this._state;
    const state = msg.state ?? KeyboardState_Enum.Unknown;

    this._state = state;
    if (msg.attributes !== undefined) {
      this._attributes = msg.attributes;
    }

    logger.debug(
      {
        state: KeyboardState_Enum[state] ?? state,
        title: msg.attributes?.title,
        prompt: msg.attributes?.prompt,
      },
      "Received KEYBOARD_MESSAGE"
    );

    this.emit("keyboardStateChanged", state, this._attributes);

    const wasEditing =
      previousState === KeyboardState_Enum.DidBeginEditing ||
      previousState === KeyboardState_Enum.Editing ||
      previousState === KeyboardState_Enum.TextDidChange;

    if (!wasEditing && this.isEditing) {
      this.emit("editingBegan", this._attributes);
    } else if (wasEditing && state === KeyboardState_Enum.DidEndEditing) {
      this._attributes = undefined;
      this.emit("editingEnded");
    } else if (state === KeyboardState_Enum.NotEditing) {
      this._attributes = undefined;
    }
  }

  /**
   * Remove the protocol listener owned by this controller.
   */
  cleanup(): void {
    this.protocol.off("message:KEYBOARD_MESSAGE", this.boundKeyboardHandler);
    this.removeAllListeners();
  }
}
