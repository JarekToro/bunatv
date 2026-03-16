import type { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";
import {
  PlaybackState_Enum,
  playbackState_EnumToJSON,
} from "@/protocols/mrp/generated/foundation/Common.ts";
import type { NowPlayingInfo } from "@/protocols/mrp/generated/types/media/NowPlayingInfo.ts";
import type { ContentItem } from "@/protocols/mrp/generated/types/media/ContentItem.ts";
import {
  Command,
  type CommandInfo,
} from "@/protocols/mrp/generated/types/media/CommandInfo.ts";
import type { PlaybackQueueCapabilities } from "@/protocols/mrp/generated/types/playback/PlaybackQueueCapabilities.ts";
import {
  type NowPlayingPlayer,
  NowPlayingPlayer_AudioSessionType,
} from "@/protocols/mrp/generated/types/playback/NowPlayingPlayer.ts";
import type { ContentItemMetadata } from "@/protocols/mrp/generated/types/media/ContentItemMetadata.ts";
import type { SetStateMessage } from "@/protocols/mrp/generated/messages/playback/SetStateMessage.ts";
import type { NowPlayingClient } from "@/protocols/mrp/generated/types/playback/NowPlayingClient.ts";
import { EmitterEx } from "@/core/eventing/EmitterEx.ts";
import { LRUCache } from "lru-cache";
import { ProtocolMessage_Type } from "@/protocols/mrp/generated/protocol/ProtocolMessage.ts";
import { PlaybackQueueRequestMessage } from "@/protocols/mrp/generated/messages/playback/PlaybackQueueRequestMessage.ts";
import { EventEmitter } from "eventemitter3";
import { GetStateMessage } from "@/protocols/mrp/generated/messages/client/GetStateMessage.ts";
import type { DePlistify } from "@/core/utils/types.ts";
import { Plist } from "@/core/encoding/plist.ts";
import { createLogger } from "@/logging/logging.ts";
import { SendLyricsEventMessage } from "@/protocols/mrp/generated/messages/playback/SendLyricsEventMessage.ts";

const logger = createLogger("bunatv:mrp:player-state");

/**
 * CFAbsoluteTime epoch offset: seconds between Unix epoch (1970-01-01)
 * and Cocoa epoch (2001-01-01). Set to 0 if your protobuf layer already
 * normalizes timestamps to Unix.
 */
const COCOA_EPOCH_OFFSET = 978307200;

const DEFAULT_PLAYER_ID = "MediaRemote-DefaultPlayer";

/** Convert a protocol timestamp to Unix seconds. */
function toUnixSeconds(protocolTimestamp: number): number {
  return protocolTimestamp + COCOA_EPOCH_OFFSET;
}

/** Current time in Unix seconds. */
function nowUnix(): number {
  return Date.now() / 1000;
}

/**
 * Extrapolate elapsed time from a snapshot.
 * Returns the snapshot value if rate is zero or timestamp is missing.
 */
function extrapolateElapsed(
  elapsedTime: number,
  snapshotTimestamp: number | undefined,
  playbackRate: number | undefined
): number {
  if (snapshotTimestamp == null || !playbackRate) {
    return elapsedTime;
  }
  const delta = (nowUnix() - toUnixSeconds(snapshotTimestamp)) * playbackRate;
  return Math.max(0, elapsedTime + delta);
}

const artworkCache = new LRUCache<string, Buffer>({
  max: 100,
  ttl: 1000 * 60 * 60,
});

// ─── Player ──────────────────────────────────────────────────
export type ProcessedContentItemMetaData = DePlistify<
  ContentItemMetadata,
  | "nowPlayingInfoData"
  | "collectionInfoData"
  | "transitionInfoData"
  | "purchaseInfoData"
  | "appMetricsData"
  | "artworkURLTemplatesData"
  | "currentPlaybackDateData"
  | "deviceSpecificUserInfoData"
  | "userInfoData"
>;

export type ProcessedContentItem = Omit<ContentItem, "metadata"> & {
  metadata?: ProcessedContentItemMetaData;
};

type PlayerStateEvents = {
  activeItemChange: (event: {
    previous: ProcessedContentItem | undefined;
    current: (ProcessedContentItem & { location: number }) | undefined;
  }) => void;
};

export class PlayerState extends EventEmitter<PlayerStateEvents> {
  identifier: string | undefined;
  displayName: string | undefined;
  audioSessionType: NowPlayingPlayer_AudioSessionType | undefined;

  // Raw state
  private _playbackState: PlaybackState_Enum | undefined;
  private _playbackStateTimestamp: number | undefined;
  private _nowPlayingInfo: NowPlayingInfo | undefined;
  private _items: ProcessedContentItem[] = [];
  private _location: number = 0;
  private _supportedCommands: CommandInfo[] = [];
  private _queueCapabilities: PlaybackQueueCapabilities | undefined;
  private _lastItem: ProcessedContentItem | undefined;

  constructor(
    public readonly clientBundleId: string,
    player: NowPlayingPlayer
  ) {
    super();
    this.identifier = player.identifier;
    this.displayName = player.displayName;
    this.audioSessionType = player.audioSessionType;
  }

  get isValid(): boolean {
    return this.identifier != null && this.identifier !== "";
  }

  // On PlayerState:
  findCommand(
    command: Command,
    clientCommands: readonly CommandInfo[]
  ): CommandInfo | undefined {
    for (const cmd of this._supportedCommands) {
      if (cmd.command === command) return cmd;
    }
    // Fall back to client-level defaults
    for (const cmd of clientCommands) {
      if (cmd.command === command) return cmd;
    }
    return undefined;
  }
  // ── Queue accessors ──

  get currentItem(): ProcessedContentItem | undefined {
    return this._items[this._location];
  }

  get metadata(): ProcessedContentItemMetaData | undefined {
    return this.currentItem?.metadata;
  }

  get itemIdentifier(): string | undefined {
    return this.currentItem?.identifier;
  }

  get queueItems(): readonly ProcessedContentItem[] {
    return this._items;
  }

  get queueLocation(): number {
    return this._location;
  }

  get queueCapabilities(): PlaybackQueueCapabilities | undefined {
    return this._queueCapabilities;
  }

  // ── Commands ──

  get supportedCommands(): readonly CommandInfo[] {
    return this._supportedCommands;
  }

  get nowPlayingInfo(): NowPlayingInfo | undefined {
    return this._nowPlayingInfo ?? this.currentItem;
  }

  /** Inline artwork data if present on the current item. */
  get artworkData(): Buffer | undefined {
    return this.currentItem?.artworkData;
  }

  get artworkWidth(): number | undefined {
    return (
      this.currentItem?.artworkDataWidth ?? this.metadata?.artworkDataWidth
    );
  }

  get artworkHeight(): number | undefined {
    return (
      this.currentItem?.artworkDataHeight ?? this.metadata?.artworkDataHeight
    );
  }

  get artworkAvailable(): boolean {
    return this.metadata?.artworkAvailable === true;
  }

  // ── Playback state ──

  /** Raw playback state as reported by the device. */
  get rawPlaybackState(): PlaybackState_Enum | undefined {
    return this._playbackState;
  }

  /**
   * Interpreted playback state that accounts for playbackRate.
   * - Playing + rate 0   → Paused
   * - Playing + rate ≈1  → Playing
   * - Playing + rate else → Seeking
   * - Paused + no metadata → Idle (not paused)
   * All other raw states pass through.
   */
  get playbackState(): PlaybackState_Enum | undefined {
    if (this._playbackState == null) return undefined;

    // Paused with nothing in the queue means idle, not paused
    if (this._playbackState === PlaybackState_Enum.Paused) {
      return this.metadata != null ? PlaybackState_Enum.Paused : undefined;
    }

    // Only interpret rate for Playing state
    if (this._playbackState !== PlaybackState_Enum.Playing) {
      return this._playbackState;
    }

    const rate =
      this._nowPlayingInfo?.playbackRate ?? this.metadata?.playbackRate;
    if (rate == null) return this._playbackState;

    if (rate === 0) return PlaybackState_Enum.Paused;
    if (Math.abs(rate - 1.0) < 0.01) return PlaybackState_Enum.Playing;
    return PlaybackState_Enum.Seeking;
  }
  // ── Time ──

  /** Duration from the best available source. */
  get duration(): number | undefined {
    return this._nowPlayingInfo?.duration ?? this.metadata?.duration;
  }

  /**
   * Current playback position in seconds, extrapolated from the most
   * recent snapshot using playbackRate. Returns the raw snapshot value
   * when rate is 0 or timestamps are unavailable.
   */
  get elapsedTime(): number | undefined {
    // Prefer nowPlayingInfo — it's the live ticker
    const npi = this._nowPlayingInfo;
    if (npi?.elapsedTime != null) {
      return extrapolateElapsed(
        npi.elapsedTime,
        npi.timestamp,
        npi.playbackRate
      );
    }

    // Fall back to queue item metadata
    const meta = this.metadata;
    if (meta?.elapsedTime != null) {
      return extrapolateElapsed(
        meta.elapsedTime,
        meta.elapsedTimeTimestamp,
        meta.playbackRate
      );
    }

    return undefined;
  }

  /** Playback progress as 0..1, or undefined if duration is unknown/zero. */
  get progress(): number | undefined {
    const elapsed = this.elapsedTime;
    const dur = this.duration;
    if (elapsed == null || dur == null || dur <= 0) return undefined;
    return Math.min(1, Math.max(0, elapsed / dur));
  }

  handleSetState(msg: SetStateMessage) {
    if (!this.shouldApply(msg.playbackStateTimestamp)) {
      return;
    }

    if (msg.playbackState != null) {
      this._playbackState = msg.playbackState;
    }

    if (msg.playbackStateTimestamp != null) {
      this._playbackStateTimestamp = msg.playbackStateTimestamp;
    }

    if (msg.nowPlayingInfo != null) {
      this._nowPlayingInfo = msg.nowPlayingInfo;
    }

    if (msg.supportedCommands != null) {
      this._supportedCommands = msg.supportedCommands.supportedCommands;
    }

    if (msg.playbackQueue != null) {
      this._items = msg.playbackQueue.contentItems.map((item) =>
        this.processContentItem(item)
      );
      this._location = msg.playbackQueue.location ?? 0;
    }

    if (msg.playbackQueueCapabilities != null) {
      this._queueCapabilities = msg.playbackQueueCapabilities;
    }
    this.emitIfItemChanged();
    return;
  }
  updateFromPlayer(player: NowPlayingPlayer): void {
    if (player.displayName != null) {
      this.displayName = player.displayName;
    }
    if (player.audioSessionType != null) {
      this.audioSessionType = player.audioSessionType;
    }
  }
  handleContentItemUpdate(updatedItems: ContentItem[]): void {
    for (const item of updatedItems) {
      const updated = this.processContentItem(item);
      if (updated.identifier == null) continue;

      const existing = this._items.find(
        (item) => item.identifier === updated.identifier
      );
      if (!existing) continue;

      if (updated.metadata != null) {
        if (existing.metadata != null) {
          // Shallow merge — only overwrite fields that are actually present
          // in the update, preserving existing values for the rest
          for (const [key, value] of Object.entries(updated.metadata)) {
            if (value != null) {
              (existing.metadata as any)[key] = value;
            }
          }
        } else {
          existing.metadata = updated.metadata;
        }
      }

      // Merge other top-level ContentItem fields if present
      if (updated.artworkData != null)
        existing.artworkData = updated.artworkData;
      if (updated.lyrics != null) existing.lyrics = updated.lyrics;
      if (updated.info != null) existing.info = updated.info;
      this.emitIfItemChanged();
    }
  }
  private shouldApply(incomingTimestamp: number | undefined): boolean {
    if (incomingTimestamp == null || this._playbackStateTimestamp == null) {
      return true;
    }
    return incomingTimestamp >= this._playbackStateTimestamp;
  }

  private emitIfItemChanged(): void {
    const currentId = this.currentItem?.identifier;
    const currentLocation =
      this.queueItems.findIndex((item) => item.identifier === currentId) ??
      this._location;
    if (currentId !== this._lastItem?.identifier) {
      this.emit("activeItemChange", {
        previous: this._lastItem ? { ...this._lastItem } : undefined,
        current: this.currentItem
          ? { ...this.currentItem!, location: currentLocation }
          : undefined,
      });
      this._lastItem = this.currentItem ? { ...this.currentItem } : undefined;
    }
  }

  private processContentItem(item: ContentItem): ProcessedContentItem {
    if (item.metadata) {
      return {
        ...item,
        metadata: this.processMetadata(item.metadata),
      };
    }
    return item as ProcessedContentItem;
  }
  private processMetadata(
    metadata: ContentItemMetadata
  ): ProcessedContentItemMetaData {
    const fieldsToDecode = [
      "nowPlayingInfoData",
      "collectionInfoData",
      "transitionInfoData",
      "purchaseInfoData",
      "appMetricsData",
      "artworkURLTemplatesData",
      "currentPlaybackDateData",
      "deviceSpecificUserInfoData",
      "userInfoData",
    ] as const;

    const {
      nowPlayingInfoData,
      collectionInfoData,
      transitionInfoData,
      purchaseInfoData,
      appMetricsData,
      artworkURLTemplatesData,
      currentPlaybackDateData,
      deviceSpecificUserInfoData,
      userInfoData,
      ...rest
    } = metadata;
    const processed: Partial<ProcessedContentItemMetaData> = { ...rest };
    for (const key of fieldsToDecode) {
      let buf = metadata[key];
      if (buf) {
        try {
          const value = Plist.decode(buf);
          if (value) {
            processed[key] = value;
          }
        } catch (e) {
          logger.warn(e, `Failed to decode metadata field ${key} as plist`);
        }
      }
    }
    return processed as ProcessedContentItemMetaData;
  }

  exportState(): Record<string, any> {
    return {
      identifier: this.identifier,
      displayName: this.displayName,
      audioSessionType: this.audioSessionType,
      playbackState: playbackState_EnumToJSON(this.playbackState!),
      rawPlaybackState: playbackState_EnumToJSON(this.rawPlaybackState!),
      duration: this.duration,
      elapsedTime: this.elapsedTime,
      progress: this.progress,
      supportedCommands: this.supportedCommands,
      nowPlayingInfo: this.nowPlayingInfo,
      queueItems: this.queueItems,
      queueLocation: this.queueLocation,
      queueCapabilities: this.queueCapabilities,
    };
  }
}

// ─── Client ──────────────────────────────────────────────────

export class ClientState {
  bundleIdentifier: string;
  displayName: string | undefined;
  supportedCommands: CommandInfo[] = [];
  players = new Map<string, PlayerState>();
  private _activePlayerId: string | undefined;

  constructor(client: NowPlayingClient) {
    this.bundleIdentifier = client.bundleIdentifier ?? "";
    this.displayName = client.displayName;
  }

  get activePlayer(): PlayerState | undefined {
    if (this._activePlayerId != null) {
      return this.players.get(this._activePlayerId);
    }
    return this.players.get(DEFAULT_PLAYER_ID);
  }

  set activePlayer(player: PlayerState | undefined) {
    this._activePlayerId = player?.identifier;
  }

  getOrCreatePlayer(player: NowPlayingPlayer): PlayerState {
    const id = player.identifier ?? "";
    let existing = this.players.get(id);
    if (!existing) {
      existing = new PlayerState(this.bundleIdentifier, player);
      this.players.set(id, existing);
    } else {
      existing.updateFromPlayer(player);
    }
    return existing;
  }
  updateFromClient(client: NowPlayingClient): void {
    if (client.displayName != null) {
      this.displayName = client.displayName;
    }
  }

  exportState(): Record<string, any> {
    const players: Record<string, any> = {};
    for (const [id, player] of this.players.entries()) {
      players[id] = player.exportState();
    }
    return {
      bundleIdentifier: this.bundleIdentifier,
      displayName: this.displayName,
      supportedCommands: this.supportedCommands,
      players,
      activePlayerId: this._activePlayerId,
    };
  }
}

// ─── Top-level state manager ─────────────────────────────────

export class MRPPlayerState {
  private clients = new Map<string, ClientState>();
  private _activeClientBundleId: string | undefined;

  private boundPlayers = new Set<PlayerState>();

  additionalDataRequested = new Set<string>();

  constructor(private protocol: MRPProtocol) {
    this.protocol.on("message:SET_STATE_MESSAGE", (message) => {
      const msg = message.innerMessage;

      const client = this.resolveClient(msg.playerPath);
      const player = this.resolvePlayer(msg.playerPath, client);
      if (!player) return;
      player.handleSetState(msg);
      this.persistStateToFile();
    });
    this.protocol.on("message:UPDATE_PLAYER_MESSAGE", (message) => {
      const msg = message.innerMessage;
      const client = this.resolveClient(msg.playerPath);

      if (!client) return;

      const player = msg.playerPath?.player;
      if (!player) return;

      // Update existing player metadata, or create if new
      client.getOrCreatePlayer(player);
      this.persistStateToFile();
    });
    this.protocol.on("message:UPDATE_CONTENT_ITEM_MESSAGE", (message) => {
      const msg = message.innerMessage;
      const client = this.resolveClient(msg.playerPath);

      const player = this.resolvePlayer(msg.playerPath, client);
      if (!player) return;

      player.handleContentItemUpdate(msg.contentItems);
      this.persistStateToFile();
    });
    this.protocol.on("message:SET_NOW_PLAYING_CLIENT_MESSAGE", (message) => {
      const msg = message.innerMessage;

      if (!msg.client?.bundleIdentifier) return;

      const client = this.getOrCreateClient(msg.client);
      this._activeClientBundleId = client.bundleIdentifier;
      this.persistStateToFile();
    });
    this.protocol.on("message:SET_NOW_PLAYING_PLAYER_MESSAGE", (message) => {
      const msg = message.innerMessage;

      const client = this.resolveClient(msg.playerPath);
      if (!client || !msg.playerPath?.player) return;

      const player = client.getOrCreatePlayer(msg.playerPath.player);
      client.activePlayer = player;
      this.persistStateToFile();
    });
    this.protocol.on("message:UPDATE_CLIENT_MESSAGE", (message) => {
      const msg = message.innerMessage;
      if (!msg.client?.bundleIdentifier) return;

      this.getOrCreateClient(msg.client);
      this.persistStateToFile();
    });
    this.protocol.on("message:REMOVE_CLIENT_MESSAGE", (message) => {
      const msg = message.innerMessage;
      const bundleId = msg.client?.bundleIdentifier;
      if (!bundleId) return;

      this.clients.delete(bundleId);

      if (this._activeClientBundleId === bundleId) {
        this._activeClientBundleId = undefined;
      }
      this.persistStateToFile();
    });
    this.protocol.on("message:REMOVE_PLAYER_MESSAGE", (message) => {
      const msg = message.innerMessage;

      const client = this.resolveClient(msg.playerPath);
      if (!client) return;

      const playerId = msg.playerPath?.player?.identifier;
      if (!playerId) return;

      const wasActive = client.activePlayer?.identifier === playerId;
      client.players.delete(playerId);

      if (wasActive) {
        client.activePlayer = undefined;
      }
      this.persistStateToFile();
    });
    this.protocol.on(
      "message:SET_DEFAULT_SUPPORTED_COMMANDS_MESSAGE",
      (message) => {
        const msg = message.innerMessage;

        const client = this.resolveClient(msg.playerPath);
        if (!client) return;

        if (msg.supportedCommands != null) {
          client.supportedCommands = msg.supportedCommands.supportedCommands;
        }
        this.persistStateToFile();
      }
    );
    this.protocol.on("message:PLAYER_CLIENT_PROPERTIES_MESSAGE", (message) => {
      const msg = message.innerMessage;
      this.resolveClient(msg.playerPath);
    });
  }
  /**
   * Clean up all per-player listeners added by bindActiveItemChange.
   * Called from MRPApi.disconnect() to prevent listener leaks.
   */
  cleanup(): void {
    for (const player of this.boundPlayers) {
      player.removeAllListeners();
    }
    this.boundPlayers.clear();
    this.additionalDataRequested.clear();
    this.clients.clear();
    this._activeClientBundleId = undefined;
  }

  get activeClient(): ClientState | undefined {
    if (this._activeClientBundleId == null) return undefined;
    return this.clients.get(this._activeClientBundleId);
  }
  private getOrCreateClient(nowPlayingClient: NowPlayingClient): ClientState {
    const id = nowPlayingClient.bundleIdentifier ?? "";
    let existing = this.clients.get(id);
    if (!existing) {
      existing = new ClientState(nowPlayingClient);
      this.clients.set(id, existing);
    } else {
      existing.updateFromClient(nowPlayingClient);
    }
    return existing;
  }

  private persistStateToFile() {
    const clientStates: Record<string, any> = {};
    for (const [bundleId, client] of this.clients.entries()) {
      clientStates[bundleId] = client.exportState();
    }
    const state = {
      activeClientBundleId: this._activeClientBundleId,
      clients: clientStates,
    };
  }
  private resolveClient(
    playerPath: { client?: NowPlayingClient } | undefined
  ): ClientState | undefined {
    if (!playerPath?.client?.bundleIdentifier) return undefined;
    return this.getOrCreateClient(playerPath.client);
  }

  private resolvePlayer(
    playerPath: SetStateMessage["playerPath"],
    client: ClientState | undefined
  ): PlayerState | undefined {
    if (!client) return undefined;
    const player = playerPath?.player ?? { mxSessionIDs: [] };
    const state = client.getOrCreatePlayer(player);
    this.bindActiveItemChange(state);
    return state;
  }

  private bindActiveItemChange(player: PlayerState) {
    if (this.boundPlayers.has(player)) return;
    this.boundPlayers.add(player);

    player.on("activeItemChange", ({ current }) => {
      if (!current?.identifier) return;
      if (!current.metadata?.artworkAvailable) return;

      // Already have it inline
      if (current.artworkData?.length) {
        artworkCache.set(current.identifier, current.artworkData);
        return;
      }

      // Already cached from a previous item with same id
      if (artworkCache.has(current.identifier)) return;

      // Already sent the request
      if (this.additionalDataRequested.has(current.identifier)) return;

      this.additionalDataRequested.add(current.identifier);

      this.protocol.send({
        extensionType: ProtocolMessage_Type.PLAYBACK_QUEUE_REQUEST_MESSAGE,
        message: PlaybackQueueRequestMessage.create({
          length: 1,
          location: 0,
          includeMetadata: true,
          includeLyrics: true,
          includeInfo: true,
          includeSections: true,
          includeAlignments: true,
          includeLanguageOptions: true,
          returnContentItemAssetsInUserCompletion: true,
          includeParticipants: true,
          artworkHeight: -1,
          artworkWidth: 300,
          isLegacyNowPlayingInfoRequest: true,
          includeAvailableArtworkFormats: true,
          playerPath: {
            player: {
              identifier: player.identifier,
            },
            client: {
              bundleIdentifier: player.clientBundleId,
            },
          },
        }),
      });
    });
  }
}
