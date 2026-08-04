import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, LOGIN_THROTTLE } from "@/lib/auth/throttle";

// AUT-03/04 (live): the Postgres attempt store + pure throttle decision, round-
// tripped against the auth_attempts table. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("AUT-03/04: throttle store round-trip", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: AuthAttemptsStore;
  const email = `throttle-${randomUUID()}@iso.test`;
  const KIND = "login";

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new AuthAttemptsStore(db);
  });

  afterAll(async () => {
    await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, email.toLowerCase()));
    await client.end();
  });

  it("allows a fresh identifier", async () => {
    const snap = await store.snapshot(email, "1.2.3.4", KIND, Date.now(), LOGIN_THROTTLE);
    expect(evaluateThrottle(snap, Date.now(), LOGIN_THROTTLE).ok).toBe(true);
  });

  it("locks out after 5 recorded failures (AUT-04)", async () => {
    for (let i = 0; i < 5; i++) await store.record(email, "1.2.3.4", KIND, false);
    const now = Date.now();
    const snap = await store.snapshot(email, "1.2.3.4", KIND, now, LOGIN_THROTTLE);
    const d = evaluateThrottle(snap, now, LOGIN_THROTTLE);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("locked_out");
    expect(d.retryAfterSec).toBeGreaterThan(0);
  });

  it("admin unlock clears the failures and restores access (AUT-04)", async () => {
    await store.clearFailures(email, KIND);
    const now = Date.now();
    const snap = await store.snapshot(email, "1.2.3.4", KIND, now, LOGIN_THROTTLE);
    expect(evaluateThrottle(snap, now, LOGIN_THROTTLE).ok).toBe(true);
  });
});
