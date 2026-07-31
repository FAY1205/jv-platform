import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { getSupabaseServer } from "@/lib/supabase/server";
import { jsonError, newTraceId } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { loginOutcome } from "@/lib/auth/login";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, LOGIN_THROTTLE } from "@/lib/auth/throttle";
import { lockoutState } from "@/lib/auth/lockout";
import { clientIp } from "@/lib/auth/client-ip";
import { notifyLockout, notifyAuthAnomaly } from "@/lib/auth/notify";
import { claimLockoutNotice } from "@/lib/auth/notice-budget";
import { logError } from "@/lib/observability";

// AUT-03/04/05/12: admin password login — rate-limited + lockout, uniform failure,
// floored timing, Origin-checked (pre-session, so no double-submit token yet).
const LoginInput = z.object({ email: z.email(), password: z.string().min(1) });

const MIN_RESPONSE_MS = 500;
const KIND = "login";
const ANOMALY_THRESHOLD = 50; // failed logins from one IP...
const ANOMALY_WINDOW_MS = 900_000; // ...within 15 minutes → alert admins

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }

  const parsed = LoginInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("invalid_input", "A valid email and a password are required.", 400);
  }
  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;
  const ip = clientIp(request);
  const now = Date.now();

  const db = getDb();
  const store = new AuthAttemptsStore(db);

  // AUT-03 (WP-SU-9): reserve BEFORE deciding, so this request is inside the window it is
  // judged against — snapshot-then-record let N concurrent requests all pass (CWE-367).
  // The reservation is success:TRUE, which is load-bearing here: a request refused at this
  // gate must not feed the AUT-04 ladder, or anyone could lock any account by hammering
  // login. The real outcome is settled below.
  const attemptId = await store.reserve(email, ip, KIND);

  // AUT-03/04: refuse before attempting when rate-limited or locked out.
  const snapshot = await store.snapshot(email, ip, KIND, now, LOGIN_THROTTLE);
  const throttle = evaluateThrottle(snapshot, now, LOGIN_THROTTLE);
  if (!throttle.ok) {
    return NextResponse.json(
      {
        code: throttle.reason ?? "too_many_requests",
        message: "Too many attempts. Please wait and try again.",
        traceId: newTraceId(),
      },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  const supabase = await getSupabaseServer();
  const success = await withUniformTiming(
    MIN_RESPONSE_MS,
    async () => {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return !error;
      } catch (e) {
        // WP-SU-19 (SEC-05/ADR-0032): withUniformTiming swallows a throw into the timing floor, so a
        // Supabase transport/infra fault would otherwise be invisible (no log, no Sentry) and silently
        // treated as a failed credential. Capture it (message scrubbed by the seam), then rethrow:
        // `success` becomes undefined exactly as before, so the uniform 401 and existing lockout
        // behaviour are unchanged. (Not feeding infra faults into the AUT-04 ladder / returning a 500
        // instead of masquerading as 401 is a real availability fix, but a behaviour change — deferred
        // to its own WP.)
        logError("login_infra_failed", { message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  await store.settle(attemptId, success === true);

  if (success !== true) {
    // AUT-04: notify the owner exactly at the first lockout (include this failure). WP-SU-16:
    // `snapshot` is taken pre-settle, so N concurrent failing logins each read the same
    // failures.length and each pass shouldNotify; claimLockoutNotice is an atomic single-winner
    // claim, so the owner gets exactly ONE mail per lock event, not one per racing request.
    if (
      lockoutState(snapshot.failures.length + 1).shouldNotify &&
      (await claimLockoutNotice(db, email, "login", now))
    ) {
      await notifyLockout(email);
    }
    // AUT-03: alert admins on sustained abuse from one IP (fire once at threshold).
    if (ip) {
      const ipFails = await store.ipFailureCount(ip, KIND, now, ANOMALY_WINDOW_MS);
      if (ipFails === ANOMALY_THRESHOLD) {
        await notifyAuthAnomaly(`sustained failed logins from ${ip} (${ipFails} in 15m)`);
      }
    }
  }

  const outcome = loginOutcome(success === true);
  if (outcome.status === 200) {
    return NextResponse.json({ code: outcome.code, message: outcome.message });
  }
  return NextResponse.json(
    { code: outcome.code, message: outcome.message, traceId: newTraceId() },
    { status: outcome.status },
  );
}
