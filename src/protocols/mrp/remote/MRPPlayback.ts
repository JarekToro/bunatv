/**
 * MRPPlayback - Playback control for Apple TV via MRP protocol
 *
 * Handles all playback-related commands like play, pause, skip, seek, etc.
 */

import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import type { SendCommandMessage } from "@/protocols/mrp/generated/messages/playback/SendCommandMessage.ts";
import type { SendCommandResultMessage } from "@/protocols/mrp/generated/messages/playback/SendCommandResultMessage.ts";
import { Command } from "@/protocols/mrp/generated/types/media/CommandInfo.ts";
import type { CommandOptions } from "@/protocols/mrp/generated/types/media/CommandOptions.ts";
import type { PlayerPath } from "@/protocols/mrp/generated/types/playback/PlayerPath.ts";
import {
  RepeatMode_Enum,
  ShuffleMode_Enum,
} from "@/protocols/mrp/generated/foundation/Common.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:mrp:playback");

// ============================================================================
// Types
// ============================================================================

export interface CommandResult {
  /** The original message from the device */
  message: SendCommandResultMessage;
  /** Whether the command succeeded */
  success: boolean;
  /** Error description if failed */
  errorDescription?: string;
}

// Re-export for convenience
export { Command, RepeatMode_Enum, ShuffleMode_Enum };

// ============================================================================
// MRPPlayback Class
// ============================================================================

/**
 * Playback control interface for Apple TV via MRP protocol.
 *
 * Provides methods for:
 * - Play/Pause/Stop
 * - Track navigation (next, previous)
 * - Seeking and skipping
 * - Playback rate control
 * - Shuffle and repeat modes
 * - Chapter navigation
 *
 * @example
 * ```ts
 * const playback = new MRPPlayback(protocol);
 *
 * // Basic controls
 * await playback.play();
 * await playback.pause();
 * await playback.nextTrack();
 *
 * // Seeking
 * await playback.seekTo(120); // Jump to 2:00
 * await playback.skipForward(30); // Skip 30 seconds
 *
 * // Modes
 * await playback.setShuffleMode(ShuffleMode_Enum.Songs);
 * await playback.setRepeatMode(RepeatMode_Enum.All);
 * ```
 */
export class MRPPlayback {
  constructor(private readonly protocol: MRPProtocol) {}

  // ==========================================================================
  // Core Command Interface
  // ==========================================================================

  /**
   * Send a playback command and wait for the result.
   *
   * @param command - The command to send (from Command enum)
   * @param options - Optional command options (seek position, etc.)
   * @param playerPath - Optional player path to target a specific player
   * @returns The command result
   */
  async sendCommand(
    command: Command,
    options?: Partial<CommandOptions>,
    playerPath?: PlayerPath
  ): Promise<CommandResult> {
    logger.debug({ command, options, playerPath }, "Sending playback command");

    const result = await this.protocol.sendAndReceive({
      extensionType: ProtocolMessage_Type.SEND_COMMAND_MESSAGE,
      message: {
        command,
        options: options as CommandOptions,
        playerPath,
      } satisfies SendCommandMessage,
    });

    const resultMessage = result.innerMessage as SendCommandResultMessage;
    const success =
      resultMessage.sendError === undefined || resultMessage.sendError === 0;

    return {
      message: resultMessage,
      success,
      errorDescription: success
        ? undefined
        : resultMessage.commandResult?.sendErrorDescription,
    };
  }

  // ==========================================================================
  // Basic Playback Controls
  // ==========================================================================

  /** Start playback */
  async play(): Promise<CommandResult> {
    return this.sendCommand(Command.Play);
  }

  /** Pause playback */
  async pause(): Promise<CommandResult> {
    return this.sendCommand(Command.Pause);
  }

  /** Toggle play/pause */
  async togglePlayPause(): Promise<CommandResult> {
    return this.sendCommand(Command.TogglePlayPause);
  }

  /** Stop playback */
  async stop(): Promise<CommandResult> {
    return this.sendCommand(Command.Stop);
  }

  // ==========================================================================
  // Track Navigation
  // ==========================================================================

  /** Skip to next track */
  async nextTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.NextTrack);
  }

  /** Skip to previous track */
  async previousTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.PreviousTrack);
  }

  /** Next chapter (for video content) */
  async nextChapter(): Promise<CommandResult> {
    return this.sendCommand(Command.NextChapter);
  }

  /** Previous chapter (for video content) */
  async previousChapter(): Promise<CommandResult> {
    return this.sendCommand(Command.PreviousChapter);
  }

  // ==========================================================================
  // Fast Forward / Rewind
  // ==========================================================================

  /** Begin fast forward */
  async beginFastForward(): Promise<CommandResult> {
    return this.sendCommand(Command.BeginFastForward);
  }

  /** End fast forward */
  async endFastForward(): Promise<CommandResult> {
    return this.sendCommand(Command.EndFastForward);
  }

  /** Begin rewind */
  async beginRewind(): Promise<CommandResult> {
    return this.sendCommand(Command.BeginRewind);
  }

  /** End rewind */
  async endRewind(): Promise<CommandResult> {
    return this.sendCommand(Command.EndRewind);
  }

  // ==========================================================================
  // Skipping
  // ==========================================================================

  /** Skip forward 15 seconds */
  async skipForward15(): Promise<CommandResult> {
    return this.sendCommand(Command.FastForward15Seconds);
  }

  /** Skip backward 15 seconds */
  async skipBackward15(): Promise<CommandResult> {
    return this.sendCommand(Command.Rewind15Seconds);
  }

  /** Skip forward 30 seconds */
  async skipForward30(): Promise<CommandResult> {
    return this.sendCommand(Command.FastForward30Seconds);
  }

  /** Skip backward 30 seconds */
  async skipBackward30(): Promise<CommandResult> {
    return this.sendCommand(Command.Rewind30Seconds);
  }

  /**
   * Skip forward by a custom interval.
   *
   * @param seconds - Number of seconds to skip forward
   */
  async skipForward(seconds: number): Promise<CommandResult> {
    return this.sendCommand(Command.SkipForward, { skipInterval: seconds });
  }

  /**
   * Skip backward by a custom interval.
   *
   * @param seconds - Number of seconds to skip backward
   */
  async skipBackward(seconds: number): Promise<CommandResult> {
    return this.sendCommand(Command.SkipBackward, { skipInterval: seconds });
  }

  // ==========================================================================
  // Seeking & Playback Rate
  // ==========================================================================

  /**
   * Seek to a specific playback position.
   *
   * @param position - Position in seconds
   */
  async seekTo(position: number): Promise<CommandResult> {
    return this.sendCommand(Command.SeekToPlaybackPosition, {
      playbackPosition: position,
    });
  }

  /**
   * Change the playback rate.
   *
   * @param rate - Playback rate (e.g., 0.5, 1.0, 1.5, 2.0)
   */
  async setPlaybackRate(rate: number): Promise<CommandResult> {
    return this.sendCommand(Command.ChangePlaybackRate, {
      playbackRate: rate,
    });
  }

  // ==========================================================================
  // Shuffle & Repeat Modes
  // ==========================================================================

  /** Advance shuffle mode (cycle through modes) */
  async advanceShuffleMode(): Promise<CommandResult> {
    return this.sendCommand(Command.AdvanceShuffleMode);
  }

  /** Advance repeat mode (cycle through modes) */
  async advanceRepeatMode(): Promise<CommandResult> {
    return this.sendCommand(Command.AdvanceRepeatMode);
  }

  /**
   * Set repeat mode to a specific value.
   *
   * @param mode - Repeat mode (Off, One/Track, All)
   */
  async setRepeatMode(mode: RepeatMode_Enum): Promise<CommandResult> {
    return this.sendCommand(Command.ChangeRepeatMode, {
      repeatMode: mode,
      sendOptions: 0,
    });
  }

  /**
   * Set shuffle mode to a specific value.
   *
   * @param mode - Shuffle mode (Off, Albums, Songs)
   */
  async setShuffleMode(mode: ShuffleMode_Enum): Promise<CommandResult> {
    return this.sendCommand(Command.ChangeShuffleMode, {
      shuffleMode: mode,
      sendOptions: 0,
    });
  }

  // ==========================================================================
  // Rating & Library (music apps)
  // ==========================================================================

  /** Like the now-playing track (e.g. Apple Music thumbs up). */
  async likeTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.LikeTrack);
  }

  /** Dislike the now-playing track. */
  async dislikeTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.DislikeTrack);
  }

  /** Ban the now-playing track (radio "never play this"). */
  async banTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.BanTrack);
  }

  /** Bookmark the now-playing track. */
  async bookmarkTrack(): Promise<CommandResult> {
    return this.sendCommand(Command.BookmarkTrack);
  }

  /**
   * Set an explicit rating on the now-playing track.
   *
   * @param rating - Rating from 0.0 to 1.0 (clamped).
   */
  async rateTrack(rating: number): Promise<CommandResult> {
    return this.sendCommand(Command.RateTrack, {
      rating: Math.max(0, Math.min(1, rating)),
    });
  }

  /** Add the now-playing track to the user's wish list. */
  async addToWishList(): Promise<CommandResult> {
    return this.sendCommand(Command.AddTrackToWishList);
  }

  /** Remove the now-playing track from the user's wish list. */
  async removeFromWishList(): Promise<CommandResult> {
    return this.sendCommand(Command.RemoveTrackFromWishList);
  }

  // ==========================================================================
  // Album / Playlist Navigation
  // ==========================================================================

  /** Skip to the next album. */
  async nextAlbum(): Promise<CommandResult> {
    return this.sendCommand(Command.NextAlbum);
  }

  /** Skip to the previous album. */
  async previousAlbum(): Promise<CommandResult> {
    return this.sendCommand(Command.PreviousAlbum);
  }

  /** Skip to the next playlist. */
  async nextPlaylist(): Promise<CommandResult> {
    return this.sendCommand(Command.NextPlaylist);
  }

  /** Skip to the previous playlist. */
  async previousPlaylist(): Promise<CommandResult> {
    return this.sendCommand(Command.PreviousPlaylist);
  }
}
