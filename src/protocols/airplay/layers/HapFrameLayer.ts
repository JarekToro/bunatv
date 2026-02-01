import type { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";

/**
 * HAP Frame Layer - handles the 2-byte length prefix framing with ChaCha20-Poly1305
 *
 * Frame format:
 * ┌──────────────────┬─────────────────────────────────────┐
 * │ length (2 bytes) │ ciphertext + auth tag (16 bytes)    │
 * │ LE uint16        │ encrypted payload                   │
 * └──────────────────┴─────────────────────────────────────┘
 *
 * The 2-byte length is also used as AAD (Additional Authenticated Data)
 * Max plaintext per frame: 1024 bytes
 */
export class HapFrameLayer {
  private static readonly MAX_FRAME_SIZE = 1024;
  private static readonly LENGTH_SIZE = 2;
  private static readonly AUTH_TAG_SIZE = 16;

  constructor(private readonly encryption: ChaCha20EncryptionLayer) {}

  get isEnabled(): boolean {
    return this.encryption.isEnabled;
  }

  /**
   * Encrypt plaintext into HAP frames
   * Splits into 1024-byte chunks, each with length prefix
   */
  encrypt(plaintext: Buffer): Buffer {
    const frames: Buffer[] = [];
    let offset = 0;

    while (offset < plaintext.length) {
      const chunk = plaintext.subarray(
        offset,
        offset + HapFrameLayer.MAX_FRAME_SIZE
      );
      const lengthBytes = Buffer.alloc(HapFrameLayer.LENGTH_SIZE);
      lengthBytes.writeUInt16LE(chunk.length, 0);

      const ciphertext = this.encryption.encrypt(chunk, lengthBytes);
      frames.push(Buffer.concat([lengthBytes, ciphertext]));

      offset += chunk.length;
    }

    return Buffer.concat(frames);
  }

  /**
   * Decrypt HAP frames from encrypted buffer
   * Returns decrypted data and any remaining incomplete frame data
   */
  decrypt(encrypted: Buffer): { decrypted: Buffer; remaining: Buffer } {
    const decryptedChunks: Buffer[] = [];
    let offset = 0;

    while (offset < encrypted.length) {
      // Need at least length header
      if (encrypted.length - offset < HapFrameLayer.LENGTH_SIZE) break;

      const length = encrypted.readUInt16LE(offset);
      const frameEnd =
        offset +
        HapFrameLayer.LENGTH_SIZE +
        length +
        HapFrameLayer.AUTH_TAG_SIZE;

      // Don't have complete frame yet
      if (encrypted.length < frameEnd) break;

      const ciphertext = encrypted.subarray(
        offset + HapFrameLayer.LENGTH_SIZE,
        frameEnd
      );
      const aad = encrypted.subarray(
        offset,
        offset + HapFrameLayer.LENGTH_SIZE
      );

      const decrypted = this.encryption.decrypt(ciphertext, aad);
      decryptedChunks.push(decrypted);

      offset = frameEnd;
    }

    return {
      decrypted:
        decryptedChunks.length > 0
          ? Buffer.concat(decryptedChunks)
          : Buffer.alloc(0),
      remaining: encrypted.subarray(offset),
    };
  }
}
