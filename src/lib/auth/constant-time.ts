import { timingSafeEqual } from "node:crypto";

// AUT-09: all secret checks (OTP codes, reset tokens, webhook signatures, API keys)
// use a constant-time comparison — never `===` on secrets. Length differences are
// handled without an early return that would leak length via timing.
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still perform a comparison of equal-length buffers to keep timing uniform.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
