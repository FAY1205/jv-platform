import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// ADR-0036: AES-256-GCM envelope for secrets that must be RECOVERED in plaintext
// (unlike OTP/token hashes, which are one-way). Used to store per-tenant AI provider
// API keys at rest. The master key is AI_KEY_ENCRYPTION_KEY (32 bytes, base64) — set
// per environment; rotating it invalidates every stored ciphertext (documented).
//
// Blob format: "v1.<iv>.<tag>.<ciphertext>", each part base64url. The version prefix
// lets a future scheme (key rotation, algorithm change) coexist.

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // full 128-bit GCM auth tag — pinned so decrypt REJECTS a truncated
// tag (a shortened tag weakens integrity; without authTagLength, GCM would accept it).

/** The 32-byte master key, or null when unconfigured (feature disabled, not crashed). */
function masterKey(): Buffer | null {
  const raw = env.AI_KEY_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** Whether at-rest encryption is available (a valid 32-byte master key is configured). */
export function isEncryptionConfigured(): boolean {
  return masterKey() !== null;
}

export class EncryptionUnavailableError extends Error {
  constructor() {
    super("Secret encryption is not configured (AI_KEY_ENCRYPTION_KEY).");
    this.name = "EncryptionUnavailableError";
  }
}

export function encryptSecret(plaintext: string): string {
  const key = masterKey();
  if (!key) throw new EncryptionUnavailableError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const key = masterKey();
  if (!key) throw new EncryptionUnavailableError();
  const [version, ivB64, tagB64, ctB64] = blob.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) throw new Error("malformed secret blob");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}
