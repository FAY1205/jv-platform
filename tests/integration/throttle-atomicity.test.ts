import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, type ThrottleConfig } from "@/lib/auth/throttle";

// WP-SU-9 (CWE-367): the throttle decision used to be snapshot-then-record, so N concurrent
// requests all read the same pre-burst window and ALL passed. On signup each pass provisions a
// tenant and sends mail. Self-skips without DATABASE_URL (must NOT self-skip here).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

const CFG: ThrottleConfig = {
  perIdentifier: { limit: 3, windowMs: 900_000 },
  perIp: { limit: 100, windowMs: 900_000 }, // wide, so the identifier limit is what binds
};

suite("AUT-03 (WP-SU-9): the throttle decision is atomic under concurrency", () => {
  const db = getDb();
  const store = new AuthAttemptsStore(db);
  const kinds: string[] = [];

  afterEach(async () => {
    for (const k of kinds.splice(0)) {
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, k));
    }
  });

  const freshKind = () => {
    const k = `atomic_${randomUUID().slice(0, 8)}`;
    kinds.push(k);
    return k;
  };

  /**
   * One request's gate, in the WP-SU-9 order: reserve, THEN decide from a window that already
   * includes the reservation. Drizzle autocommits each statement, so the row is committed
   * before the snapshot query starts — whichever request counts last therefore sees every
   * other request's row.
   */
  async function gate(id: string, kind: string): Promise<boolean> {
    const attemptId = await store.reserve(id, "203.0.113.7", kind);
    const now = Date.now();
    const snap = await store.snapshot(id, "203.0.113.7", kind, now, CFG);
    const ok = evaluateThrottle(snap, now, CFG).ok;
    await store.settle(attemptId, !ok);
    return ok;
  }

  it("AUT-03: 10 concurrent requests never exceed the limit (was: all 10 passed)", async () => {
    const kind = freshKind();
    const id = `burst-${randomUUID()}@example.test`;
    const results = await Promise.all(Array.from({ length: 10 }, () => gate(id, kind)));
    const passed = results.filter(Boolean).length;
    // Fail-CLOSED: contention may refuse MORE than the limit, never fewer. Asserting an exact
    // count here would make the test flaky for the right reason, so the invariant is the bound.
    expect(passed).toBeLessThanOrEqual(CFG.perIdentifier.limit);
  });

  it("AUT-03: a lone request still passes (the limiter is not vacuously closed)", async () => {
    expect(await gate(`solo-${randomUUID()}@example.test`, freshKind())).toBe(true);
  });

  it("AUT-03: sequential requests are admitted up to exactly the limit", async () => {
    const kind = freshKind();
    const id = `seq-${randomUUID()}@example.test`;
    const outcomes: boolean[] = [];
    for (let i = 0; i < CFG.perIdentifier.limit + 2; i++) outcomes.push(await gate(id, kind));
    // No contention, so the bound is tight: exactly `limit` admitted, the rest refused.
    expect(outcomes.filter(Boolean)).toHaveLength(CFG.perIdentifier.limit);
    expect(outcomes.slice(0, CFG.perIdentifier.limit).every(Boolean)).toBe(true);
  });

  it("AUT-04: a reservation never feeds the lockout ladder until it is settled", async () => {
    const kind = freshKind();
    const id = `ladder-${randomUUID()}@example.test`;
    await store.reserve(id, null, kind);
    const snap = await store.snapshot(id, null, kind, Date.now(), CFG);
    expect(snap.attempts).toHaveLength(1); // counts toward the rate window...
    expect(snap.failures).toHaveLength(0); // ...but not toward lockout.
  });

  it("AUT-04: settling a failure DOES feed the lockout ladder", async () => {
    const kind = freshKind();
    const id = `ladder2-${randomUUID()}@example.test`;
    const attemptId = await store.reserve(id, null, kind);
    await store.settle(attemptId, false);
    const snap = await store.snapshot(id, null, kind, Date.now(), CFG);
    expect(snap.failures).toHaveLength(1);
  });

  it("AUT-04: settling a success leaves no failure behind", async () => {
    const kind = freshKind();
    const id = `ladder3-${randomUUID()}@example.test`;
    const attemptId = await store.reserve(id, null, kind);
    await store.settle(attemptId, true);
    const rows = await db.select().from(schema.authAttempts).where(eq(schema.authAttempts.kind, kind));
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(true);
  });
});
