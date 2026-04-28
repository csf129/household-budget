import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export function assertPlaidEncryptionKeyConfigured(): void {
  getKey();
}

function getKey(): Buffer {
  const hex = process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();
  if (!hex || hex.length !== 64) {
    throw new Error(
      "PLAID_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Returns base64 ciphertext (iv + tag + payload). */
export function encryptPlaidAccessToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptPlaidAccessToken(ciphertextB64: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid Plaid token ciphertext.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
