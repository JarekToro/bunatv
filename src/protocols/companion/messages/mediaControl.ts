import {
  type CompanionCommand,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  type CompanionEventOpackMessage,
  createCompanionCommand,
} from "@/protocols/companion/messages/CompanionOpackMessage.ts";

export enum MediaControlCommand {
  Play = 1,
  Pause = 2,
  NextTrack = 3,
  PreviousTrack = 4,
  GetVolume = 5,
  SetVolume = 6,
  SkipBy = 7,
  FastForwardBegin = 8,
  FastForwardEnd = 9,
  RewindBegin = 10,
  RewindEnd = 11,
  GetCaptionSettings = 12,
  SetCaptionSettings = 13,
}

export type RequestResponseMapping = {
  [MediaControlCommand.Play]: [never, never];
  [MediaControlCommand.Pause]: [never, never];
  [MediaControlCommand.NextTrack]: [never, never];
  [MediaControlCommand.PreviousTrack]: [never, never];
  [MediaControlCommand.GetVolume]: [never, { _vol: number }];
  [MediaControlCommand.SetVolume]: [{ _vol: number }, never];
  [MediaControlCommand.SkipBy]: [{ _skpS: number }, never];
  [MediaControlCommand.FastForwardBegin]: [never, never];
  [MediaControlCommand.FastForwardEnd]: [never, never];
  [MediaControlCommand.RewindBegin]: [never, never];
  [MediaControlCommand.RewindEnd]: [never, never];
  [MediaControlCommand.GetCaptionSettings]: [never, never]; // TODO: Define caption settings response
  [MediaControlCommand.SetCaptionSettings]: [
    {
      /* caption settings */
    },
    never,
  ]; // TODO: Define caption settings request
};

export type MediaControlRequestContent<T extends MediaControlCommand> = {
  _mcc: T;
} & RequestResponseMapping[T][0];

export interface MediaControlRequest<
  T extends MediaControlCommand = MediaControlCommand,
> extends CompanionRequestOpackMessage {
  _i: "_mcc";
  _c: MediaControlRequestContent<T>;
}

export type MediaControlResponseContent<T extends MediaControlCommand> =
  RequestResponseMapping[T][1];

export interface MediaControlResponse<
  T extends MediaControlCommand = MediaControlCommand,
> extends CompanionResponseOpackMessage {
  _i: "_mcc";
  _c: MediaControlResponseContent<T>;
}

// Media Control Flags
export enum MediaControlFlags {
  Play = 0x0001,
  Pause = 0x0002,
  NextTrack = 0x0004,
  PreviousTrack = 0x0008,
  FastForward = 0x0010,
  Rewind = 0x0020,
  Volume = 0x0100,
  SkipForward = 0x0200,
  SkipBackward = 0x0400,
}

export interface MediaControlEventContent {
  _mcF: number;
}

export interface MediaControlEvent extends CompanionEventOpackMessage {
  _i: "_iMC";
  _c: MediaControlEventContent;
}

export interface ParsedMediaControlEvent {
  type: "media-control";
  controls: MediaControl[];
  raw: MediaControlEvent;
}

export function parseMediaControlEvent(
  message: MediaControlEvent
): ParsedMediaControlEvent {
  const flags = message._c._mcF;
  const controls = getMediaControls(flags);
  return {
    type: "media-control",
    controls,
    raw: message,
  };
}

export enum MediaControl {
  Play = "Play",
  Pause = "Pause",
  NextTrack = "NextTrack",
  PreviousTrack = "PreviousTrack",
  FastForward = "FastForward",
  Rewind = "Rewind",
  Volume = "Volume",
  SkipForward = "SkipForward",
  SkipBackward = "SkipBackward",
}
function getMediaControls(flags: number): MediaControl[] {
  const controls: MediaControl[] = [];
  if (flags & MediaControlFlags.Play) controls.push(MediaControl.Play);
  if (flags & MediaControlFlags.Pause) controls.push(MediaControl.Pause);
  if (flags & MediaControlFlags.NextTrack)
    controls.push(MediaControl.NextTrack);
  if (flags & MediaControlFlags.PreviousTrack)
    controls.push(MediaControl.PreviousTrack);
  if (flags & MediaControlFlags.FastForward)
    controls.push(MediaControl.FastForward);
  if (flags & MediaControlFlags.Rewind) controls.push(MediaControl.Rewind);
  if (flags & MediaControlFlags.Volume) controls.push(MediaControl.Volume);
  if (flags & MediaControlFlags.SkipForward)
    controls.push(MediaControl.SkipForward);
  if (flags & MediaControlFlags.SkipBackward)
    controls.push(MediaControl.SkipBackward);
  return controls;
}

function hasControl(flags: number, control: MediaControlFlags): boolean {
  return (flags & control) !== 0;
}

// Overload for commands without args
function createMediaCommand<
  TCommand extends MediaControlCommand,
  TResponse = void,
>(config: {
  name: string;
  command: TCommand;
  buildContent?: never;
  parseResponse?: (content: MediaControlResponseContent<TCommand>) => TResponse;
}): () => CompanionCommand<
  MediaControlRequest<TCommand>,
  MediaControlResponse<TCommand>,
  TResponse
>;
// Overload for commands with args
function createMediaCommand<
  TCommand extends MediaControlCommand,
  TResponse = void,
>(config: {
  name: string;
  command: TCommand;
  buildContent: (
    args: RequestResponseMapping[TCommand][0]
  ) => RequestResponseMapping[TCommand][0];
  parseResponse?: (content: MediaControlResponseContent<TCommand>) => TResponse;
}): (
  args: RequestResponseMapping[TCommand][0]
) => CompanionCommand<
  MediaControlRequest<TCommand>,
  MediaControlResponse<TCommand>,
  TResponse
>;
function createMediaCommand<
  TCommand extends MediaControlCommand,
  TResponse = void,
  TArgs = RequestResponseMapping[TCommand][0],
>(config: {
  name: string;
  command: TCommand;
  buildContent?: (args: TArgs) => RequestResponseMapping[TCommand][0];
  parseResponse?: (content: MediaControlResponseContent<TCommand>) => TResponse;
}) {
  return (args?: TArgs) =>
    createCompanionCommand<
      MediaControlRequest<TCommand>,
      MediaControlResponse<TCommand>,
      TResponse
    >({
      identifier: "_mcc",
      name: config.name,
      buildContent: () =>
        ({
          _mcc: config.command,
          ...(config.buildContent ? config.buildContent(args!) : {}),
        }) as MediaControlRequestContent<TCommand>,
      parse: (response) => {
        if (config.parseResponse) {
          return config.parseResponse(response._c);
        }
        return undefined as TResponse;
      },
    });
}

// Simple commands
export const createPlayCommand = createMediaCommand({
  name: "Play",
  command: MediaControlCommand.Play,
});

export const createPauseCommand = createMediaCommand({
  name: "Pause",
  command: MediaControlCommand.Pause,
});

export const createNextTrackCommand = createMediaCommand({
  name: "NextTrack",
  command: MediaControlCommand.NextTrack,
});

export const createPreviousTrackCommand = createMediaCommand({
  name: "PreviousTrack",
  command: MediaControlCommand.PreviousTrack,
});

export const createFastForwardBeginCommand = createMediaCommand({
  name: "FastForwardBegin",
  command: MediaControlCommand.FastForwardBegin,
});

export const createFastForwardEndCommand = createMediaCommand({
  name: "FastForwardEnd",
  command: MediaControlCommand.FastForwardEnd,
});

export const createRewindBeginCommand = createMediaCommand({
  name: "RewindBegin",
  command: MediaControlCommand.RewindBegin,
});

export const createRewindEndCommand = createMediaCommand({
  name: "RewindEnd",
  command: MediaControlCommand.RewindEnd,
});

export const createSkipByCommand = createMediaCommand({
  name: "SkipBy",
  command: MediaControlCommand.SkipBy,
  buildContent: ({ _skpS }) => ({ _skpS }),
});

// Command with response parsing
export const createGetVolumeCommand = createMediaCommand({
  name: "GetVolume",
  command: MediaControlCommand.GetVolume,
  parseResponse: (content) => content._vol,
});
export const createSetVolumeCommand = createMediaCommand({
  name: "SetVolume",
  command: MediaControlCommand.SetVolume,
  buildContent: ({ _vol }) => ({ _vol }),
});
export const createGetCaptionSettingsCommand = createMediaCommand({
  name: "GetCaptionSettings",
  command: MediaControlCommand.GetCaptionSettings,
});

export const createSetCaptionSettingsCommand = createMediaCommand({
  name: "SetCaptionSettings",
  command: MediaControlCommand.SetCaptionSettings,
});
