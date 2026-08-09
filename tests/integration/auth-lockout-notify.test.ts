import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import * as schema from "@/db/schema";
import { issueOtp } from "@/lib/auth/otp";
import { OtpStore } from "@/lib/auth/otp-store";
import { POST as otpVerify } from "@/app/api/auth/otp/verify/route";
import { clearDevMailbox, recentDevEmails } from "@/modules/notify/dev-mailbox";

// WP-SU-15 / AUT-04 (live): "the account owner is notified by email on lockout" (§6.18).
// The login route does this; otp/verify ENFORCES the lockout but must also NOTIFY, or a
// partner sign-in DoS is silent. Post-WP-SU-12 only a genuinely wrong code feeds the ladder,
// so the notice must fire ONLY on real credential failures — exactly at the tripping attempt,
// never before, never on a non-wrong outcome. Self-skips without DATABASE_URL.
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORIGIN = "http://localhost";
function post(path: string, body: unknown): Request {
  // requireToken:false routes need only an Origin matching the request URL's origin.
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

suite("AUT-04: OTP lockout notifies the account owner", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client.end();
  });

  // Track every identifier a test creates so cleanup runs even if an assertion throws,
  // so a failing test never leaks rows into the dev DB.
  const created = new Set<string>();
  const track = (id: string): string => {
    created.add(id.toLowerCase());
    return id;
  };

  // The dev mailbox is a process-wide buffer; the suite runs serially
  // (--no-file-parallelism). Clear before AND after each test, and filter by the
  // per-test unique victim, so no assertion sees another test's mail.
  beforeEach(() => clearDevMailbox());
  afterEach(async () => {
    for (const id of created) {
      await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, id));
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, id));
      // WP-SU-16: the atomic lockout-notice claim (guarded so this suite still runs before
      // the notice_claims table exists, e.g. the TDD red step).
      await db.execute(sql`delete from notice_claims where identifier = ${id}`).catch(() => {});
    }
    created.clear();
    clearDevMailbox();
  });

  // Lockout notices (buildLockoutEmail → meta.kind "lockout") captured by the SEC-07 sink,
  // scoped to this victim's real intended recipient.
  const lockoutMailsTo = (email: string): number =>
    recentDevEmails(200).filter((e) => e.kind === "lockout" && e.intendedTo.includes(email))
      .length;

  it("AUT-04: a wrong OTP code emails the owner exactly at the lockout-tripping 5th attempt, not before", async () => {
    const victim = track(`otp-lock-${randomUUID()}@wp-su-15.test`);
    const pepper = randomBytes(16).toString("base64url");
    const { code, challenge } = issueOtp(pepper, Date.now());
    await new OtpStore(db).persist(victim, challenge);
    const wrong = code === "000000" ? "111111" : "000000"; // guaranteed != real code

    // Attempts 1–4 are below the lock threshold (FREE_ATTEMPTS = 4): no notice yet.
    for (let i = 1; i <= 4; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }));
      expect(res.status).toBe(400);
      expect(lockoutMailsTo(victim)).toBe(0);
    }

    // The 5th genuinely wrong code trips the lock → exactly ONE owner notification.
    const fifth = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }));
    expect(fifth.status).toBe(400);
    expect(lockoutMailsTo(victim)).toBe(1);

    // The 6th request is refused at the lockout gate (429) and must NOT re-notify.
    const sixth = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }));
    expect(sixth.status).toBe(429);
    expect(lockoutMailsTo(victim)).toBe(1);
  });

  it("AUT-04: N concurrent wrong OTP codes at the tripping attempt email the owner exactly once", async () => {
    // The race: 6 simultaneous wrong-code verifies should each read the same pre-settle
    // failures===4 (the primed stale failures) and each compute shouldNotify — the atomic
    // single-winner claim must collapse them to exactly ONE owner mail (pre-WP-SU-16 each sent).
    //
    // Under CI load the "concurrent" burst can SERIALISE: one request trips the lock before a 2nd
    // racer reads the snapshot, so fewer than 2 reach the wrong-code (400) branch and the race
    // never happens — the >=2 precondition then fails. That is a timing artifact (the flake this
    // test used to red CI with), NOT a product bug. Retry with a fresh victim until the burst
    // genuinely races, THEN assert the invariant; fail loudly if it never races after N tries (a
    // real serialization regression). Each racing attempt reads failures===4, so the exactly-once
    // guarantee is exercised precisely as before — retrying only re-rolls the timing.
    const staleFailedAt = new Date(Date.now() - 16 * 60_000); // OUTSIDE 15-min rate window, INSIDE 1h lockout

    const raceOnce = async (): Promise<{ raced: number; victim: string }> => {
      const victim = track(`otp-race-${randomUUID()}@wp-su-16.test`);
      const pepper = randomBytes(16).toString("base64url");
      const { code, challenge } = issueOtp(pepper, Date.now());
      await new OtpStore(db).persist(victim, challenge);
      const wrong = code === "000000" ? "111111" : "000000"; // guaranteed != real code
      // 4 prior failures count toward the lock (so the burst trips it) without spending the
      // 6/15min rate budget (so the burst isn't 429'd at the gate and genuinely races).
      await db.insert(schema.authAttempts).values(
        Array.from({ length: 4 }, () => ({ identifier: victim, ip: null, kind: "otp", success: false, createdAt: staleFailedAt })),
      );
      clearDevMailbox();
      const burst = await Promise.all(
        Array.from({ length: 6 }, () => otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }))),
      );
      return { raced: burst.filter((r) => r.status === 400).length, victim };
    };

    let result = { raced: 0, victim: "" };
    for (let attempt = 0; attempt < 10 && result.raced < 2; attempt++) result = await raceOnce();

    expect(result.raced, "concurrent burst never raced (>=2 reached the wrong-code branch) after 10 tries").toBeGreaterThanOrEqual(2);
    expect(lockoutMailsTo(result.victim)).toBe(1);
  });

  it("AUT-04: a verify with no active challenge never emails a lockout notice", async () => {
    const victim = track(`otp-nolock-${randomUUID()}@wp-su-15.test`);
    // No code was ever issued: every verify settles success:true, so lockout never trips
    // and the owner is never emailed — the stranger-DoS victim is not spammed either.
    for (let i = 0; i < 6; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: "000000" }));
      expect(res.status).toBe(400);
    }
    expect(lockoutMailsTo(victim)).toBe(0);
  });
});
