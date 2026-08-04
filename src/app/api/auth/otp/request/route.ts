import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, OTP_THROTTLE } from "@/lib/auth/throttle";
import { clientIp } from "@/lib/auth/client-ip";
import { issueOtp } from "@/lib/auth/otp";
import { OtpStore } from "@/lib/auth/otp-store";
import { notifyOtp } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";

// PTL-01/AUT-05: request a partner sign-in code. Uniform + timing-floored + rate-
// limited; a 6-digit code is issued (hashed) and emailed via the SEC-07 sink only
// when the email maps to a partner. Origin-checked (pre-session).
const Input = z.object({ email: z.email() });
const KIND = "otp";
const MIN_RESPONSE_MS = 500;
const UNIFORM = { code: "otp_requested", message: "If an account exists, we've sent a code." };

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A valid email is required.", 400);

  const email = parsed.data.email.toLowerCase();
  const ip = clientIp(request);
  const now = Date.now();
  const db = getDb();
  const attempts = new AuthAttemptsStore(db);

  // AUT-03 (WP-SU-9): reserve BEFORE deciding, so this request is inside the window it is
  // judged against. Snapshot-then-record let N concurrent requests all read the same
  // pre-burst state and all pass (CWE-367). The reservation is success:true, so a request
  // refused here never feeds the AUT-04 lockout ladder.
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, OTP_THROTTLE);
  const throttle = evaluateThrottle(snap, now, OTP_THROTTLE);
  if (!throttle.ok) {
    return NextResponse.json({ ...UNIFORM }, { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } });
  }

  await withUniformTiming(
    MIN_RESPONSE_MS,
    async () => {
      try {
        // AUT-04 (WP-SU-12): a code REQUEST is not a credential failure. Settle success:true so it
        // counts toward the AUT-03 rate cap but never feeds the lockout ladder — otherwise a stranger
        // could lock a victim's sign-in just by requesting codes for their address.
        await attempts.settle(attemptId, true);
        const [user] = await db
          .select({ id: schema.users.id, role: schema.users.role })
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = ${email}`);
        if (!user || user.role !== "partner") return; // only partners sign in by OTP
        const pepper = randomBytes(16).toString("base64url");
        const { code, challenge } = issueOtp(pepper, now);
        await new OtpStore(db).persist(email, challenge);
        await notifyOtp(email, code);
      } catch (e) {
        // WP-SU-19 (SEC-05/ADR-0032): withUniformTiming swallows a throw into the timing floor, so an
        // infra fault here (a DB fault, or the email transport rejecting) would otherwise vanish with
        // no log and no Sentry event. Capture it (message scrubbed by the seam), then rethrow: the
        // floor still applies and the caller's uniform response is unchanged. We must NOT surface a
        // 500 — this body only sends for a real partner, so a distinct error status would leak account
        // existence and break AUT-05.
        logError("otp_request_failed", { message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  return NextResponse.json({ ...UNIFORM });
}
