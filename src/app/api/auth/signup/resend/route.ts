import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, SIGNUP_RESEND_THROTTLE } from "@/lib/auth/throttle";
import { clientIp } from "@/lib/auth/client-ip";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { issueSignupToken } from "@/lib/auth/signup-token";
import { SignupStore } from "@/lib/auth/signup-store";
import { notifySignupVerify } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";

// WP-B (SCP-02/AUT-05): resend the signup verification email. Closes the flow's
// worst dead-end — before this, a missed or expired verification link left the user
// stuck (login rejects an unconfirmed account, re-signup says "you already exist",
// and there was no resend). Enumeration-safe: uniform response + floored timing
// whether or not a pending signup exists, and a NEW link is emailed only for an
// account that exists AND is still unconfirmed. NOT gated on the signup kill-switch —
// finishing an in-flight signup must keep working even after public signup is paused.
const Input = z.object({ email: z.email() });
const KIND = "signup_resend";
const MIN_RESPONSE_MS = 600;

// The one response returned on every path (AUT-05).
const UNIFORM = {
  code: "signup_resend_check_email",
  message: "If your workspace still needs verifying, we've emailed a new link.",
};

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
  // judged against; snapshot-then-record so concurrent requests read the same pre-burst state.
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, SIGNUP_RESEND_THROTTLE);
  const throttle = evaluateThrottle(snap, now, SIGNUP_RESEND_THROTTLE);
  if (!throttle.ok) {
    return NextResponse.json(
      { ...UNIFORM },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  await withUniformTiming(
    MIN_RESPONSE_MS,
    async () => {
      try {
        // A resend is not a credential failure — settle success so it counts toward the AUT-03
        // rate cap but never feeds the AUT-04 lockout ladder (a stranger must not be able to lock
        // a victim's signup by resending for their address).
        await attempts.settle(attemptId, true);

        // Constant-time existence resolution (AUT-05): one indexed lookup, then ONE getUserById
        // for confirmation status. NOT findAuthUserByEmail — its listUsers paging returns early on a
        // hit but scans every page on a miss, which is a timing oracle the floor cannot mask.
        const [row] = await db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = ${email}`);
        if (!row) return; // no account (or already swept) — respond uniformly, send nothing

        const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(row.id);
        if (error || !data.user) return;
        if (data.user.email_confirmed_at) return; // already verified — nothing to resend

        // Rotate to a single fresh token (invalidates the previous link) and email it. Rotating in
        // place keeps exactly one verification row per user, so a resend can never leave a stale
        // expired row for the abandoned-signup sweep to purge out from under a live pending signup.
        const { token, record } = issueSignupToken(row.id, now);
        await new SignupStore(db).rotate(record);
        // C-101 (CWE-644): links that leave the system travel on env.APP_URL (the canonical
        // origin, prod-guarded in lib/env), never on the request Host. Resend is UNAUTHENTICATED
        // and takes the recipient's address from the body, so a forged Host here mails a stranger's
        // verification token to an attacker origin on demand.
        await notifySignupVerify(row.email, `${env.APP_URL}/signup/verify?token=${token}`);
      } catch (e) {
        // WP-SU-19 (SEC-05/ADR-0032): withUniformTiming swallows a throw into the floor, so an infra
        // fault here would otherwise vanish with no log. Capture (message scrubbed by the seam), then
        // rethrow so the floor still applies and the uniform response is unchanged — never a distinct
        // error status, which would leak account existence (AUT-05).
        logError("signup_resend_failed", { message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  return NextResponse.json({ ...UNIFORM });
}
