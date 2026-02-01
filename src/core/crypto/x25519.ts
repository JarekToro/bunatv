/**
 * X25519 utilities for HAP key exchange - Bun Native Implementation
 *
 * Provides X25519 elliptic curve Diffie-Hellman operations for secure
 * key exchange in the HAP pairing protocol.
 */

import { x25519 } from "@noble/curves/ed25519";
import { createLogger } from "@/logging/logging.ts";
import { CryptoError } from "./errors";

const logger = createLogger("bunatv:crypto:x25519");

/**
 * X25519 utilities for HAP key exchange - Bun Native Implementation
 */
export class X25519Utils {
  private static algorithm = "X25519";

  /**
   * Generate X25519 key pair from deterministic seed (for testing)
   *
   * @param seed - 32-byte deterministic seed
   * @returns Key pair derived from seed
   */
  static generateKeyPairFromSeed(seed: Uint8Array): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    if (seed.length !== 32) {
      throw new CryptoError(`X25519 seed must be 32 bytes, got ${seed.length}`);
    }

    try {
      // Use @noble/curves/x25519 for deterministic key generation
      const publicKey = x25519.getPublicKey(seed);

      return {
        privateKey: new Uint8Array(seed),
        publicKey: new Uint8Array(publicKey),
      };
    } catch (error) {
      logger.error({ error }, "generateKeyPairFromSeed failed");
      throw new CryptoError(
        "Failed to generate X25519 key pair from seed",
        error as Error
      );
    }
  }

  /**
   * Generate a new X25519 key pair (Bun native)
   *
   * @returns Object containing private and public keys
   */
  static async generateKeyPair(): Promise<{
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  }> {
    logger.debug("Starting key pair generation...");
    logger.debug(
      "Using @noble/curves/x25519 (more reliable than WebCrypto for X25519)..."
    );
    try {
      return this.generateKeyPairSync();
    } catch (syncError) {
      logger.error({ error: syncError }, "Noble fallback failed");

      // Try WebCrypto as fallback
      logger.debug("Trying WebCrypto as fallback...");
      try {
        logger.debug(`Using algorithm: ${this.algorithm}`);

        const keyPair = (await crypto.subtle.generateKey(
          {
            name: this.algorithm,
          },
          true,
          ["deriveKey", "deriveBits"]
        )) as CryptoKeyPair;

        // X25519 raw key export is often not supported, so use the key objects directly
        // For HAP we need raw bytes, so this approach may not work
        logger.debug(
          "WebCrypto key generation succeeded but raw export may fail"
        );
        throw new Error("WebCrypto X25519 raw export not supported");
      } catch (webCryptoError) {
        logger.error("Both methods failed");
        throw new CryptoError(
          "Failed to generate X25519 key pair (both @noble and WebCrypto failed)",
          syncError as Error
        );
      }
    }
  }

  /**
   * Perform X25519 key exchange (Bun native)
   *
   * @param privateKey - Our private key
   * @param publicKey - Peer's public key
   * @returns Shared secret
   */
  static async computeSharedSecret(
    privateKey: Uint8Array,
    publicKey: Uint8Array
  ): Promise<Uint8Array> {
    // Use sync implementation since WebCrypto X25519 raw key import is problematic
    return this.computeSharedSecretSync(privateKey, publicKey);
  }

  /**
   * Generate X25519 key pair synchronously (Bun optimized)
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static generateKeyPairSync(): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    logger.debug("generateKeyPairSync: Using @noble/curves/x25519...");
    try {
      logger.debug("generateKeyPairSync: Generating random private key...");

      // Generate random private key (32 bytes)
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);

      logger.debug(
        `generateKeyPairSync: Private key length: ${privateKey.length}`
      );
      logger.debug(
        `generateKeyPairSync: Public key length: ${publicKey.length}`
      );

      const result = {
        privateKey: new Uint8Array(privateKey),
        publicKey: new Uint8Array(publicKey),
      };

      logger.debug("generateKeyPairSync: Noble key generation successful");
      return result;
    } catch (error) {
      logger.error({ error }, "generateKeyPairSync failed");
      throw new CryptoError(
        "Failed to generate X25519 key pair with Noble",
        error as Error
      );
    }
  }

  /**
   * Compute X25519 shared secret synchronously (Bun optimized)
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static computeSharedSecretSync(
    privateKey: Uint8Array,
    publicKey: Uint8Array
  ): Uint8Array {
    logger.debug("computeSharedSecretSync: Using @noble/curves/x25519...");
    try {
      const secret = x25519.getSharedSecret(privateKey, publicKey);
      logger.debug(
        `computeSharedSecretSync: Shared secret length: ${secret.length}`
      );
      return new Uint8Array(secret);
    } catch (error) {
      logger.error({ error }, "computeSharedSecretSync failed");
      throw new CryptoError(
        "Failed to compute X25519 shared secret with Noble",
        error as Error
      );
    }
  }
}
