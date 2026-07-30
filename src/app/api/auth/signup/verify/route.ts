import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { jsonOk, jsonError, newTraceId } from "@/lib/http";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { VERIFY_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { assertCsrf } from "@/lib/auth/guard";
import { sha256Hex } from "@/lib/auth/hash";
import { verifySignupToken } from "@/lib/auth/signup-token";
import { SignupStore } from "@/lib/auth/signup-store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";

// SCP-02/ADR-0033: complete signup by verifying the single-use email token and
// activating login (email_confirm:true). Uniform invalid/expired/used response.
const Input = z.object({ token: z.string().min(10) });
const VERIFY_KIND = "signup_verify";

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A token is required.", 400);
  const { token } = parsed.data;
  const now = Date.now();
  const db = getDb();

  // AUT-03 (WP-SU-6): this was the only credential endpoint without a throttle. The token
  // is 32 random bytes, so guessing is already infeasible — this caps DB + Auth-API load
  // and restores the "every credential endpoint wires a throttle kind" invariant.
  // The identifier is a truncated hash, never the token itself (SEC-05).
  const tokenKey = sha256Hex(token).slice(0, 16);
  const ip = clientIp(request);
  const attempts = new AuthAttemptsStore(db);
  // AUT-03 (WP-SU-9): reserve before deciding (CWE-367) — the try/finally below then settles
  // the real outcome exactly once, as it did before. A request refused AT the gate now also
  // consumes rate budget, which is the point.
  const attemptId = await attempts.reserve(tokenKey, ip, VERIFY_KIND);
  const snap = await attempts.snapshot(tokenKey, ip, VERIFY_KIND, now, VERIFY_THROTTLE);
  // Sliding window ONLY — deliberately not evaluateThrottle. That composes AUT-04's
  // progressive account-lockout ladder, whose two escape hatches (owner notification and
  // an admin `clearFailures`) are both unreachable for a key derived from a token that
  // exists only in the user's inbox. The ladder would also fire at 5 failures, making the
  // configured per-token limit dead config, and would turn an honest "this link expired"
  // into a "wait and try again" that waiting never fixes.
  // *WithSelf: the snapshot now includes the reservation above (WP-SU-9), so a plain
  // rateDecision would admit one fewer than the configured limit.
  const byToken = rateDecisionWithSelf(snap.attempts, now, VERIFY_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, VERIFY_THROTTLE.perIp);
  if (!byToken.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byToken.retryAfterMs, byIp.retryAfterMs) / 1000);
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }
  // try/finally so EVERY post-gate exit consumes budget exactly once — including the
  // Supabase Admin error branch and any thrown error. Recording on only some exits would
  // leave the most expensive path (an outbound Auth API call) outside the budget this
  // throttle exists to enforce. The real outcome is what lands, so a genuine success is
  // never counted as a failure.
  let verified = false;
  try {
    const store = new SignupStore(db);
    const record = await store.findByHash(sha256Hex(token));
    if (!record || !verifySignupToken(token, record, now).ok) {
      return jsonError("signup_verify_invalid", "This link is invalid or has expired.", 400);
    }

    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(record.userId, { email_confirm: true });
    if (error) {
      logError("signup_verify_update_failed", { message: error.message });
      return jsonError("signup_verify_failed", "Could not verify your email. Please try again.", 400);
    }

    // Mark used only AFTER a successful activation, so a transient failure lets the user retry.
    await store.markUsed(record.id, now);
    verified = true;
    return jsonOk({ code: "signup_verified", message: "Your email is verified. You can now log in." });
  } finally {
    await attempts.settle(attemptId, verified);
  }
}
