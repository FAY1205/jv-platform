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

  it("parses an explicit production environment", () => {
    const env = readEnv({ APP_ENV: "production" });
    expect(env.APP_ENV).toBe("production");
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
