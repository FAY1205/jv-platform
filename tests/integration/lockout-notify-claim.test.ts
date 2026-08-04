import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { claimLockoutNotice, LOCKOUT_NOTICE_WINDOW_MS } from "@/lib/auth/notice-budget";

// WP-SU-16 / AUT-04 (live): the atomic single-winner claim behind the lockout-notify de-dup. The
// login and otp/verify routes both decide whether to email from a PRE-settle snapshot, so N racing
// wrong-credential requests each think they are the tripping attempt. This claim makes exactly one
// of them "win" the notice per (identifier, window) — the guarantee a read-then-write budget can't
// give. DB-only; self-skips without DATABASE_URL (must NOT self-skip here — read the counts).
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("AUT-04: claimLockoutNotice is an atomic once-per-window claim", () => {
  const db = getDb();
  const ids: string[] = [];
  const fresh = (): string => {
    const id = `claim-${randomUUID()}@wp-su-16.test`;
    ids.push(id);
    return id;
  };
  afterEach(async () => {
    for (const id of ids.splice(0)) {
      await db.execute(sql`delete from notice_claims where identifier = ${id}`).catch(() => {});
    }
  });

  it("AUT-04: the first claim in a window wins and a second within it is refused", async () => {
    const id = fresh();
    const now = Date.now();
    expect(await claimLockoutNotice(db, id, "otp", now)).toBe(true);
    expect(await claimLockoutNotice(db, id, "otp", now + 1000)).toBe(false);
  });

  it("AUT-04: a claim after the window elapses wins again (a new lock event notifies)", async () => {
    const id = fresh();
    const now = Date.now();
    expect(await claimLockoutNotice(db, id, "otp", now)).toBe(true);
    expect(await claimLockoutNotice(db, id, "otp", now + LOCKOUT_NOTICE_WINDOW_MS + 1)).toBe(true);
  });

  it("AUT-04: N concurrent claims for one identifier + surface yield exactly one winner", async () => {
    const id = fresh();
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => claimLockoutNotice(db, id, "otp", now)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("AUT-04: distinct identifiers each get their own claim", async () => {
    const a = fresh();
    const b = fresh();
    const now = Date.now();
    expect(await claimLockoutNotice(db, a, "otp", now)).toBe(true);
    expect(await claimLockoutNotice(db, b, "otp", now)).toBe(true);
  });

  it("AUT-04: the login and otp surfaces claim independently for the same identifier", async () => {
    // A lock on the password-login surface must NOT suppress the owner alert for a genuine lock on
    // the partner-OTP surface (and vice versa) — they are separate AUT-04 events. Both surfaces win
    // in the same window; a repeat WITHIN a surface is still refused.
    const id = fresh();
    const now = Date.now();
    expect(await claimLockoutNotice(db, id, "login", now)).toBe(true);
    expect(await claimLockoutNotice(db, id, "otp", now)).toBe(true); // different surface → own claim
    expect(await claimLockoutNotice(db, id, "login", now + 1000)).toBe(false); // same surface → refused
  });
});
