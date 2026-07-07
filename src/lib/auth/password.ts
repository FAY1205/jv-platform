import { createHash } from "node:crypto";
import zxcvbn from "zxcvbn";

// AUT-02: admin passwords require min length 12, zxcvbn score ≥ 3, and a breach
// check via the HaveIBeenPwned k-anonymity range API. Supabase Auth handles the
// hashing/storage (AUT-01); this is the pre-set/change gate.

export const MIN_PASSWORD_LENGTH = 12;
export const MIN_ZXCVBN_SCORE = 3;

export interface PasswordStrength {
  ok: boolean;
  score: number;
  reasons: string[];
}

export function checkPasswordStrength(password: string, userInputs: string[] = []): PasswordStrength {
  const reasons: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    reasons.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const { score } = zxcvbn(password, userInputs);
  if (score < MIN_ZXCVBN_SCORE) {
    reasons.push("Choose a stronger, less guessable password.");
  }
  return { ok: reasons.length === 0, score, reasons };
}

/** Fetches an HIBP range body ("SUFFIX:count" lines) for a 5-char SHA-1 prefix. */
export type RangeFetcher = (prefix: string) => Promise<string>;

/**
 * Breach check via k-anonymity: only the SHA-1 prefix leaves the process; the full
 * hash and password never do. Injectable fetcher keeps it testable/offline.
 */
export async function isPasswordBreached(
  password: string,
  fetchRange: RangeFetcher,
): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const body = await fetchRange(prefix);
  return body
    .split("\n")
    .some((line) => line.split(":")[0].trim().toUpperCase() === suffix);
}

/** Default fetcher hitting the public HIBP range endpoint (server-side only). */
export const hibpRangeFetcher: RangeFetcher = async (prefix) => {
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  if (!res.ok) throw new Error(`HIBP range fetch failed: ${res.status}`);
  return res.text();
};
