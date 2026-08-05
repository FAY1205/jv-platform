import { describe, it, expect } from "vitest";
import { AI_CREDENTIAL_TEST_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";

// WP-AI-GUARD / AUT-03 (audit R-60): the settings "test connection" action makes a live
// provider call on the tenant's BYO key. The route throttles it per-tenant + per-IP with a
// sliding window (rateDecisionWithSelf) so it can't be used as a fast key-validity oracle or
// a spend vector. WP-SU-9 contract: the window the route feeds INCLUDES the reserved current
// attempt, so a "full" window is limit + 1 rows.
const now = 10_000_000;

describe("WP-AI-GUARD: ai credential-test throttle config", () => {
  it("AUT-03: per-tenant cooldown + per-IP bound (5/min, 10/min)", () => {
    expect(AI_CREDENTIAL_TEST_THROTTLE.perIdentifier).toEqual({ limit: 5, windowMs: 60_000 });
    expect(AI_CREDENTIAL_TEST_THROTTLE.perIp).toEqual({ limit: 10, windowMs: 60_000 });
  });

  it("AUT-03: admits exactly the per-tenant limit, then blocks the next", () => {
    const atLimit = Array.from({ length: 5 }, (_, i) => now - i * 1000); // 4 spent + own reservation
    expect(rateDecisionWithSelf(atLimit, now, AI_CREDENTIAL_TEST_THROTTLE.perIdentifier).allowed).toBe(true);

    const overLimit = Array.from({ length: 6 }, (_, i) => now - i * 1000); // 5 spent + own reservation
    const d = rateDecisionWithSelf(overLimit, now, AI_CREDENTIAL_TEST_THROTTLE.perIdentifier);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });

  it("AUT-03: tests that have aged out of the 1-minute window no longer count", () => {
    const stale = Array.from({ length: 6 }, (_, i) => now - 60_000 - i * 1000);
    expect(rateDecisionWithSelf(stale, now, AI_CREDENTIAL_TEST_THROTTLE.perIdentifier).allowed).toBe(true);
  });
});
