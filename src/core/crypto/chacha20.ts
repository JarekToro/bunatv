/**
 * ChaCha20-Poly1305 utilities for HAP session encryption
 *
 * Provides authenticated encryption using ChaCha20-Poly1305 AEAD cipher
 * for secure communication in established HAP sessions.
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { createLogger } from "../../logging/logging";
import { CryptoError } from "./errors";

const logger = createLogger("bunatv:crypto:chacha20");

/**
 * ChaCha20-Poly1305 utilities for HAP session encryption - Noble Implementation
 * Uses @noble/ciphers for reliable cross-platform support
 */
export class ChaCha20Utils {
  /**
   * Encrypt data using ChaCha20-Poly1305 (@noble implementation)
   *
   * @param key - 32-byte encryption key
   * @param nonce - 12-byte nonce
   * @param data - Data to encrypt
   * @param additionalData - Additional authenticated data (optional)
   * @returns Encrypted data with authentication tag
   */
  static async encrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    data: Uint8Array,
    additionalData?: Uint8Array
  ): Promise<Uint8Array> {
    try {
      if (key.length !== 32) {
        throw new Error("Key must be 32 bytes");
      }
      if (nonce.length !== 12) {
        throw new Error("Nonce must be 12 bytes");
      }

      // Use @noble/ciphers/chacha (Bun WebCrypto doesn't support ChaCha20-Poly1305)
      const cipher = chacha20poly1305(key, nonce, additionalData);
      const sealed = cipher.encrypt(data);

      logger.debug(`encrypt: ${data.length}B → ${sealed.length}B`);

      return new Uint8Array(sealed);
    } catch (error) {
      throw new CryptoError(
        "Failed to encrypt with ChaCha20-Poly1305",
        error as Error
      );
    }
  }

  /**
   * Decrypt data using ChaCha20-Poly1305 (@noble implementation)
   *
   * @param key - 32-byte encryption key
   * @param nonce - 12-byte nonce
   * @param encryptedData - Encrypted data with authentication tag
   * @param additionalData - Additional authenticated data (optional)
   * @returns Decrypted data
   */
  static async decrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    encryptedData: Uint8Array,
    additionalData?: Uint8Array
  ): Promise<Uint8Array> {
    try {
      if (key.length !== 32) {
        throw new Error("Key must be 32 bytes");
      }
      if (nonce.length !== 12) {
        throw new Error("Nonce must be 12 bytes");
      }

      // Use @noble/ciphers/chacha (Bun WebCrypto doesn't support ChaCha20-Poly1305)
      const cipher = chacha20poly1305(key, nonce, additionalData);

      const opened = cipher.decrypt(encryptedData);

      logger.debug(`decrypt: ${encryptedData.length}B → ${opened.length}B`);
      return new Uint8Array(opened);
    } catch (error) {
      throw new CryptoError(
        "Failed to decrypt with ChaCha20-Poly1305",
        error as Error
      );
    }
  }

  /**
   * Generate a random nonce for ChaCha20-Poly1305 (Bun optimized)
   * Uses Bun's fast crypto.getRandomValues with pre-allocated buffer
   *
   * @returns 12-byte random nonce
   */
  static generateNonce(): Uint8Array {
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    return nonce;
  }

  /**
   * Encrypt data synchronously for performance-critical paths (Bun optimized)
   * Uses external library for sync operations since WebCrypto is async-only
   */
  static encryptSync(
    key: Uint8Array,
    nonce: Uint8Array,
    data: Uint8Array,
    additionalData?: Uint8Array
  ): Uint8Array {
    try {
      // Use @noble/ciphers for sync operations since WebCrypto ChaCha20-Poly1305 is async-only
      const cipher = chacha20poly1305(key, nonce, additionalData);
      return cipher.encrypt(data);
    } catch (error) {
      throw new CryptoError(
        "ChaCha20-Poly1305 sync encryption failed",
        error as Error
      );
    }
  }

  /**
   * Decrypt data synchronously for performance-critical paths (Bun optimized)
   * Uses external library for sync operations since WebCrypto is async-only
   */
  static decryptSync(
    key: Uint8Array,
    nonce: Uint8Array,
    encryptedData: Uint8Array,
    additionalData?: Uint8Array
  ): Uint8Array {
    try {
      // Use @noble/ciphers for sync operations since WebCrypto ChaCha20-Poly1305 is async-only
      const cipher = chacha20poly1305(key, nonce, additionalData);
      const decrypted = cipher.decrypt(encryptedData);
      return decrypted;
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError(
        "ChaCha20-Poly1305 sync decryption failed",
        error as Error
      );
    }
  }
}
