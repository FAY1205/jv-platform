import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { RESET_CONFIRM_THROTTLE } from "@/lib/auth/throttle";
import { jsonRequest } from "./_route-harness";
import { POST } from "@/app/api/auth/reset/confirm/route";

// AUT-03 (WP-SU-9): reset/confirm was the last credential endpoint with NO throttle at all.
// Unthrottled, each guess cost a token lookup, an HIBP range fetch, a Supabase password write
// and a global sign-out. Self-skips without DATABASE_URL (must NOT self-skip here).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const KIND = "reset_confirm";

suite("POST /api/auth/reset/confirm — throttle (WP-SU-9)", () => {
  const db = getDb();

  afterEach(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, KIND));
  });

  const callWith = (token: string) =>
    POST(
      jsonRequest("POST", "/api/auth/reset/confirm", {
        token,
        newPassword: `Correct-Horse-${randomUUID()}-Battery-9!`,
      }),
    );

  it("AUT-03: refuses with 429 + Retry-After past the per-token limit", async () => {
    // One token, replayed. A bogus token is fine — the throttle runs BEFORE the lookup, which
    // is exactly the point: unthrottled, every guess bought a DB read and an outbound fetch.
    const token = `tok-${randomUUID()}${randomUUID()}`;

    for (let i = 0; i < RESET_CONFIRM_THROTTLE.perIdentifier.limit; i++) {
      expect((await callWith(token)).status).toBe(400); // reset_invalid — admitted
    }

    const blocked = await callWith(token);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await blocked.json();
    expect(body.code).toBe("too_many_requests");
    expect(body.traceId).toBeTruthy(); // uniform {code,message,traceId} envelope
  });

  it("SEC-05: the throttle key is a hash prefix — the raw token never reaches auth_attempts", async () => {
    // auth_attempts.identifier is queried, indexed and logged. A live reset token sitting there
    // is an account-takeover credential, so this pins the key's SHAPE, not just its absence.
    const token = `tok-${randomUUID()}${randomUUID()}`;
    await callWith(token);

    const rows = await db
      .select({ identifier: schema.authAttempts.identifier })
      .from(schema.authAttempts)
      .where(eq(schema.authAttempts.kind, KIND));
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).not.toBe(token);
    expect(rows[0].identifier).not.toContain(token);
    expect(rows[0].identifier).toMatch(/^[0-9a-f]{16}$/);
  });

  it("AUT-04: an admitted attempt is settled as a failure, a distinct token has its own budget", async () => {
    const tokenA = `tok-${randomUUID()}${randomUUID()}`;
    const tokenB = `tok-${randomUUID()}${randomUUID()}`;
    await callWith(tokenA);
    await callWith(tokenB);

    const rows = await db
      .select({ identifier: schema.authAttempts.identifier, success: schema.authAttempts.success })
      .from(schema.authAttempts)
      .where(eq(schema.authAttempts.kind, KIND));
    // Two distinct keys — one token's budget can never exhaust another's.
    expect(new Set(rows.map((r) => r.identifier)).size).toBe(2);
    // Both failed (bogus tokens), settled from the reservation's neutral success:true.
    expect(rows.every((r) => r.success === false)).toBe(true);
  });

  it("AUT-03: the per-token budget is independent — one exhausted token does not block another", async () => {
    const exhausted = `tok-${randomUUID()}${randomUUID()}`;
    for (let i = 0; i < RESET_CONFIRM_THROTTLE.perIdentifier.limit + 1; i++) await callWith(exhausted);
    expect((await callWith(exhausted)).status).toBe(429);

    // A different token is still admitted, because the per-IP limit is the looser of the two
    // and the harness presents no client IP.
    const fresh = `tok-${randomUUID()}${randomUUID()}`;
    const freshRows = await db
      .select({ i: schema.authAttempts.identifier })
      .from(schema.authAttempts)
      .where(and(eq(schema.authAttempts.kind, KIND), eq(schema.authAttempts.success, false)));
    expect(freshRows.length).toBeGreaterThan(0);
    expect((await callWith(fresh)).status).toBe(400);
  });
});
