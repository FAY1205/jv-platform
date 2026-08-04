import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/auth/client-ip";

// AUT-03 (WP-SU-4): the IP is a rate-limit key, so its trustworthiness bounds abuse
// protection on every auth endpoint — and on public signup it is one of only two limits.
const req = (headers: Record<string, string>) => new Request("https://app.test/x", { headers });

describe("AUT-03: client IP trust ordering", () => {
  it("AUT-03: prefers x-vercel-forwarded-for over x-forwarded-for", () => {
    // Vercel overwrites x-forwarded-for itself, but a reverse proxy placed IN FRONT of
    // Vercel can overwrite it — x-vercel-forwarded-for is the platform's own value and
    // survives that, so it must win.
    expect(
      clientIp(req({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4" })),
    ).toBe("203.0.113.7");
  });

  it("AUT-03: takes the LAST entry of a platform header — a chain there means a merged duplicate", () => {
    // Vercel emits a single value in its platform header, so a comma chain can only come
    // from Headers.get() merging a client-sent copy (first) with the edge's own (last).
    // Reading leftmost would hand the attacker the key; identical either way when single.
    expect(clientIp(req({ "x-vercel-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("AUT-03: falls back to x-real-ip when no platform header is present", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.5", "x-forwarded-for": "1.2.3.4" }))).toBe(
      "198.51.100.5",
    );
  });

  it("AUT-03: falls back to x-forwarded-for last (local dev / non-Vercel hosts)", () => {
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }))).toBe("198.51.100.9");
  });

  it("AUT-03: prefers the Vercel platform header over x-real-ip", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "1.2.3.4" }))).toBe(
      "203.0.113.7",
    );
  });

  it("AUT-03: a client-sent duplicate of a platform header cannot win the merge", () => {
    // Headers.get() joins duplicates with ", ", client copy FIRST and the edge's own value
    // LAST — so reading leftmost would let a spoofed copy outrank the trusted one.
    const h = new Headers();
    h.append("x-vercel-forwarded-for", "1.2.3.4"); // attacker's copy
    h.append("x-vercel-forwarded-for", "203.0.113.7"); // edge's value
    expect(clientIp(new Request("https://app.test/x", { headers: h }))).toBe("203.0.113.7");
  });

  it("AUT-03: rejects values that are not IPs rather than keying limits on garbage", () => {
    expect(clientIp(req({ "x-real-ip": "not-an-ip" }))).toBeNull();
    // An oversized header would otherwise be inserted into an indexed text column.
    expect(clientIp(req({ "x-real-ip": "1".repeat(5000) }))).toBeNull();
  });

  it("AUT-03: strips a port suffix — otherwise every connection is its own throttle bucket", () => {
    expect(clientIp(req({ "x-real-ip": "203.0.113.7:54321" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "[2001:db8::1]:443" }))).toBe("2001:db8::");
  });

  it("AUT-03: buckets IPv6 on the /64 — per-address keying is not an abuse bound", () => {
    // A single ordinary IPv6 allocation holds 2^64 addresses; per-address limits are free
    // to evade. Two addresses in the same /64 must share a bucket.
    expect(clientIp(req({ "x-real-ip": "2001:db8:1:2:3:4:5:6" }))).toBe("2001:db8:1:2::");
    expect(clientIp(req({ "x-real-ip": "2001:DB8:1:2:aaaa::9" }))).toBe("2001:db8:1:2::");
  });

  it("AUT-03: returns null when nothing is present — IP limits no-op, identifier limits still apply", () => {
    expect(clientIp(req({}))).toBeNull();
  });

  it("AUT-03: skips a blank entry WITHIN the trusted header itself, with nothing to fall back to", () => {
    // Distinct from the case below: with no other header present, only scan-within-header
    // can produce this answer. Pins the behaviour on the header the WP exists to trust,
    // rather than inferring it from the lowest-trust fallback.
    expect(clientIp(req({ "x-vercel-forwarded-for": " , 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("AUT-03: ignores blank header values rather than keying limits on an empty string", () => {
    expect(clientIp(req({ "x-vercel-forwarded-for": "   ", "x-forwarded-for": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
    expect(clientIp(req({ "x-forwarded-for": " , 10.0.0.1" }))).toBe("10.0.0.1");
  });
});
