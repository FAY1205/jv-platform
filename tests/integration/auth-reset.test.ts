import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { ResetStore } from "@/lib/auth/reset-store";
import { issueResetToken, verifyResetToken } from "@/lib/auth/reset-token";

// AUT-06 (live): reset-token persistence round-trip — hashed at rest, single-use.
// Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("AUT-06: reset token store", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: ResetStore;
  const userId = randomUUID();

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new ResetStore(db);
  });
  afterAll(async () => {
    await db.delete(schema.resetTokens).where(eq(schema.resetTokens.userId, userId));
    await client.end();
  });

  it("persists only the hash and verifies the secret once, then marks it used", async () => {
    const now = Date.now();
    const { token, record } = issueResetToken(userId, now);
    await store.persist(record);

    const found = await store.findByHash(record.tokenHash);
    expect(found).not.toBeNull();
    expect(found!.tokenHash).toBe(record.tokenHash);
    // The plaintext token is never stored — only its hash.
    expect(found!.tokenHash).not.toContain(token);

    expect(verifyResetToken(token, found!, now).ok).toBe(true);

    await store.markUsed(found!.id, now);
    const reused = await store.findByHash(record.tokenHash);
    expect(verifyResetToken(token, reused!, now)).toEqual({ ok: false, reason: "used" });
  });

  it("rejects a wrong token (no matching hash)", async () => {
    const found = await store.findByHash("deadbeef".repeat(8));
    expect(found).toBeNull();
  });
});
