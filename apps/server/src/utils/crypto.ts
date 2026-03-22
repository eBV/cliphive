/**
 * AES-256-GCM encryption/decryption for OAuth tokens stored in the database.
 * Uses ENCRYPTION_KEY from environment (must be 32-byte hex string = 64 hex chars).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env["ENCRYPTION_KEY"];
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is not set");
  if (key.length !== 64) throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a plaintext string. Returns a base64-encoded string
 * containing iv:authTag:ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a string encrypted with encrypt().
 */
export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const [ivB64, tagB64, ciphertextB64] = encryptedStr.split(":");

  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Generate a cryptographically secure random API key.
 */
export function generateApiKey(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

/**
 * Class wrapper for use in services that prefer OOP style.
 */
export class CryptoService {
  encrypt(plaintext: string): string {
    return encrypt(plaintext);
  }

  decrypt(encryptedStr: string): string {
    return decrypt(encryptedStr);
  }

  generateApiKey(byteLength = 32): string {
    return generateApiKey(byteLength);
  }
}
