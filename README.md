# BunATV

> **Work in progress / alpha**
>
> This project is actively evolving and should be considered **unstable**. APIs, CLI flags, output formats, and credential storage may change without notice.

A TypeScript/Bun library for controlling Apple TV devices over your local network. BunATV implements Apple’s Companion, MRP (Media Remote Protocol), and AirPlay 2 protocols, giving you direct access to the messages each protocol sends — no abstraction facades, no magic grouping.

## What is BunATV?

BunATV is a **library-first** project. It exposes the raw protocol interfaces for Apple TV device control: discovery, pairing, remote input, volume, power, media playback, app launching, text input, and more. Each protocol’s API maps closely to what actually goes over the wire.

A CLI (`bunatv`) is included for convenience, but it’s a thin layer on top of the library and doesn’t expose every feature. The library is the primary interface.

## Goals

- **Learn by building.** Understand Apple’s device control protocols by implementing them from scratch in TypeScript — not by wrapping or porting an existing library.
- **Protocol transparency.** Provide an API that’s faithful to the underlying protocols, exposing raw messages and data structures without hiding them behind high-level abstractions.
- **Reverse engineer the undocumented.** Many aspects of these protocols are not publicly documented. This project is an opportunity to reverse engineer (Many additional MRP messages have been found using ghidra on Apple Frameworks)
- **Improve stuff that interest me** Millisecond-precision elapsed time extrapolation, TTL-aware mDNS caching that makes subsequent lookups fast, and Bun’s performance characteristics for real-world automation.

## What BunATV is NOT

- **Not a PyATV port.** BunATV is deeply inspired by [PyATV](https://github.com/postlund/pyatv) and builds on its research, but it is a ground-up TypeScript implementation with a different design philosophy — not a line-by-line translation.
- **Not a streaming app.** BunATV controls Apple TV devices. It does not (yet) stream audio or video to them.
- **Not CLI-first.** The CLI is a convenience tool and will likely be rewritten. Not all implemented features are exposed there. The library API is the intended interface.

## Status

- **Companion Protocol:** working — pairing, connection, remote control, volume, power, app launch, text input, touch
- **MRP Protocol:** functional — core remote, playback, and now-playing working; many advanced message types (voice, game controllers, keyboard) unhandled
- **AirPlay 2:** infrastructure implemented (transport, auth, framing) — used as MRP’s underlying transport
- **RAOP (AirPlay 1 audio):** streaming stack implemented — RTSP ANNOUNCE/SETUP/RECORD, UDP RTP audio, sync packets, retransmit backlog, DAAP metadata
- **CLI:** functional for discovery, pairing, and basic control

## What works

### Companion Protocol

- **Discovery** of Apple TVs on your LAN via mDNS
  - TTL-aware resolution cache significantly speeds up subsequent lookups and CLI commands
- **Pairing** using the on-screen **4-digit PIN**
- **Credential re-use** for future sessions
- **Interest subscriptions** for state change notifications
- **Remote button presses** — HID-style commands (navigation, menu, home, play/pause, etc.)
- **Volume control** — get, set, up, down
- **Power / attention state** — queries and wake/sleep control
- **App launching** — launch apps by bundle ID
- **Text input** — type into search fields and forms
- **Touch input** — touch events and gestures

### MRP Protocol (via AirPlay 2)

- **Now-playing state** — active player, track metadata, playback position with millisecond-precision extrapolation
- **Playback control** — play, pause, skip, seek, chapters, shuffle/repeat modes, playback rate
- **Music/library commands** — like, dislike, ban, bookmark, rate, wish-list, album/playlist navigation
- **Advanced remote** — full HID command set with protobuf messaging
- **Keyboard / text input** — set, insert, and clear focused text fields, with keyboard-session state and editing-attribute events
- **Volume** — set/mute plus explicit `getVolume`/`getVolumeMuted` queries and passive volume-change tracking
- **Speaker management** — add, remove, and set AirPlay output devices
- **Touch/gesture control** — tap and swipe with configurable duration

Not yet implemented: voice input, game controller input, playback session migration, device endpoint discovery.

### RAOP / AirPlay 1 Audio

- **RTSP session** — ANNOUNCE with SDP (L16 PCM, 44100 Hz, stereo), SETUP (UDP port negotiation), RECORD, FLUSH, TEARDOWN
- **UDP audio channel** — real-time RTP packet sending with burst compensation for timing drift
- **Control channel** — UDP sync packets (NTP wall-clock ↔ RTP timestamp anchoring) sent every second; handles retransmit requests from the receiver
- **DAAP metadata** — publishes title, artist, album, and duration via RTSP `SET_PARAMETER` with `application/x-dmap-tagged`
- **Artwork** — publishes album artwork (JPEG or PNG auto-detected) via `SET_PARAMETER`
- **Progress** — publishes playback position in RTP timestamp units via `SET_PARAMETER`
- **Volume** — set volume in dBFS or as a 0–100 percentage (`pctToDbfs` conversion included)
- **MFi-SAP** — `authSetup` for AirPort Express devices (static Curve25519 key)
- **Digest auth** — optional password for protected receivers

## Install / run

This repo is designed for Bun.

### Run from source

```sh
bun install
bun run cli -- --help
```

### Build the standalone CLI binary

```sh
bun run build:cli
./dist/bin/bunatv --help
```

## CLI

> The CLI is a thin convenience layer. Not all library features are exposed here.

The CLI executable name is `bunatv`.

```bash
Usage:   bunatv
Version: 1.0.0

Description:

  Control Apple TV devices from the command line

Options:

  -h, --help               - Show this help.
  -V, --version            - Show the version number for this program.
  -o, --output   <format>  - Output format (text, json, table)                            (Default: "text", Values: "text", "json", "table")
  -v, --verbose            - Verbose output with detailed information                     (Default: false)
  --no-color               - Disable colored output                                       (Default: false)
  --debug        [level]   - Set logging level (silent, error, warn, info, debug, trace)  (Values: "silent", "error", "warn", "info", "debug",
                                                                                          "trace")

Commands:

  discover                   - Discover Apple TV devices on the network
  info         <identifier>  - Get detailed information about a specific device
  pair         <device>      - Pair with an Apple TV device
  wizard                     - Interactive setup wizard for Apple TV connection
  control                    - Control an Apple TV device
  debug                      - Debug utilities for BunATV
```

## Logging & debugging

BunATV uses **pino** and **debug** for logging

### Module-level debug filtering (`DEBUG`)

Logs can be filtered by a `DEBUG` namespace matcher.

- `DEBUG` defaults to `*` in code

Examples:

```sh
# Show all logs
DEBUG=bunatv:*

# Show only companion protocol logs
DEBUG=bunatv:companion:*

# Show all crypto operations
DEBUG=bunatv:crypto:*

# Show specific modules
DEBUG=bunatv:hap:auth,bunatv:companion:api

# Exclude noisy modules
DEBUG=bunatv:*,-bunatv:encoding:*
```

To find all available namespaces, using [astgrep](https://ast-grep.github.io/) run `ast-grep --pattern "createLogger(\$ARG)" .`

## Roadmap

- **Companion Now Playing** — newer protocol messages for now-playing info exist in the Companion protocol but need further reverse engineering to fully map out
- **AirPlay audio/video streaming** — RAOP/AirPlay 1 audio sender is done; AirPlay 2 audio/video streaming is next
- **Publishable package** — clean public API surface and publish to npm/JSR

## Acknowledgments

This project would not exist without [**PyATV**](https://github.com/postlund/pyatv) by [postlund](https://github.com/postlund). PyATV is the definitive Python library for Apple TV control and the most comprehensive open-source reference for these protocols.

BunATV's Core MRP protobuf definitions were imported from PyATV. The OPack encoding, TLV8 handling, HKDF key derivation, Companion message types, and much of the cryptographic approach were built by studying and referencing PyATV's implementations. Compatibility test vectors were derived from PyATV's test suite to ensure correctness.

PyATV's years of protocol research and reverse engineering gave this project a foundation to build on. If you're working in Python, [PyATV](https://github.com/postlund/pyatv) is what you want — it's mature, well-maintained, and covers far more ground than BunATV does today.

## License

MIT
