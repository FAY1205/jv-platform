import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonError, jsonServerError, jsonServiceUnavailable, newTraceId } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/client-ip";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { TRUST_REFRESH_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { establishSessionForEmail } from "@/lib/auth/otp-session";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { notifyTrustReuse } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";
import { TRUST_COOKIE_NAME, TRUST_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// AUT-10: skip OTP on a trusted device. Rotate the trust token (reuse ⇒ revoke family + notify),
// then mint a fresh Supabase session. Pre-session → Origin-checked.
const TRUST_REFRESH_KIND = "trust_refresh";

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }

  const store = await cookies();
  const token = store.get(TRUST_COOKIE_NAME)?.value;
  const clear = () => store.set(TRUST_COOKIE_NAME, "", { ...TRUST_COOKIE_OPTIONS, maxAge: 0 });
  if (!token) return jsonError("no_trusted_device", "No trusted device on this browser.", 401);

  const db = getDb();
  const now = Date.now();
  const ip = clientIp(request);
  const svc = new TrustedDeviceService(db);

  // WP-SU-14 (AUT-10 growth bound): resolve the family BEFORE the insert-heavy rotate and throttle
  // per family + IP. An unknown token inserts nothing, so it needs no throttle. familyId is an
  // internal UUID, never the token (SEC-05-safe as an auth_attempts identifier). This is one extra
  // indexed (unique tokenHash) lookup that rotate() repeats; deliberately not hoisted into rotate —
  // simplicity over saving one indexed read at a few-per-day-per-device cadence.
  const familyId = await svc.familyForToken(token);
  if (!familyId) {
    clear();
    return jsonError("trust_invalid", "Please sign in again.", 401);
  }

  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(familyId, ip, TRUST_REFRESH_KIND);
  const snap = await attempts.snapshot(familyId, ip, TRUST_REFRESH_KIND, now, TRUST_REFRESH_THROTTLE);
  // *WithSelf: the snapshot includes the reservation above (WP-SU-9). Sliding-window ONLY —
  // deliberately not evaluateThrottle (see TRUST_REFRESH_THROTTLE).
  const byFamily = rateDecisionWithSelf(snap.attempts, now, TRUST_REFRESH_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, TRUST_REFRESH_THROTTLE.perIp);
  if (!byFamily.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byFamily.retryAfterMs, byIp.retryAfterMs) / 1000);
    // Refused BEFORE rotate ⇒ no row inserted. The reserved attempt stays success:true (not settled
    // to a failure): trust_refresh is sliding-window-only, so nothing reads a lockout ladder for it.
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let succeeded = false;
  try {
    const { result, email } = await svc.rotate(token, now, ip);

    if (result.status === "reuse_revoked") {
      clear();
      logError("trust_token_reuse", { familyId: result.familyId });
      if (email) await notifyTrustReuse(email);
      return jsonError("trust_reuse", "This device was signed out for security. Please sign in again.", 401);
    }
    if (result.status !== "rotated" || !email) {
      clear();
      return jsonError("trust_invalid", "Please sign in again.", 401);
    }

    // Persist the rotated trust token and mint a fresh Supabase session (no OTP).
    store.set(TRUST_COOKIE_NAME, result.token, TRUST_COOKIE_OPTIONS);
    const session = await establishSessionForEmail(email);
    if (session.status !== "established") {
      // C-34 (SEC-09): a transient auth-backend outage is a retryable 503 + Retry-After (mirroring
      // login / otp/verify); a clean-but-unusable response stays a 500. Account-independent — the
      // trust token was already validated — so the distinct status leaks nothing. The helper returns
      // `detail` so we log ONCE here sharing the response traceId (F-42), not an uncorrelated line.
      const detail = { message: session.detail };
      return session.status === "unavailable"
        ? jsonServiceUnavailable("session_unavailable", "Sign-in is temporarily unavailable. Please try again shortly.", detail)
        : jsonServerError("session_failed", "Could not establish a session. Please sign in.", detail);
    }

    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`);
    const accepted = u ? await latestTosVersion(db, u.id) : null;

    succeeded = result.status === "rotated";
    return NextResponse.json({
      code: "ok",
      message: "Welcome back.",
      tosRequired: needsTosAcceptance(accepted, CURRENT_TOS_VERSION),
    });
  } finally {
    // Settle the reserved attempt with the real outcome (matches reset/confirm). success feeds only
    // the rate window here; no lockout ladder consults trust_refresh, so this is observational.
    await attempts.settle(attemptId, succeeded);
  }
}
