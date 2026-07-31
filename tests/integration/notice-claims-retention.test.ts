import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { LOCKOUT_NOTICE_WINDOW_MS } from "@/lib/auth/notice-budget";
import {
  AUTH_TABLE_RETENTION_MARGIN_MS,
  NOTICE_CLAIMS_RETENTION_MS,
  noticeClaimsCutoff,
  sweepNoticeClaims,
} from "@/modules/retention/auth-tables";

// WP-SU-18: retention for notice_claims (WP-SU-16), the one auth-sibling table that holds a raw
// login/OTP email (identifier) with no sweep. Anchored on notified_at; a row older than the 1h
// claim window is dead (the next claim would overwrite it), so window+margin can never race a live
// claim. The boundary is a SQL predicate → proven against the real table. Self-skips without
// DATABASE_URL (must NOT self-skip in this environment — read the counts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("WP-SU-18: notice_claims retention sweep", () => {
  const db = getDb();
  const TAG = `su18-ntc-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const cutoff = noticeClaimsCutoff(now);
  const MIN = 60_000;

  async function seed(suffix: string, notifiedAt: Date) {
    await db.insert(schema.noticeClaims).values({
      identifier: `${TAG}-${suffix}@example.test`,
      kind: "lockout:otp",
      notifiedAt,
    });
  }
  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ identifier: schema.noticeClaims.identifier }).from(schema.noticeClaims))
      .map((r) => r.identifier)
      .filter((i) => i.startsWith(TAG))
      .sort();

  beforeAll(async () => {
    // Drain any genuinely-past-retention backlog the dev DB already carries so the `deleted`
    // counts below are exact rather than "mine plus whatever else was already old" (WP-SU-11 pattern).
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepNoticeClaims(db, { now });
      if (deleted === 0) break;
    }

    await seed("ancient", new Date(cutoff.getTime() - 24 * 60 * MIN)); // day past cutoff → delete
    await seed("at-cutoff", cutoff); // boundary inclusive → delete
    await seed("just-inside", new Date(cutoff.getTime() + MIN)); // 1 min inside → keep
    await seed("fresh", now); // keep
  });
  afterAll(async () => {
    for (const i of await mineRemaining()) {
      await db.delete(schema.noticeClaims).where(eq(schema.noticeClaims.identifier, i));
    }
  });

  it("SU-18-NTC-01: deletes rows past the cutoff (boundary inclusive), keeps in-window rows", async () => {
    const { deleted } = await sweepNoticeClaims(db, { now });
    expect(deleted).toBe(2);
    expect(await mineRemaining()).toEqual(
      [`${TAG}-fresh@example.test`, `${TAG}-just-inside@example.test`].sort(),
    );
  });

  it("SU-18-NTC-02: idempotent — a second sweep at the same instant deletes nothing", async () => {
    const { deleted } = await sweepNoticeClaims(db, { now });
    expect(deleted).toBe(0);
  });

  it("SU-18-NTC-03: bounded per run — limit caps rows removed, remainder drains next run", async () => {
    await seed("b1", new Date(cutoff.getTime() - MIN));
    await seed("b2", new Date(cutoff.getTime() - 2 * MIN));
    const first = await sweepNoticeClaims(db, { now, limit: 1 });
    expect(first.deleted).toBe(1);
    const second = await sweepNoticeClaims(db, { now, limit: 10 });
    expect(second.deleted).toBe(1);
  });

  it("SU-18-NTC-04: the cutoff is DERIVED from LOCKOUT_NOTICE_WINDOW_MS + margin, not a restated literal", () => {
    expect(NOTICE_CLAIMS_RETENTION_MS).toBe(LOCKOUT_NOTICE_WINDOW_MS + AUTH_TABLE_RETENTION_MARGIN_MS);
    expect(noticeClaimsCutoff(now).getTime()).toBe(now.getTime() - NOTICE_CLAIMS_RETENTION_MS);
  });
});
