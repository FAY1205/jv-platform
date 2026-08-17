import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getServerScope } from "@/lib/scope-context";
import { jsonOk, jsonError, jsonServiceUnavailable, newTraceId } from "@/lib/http";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { evaluateNewPassword, hibpRangeFetcher } from "@/lib/auth/password";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { CHANGE_PASSWORD_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { withUniformTiming } from "@/lib/auth/enumeration";

// AUT-02 / AUT-08: authenticated admin changes their password. Requires recent
// re-authentication (the current password), enforces strength + breach check, and
// lets Supabase Auth hash/store it (AUT-01). Passwords are never logged (SEC-05).

const MIN_RESPONSE_MS = 500;
const CHANGE_PASSWORD_KIND = "change_password";

const Input = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }

  // Must be authenticated (401/403 via the uniform envelope).
  try {
    await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("invalid_input", "Current and new passwords are required.", 400);
  }
  const { currentPassword, newPassword } = parsed.data;
  const now = Date.now();

  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return jsonError("unauthenticated", "Authentication required.", 401);
  }

  // AUT-03 (WP-SU-22, audit R-30): this was the one credential endpoint with no throttle —
  // a session-holder (or a stolen cookie) could brute-force the CURRENT password unmetered,
  // each guess buying a Supabase re-auth. Sliding window ONLY (not evaluateThrottle): the
  // caller is already authenticated, so composing AUT-04's account lockout would let a
  // session-hijacker lock the real owner out of changing their own password. Reserve the
  // attempt FIRST, then snapshot (WP-SU-9: closes the concurrency race). Keyed on the
  // caller's own email — a normal account identifier, already how login/reset key.
  const email = user.email.toLowerCase();
  const ip = clientIp(request);
  const db = getDb();
  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(email, ip, CHANGE_PASSWORD_KIND);
  const snap = await attempts.snapshot(email, ip, CHANGE_PASSWORD_KIND, now, CHANGE_PASSWORD_THROTTLE);
  const byId = rateDecisionWithSelf(snap.attempts, now, CHANGE_PASSWORD_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, CHANGE_PASSWORD_THROTTLE.perIp);
  if (!byId.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byId.retryAfterMs, byIp.retryAfterMs) / 1000);
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // try/finally so the reservation settles exactly once on every post-gate exit — including
  // the error branches — so a genuine success is never recorded as a failure.
  let succeeded = false;
  try {
    // AUT-08 re-auth + AUT-05 timing floor: confirm the current password, wrapped in
    // withUniformTiming so a wrong current password is not distinguishable by response time.
    // `ok` is tri-state: true (correct), false (wrong), undefined (the auth backend THREW —
    // a transient fault, never a credential result; do not report it as a wrong password).
    let infraError: unknown;
    const ok = await withUniformTiming(
      MIN_RESPONSE_MS,
      async () => {
        try {
          const { error } = await supabase.auth.signInWithPassword({ email: user.email!, password: currentPassword });
          return !error;
        } catch (e) {
          // Capture the fault for the 503 below, then rethrow so the timing floor still applies and
          // `ok` becomes undefined — the infra-fault signal, distinct from a wrong password (login's shape).
          infraError = e;
          throw e;
        }
      },
      (ms) => new Promise((r) => setTimeout(r, ms)),
      () => performance.now(),
    );
    if (ok === undefined) {
      // C-3 / SEC-09 (audit F-2): a transient auth-backend outage — mirror login. Was a bare 503
      // with no log and no Retry-After; jsonServiceUnavailable adds the Retry-After hint and logs the
      // PII-scrubbed fault sharing the response traceId (F-42), so an outage on this authed path is
      // no longer a silent failure (ADR-0014).
      return jsonServiceUnavailable("password_change_unavailable", "Could not verify your current password right now. Please try again.", {
        message: infraError instanceof Error ? infraError.message : String(infraError),
      });
    }
    if (!ok) {
      return jsonError("reauth_failed", "Your current password is incorrect.", 401);
    }

    // AUT-02: strength + breach gate (the email is a zxcvbn user-input to penalize).
    const evaluation = await evaluateNewPassword(newPassword, [user.email], hibpRangeFetcher);
    if (!evaluation.ok) {
      return jsonError("weak_password", evaluation.reasons.join(" "), 422);
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      return jsonError("update_failed", "Could not update the password. Please try again.", 400);
    }

    succeeded = true;
    return jsonOk({ code: "ok", message: "Password updated." });
  } finally {
    // NB (audit-security F-2): unlike login, the infra-outage path (503 above) is ALSO settled here
    // (succeeded=false). Intentional and harmless — change-password uses the SLIDING window
    // (rateDecisionWithSelf), not the AUT-04 lockout ladder, and reserve() already created the window
    // row, so settle(false) vs no-settle changes the rate count by zero. Do NOT "fix" it to match
    // login's no-settle: composing the ladder here would let a session-hijacker lock the real owner out.
    await attempts.settle(attemptId, succeeded);
  }
}
