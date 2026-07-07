import { createHash } from "node:crypto";

/** SHA-256 hex — used to store OTP/token hashes at rest (never the secret itself). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
