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
  } as const;

  it("parses a fully-configured production environment", () => {
    const env = readEnv({ ...PROD });
    expect(env.APP_ENV).toBe("production");
    expect(env.APP_URL).toBe("https://app.example.com");
    expect(env.RESEND_API_KEY).toBe("re_live_key");
  });

  it("refuses to boot in production if APP_URL is left at the localhost default (release-cron links)", () => {
    expect(() => readEnv({ ...PROD, APP_URL: undefined })).toThrow();
  });

  it("NTF-03: refuses to boot in production without RESEND_API_KEY (else OTPs silently vanish)", () => {
    expect(() => readEnv({ ...PROD, RESEND_API_KEY: undefined })).toThrow();
  });

  it("NTF-03: refuses to boot in production with EMAIL_FROM left at the placeholder default", () => {
    expect(() => readEnv({ ...PROD, EMAIL_FROM: undefined })).toThrow();
  });

  it("NTF-03: a BLANK EMAIL_FROM is rejected in production the same as a missing one", () => {
    expect(() => readEnv({ ...PROD, EMAIL_FROM: "  " })).toThrow();
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
