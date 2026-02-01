/**
 * Ed25519 utilities for HAP device authentication - Bun Native Implementation
 *
 * Provides Ed25519 digital signature operations for device authentication
 * in the HAP pairing protocol. Uses a combination of Bun's WebCrypto API
 * and Noble libraries for maximum compatibility.
 */

import { ed25519 } from "@noble/curves/ed25519";
import { createLogger } from "../../logging/logging";
import { CryptoError } from "./errors";

const logger = createLogger("bunatv:crypto:ed25519");

/**
 * Ed25519 utilities for HAP device authentication - Bun Native Implementation
 */
export class Ed25519Utils {
  private static algorithm = "Ed25519";

  /**
   * Generate a new Ed25519 key pair (Bun optimized with WebCrypto primary)
   *
   * Note: Bun v1.2.6+ fixed Ed25519 crypto key generation from private keys.
   * We try WebCrypto first, then fall back to Noble for maximum compatibility.
   *
   * @returns Object containing private and public keys (32 bytes each)
   */
  static async generateKeyPair(): Promise<{
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  }> {
    logger.debug("Starting key generation...");

    // Try WebCrypto first (Bun v1.2.6+ has fixed Ed25519 support)
    try {
      logger.debug("Using WebCrypto Ed25519 (Bun v1.2.6+ native)...");
      const keyPair = (await crypto.subtle.generateKey(
        {
          name: this.algorithm,
        },
        true,
        ["sign", "verify"]
      )) as CryptoKeyPair;

      // Export in supported formats (not 'raw')
      const privateKeyPkcs8 = await crypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey
      );
      const publicKeySpki = await crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey
      );

      // Extract raw keys from structured formats
      const privateKey = this.extractRawPrivateKeyFromPkcs8(
        new Uint8Array(privateKeyPkcs8)
      );
      const publicKey = this.extractRawPublicKeyFromSpki(
        new Uint8Array(publicKeySpki)
      );

      logger.debug("WebCrypto PKCS8/SPKI extraction successful");
      return { privateKey, publicKey };
    } catch (webCryptoError) {
      logger.debug(
        { error: webCryptoError },
        "WebCrypto failed, falling back to @noble/curves..."
      );

      // Fall back to Noble
      try {
        logger.debug("Using @noble/curves/ed25519 (fallback)...");
        return this.generateKeyPairSync();
      } catch (nobleError) {
        logger.error(
          {
            webCryptoError,
            nobleError,
          },
          "All methods failed"
        );
        throw new CryptoError(
          "Failed to generate Ed25519 key pair (all methods failed)",
          webCryptoError as Error
        );
      }
    }
  }

  /**
   * Extract raw 32-byte private key from PKCS8 DER format
   * PKCS8 Ed25519 structure: 48 bytes total, raw key is bytes 16-47
   */
  private static extractRawPrivateKeyFromPkcs8(pkcs8: Uint8Array): Uint8Array {
    if (pkcs8.length !== 48) {
      throw new Error(
        `Invalid PKCS8 Ed25519 length: expected 48, got ${pkcs8.length}`
      );
    }
    // The raw private key is in bytes 16-47 of the PKCS8 structure
    return pkcs8.slice(16, 48);
  }

  /**
   * Extract raw 32-byte public key from SPKI DER format
   * SPKI Ed25519 structure: 44 bytes total, raw key is bytes 12-43
   */
  private static extractRawPublicKeyFromSpki(spki: Uint8Array): Uint8Array {
    if (spki.length !== 44) {
      throw new Error(
        `Invalid SPKI Ed25519 length: expected 44, got ${spki.length}`
      );
    }
    // The raw public key is in bytes 12-43 of the SPKI structure
    return spki.slice(12, 44);
  }

  /**
   * Sign data with Ed25519 private key (Bun optimized with WebCrypto fallback)
   *
   * Note: Bun's WebCrypto doesn't support 'raw' import for Ed25519 private keys.
   * We use Noble libraries for reliable raw key operations.
   *
   * @param data - Data to sign
   * @param privateKey - Ed25519 private key (32 bytes)
   * @returns Signature (64 bytes)
   */
  static async sign(
    data: Uint8Array,
    privateKey: Uint8Array
  ): Promise<Uint8Array> {
    logger.debug(`Sign: data=${data.length}B, key=${privateKey.length}B`);

    // Use @noble/curves/ed25519 for raw key operations
    try {
      return this.signSync(data, privateKey);
    } catch (error) {
      logger.error(error, "Signing failed");
      throw new CryptoError("Failed to sign with Ed25519", error as Error);
    }
  }

  /**
   * Verify Ed25519 signature (Bun optimized with WebCrypto fallback)
   *
   * Note: Bun's WebCrypto doesn't support 'raw' import for Ed25519 public keys.
   * We use Noble libraries for reliable raw key operations.
   *
   * @param signature - Signature to verify (64 bytes)
   * @param data - Original data
   * @param publicKey - Ed25519 public key (32 bytes)
   * @returns True if signature is valid
   */
  static async verify(
    signature: Uint8Array,
    data: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    logger.debug(
      `Verify: sig=${signature.length}B, data=${data.length}B, key=${publicKey.length}B`
    );

    // Use @noble/curves/ed25519 for raw key operations
    try {
      return this.verifySync(signature, data, publicKey);
    } catch (error) {
      logger.error(error, "Verification failed");
      throw new CryptoError(
        "Failed to verify Ed25519 signature",
        error as Error
      );
    }
  }

  /**
   * Generate Ed25519 key pair from deterministic seed (for testing)
   *
   * @param seed - 32-byte deterministic seed (like pyatv's PRIVATE_KEY)
   * @returns Key pair derived from seed
   */
  static generateKeyPairFromSeed(seed: Uint8Array): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    if (seed.length !== 32) {
      throw new CryptoError(
        `Ed25519 seed must be 32 bytes, got ${seed.length}`
      );
    }

    try {
      // Use @noble/curves/ed25519 for deterministic key generation
      const publicKey = ed25519.getPublicKey(seed);

      return {
        privateKey: new Uint8Array(seed),
        publicKey: new Uint8Array(publicKey),
      };
    } catch (error) {
      logger.error(error, "generateKeyPairFromSeed failed");
      throw new CryptoError(
        "Failed to generate Ed25519 key pair from seed",
        error as Error
      );
    }
  }

  /**
   * Generate Ed25519 key pair synchronously (Bun optimized)
   * Uses Noble for synchronous operations
   */
  static generateKeyPairSync(): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    logger.debug("generateKeyPairSync: Using @noble/curves/ed25519...");
    try {
      // Generate random private key (32 bytes)
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);

      logger.debug(
        `generateKeyPairSync: Private key length: ${privateKey.length}`
      );
      logger.debug(
        `generateKeyPairSync: Public key length: ${publicKey.length}`
      );

      const result = {
        privateKey: new Uint8Array(privateKey), // 32 bytes
        publicKey: new Uint8Array(publicKey), // 32 bytes
      };

      logger.debug(
        `generateKeyPairSync: Final private key length: ${result.privateKey.length}`
      );
      logger.debug(
        `generateKeyPairSync: Final public key length: ${result.publicKey.length}`
      );
      logger.debug("generateKeyPairSync: Noble key generation successful");
      return result;
    } catch (error) {
      logger.error(error, "generateKeyPairSync failed");
      throw new CryptoError(
        "Failed to generate Ed25519 key pair with Noble",
        error as Error
      );
    }
  }

  /**
   * Sign data synchronously (Bun optimized)
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static signSync(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
    try {
      // Noble expects a 32-byte private key
      if (privateKey.length !== 32) {
        throw new Error(
          `Invalid private key length: expected 32, got ${privateKey.length}`
        );
      }

      const signature = ed25519.sign(data, privateKey);
      logger.debug(`Sign successful: signature=${signature.length}B`);
      return new Uint8Array(signature);
    } catch (error) {
      throw new CryptoError("Failed to sign with Ed25519", error as Error);
    }
  }

  /**
   * Verify Ed25519 signature synchronously (Bun optimized)
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static verifySync(
    signature: Uint8Array,
    data: Uint8Array,
    publicKey: Uint8Array
  ): boolean {
    try {
      const isValid = ed25519.verify(signature, data, publicKey);
      logger.debug(`Verify result: ${isValid}`);
      return isValid;
    } catch (error) {
      throw new CryptoError(
        "Failed to verify Ed25519 signature",
        error as Error
      );
    }
  }
}
