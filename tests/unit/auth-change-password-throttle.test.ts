import { describe, it, expect } from "vitest";
import { CHANGE_PASSWORD_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";

// WP-SU-22 / AUT-03 (audit R-30): change-password was the one credential endpoint with no
// throttle. The route uses a SLIDING WINDOW only (rateDecisionWithSelf) — deliberately NOT
// evaluateThrottle — so an authenticated session-hijacker cannot lock the real owner out of
// changing their own password via AUT-04's ladder. These tests pin the config's shape and
// that it actually bites at the configured per-identifier / per-IP limits (WP-SU-9: the
// window the route feeds INCLUDES the reserved current attempt, so a "full" window is
// limit + 1 rows).
const now = 10_000_000;

describe("WP-SU-22: change-password throttle config", () => {
  it("AUT-03: sliding-window shape, generous enough for legitimate use (5/15min per email)", () => {
    expect(CHANGE_PASSWORD_THROTTLE.perIdentifier).toEqual({ limit: 5, windowMs: 900_000 });
    expect(CHANGE_PASSWORD_THROTTLE.perIp).toEqual({ limit: 20, windowMs: 900_000 });
  });

  it("AUT-03: admits exactly the per-identifier limit, then blocks the next", () => {
    // 4 already spent + this request's own reservation = 5 rows: the limit'th request, allowed.
    const atLimit = Array.from({ length: 5 }, (_, i) => now - i * 1000);
    expect(rateDecisionWithSelf(atLimit, now, CHANGE_PASSWORD_THROTTLE.perIdentifier).allowed).toBe(true);

    // 5 already spent + own reservation = 6 rows: over the limit, blocked with a Retry-After.
    const overLimit = Array.from({ length: 6 }, (_, i) => now - i * 1000);
    const d = rateDecisionWithSelf(overLimit, now, CHANGE_PASSWORD_THROTTLE.perIdentifier);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });

  it("AUT-03: the per-IP window bounds a hijacker spreading guesses across accounts", () => {
    const overLimit = Array.from({ length: 21 }, (_, i) => now - i * 1000);
    expect(rateDecisionWithSelf(overLimit, now, CHANGE_PASSWORD_THROTTLE.perIp).allowed).toBe(false);
  });

  it("AUT-03: attempts that have aged out of the window no longer count", () => {
    const stale = Array.from({ length: 6 }, (_, i) => now - CHANGE_PASSWORD_THROTTLE.perIdentifier.windowMs - i * 1000);
    expect(rateDecisionWithSelf(stale, now, CHANGE_PASSWORD_THROTTLE.perIdentifier).allowed).toBe(true);
  });
});
