import { describe, it, expect } from "vitest";
import { securityHeaders, HSTS_MAX_AGE } from "@/lib/security-headers";

// F-06 / SEC-08: the response security header set the app serves on every route.
describe("F-06: security headers", () => {
  const byKey = (opts?: Parameters<typeof securityHeaders>[0]) =>
    new Map(securityHeaders(opts).map((h) => [h.key, h.value]));

  it("F-06: sets HSTS, nosniff, frame-deny, referrer + permissions policy", () => {
    const h = byKey();
    expect(h.get("Strict-Transport-Security")).toContain(`max-age=${HSTS_MAX_AGE}`);
    expect(h.get("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
  });

  it("F-06: CSP shuts the high-risk doors (frame-ancestors/object-src/base-uri/default-src)", () => {
    const csp = byKey().get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("F-06: connect-src allows the Supabase origin (https + wss) when configured", () => {
    const csp = byKey({ supabaseUrl: "https://abc.supabase.co" }).get("Content-Security-Policy")!;
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
  });

  it("F-06: connect-src stays 'self' only when no Supabase URL is given", () => {
    const csp = byKey().get("Content-Security-Policy")!;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("supabase");
    expect(csp).not.toContain("wss:");
  });

  it("F-06: a malformed Supabase URL degrades safely to 'self'", () => {
    const csp = byKey({ supabaseUrl: "not a url" }).get("Content-Security-Policy")!;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("wss:");
  });
});
