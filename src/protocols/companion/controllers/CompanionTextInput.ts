/**
 * CompanionTextInput - Text input/keyboard state for Apple TV via Companion protocol
 */

import { EventEmitter } from "eventemitter3";
import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:companion:text-input");

export interface TextInputState {
  documentText: string;
  cursorPosition: number;
  selectionLength: number;
  isSecure: boolean;
  keyboardType: number;
  autoCorrection: boolean;
  autoCapitalization: boolean;
}

export type CompanionTextInputEvents = {
  started: (state: TextInputState) => void;
  stopped: () => void;
};

export class CompanionTextInput extends EventEmitter<CompanionTextInputEvents> {
  private _state: TextInputState | null = null;

  constructor(private readonly protocol: CompanionProtocol) {
    super();
    this._setupListeners();
  }

  get isActive(): boolean {
    return this._state !== null;
  }

  get state(): TextInputState | null {
    return this._state;
  }

  private _setupListeners(): void {
    this.protocol.on("text-input-started", (data) => {
      this._state = {
        documentText: data.documentText,
        cursorPosition: data.cursorPosition,
        selectionLength: data.selectionLength,
        isSecure: data.isSecure,
        keyboardType: data.keyboardType,
        autoCorrection: data.autoCorrection,
        autoCapitalization: data.autoCapitalization,
      };
      logger.debug("Text input started");
      this.emit("started", this._state);
    });

    this.protocol.on("text-input-stopped", () => {
      this._state = null;
      logger.debug("Text input stopped");
      this.emit("stopped");
    });
  }
}
