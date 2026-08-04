import { describe, it, expect } from "vitest";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";
import { trustedDevicesCutoff, AUTH_TABLE_RETENTION_MARGIN_MS } from "@/modules/retention/auth-tables";

describe("WP-SU-14: trust-refresh throttle config", () => {
  it("AUT-10-DEV-THR-01: per-family tighter than per-IP, matched windows, sane limits", () => {
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.limit).toBeGreaterThan(0);
    expect(TRUST_REFRESH_THROTTLE.perIp.limit).toBeGreaterThan(TRUST_REFRESH_THROTTLE.perIdentifier.limit);
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.windowMs).toBe(TRUST_REFRESH_THROTTLE.perIp.windowMs);
    expect(TRUST_REFRESH_THROTTLE.perIdentifier.windowMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe("WP-SU-14: trusted_devices retention cutoff", () => {
  it("AUT-10-DEV-RET-01: cutoff = now − AUTH_TABLE_RETENTION_MARGIN_MS, anchored on stored expiresAt (derived, not a restated literal)", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(trustedDevicesCutoff(now).getTime()).toBe(now.getTime() - AUTH_TABLE_RETENTION_MARGIN_MS);
  });
});
