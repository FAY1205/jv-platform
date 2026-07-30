import { eq } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { NextResponse } from "next/server";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { sha256Hex } from "@/lib/auth/hash";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { RESET_CONFIRM_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { verifyResetToken } from "@/lib/auth/reset-token";
import { ResetStore } from "@/lib/auth/reset-store";
import { evaluateNewPassword, hibpRangeFetcher } from "@/lib/auth/password";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notifyPasswordChanged } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";

// AUT-06: complete a password reset. Verify the single-use token, enforce strength
// + breach, set the password (Supabase admin), revoke ALL sessions, notify, and mark
// the token used. Pre-session route → Origin-checked (no double-submit token yet).
const Input = z.object({ token: z.string().min(10), newPassword: z.string().min(1) });
const RESET_CONFIRM_KIND = "reset_confirm";

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A token and a new password are required.", 400);
  const { token, newPassword } = parsed.data;
  const now = Date.now();

  const db = getDb();
  const store = new ResetStore(db);

  // AUT-03 (WP-SU-9): this was the last credential endpoint with no throttle. Sliding window
  // ONLY — deliberately not evaluateThrottle, for the same reason signup/verify avoids it: that
  // composes AUT-04's progressive account lockout, whose two escape hatches (owner notification
  // and an admin clearFailures) are both unreachable for a key derived from a token that exists
  // only in the user's inbox, and it would turn an honest "this link expired" into a "wait and
  // try again" that waiting never fixes.
  //
  // The key is a TRUNCATED HASH, never the token (SEC-05): auth_attempts.identifier is queried,
  // indexed and logged, and a live reset token sitting there is an account-takeover credential.
  const tokenKey = sha256Hex(token).slice(0, 16);
  const ip = clientIp(request);
  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(tokenKey, ip, RESET_CONFIRM_KIND);
  const snap = await attempts.snapshot(tokenKey, ip, RESET_CONFIRM_KIND, now, RESET_CONFIRM_THROTTLE);
  // *WithSelf: the snapshot includes the reservation above (WP-SU-9).
  const byToken = rateDecisionWithSelf(snap.attempts, now, RESET_CONFIRM_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, RESET_CONFIRM_THROTTLE.perIp);
  if (!byToken.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byToken.retryAfterMs, byIp.retryAfterMs) / 1000);
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // try/finally so EVERY post-gate exit settles the attempt exactly once — including the
  // Supabase error branches and any throw. The real outcome is what lands, so a genuine
  // success is never counted as a failure.
  let succeeded = false;
  try {
    const record = await store.findByHash(sha256Hex(token));
    if (!record || !verifyResetToken(token, record, now).ok) {
      return jsonError("reset_invalid", "This reset link is invalid or has expired.", 400);
    }

    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, record.userId));
    if (!user) return jsonError("reset_invalid", "This reset link is invalid or has expired.", 400);

    // AUT-02: strength + breach gate on the new password.
    const evaluation = await evaluateNewPassword(newPassword, [user.email], hibpRangeFetcher);
    if (!evaluation.ok) return jsonError("weak_password", evaluation.reasons.join(" "), 422);

    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin.auth.admin.updateUserById(record.userId, { password: newPassword });
    if (updateError) return jsonError("reset_failed", "Could not reset the password. Please request a new link.", 400);

    // AUT-06: revoke ALL existing sessions. Sign in with the new password to obtain a
    // token, then global sign-out revokes every refresh token (including that one).
    // Track success so we never claim revocation happened when it didn't.
    let sessionsRevoked = false;
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
        const { data } = await anon.auth.signInWithPassword({ email: user.email, password: newPassword });
        const accessToken = data.session?.access_token;
        if (accessToken) {
          const { error: signOutError } = await admin.auth.admin.signOut(accessToken, "global");
          if (signOutError) logError("reset_revoke_failed", { userId: record.userId, message: signOutError.message });
          else sessionsRevoked = true;
        } else {
          logError("reset_revoke_no_session", { userId: record.userId });
        }
      } catch (e) {
        logError("reset_revoke_failed", { userId: record.userId, message: e instanceof Error ? e.message : String(e) });
      }
    } else {
      logError("reset_revoke_unconfigured", { userId: record.userId });
    }

    await store.markUsed(record.id, now);
    await notifyPasswordChanged(user.email, sessionsRevoked);

    succeeded = true;
    return jsonOk({
      code: "ok",
      message: sessionsRevoked
        ? "Password updated. Please sign in."
        : "Password updated. Please sign in, and sign out of any other devices to be safe.",
    });
  } finally {
    // settle's argument is the SUCCESS flag, not a failure flag.
    await attempts.settle(attemptId, succeeded);
  }
}
