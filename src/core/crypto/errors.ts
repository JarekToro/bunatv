/**
 * Cryptographic error handling for core crypto operations
 */

/**
 * Error thrown when cryptographic operations fail
 */
export class CryptoError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "CryptoError";
    this.cause = cause;
  }
}
