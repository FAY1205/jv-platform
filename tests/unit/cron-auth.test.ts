import { describe, it, expect } from "vitest";
import { isAuthorizedCron } from "@/lib/auth/cron-auth";

// F-07 / AUT-09: the scheduled outbox drain authenticates via the CRON_SECRET bearer.
describe("F-07: cron authorization", () => {
  const SECRET = "s3cr3t-cron-value";

  it("accepts the correct Bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong secret (constant-time)", () => {
    expect(isAuthorizedCron("Bearer nope", SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("rejects a missing header or one without the Bearer scheme", () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false); // no "Bearer " prefix
    expect(isAuthorizedCron(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("refuses when the secret is unconfigured — the endpoint is never open", () => {
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});
