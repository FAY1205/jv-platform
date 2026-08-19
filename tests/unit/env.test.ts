import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";

// WP-002 / SEC-07: environment parsing + separation defaults.
describe("SEC-07: environment config", () => {
  it("defaults to development with safe placeholders when unset", () => {
    const env = readEnv({});
    expect(env.APP_ENV).toBe("development");
    expect(env.APP_NAME).toBe("TerritoryDesk");
    expect(env.EMAIL_SINK_ADDRESS).toBe("dev-sink@example.test");
  });

  // A production environment must be FULLY configured for transactional email —
  // otherwise partner OTPs are silently black-holed (the dev mailbox is 404'd in prod).
  const PROD = {
    APP_ENV: "production",
    APP_URL: "https://app.example.com",
    RESEND_API_KEY: "re_live_key",
    EMAIL_FROM: "JV Platform <noreply@jv.example>",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  } as const;

  it("parses a fully-configured production environment", () => {
    const env = readEnv({ ...PROD });
    expect(env.APP_ENV).toBe("production");
    expect(env.APP_URL).toBe("https://app.example.com");
    expect(env.RESEND_API_KEY).toBe("re_live_key");
  });

  it("refuses to boot in production if APP_URL is left at the localhost default (every emailed link is built from it — C-101)", () => {
    expect(() => readEnv({ ...PROD, APP_URL: undefined })).toThrow();
  });

  it("NTF-03: refuses to boot in production without RESEND_API_KEY (else OTPs silently vanish)", () => {
    expect(() => readEnv({ ...PROD, RESEND_API_KEY: undefined })).toThrow();
  });

  it("NTF-03: refuses to boot in production with EMAIL_FROM left at the placeholder default", () => {
    expect(() => readEnv({ ...PROD, EMAIL_FROM: undefined })).toThrow();
  });

  // SEC-05/WP-SU-3: the log scrubber redacts long opaque runs but deliberately preserves
  // UUIDs (traceId/tenantId correlation). An operator who pastes a UUID as CRON_SECRET
  // would therefore have it survive into logs. Constrain the format so every
  // operator-supplied secret is redactable by construction, not by hope.
  it("SEC-05: rejects a CRON_SECRET that the log scrubber could not redact (UUID-shaped)", () => {
    expect(() => readEnv({ ...PROD, CRON_SECRET: "550e8400-e29b-41d4-a716-446655440000" })).toThrow();
  });

  it("SEC-05: rejects a too-short CRON_SECRET", () => {
    expect(() => readEnv({ ...PROD, CRON_SECRET: "short-secret" })).toThrow();
  });

  it("SEC-05: accepts a long opaque CRON_SECRET (redactable by the scrubber)", () => {
    const secret = "K7fQ2xZm9pL4vR8sT1nW6yB3cD5gH0jA";
    expect(readEnv({ ...PROD, CRON_SECRET: secret }).CRON_SECRET).toBe(secret);
  });

  it("NTF-03: a BLANK EMAIL_FROM is rejected in production the same as a missing one", () => {
    expect(() => readEnv({ ...PROD, EMAIL_FROM: "  " })).toThrow();
  });

  it("ADR-0034: refuses to boot in production without TURNSTILE_SECRET_KEY (public signup needs bot protection)", () => {
    expect(() => readEnv({ ...PROD, TURNSTILE_SECRET_KEY: undefined })).toThrow();
  });

  it("ADR-0034: refuses to boot in production without TURNSTILE_SITE_KEY (signup CAPTCHA widget never renders)", () => {
    expect(() => readEnv({ ...PROD, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined })).toThrow();
  });

  it("treats blank strings as unset (no false URL/email validation failures)", () => {
    const env = readEnv({
      NEXT_PUBLIC_SUPABASE_URL: "",
      DATABASE_URL: "   ",
    });
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("rejects an invalid APP_ENV value", () => {
    expect(() => readEnv({ APP_ENV: "staging" })).toThrow();
  });

  it("rejects a malformed Supabase URL when provided", () => {
    expect(() =>
      readEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow();
  });
});
