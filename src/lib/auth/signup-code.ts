import { randomInt } from "node:crypto";
import { sha256Hex } from "./hash";
import { timingSafeEqualStr } from "./constant-time";

// SCP-06: signup invitation codes. A single-use, 48-hour code the platform owner
// generates and hands to a prospective admin; required at signup. The plaintext is
// shown to the owner once (to copy); only its hash is stored (AUT-06 pattern,
// mirrors signup-token.ts). Human-typeable: Crockford base32 (no ambiguous
// I/L/O/U), grouped XXXX-XXXX-XXXX; input is normalised before hashing so dashes,
// spacing, case, and O→0 / I,L→1 typos all resolve to the same code.

export const SIGNUP_CODE_TTL_MS = 48 * 60 * 60_000;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const CODE_LEN = 12;

/** Canonical form used for hashing + lookup: uppercase, strip separators, and fold
 *  the common look-alike typos into their Crockford digit. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Group a raw 12-char code as XXXX-XXXX-XXXX for display. */
function format(raw: string): string {
  return raw.match(/.{1,4}/g)!.join("-");
}

export interface SignupCodeRecord {
  codeHash: string;
  expiresAt: number;
}

/** Mint a fresh code. Returns the formatted plaintext (show once) + the record to
 *  persist (only the hash). `now` injected for determinism/testing. */
export function issueSignupCode(now: number): { code: string; record: SignupCodeRecord } {
  let raw = "";
  for (let i = 0; i < CODE_LEN; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return { code: format(raw), record: { codeHash: sha256Hex(raw), expiresAt: now + SIGNUP_CODE_TTL_MS } };
}

/** The hash to look a typed code up by (normalise first). */
export function hashCode(input: string): string {
  return sha256Hex(normalizeCode(input));
}

export type SignupCodeReason = "used" | "expired" | "mismatch";

export function verifySignupCode(
  input: string,
  record: SignupCodeRecord & { usedAt?: number },
  now: number,
): { ok: boolean; reason?: SignupCodeReason } {
  if (record.usedAt != null) return { ok: false, reason: "used" };
  if (now > record.expiresAt) return { ok: false, reason: "expired" };
  if (!timingSafeEqualStr(hashCode(input), record.codeHash)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
