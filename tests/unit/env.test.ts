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

  it("parses an explicit production environment (with APP_URL set)", () => {
    const env = readEnv({ APP_ENV: "production", APP_URL: "https://app.example.com" });
    expect(env.APP_ENV).toBe("production");
    expect(env.APP_URL).toBe("https://app.example.com");
  });

  it("refuses to boot in production if APP_URL is left at the localhost default (release-cron links)", () => {
    expect(() => readEnv({ APP_ENV: "production" })).toThrow();
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
