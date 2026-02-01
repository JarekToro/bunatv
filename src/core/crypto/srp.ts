/**
 * SRP (Secure Remote Password) utilities for HAP pairing authentication
 *
 * Implements SRP-6a protocol with 3072-bit primes as required by the
 * HomeKit Accessory Protocol specification.
 */

// SRP library is external as Bun doesn't have native SRP support
import { SRP, SrpClient, SrpServer } from "fast-srp-hap";
import { CryptoError } from "./errors";

/**
 * SRP utilities for HAP pairing authentication
 */
export class SrpUtils {
  // Use HAP-specific parameters from the library
  private static params = SRP.params.hap;

  /**
   * Create SRP client for pair-setup
   *
   * @param username - HAP username (typically device MAC address)
   * @param password - HAP password (PIN from device screen)
   * @param salt - Salt from server
   * @param secretKey - Random secret key
   * @returns SRP client instance
   */
  static createClient(
    username: string,
    password: string,
    salt: Buffer,
    secretKey: Buffer
  ): SrpClient {
    try {
      return new SrpClient(
        this.params,
        salt,
        Buffer.from(username),
        Buffer.from(password),
        secretKey,
        true // HAP mode
      );
    } catch (error) {
      throw new CryptoError("Failed to create SRP client", error as Error);
    }
  }

  /**
   * Create SRP server for pair-setup
   *
   * @param username - HAP username
   * @param password - HAP password
   * @param salt - SRP salt
   * @param secretKey - Random secret key
   * @returns SRP server instance
   */
  static createServer(
    username: string,
    password: string,
    salt: Buffer,
    secretKey: Buffer
  ): SrpServer {
    try {
      return new SrpServer(
        this.params,
        salt,
        Buffer.from(username),
        Buffer.from(password),
        secretKey
      );
    } catch (error) {
      throw new CryptoError("Failed to create SRP server", error as Error);
    }
  }

  /**
   * Generate random key for SRP operations
   */
  static async generateKey(bytes: number = 32): Promise<Buffer> {
    try {
      return await SRP.genKey(bytes);
    } catch (error) {
      throw new CryptoError("Failed to generate SRP key", error as Error);
    }
  }

  /**
   * Compute SRP verifier
   */
  static computeVerifier(
    salt: Buffer,
    username: string,
    password: string
  ): Buffer {
    try {
      return SRP.computeVerifier(
        this.params,
        salt,
        Buffer.from(username),
        Buffer.from(password)
      );
    } catch (error) {
      throw new CryptoError("Failed to compute SRP verifier", error as Error);
    }
  }
}
