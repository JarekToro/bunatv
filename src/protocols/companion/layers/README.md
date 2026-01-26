# Companion protocol layers

This folder contains the **transport + framing + security + session** building blocks used by the Companion protocol implementation.

> This doc explains how the pieces fit together in *this* codebase. It’s not intended to be a complete spec for HAP/Companion.

---

## High-level picture

The Companion protocol stack in BunATV is built as a set of small composable layers.

### Data flow (conceptual)

```
Application / Protocol API
  (CompanionProtocol, CompanionApi, message builders/parsers)
                |
                v
+-----------------------------------------------------------+
| CompanionSessionService                                   |
|  - starts/stops a Companion session                        |
|  - assigns transaction IDs (_x)                            |
|  - correlates request/response via pendingRequests map      |
+-----------------------------------------------------------+
                |
                v
+-----------------------------------------------------------+
| HapFramedChannel                                          |
|  - encodes/decodes OPACK messages                          |
|  - sends/receives HAP frames                               |
|  - applies ChaCha20-Poly1305 encryption when enabled        |
+-----------------------------------------------------------+
                |
                v
+--------------------------+     +--------------------------+
| ChaCha20EncryptionLayer  |<--->| HAPAuthenticationService  |
|  - encrypt/decrypt        |     |  - pair-setup + pair-verify|
|  - per-direction nonces   |     |  - derives session keys    |
|  - AAD = HAP header       |     |  - hands keys to encryption|
+--------------------------+     +--------------------------+
                |
                v
+-----------------------------------------------------------+
| HapFrameHandler                                           |
|  - stream parsing: bytes -> HAPFrame(s)                    |
|  - encoding: HAPFrame -> bytes                             |
|  - (optional) frame validation                             |
+-----------------------------------------------------------+
                |
                v
+-----------------------------------------------------------+
| BunTCPTransport                                           |
|  - TCP socket connect/read/write                           |
|  - backpressure handling (drain)                           |
|  - optional auto-reconnect                                 |
+-----------------------------------------------------------+
                |
                v
Network (Apple TV)
```

### What each layer “owns”

- **`BunTCPTransport`**: raw TCP connectivity, reconnection, and safe writes.
- **`HapFrameHandler`**: turning a stream of bytes into discrete **HAP frames** and back.
- **`ChaCha20EncryptionLayer`**: encrypt/decrypt frame payloads using session keys from pair-verify.
- **`HapFramedChannel`**: glue layer that connects transport ↔ frame handler ↔ encryption ↔ OPACK.
- **`HAPAuthenticationService`**: HAP Pair-Setup + Pair-Verify flows; derives session keys.
- **`CompanionSessionService`**: Companion “session start/stop” and request/response correlation.

---

## Send path (client → Apple TV)

When higher-level code wants to send a Companion command:

1. **`CompanionSessionService.sendCommand()`**
   - Builds a message (usually OPACK-based) via a `CompanionCommand`.
   - Ensures the message has a transaction id (`_x`).
   - Stores a pending promise in `pendingRequests` keyed by `_x`.

2. **`CompanionSessionService.sendMessage()` → `HapFramedChannel.sendMessage()`**
   - OPACK-encodes the message.

3. **`HapFramedChannel.sendFrame(HAPFrameType.EncryptedOpack, payload)`**
   - If encryption is enabled:
     - Builds a **4-byte HAP header** (`[type:1][length:3]`).
     - Uses that header as **AAD** (additional authenticated data).
     - Encrypts payload and appends the Poly1305 auth tag (handled inside crypto util).
   - Encodes a HAP frame via `HapFrameHandler.encode(...)`.

4. **`BunTCPTransport.send(frameBytes)`**
   - Writes to the TCP socket.
   - Handles backpressure by waiting for `drain` when needed.

---

## Receive path (Apple TV → client)

1. **`BunTCPTransport` emits `data`**
   - Raw bytes from the socket.

2. **`HapFrameHandler.push(data)`**
   - Buffers stream data and emits one or more parsed `HAPFrame` objects.

3. **`HapFramedChannel` receives `frame`**
   - If the frame is marked `encrypted`:
     - Reconstructs the same 4-byte header (type + payload length) and decrypts using AAD.
   - If the decrypted frame type is `EncryptedOpack`:
     - OPACK-decodes it and emits a `message` event.

4. **`CompanionSessionService.handleMessage(message)`**
   - If the incoming message has `_x` and it matches a pending request:
     - Resolves/rejects the waiting promise.
   - Otherwise emits it as an unsolicited `message` event.

---

## Lifecycle: connect → authenticate → encrypt → session

A typical happy-path sequence looks like:

1. `BunTCPTransport.connect(host, port)`
2. Build a `HapFramedChannel(transport, encryption)`
3. Run `HAPAuthenticationService.authenticate(...)`
   - Pair-Setup (if no creds) and/or Pair-Verify
   - Produces `session.keys = { writeKey, readKey }`
4. Call `ChaCha20EncryptionLayer.enable(session.keys)`
5. Start a Companion session with `CompanionSessionService.start(...)`
   - Sends a session-start message over the encrypted channel
6. Send Companion commands via `CompanionSessionService.sendCommand(...)`
7. Stop session + disconnect cleanly

Important: `CompanionSessionService.start()` explicitly checks:

- transport is ready (`hapFrameChannel.isReady()`)
- encryption is enabled (`hapFrameChannel.isEncrypted()`)

That matches how Apple TV expects Companion traffic: **commands happen inside an encrypted session**.

---

## Notes & gotchas

### 1) Nonces are stateful

`ChaCha20EncryptionLayer` keeps independent nonces:

- `sendNonce` increments on every encrypt()
- `receiveNonce` increments on every decrypt()

If you ever re-key or restart a session, nonces must be reset. The layer does this in `enable()` and also exposes `resetNonces()`.

### 2) AAD = HAP header

Both encrypt and decrypt use the 4-byte HAP header as AAD. If the header differs (wrong type/length), authentication will fail.

### 3) Frames vs messages

- **Frames** are a binary transport unit: `HAPFrameType + length + payload`.
- **Messages** are Companion payloads (OPACK) carried inside `HAPFrameType.EncryptedOpack`.

`HapFramedChannel` is the boundary where frames become messages.

### 4) Request/response correlation

`CompanionSessionService` uses `_x` as the transaction id:

- outgoing requests get `_x` assigned
- responses with matching `_x` resolve the right pending promise
- responses with `_em` or `_ec` reject with a `SessionError`

### 5) The authentication service also uses frames

`HAPAuthenticationService` listens to `hapFrameChannel` frames directly (`'frame'` events).

That’s because pairing/verification happens via HAP frame types like:

- `PairSetupStart` / `PairSetupNext`
- `PairVerifyStart` / `PairVerifyNext`

After verification succeeds, the derived keys enable encrypted OPACK messaging.

---

## Code map

- `BunTCPTransport.ts` — TCP socket, reconnection, backpressure
- `HapFrameHandler.ts` — parsing/encoding HAP frames
- `ChaCha20EncryptionLayer.ts` — ChaCha20-Poly1305 encrypt/decrypt + nonces
- `HapFramedChannel.ts` — glue: transport ↔ frames ↔ encryption ↔ OPACK
- `HAPAuthenticationService.ts` — HAP pair-setup + pair-verify, key derivation
- `CompanionSessionService.ts` — session start/stop, request/response correlation
