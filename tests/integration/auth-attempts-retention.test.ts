import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore, LOCKOUT_WINDOW_MS } from "@/lib/auth/attempts-store";
import { ALREADY_REGISTERED_CAP } from "@/lib/auth/throttle";
import { authAttemptsCutoff, sweepAuthAttempts } from "@/modules/retention/auth-attempts";

// WP-SU-11 (ADR-0010): the auth_attempts retention pass. Two properties matter and they pull in
// opposite directions — it must actually DELETE old rows (data minimisation: the table holds the
// lowercased email of anyone an attacker merely NAMED at signup, plus IPs, and nothing reads past
// 24h), and it must NEVER delete a row a live rate-limit, lockout or notification cap can still
// read. Both are proven here against the real table, because the boundary is a SQL predicate.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment — read the counts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("WP-SU-11: auth_attempts retention sweep (ADR-0010)", () => {
  const db = getDb();
  const store = new AuthAttemptsStore(db);
  // A unique kind per run keeps the fixtures independent of every other suite's rows.
  const KIND = `test_retention_${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const cutoff = authAttemptsCutoff(now);
  const MINUTE = 60_000;
  /** The seeded rows that must SURVIVE every sweep in this file — sorted, as remainingIdentifiers is. */
  const KEEPERS = [
    "fresh@example.test",
    "just-inside@example.test",
    "within-24h-cap@example.test",
    "within-lockout-window@example.test",
  ];

  /** Insert a row with an explicit created_at — the column the sweep's predicate reads. */
  async function seed(identifier: string, createdAt: Date, ip: string | null = "203.0.113.7") {
    await db.insert(schema.authAttempts).values({ identifier, ip, kind: KIND, success: false, createdAt });
  }

  const remainingIdentifiers = async (): Promise<string[]> =>
    (
      await db
        .select({ identifier: schema.authAttempts.identifier })
        .from(schema.authAttempts)
        .where(eq(schema.authAttempts.kind, KIND))
    )
      .map((r) => r.identifier)
      .sort();

  beforeAll(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, KIND));

    // Drain any genuinely-past-retention backlog the dev database already carries, so the
    // `deleted` counts below are exact rather than "mine plus whatever else was old". Deleting
    // those rows is precisely this sweep's job and they are unreadable by any code path, so the
    // drain is not destructive to anything a test or the app can observe.
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepAuthAttempts(db, { now });
      if (deleted === 0) break;
    }

    await seed("ancient@example.test", new Date(cutoff.getTime() - 24 * 60 * MINUTE)); // a day past cutoff
    await seed("exactly-at-cutoff@example.test", cutoff); // boundary — inclusive
    await seed("just-inside@example.test", new Date(cutoff.getTime() + MINUTE)); // 1 min inside
    await seed("within-lockout-window@example.test", new Date(now.getTime() - LOCKOUT_WINDOW_MS + MINUTE));
    await seed("within-24h-cap@example.test", new Date(now.getTime() - ALREADY_REGISTERED_CAP.windowMs + MINUTE));
    await seed("fresh@example.test", now, null);
  });

  afterAll(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.kind, KIND));
  });

  it("ADR-0010/SEC-05: deletes rows past the retention cutoff, boundary inclusive", async () => {
    const { deleted } = await sweepAuthAttempts(db, { now });
    expect(deleted).toBe(2); // the day-old-past-cutoff row and the exactly-at-cutoff row

    expect(await remainingIdentifiers()).toEqual(KEEPERS);
  });

  it("AUT-03/AUT-04: never deletes a row a live rate-limit, lockout or notice cap still reads", async () => {
    // The whole point of the margin: the newest row the sweep removed is still far older than
    // the oldest row ANY read of this table looks back to.
    const lockoutReadable = await store.snapshot("within-lockout-window@example.test", null, KIND, now.getTime(), {
      perIdentifier: { limit: 5, windowMs: LOCKOUT_WINDOW_MS },
      perIp: { limit: 5, windowMs: LOCKOUT_WINDOW_MS },
    });
    expect(lockoutReadable.failures.length).toBe(1);

    const capReadable = await store.identifierCount(
      "within-24h-cap@example.test",
      KIND,
      now.getTime(),
      ALREADY_REGISTERED_CAP.windowMs,
    );
    expect(capReadable).toBe(1);
  });

  it("ADR-0010: idempotent — a second sweep at the same instant deletes nothing", async () => {
    const { deleted } = await sweepAuthAttempts(db, { now });
    expect(deleted).toBe(0);
    expect(await remainingIdentifiers()).toEqual(KEEPERS);
  });

  it("ADR-0010: bounded per run — a backlog drains across runs rather than in one long delete", async () => {
    // The backlog is seeded PAST the fixed cutoff rather than by advancing `now`: moving the
    // clock forward would widen the cutoff over every other row in the database, so the test
    // would delete unrelated live rate-limit rows and its counts would not be its own.
    for (const n of [1, 2, 3]) await seed(`backlog-${n}@example.test`, new Date(cutoff.getTime() - n * MINUTE));

    const { deleted: first } = await sweepAuthAttempts(db, { now, limit: 1 });
    expect(first).toBe(1);
    expect((await remainingIdentifiers()).length).toBe(KEEPERS.length + 2);

    const { deleted: second } = await sweepAuthAttempts(db, { now, limit: 10 });
    expect(second).toBe(2);
    expect(await remainingIdentifiers()).toEqual(KEEPERS);
  });

  it("ADR-0010: deletes oldest-first, so a bounded run drains a backlog fairly", async () => {
    const base = new Date(cutoff.getTime() - 10 * MINUTE);
    await seed("older@example.test", base);
    await seed("newer@example.test", new Date(base.getTime() + MINUTE));

    const { deleted } = await sweepAuthAttempts(db, { now, limit: 1 });
    expect(deleted).toBe(1);
    expect(await remainingIdentifiers()).toEqual([...KEEPERS, "newer@example.test"].sort());
  });

  it("SEC-05: leaves no row older than the cutoff behind once drained", async () => {
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepAuthAttempts(db, { now });
      if (deleted === 0) break;
    }
    const [row] = await db
      .select({ c: schema.authAttempts.id })
      .from(schema.authAttempts)
      .where(and(eq(schema.authAttempts.kind, KIND), lte(schema.authAttempts.createdAt, cutoff)))
      .limit(1);
    expect(row).toBeUndefined();
    expect(await remainingIdentifiers()).toEqual(KEEPERS); // ...and the live-window rows survived
  });
});
