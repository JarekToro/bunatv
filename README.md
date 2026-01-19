# BunATV (bun-apple-tv)

> **Work in progress / alpha**
>
> This project is actively evolving and should be considered **unstable**. APIs, CLI flags, output formats, and credential storage may change without notice.

Apple TV remote control library and CLI for Bun/TypeScript.


## Status

- **Companion Protocol:** working (pair, connect, basic controls)
- **CLI:** usable for discovery, pairing, and control (see below)
- **Other protocols (e.g. AirPlay):** not implemented yet

## What works (Companion Protocol)

The current implementation focuses on Apple’s **Companion** protocol and includes:

- **Discovery** of Apple TVs on your LAN (mDNS)
  - mdns resolution cache honors TTLs significantly speeds up subsequent discoveries and cli commands
- **Pairing** using the on-screen **4-digit PIN**
- **Credential re-use** for future sessions (unless you opt out)
- **Interest subscription** for state changes
- **Remote button presses** (HID-style commands)
- **Volume control** (get/set/up/down)
- **Power / attention state** queries and basic wake/sleep style control
- **Debug utilities** like subscribing to “interest”/state changes


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

## License

MIT