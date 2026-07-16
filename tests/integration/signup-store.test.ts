import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { SignupStore } from "@/lib/auth/signup-store";
import { issueSignupToken, verifySignupToken } from "@/lib/auth/signup-token";

// SCP-02 / AUT-06 (live): signup-verification token persistence round-trip —
// hashed at rest, single-use, activates the account on success.
// Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("SCP-02: signup verification token store", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: SignupStore;
  const userId = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new SignupStore(db);
  });
  afterAll(async () => {
    await db.delete(schema.signupVerifications).where(eq(schema.signupVerifications.userId, userId));
    await client.end();
  });

  it("SCP-02: persists only the hash and verifies the secret once", async () => {
    const now = Date.now();
    const { token, record } = issueSignupToken(userId, now);
    await store.persist(record);

    const found = await store.findByHash(record.tokenHash);
    expect(found).not.toBeNull();
    expect(found!.tokenHash).toBe(record.tokenHash);
    // The plaintext token is never stored — only its hash.
    expect(found!.tokenHash).not.toContain(token);

    expect(verifySignupToken(token, found!, now).ok).toBe(true);
  });

  it("AUT-06: rejects a wrong token as a mismatch", async () => {
    const now = Date.now();
    const { record } = issueSignupToken(userId, now);
    await store.persist(record);
    const found = await store.findByHash(record.tokenHash);

    expect(verifySignupToken("not-the-right-token", found!, now)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("AUT-06: rejects an expired token", async () => {
    const past = Date.now() - 1000 * 60 * 60 * 48; // 48h ago, well past 24h TTL
    const { token, record } = issueSignupToken(userId, past);
    await store.persist(record);
    const found = await store.findByHash(record.tokenHash);

    expect(verifySignupToken(token, found!, Date.now())).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("AUT-06: markUsed then verify reports used", async () => {
    const now = Date.now();
    const { token, record } = issueSignupToken(userId, now);
    await store.persist(record);
    const found = await store.findByHash(record.tokenHash);

    await store.markUsed(found!.id, now);
    const reused = await store.findByHash(record.tokenHash);
    expect(reused!.usedAt).not.toBeUndefined();
    expect(verifySignupToken(token, reused!, now)).toEqual({ ok: false, reason: "used" });
  });
});
