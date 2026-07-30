import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { OTP_TTL_MS } from "@/lib/auth/otp";
import { RESET_TTL_MS } from "@/lib/auth/reset-token";
import { SIGNUP_TTL_MS } from "@/lib/auth/signup-token";
import {
  otpChallengesCutoff,
  sweepOtpChallenges,
  resetTokensCutoff,
  sweepResetTokens,
  signupVerificationsCutoff,
  sweepSignupVerifications,
} from "@/modules/retention/auth-tables";

// WP-SU-13: the sweep boundary is a SQL predicate, so it is proven against the real table.
// Self-skips without DATABASE_URL (must NOT self-skip in this environment — read the counts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("WP-SU-13: otp_challenges retention sweep", () => {
  const db = getDb();
  const TAG = `su13-otp-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const cutoff = otpChallengesCutoff(now);
  const MIN = 60_000;

  async function seed(suffix: string, createdAt: Date) {
    await db.insert(schema.otpChallenges).values({
      identifier: `${TAG}-${suffix}@example.test`,
      codeHash: "x",
      pepper: "p",
      expiresAt: new Date(createdAt.getTime() + OTP_TTL_MS),
      createdAt,
    });
  }
  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ identifier: schema.otpChallenges.identifier }).from(schema.otpChallenges))
      .map((r) => r.identifier)
      .filter((i) => i.startsWith(TAG))
      .sort();

  beforeAll(async () => {
    // Drain any genuinely-past-retention backlog the dev DB already carries — those rows are
    // unreadable by any code path and deleting them IS this sweep's job, so the drain observes
    // nothing the app or a test can see, and it makes the `deleted` counts below exact rather than
    // "mine plus whatever else was already old". Mirrors the WP-SU-11 retention suite's beforeAll.
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepOtpChallenges(db, { now });
      if (deleted === 0) break;
    }

    await seed("ancient", new Date(cutoff.getTime() - 24 * 60 * MIN)); // day past cutoff → delete
    await seed("at-cutoff", cutoff); // boundary inclusive → delete
    await seed("just-inside", new Date(cutoff.getTime() + MIN)); // 1 min inside → keep
    await seed("fresh", now); // keep
  });
  afterAll(async () => {
    for (const i of await mineRemaining()) {
      await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, i));
    }
  });

  it("SU-13-OTP-04: deletes rows past the cutoff (boundary inclusive), keeps in-window rows", async () => {
    const { deleted } = await sweepOtpChallenges(db, { now });
    expect(deleted).toBe(2);
    expect(await mineRemaining()).toEqual([`${TAG}-fresh@example.test`, `${TAG}-just-inside@example.test`].sort());
  });

  it("SU-13-OTP-05: idempotent — a second sweep at the same instant deletes nothing", async () => {
    const { deleted } = await sweepOtpChallenges(db, { now });
    expect(deleted).toBe(0);
  });

  it("SU-13-OTP-06: bounded per run — limit caps rows removed, remainder drains next run", async () => {
    await seed("b1", new Date(cutoff.getTime() - MIN));
    await seed("b2", new Date(cutoff.getTime() - 2 * MIN));
    const first = await sweepOtpChallenges(db, { now, limit: 1 });
    expect(first.deleted).toBe(1);
    const second = await sweepOtpChallenges(db, { now, limit: 10 });
    expect(second.deleted).toBe(1);
  });
});

suite("WP-SU-13: reset_tokens retention sweep", () => {
  const db = getDb();
  const now = new Date();
  const cutoff = resetTokensCutoff(now);
  const MIN = 60_000;
  const tags: string[] = [];

  async function seed(createdAt: Date): Promise<string> {
    const userId = randomUUID();
    tags.push(userId);
    await db.insert(schema.resetTokens).values({
      userId,
      tokenHash: `su13-rst-${randomUUID()}`,
      expiresAt: new Date(createdAt.getTime() + RESET_TTL_MS),
      createdAt,
    });
    return userId;
  }
  const mineRemaining = async () =>
    (await db.select({ userId: schema.resetTokens.userId }).from(schema.resetTokens))
      .map((r) => r.userId)
      .filter((u) => tags.includes(u)).length;

  beforeAll(async () => {
    // Drain pre-existing past-cutoff backlog so `deleted` counts are exact (WP-SU-11 pattern).
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepResetTokens(db, { now });
      if (deleted === 0) break;
    }
    await seed(new Date(cutoff.getTime() - MIN)); // past cutoff → delete
    await seed(new Date(cutoff.getTime() + MIN)); // in-window → keep
  });
  afterAll(async () => {
    for (const u of tags) await db.delete(schema.resetTokens).where(eq(schema.resetTokens.userId, u));
  });

  it("SU-13-RST-04: deletes past-cutoff tokens, keeps in-window tokens", async () => {
    const { deleted } = await sweepResetTokens(db, { now });
    expect(deleted).toBe(1);
    expect(await mineRemaining()).toBe(1);
  });
  it("SU-13-RST-05: idempotent", async () => {
    expect((await sweepResetTokens(db, { now })).deleted).toBe(0);
  });
});

suite("WP-SU-13: signup_verifications retention sweep (used rows only)", () => {
  const db = getDb();
  const now = new Date();
  const cutoff = signupVerificationsCutoff(now);
  const MIN = 60_000;
  const tags: string[] = [];

  async function seed(createdAt: Date, used: boolean): Promise<string> {
    const userId = randomUUID();
    tags.push(userId);
    await db.insert(schema.signupVerifications).values({
      userId,
      tokenHash: `su13-sgn-${randomUUID()}`,
      expiresAt: new Date(createdAt.getTime() + SIGNUP_TTL_MS),
      usedAt: used ? new Date(createdAt.getTime() + MIN) : null,
      createdAt,
    });
    return userId;
  }
  const mineRemaining = async (): Promise<string[]> =>
    (await db.select({ userId: schema.signupVerifications.userId }).from(schema.signupVerifications))
      .map((r) => r.userId)
      .filter((u) => tags.includes(u))
      .sort();

  let usedOld: string, unusedOld: string;
  beforeAll(async () => {
    // Drain pre-existing USED past-cutoff backlog so `deleted` counts are exact (WP-SU-11 pattern).
    // The sweep only touches usedAt-set rows, so this never disturbs unconsumed abandonment rows.
    for (let pass = 0; pass < 10; pass++) {
      const { deleted } = await sweepSignupVerifications(db, { now });
      if (deleted === 0) break;
    }
    usedOld = await seed(new Date(cutoff.getTime() - MIN), true); // used + past cutoff → DELETE
    unusedOld = await seed(new Date(cutoff.getTime() - MIN), false); // UNCONSUMED + past cutoff → KEEP
    await seed(new Date(cutoff.getTime() + MIN), true); // used + in-window → keep
  });
  afterAll(async () => {
    for (const u of tags) await db.delete(schema.signupVerifications).where(eq(schema.signupVerifications.userId, u));
  });

  it("SU-13-SGN-04: deletes USED past-cutoff rows but NEVER an unconsumed row (signup-sweep's signal)", async () => {
    const { deleted } = await sweepSignupVerifications(db, { now });
    expect(deleted).toBe(1); // only usedOld
    const left = await mineRemaining();
    expect(left).toContain(unusedOld); // unconsumed abandoned-signal row survives
    expect(left).not.toContain(usedOld);
    expect(left.length).toBe(2);
  });
  it("SU-13-SGN-05: idempotent", async () => {
    expect((await sweepSignupVerifications(db, { now })).deleted).toBe(0);
  });
});
