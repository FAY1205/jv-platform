import { describe, it, expect } from "vitest";
import { LOCKOUT_WINDOW_MS } from "@/lib/auth/attempts-store";
import { ALREADY_REGISTERED_CAP } from "@/lib/auth/throttle";
import * as throttleModule from "@/lib/auth/throttle";
import {
  AUTH_ATTEMPTS_MAX_READ_WINDOW_MS,
  AUTH_ATTEMPTS_RETENTION_MARGIN_MS,
  AUTH_ATTEMPTS_RETENTION_MS,
  authAttemptsCutoff,
} from "@/modules/retention/auth-attempts";

// WP-SU-11 (ADR-0010): the auth_attempts retention cutoff. ADR-0010 deferred the sweep and
// WP-SU-8 then RAISED the largest read window on the table from 1h to 24h — the exact drift
// this suite exists to make impossible. The cutoff must be DERIVED from the live constants;
// a restated literal (`86_400_000`, "24h") passes on the day it is written and silently
// starts deleting rows a live window still reads the moment either constant moves.
// (.superpowers/sdd/progress.md lesson 3: a rule restated in two places drifted INSIDE one commit.)

describe("WP-SU-11: auth_attempts retention cutoff (ADR-0010)", () => {
  it("ADR-0010: the read window covers the AUT-04 lockout look-back", () => {
    expect(AUTH_ATTEMPTS_MAX_READ_WINDOW_MS).toBeGreaterThanOrEqual(LOCKOUT_WINDOW_MS);
  });

  it("ADR-0010: the read window covers the WP-SU-8 already-registered mail cap (the 24h one)", () => {
    // The assertion that would have caught WP-SU-8's widening: it is written against the live
    // constant, so raising ALREADY_REGISTERED_CAP.windowMs re-checks the cutoff automatically.
    expect(AUTH_ATTEMPTS_MAX_READ_WINDOW_MS).toBeGreaterThanOrEqual(ALREADY_REGISTERED_CAP.windowMs);
  });

  it("ADR-0010: the retention window is the read window PLUS a generous margin", () => {
    expect(AUTH_ATTEMPTS_RETENTION_MS).toBe(AUTH_ATTEMPTS_MAX_READ_WINDOW_MS + AUTH_ATTEMPTS_RETENTION_MARGIN_MS);
    // "Generous" is the safety property, not a nicety: it is what makes the sweep unable to race
    // a live rate-limit or lockout window even if a future WP widens one without touching here.
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    expect(AUTH_ATTEMPTS_RETENTION_MARGIN_MS).toBeGreaterThanOrEqual(SEVEN_DAYS);
  });

  it("SEC-05: the cutoff is exactly the retention window before `now`, and is pure", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    expect(authAttemptsCutoff(now).getTime()).toBe(now.getTime() - AUTH_ATTEMPTS_RETENTION_MS);
    // Same input ⇒ same output, and the caller's clock is never mutated.
    expect(authAttemptsCutoff(now).getTime()).toBe(authAttemptsCutoff(now).getTime());
    expect(now.toISOString()).toBe("2026-07-30T03:00:00.000Z");
  });

  it("ADR-0010: a row inside the largest live read window is never past the cutoff", () => {
    const now = new Date("2026-07-30T03:00:00.000Z");
    const oldestStillRead = new Date(now.getTime() - AUTH_ATTEMPTS_MAX_READ_WINDOW_MS);
    expect(oldestStillRead.getTime()).toBeGreaterThan(authAttemptsCutoff(now).getTime());
  });

  // WP-SU-11 review (audit-security F-1): the two assertions above guard only the two constants
  // that feed AUTH_ATTEMPTS_MAX_READ_WINDOW_MS BY NAME. This is the general tripwire — it
  // enumerates EVERY window the throttle module exports and fails the BUILD if any exceeds the
  // retention max. Without it, a future throttle kind with a window > the max would be deleted
  // while a live decision still reads it: silent data loss with nothing to catch it. Because the
  // enumeration is reflective, a newly-exported window is checked automatically — no one has to
  // remember to add it here.
  it("ADR-0010: EVERY exported throttle window is within the retention max (build-fails otherwise)", () => {
    const windows: Array<{ name: string; windowMs: number }> = [];
    for (const [name, value] of Object.entries(throttleModule)) {
      if (!value || typeof value !== "object") continue;
      const v = value as unknown as Record<string, unknown>;
      // A RateRule ({ limit, windowMs }) — e.g. SIGNUP_GLOBAL_CEILING, ALREADY_REGISTERED_CAP.
      if (typeof v.windowMs === "number") windows.push({ name, windowMs: v.windowMs });
      // A ThrottleConfig ({ perIdentifier, perIp }) — check both sub-rules.
      for (const key of ["perIdentifier", "perIp"] as const) {
        const rule = v[key] as Record<string, unknown> | undefined;
        if (rule && typeof rule.windowMs === "number") {
          windows.push({ name: `${name}.${key}`, windowMs: rule.windowMs });
        }
      }
    }
    // Guard the guard: if the enumeration ever silently finds nothing (a refactor renames the
    // exports, say), this fails instead of vacuously passing. Today there are 6 ThrottleConfigs
    // (12 sub-rules) + 2 bare RateRules = 14 windows.
    expect(windows.length).toBeGreaterThanOrEqual(8);
    for (const w of windows) {
      expect(
        w.windowMs,
        `${w.name} (${w.windowMs}ms) exceeds AUTH_ATTEMPTS_MAX_READ_WINDOW_MS — the retention sweep would delete rows this window still reads. Add it to the max, or lengthen the retention margin.`,
      ).toBeLessThanOrEqual(AUTH_ATTEMPTS_MAX_READ_WINDOW_MS);
    }
  });
});
