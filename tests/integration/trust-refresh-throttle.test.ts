import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";

// WP-SU-14: exercises the EXACT machinery the route uses (reserve → snapshot → rateDecisionWithSelf
// with kind="trust_refresh", keyed on familyId). Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const KIND = "trust_refresh";

suite("WP-SU-14: trust-refresh throttle binds per family", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let attempts: AuthAttemptsStore;
  const famA = randomUUID();
  const famB = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    attempts = new AuthAttemptsStore(db);
  });
  afterAll(async () => {
    await db.delete(schema.authAttempts).where(inArray(schema.authAttempts.identifier, [famA, famB]));
    await client.end();
  });

  // Mirrors the route: reserve, snapshot (which now includes the reservation), decide WithSelf.
  // Distinct IP per family so the per-IP dimension never cross-contaminates the per-family assertion.
  async function attempt(familyId: string, ip: string, at: number): Promise<boolean> {
    await attempts.reserve(familyId, ip, KIND);
    const snap = await attempts.snapshot(familyId, ip, KIND, at, TRUST_REFRESH_THROTTLE);
    return rateDecisionWithSelf(snap.attempts, at, TRUST_REFRESH_THROTTLE.perIdentifier).allowed;
  }

  it("AUT-10-DEV-THR-02: the (limit+1)th rotation for one family in the window is refused", async () => {
    const at = Date.now();
    const L = TRUST_REFRESH_THROTTLE.perIdentifier.limit;
    const results: boolean[] = [];
    for (let i = 0; i < L + 1; i++) results.push(await attempt(famA, "9.9.9.1", at + i));
    expect(results.slice(0, L).every(Boolean)).toBe(true);
    expect(results[L]).toBe(false);
  });

  it("AUT-10-DEV-THR-03: a different family is unaffected by famA's burst", async () => {
    expect(await attempt(famB, "9.9.9.2", Date.now())).toBe(true);
  });
});
