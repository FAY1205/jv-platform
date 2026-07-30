import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";

// WP-SU-8: the per-identifier and per-IP windows are both keyed on attacker-chosen
// values — a fresh email defeats one, a rotated IP defeats the other. The global count
// is the one dimension an attacker cannot rotate away from.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("AuthAttemptsStore.kindCount (WP-SU-8)", () => {
  const db = getDb();
  const store = new AuthAttemptsStore(db);
  // A unique kind per run keeps this test independent of every other suite's rows.
  const KIND = `test_signup_${randomUUID().slice(0, 8)}`;
  const OTHER = `${KIND}_other`;

  afterAll(async () => {
    await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.kind, [KIND, OTHER]));
  });

  it("AUT-03: counts every identifier and IP under one kind", async () => {
    await store.record("a@example.test", "203.0.113.1", KIND, false);
    await store.record("b@example.test", "203.0.113.2", KIND, false);
    await store.record("c@example.test", null, KIND, false);
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
  });

  it("AUT-03: does not count another kind", async () => {
    await store.record("d@example.test", "203.0.113.3", OTHER, false);
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
  });

  it("AUT-03: excludes rows older than the window", async () => {
    const old = new Date(Date.now() - 7_200_000);
    await db.insert(schema.authAttempts).values({
      identifier: "old@example.test",
      ip: null,
      kind: KIND,
      success: false,
      createdAt: old,
    });
    expect(await store.kindCount(KIND, Date.now(), 3_600_000)).toBe(3);
    expect(await store.kindCount(KIND, Date.now(), 10_800_000)).toBe(4);
  });
});
