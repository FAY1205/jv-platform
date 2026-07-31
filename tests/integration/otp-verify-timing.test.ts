import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type * as EnumModule from "@/lib/auth/enumeration";
import * as schema from "@/db/schema";
import { OtpStore } from "@/lib/auth/otp-store";

// WP-SU-17 / AUT-05 (live): otp/verify was the one pre-session auth route with no withUniformTiming
// floor, so its per-outcome DB-write count leaked whether a LIVE challenge exists (a partner-
// enumeration timing oracle). This proves the route now WRAPS its post-gate body in the floor at
// the sibling-standard minimum. Deterministic by design: a wall-clock assertion is unusable here —
// the remote test pooler's per-query latency alone exceeds the floor, whereas in prod (co-located
// DB) the paths are tens of ms and the floor is what masks them. So we capture the injected minMs
// and run `work` WITHOUT the real sleep; the flooring math itself is unit-proven (auth.test.ts).
const timing = vi.hoisted(() => ({ minMs: [] as number[] }));
vi.mock("@/lib/auth/enumeration", async (orig) => {
  const actual = await orig<typeof EnumModule>();
  return {
    ...actual,
    withUniformTiming: vi.fn(async (minMs: number, work: () => Promise<unknown>) => {
      timing.minMs.push(minMs);
      // Faithfully mirror the real primitive's swallow (catch → undefined) so the route's
      // `?? fallback` branch is exercisable — but skip the real sleep (deterministic).
      try {
        return await work();
      } catch {
        return undefined;
      }
    }),
  };
});

// Import AFTER the mock is registered (vi.mock is hoisted, so this is belt-and-braces).
const { POST: otpVerify } = await import("@/app/api/auth/otp/verify/route");

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORIGIN = "http://localhost";
function post(body: unknown): Request {
  return new Request(`${ORIGIN}/api/auth/otp/verify`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

suite("AUT-05: otp/verify is uniform-timing floored", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  const created = new Set<string>();

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(() => {
    timing.minMs.length = 0;
  });
  afterEach(async () => {
    for (const id of created) {
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, id));
    }
    created.clear();
  });

  it("AUT-05: wraps its post-gate body in withUniformTiming at the sibling-standard 500ms floor", async () => {
    const email = `otp-timing-${randomUUID()}@wp-su-17.test`;
    created.add(email.toLowerCase());
    const res = await otpVerify(post({ email, code: "000000" }));
    // The no-challenge outcome is unchanged (uniform "invalid or expired")...
    expect(res.status).toBe(400);
    // ...and it flowed through the floor exactly once, at MIN_RESPONSE_MS = 500 (mirroring
    // login/otp-request/reset-request). Before WP-SU-17 the route never called withUniformTiming.
    expect(timing.minMs).toEqual([500]);
  });

  it("AUT-05: a rate-limited verify (429) is refused BEFORE the floor (the gate stays unfloored)", async () => {
    const email = `otp-timing-gate-${randomUUID()}@wp-su-17.test`;
    const id = email.toLowerCase();
    created.add(id);
    // Fill the OTP per-identifier rate window (OTP_THROTTLE = 6/15min) so the verify's own reserve
    // trips the gate — which returns 429 before reaching withUniformTiming, exactly like otp/request.
    await db.insert(schema.authAttempts).values(
      Array.from({ length: 6 }, () => ({ identifier: id, ip: null, kind: "otp", success: true })),
    );
    const res = await otpVerify(post({ email, code: "000000" }));
    expect(res.status).toBe(429);
    expect(timing.minMs).toEqual([]); // the floor was never entered
  });

  it("AUT-05: an unexpected throw inside the floored body yields a floored otp_verify_failed 500", async () => {
    const email = `otp-timing-throw-${randomUUID()}@wp-su-17.test`;
    created.add(email.toLowerCase());
    // Force a fault on the first query inside the floored body. withUniformTiming swallows it, so the
    // route returns its logged 500 fallback (audit-security F-1) — still floored (minMs recorded).
    const spy = vi.spyOn(OtpStore.prototype, "latestActive").mockRejectedValueOnce(new Error("db down"));
    const res = await otpVerify(post({ email, code: "000000" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "otp_verify_failed" });
    expect(timing.minMs).toEqual([500]);
    spy.mockRestore();
  });
});
