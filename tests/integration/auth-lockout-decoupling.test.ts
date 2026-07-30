import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import * as schema from "@/db/schema";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, OTP_THROTTLE, RESET_THROTTLE } from "@/lib/auth/throttle";
import { POST as otpRequest } from "@/app/api/auth/otp/request/route";
import { POST as resetRequest } from "@/app/api/auth/reset/request/route";
import { issueOtp } from "@/lib/auth/otp";
import { OtpStore } from "@/lib/auth/otp-store";
import { POST as otpVerify } from "@/app/api/auth/otp/verify/route";

// WP-SU-12 / AUT-04 (live): a code REQUEST is not a credential failure and must
// never feed the progressive-lockout ladder — otherwise a stranger could DoS a
// victim by requesting codes for their email. Rate caps (AUT-03) still apply.
// Self-skips without DATABASE_URL.
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

suite("AUT-04: code requests are decoupled from the lockout ladder", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let store: AuthAttemptsStore;

  beforeAll(() => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    store = new AuthAttemptsStore(db);
  });

  afterAll(async () => {
    await client.end();
  });

  // Tracks every identifier created by a test so afterEach can clean it up
  // unconditionally — even when an assertion above it throws — so a failing
  // test never leaks rows into the dev DB.
  const created = new Set<string>();
  const track = (id: string): string => {
    created.add(id.toLowerCase());
    return id;
  };

  afterEach(async () => {
    for (const id of created) {
      await db.delete(schema.otpChallenges).where(eq(schema.otpChallenges.identifier, id));
      await db.delete(schema.authAttempts).where(eq(schema.authAttempts.identifier, id));
    }
    created.clear();
  });

  it("AUT-04: repeated OTP requests by a stranger never lock the victim", async () => {
    const victim = track(`otp-req-${randomUUID()}@wp-su-12.test`);
    for (let i = 0; i < 5; i++) {
      const res = await otpRequest(post("/api/auth/otp/request", { email: victim }));
      expect(res.status).toBe(200); // uniform accept — never a lockout 429
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(0); // no lockout-feeding rows
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).not.toBe("locked_out");
  });

  it("AUT-04: repeated reset requests by a stranger never lock the victim", async () => {
    const victim = track(`reset-req-${randomUUID()}@wp-su-12.test`);
    for (let i = 0; i < 5; i++) {
      const res = await resetRequest(post("/api/auth/reset/request", { email: victim }));
      expect(res.status).toBe(200);
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "reset", now, RESET_THROTTLE);
    expect(snap.failures.length).toBe(0);
    expect(evaluateThrottle(snap, now, RESET_THROTTLE).reason).not.toBe("locked_out");
  });

  it("AUT-04: OTP requests still count toward the rate window (flood cap intact)", async () => {
    const victim = track(`otp-rate-${randomUUID()}@wp-su-12.test`);
    for (let i = 0; i < 5; i++) {
      await otpRequest(post("/api/auth/otp/request", { email: victim }));
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.attempts.length).toBe(5); // every request is still recorded (rate)
  });

  it("AUT-04: a verify with no active challenge does not feed lockout", async () => {
    const victim = track(`otp-noverify-${randomUUID()}@wp-su-12.test`);
    for (let i = 0; i < 5; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: "000000" }));
      expect(res.status).toBe(400); // uniform invalid — no code was ever issued
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(0); // must NOT feed lockout
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).not.toBe("locked_out");
  });

  it("AUT-04: a genuinely wrong OTP code still feeds lockout (brute-force protection)", async () => {
    const victim = track(`otp-wrong-${randomUUID()}@wp-su-12.test`);
    const now0 = Date.now();
    const pepper = randomBytes(16).toString("base64url");
    const { code, challenge } = issueOtp(pepper, now0);
    await new OtpStore(db).persist(victim, challenge);
    const wrong = code === "000000" ? "111111" : "000000"; // guaranteed != real code

    for (let i = 0; i < 5; i++) {
      const res = await otpVerify(post("/api/auth/otp/verify", { email: victim, code: wrong }));
      expect(res.status).toBe(400);
    }
    const now = Date.now();
    const snap = await store.snapshot(victim, null, "otp", now, OTP_THROTTLE);
    expect(snap.failures.length).toBe(5); // wrong guesses DO feed lockout
    expect(evaluateThrottle(snap, now, OTP_THROTTLE).reason).toBe("locked_out");
  });
});
