import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonOk, jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, OTP_THROTTLE } from "@/lib/auth/throttle";
import { lockoutState } from "@/lib/auth/lockout";
import { notifyLockout } from "@/lib/auth/notify";
import { clientIp } from "@/lib/auth/client-ip";
import { OtpStore } from "@/lib/auth/otp-store";
import { otpOutcome } from "@/lib/auth/otp-verify";
import { establishSessionForEmail } from "@/lib/auth/otp-session";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { TRUST_COOKIE_NAME, TRUST_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// PTL-01: verify a partner's 6-digit code (constant-time, single-use, attempt-
// capped), then establish a Supabase session and report whether ToS acceptance is
// still required. Uniform "invalid or expired" for every failure. Origin-checked.
// AUT-10: an optional "remember this device" issues a 30-day trusted-device token.
const Input = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
  remember: z.boolean().optional(),
});
const KIND = "otp";
const MAX_ATTEMPTS = 5;
const INVALID = { code: "otp_invalid", message: "That code is invalid or has expired." };

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "Enter the 6-digit code.", 400);

  const email = parsed.data.email.toLowerCase();
  const { code, remember } = parsed.data;
  const ip = clientIp(request);
  const now = Date.now();
  const db = getDb();
  const attempts = new AuthAttemptsStore(db);

  // AUT-03 (WP-SU-9): reserve before deciding (CWE-367). success:true keeps a gate refusal out of
  // the AUT-04 ladder. AUT-04 (WP-SU-12): each post-gate exit then SETTLES the real outcome, so
  // ONLY a genuinely wrong code on an active challenge feeds the lockout ladder — a credential-less
  // verify (no challenge / expired / too-many) or a correct code never can, closing a stranger-DoS
  // on the victim's sign-in. (This also fixes a latent bug: the prior unconditional settle(false)
  // fed the victim's OWN lockout on a successful verify.)
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, OTP_THROTTLE);
  if (!evaluateThrottle(snap, now, OTP_THROTTLE).ok) {
    return NextResponse.json({ ...INVALID }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const store = new OtpStore(db);
  const challenge = await store.latestActive(email);
  if (!challenge) {
    // No code was ever issued — an admitted attempt (counts toward the AUT-03 rate cap) but NOT a
    // credential failure. Settle success:true so a stranger can't lock a victim by verifying
    // against a non-existent code.
    await attempts.settle(attemptId, true);
    return jsonError(INVALID.code, INVALID.message, 400);
  }

  const outcome = otpOutcome(challenge, code, now, MAX_ATTEMPTS);
  if (outcome !== "ok") {
    // ONLY a genuinely wrong code is a credential failure that feeds the lockout ladder (settle
    // false). expired / too_many / consumed count toward the rate cap only (settle true).
    await attempts.settle(attemptId, outcome !== "wrong");
    if (outcome === "wrong") {
      await store.incrementAttempt(challenge.id);
      // AUT-04 (WP-SU-15): notify the account owner the moment repeated wrong codes trip the
      // lock — mirroring login/route.ts. `snap` predates the settle(false) above (reserve wrote
      // this row success:true, invisible to snapshot's failures), so failures.length + 1 counts
      // this failure. Only a genuine wrong code reaches here (WP-SU-12), so it never fires on a
      // credential-less verify or a successful sign-in. Best-effort; never blocks the response.
      if (lockoutState(snap.failures.length + 1).shouldNotify) await notifyLockout(email);
    } else if (outcome === "too_many" || outcome === "expired") {
      await store.consume(challenge.id, now);
    }
    return jsonError(INVALID.code, INVALID.message, 400);
  }

  // Correct code: settle the successful verification (not a failure), matching the login route's
  // success:true semantics, before we try to establish the session — an infra failure there then
  // leaves a correctly non-lockout row.
  await attempts.settle(attemptId, true);

  // Establish the session BEFORE consuming the code, so an infrastructure failure
  // here leaves the (correct) code usable for an immediate retry.
  if (!(await establishSessionForEmail(email))) {
    return jsonError("session_failed", "Could not establish a session. Please try again.", 500);
  }
  await store.consume(challenge.id, now);

  const [user] = await db
    .select({ id: schema.users.id, tenantId: schema.users.tenantId, partnerId: schema.users.partnerId })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`);
  if (user?.partnerId) {
    await db.update(schema.partners).set({ lastPortalLoginAt: new Date() }).where(eq(schema.partners.id, user.partnerId));
  }

  // AUT-10: issue a trusted-device token if requested, so this device can skip OTP.
  if (remember && user) {
    const { token } = await new TrustedDeviceService(db).issue(
      {
        tenantId: user.tenantId,
        userId: user.id,
        partnerId: user.partnerId,
        deviceLabel: request.headers.get("user-agent"),
        ip,
      },
      now,
    );
    (await cookies()).set(TRUST_COOKIE_NAME, token, TRUST_COOKIE_OPTIONS);
  }

  const accepted = user ? await latestTosVersion(db, user.id) : null;

  return jsonOk({
    code: "ok",
    message: "Signed in.",
    tosRequired: needsTosAcceptance(accepted, CURRENT_TOS_VERSION),
  });
}
