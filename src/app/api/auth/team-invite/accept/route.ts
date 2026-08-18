import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { assertCsrf } from "@/lib/auth/guard";
import { jsonOk, jsonError, newTraceId, jsonServerError } from "@/lib/http";
import { sha256Hex } from "@/lib/auth/hash";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { TEAM_ACCEPT_THROTTLE } from "@/lib/auth/throttle";
import { evaluateNewPassword, hibpRangeFetcher } from "@/lib/auth/password";
import { verifyTeamInviteToken, INVITABLE_ROLES, type InvitableRole } from "@/lib/auth/team-invite";
import {
  provisionTeamMember,
  TeamInviteConsumedError,
  TeamEmailExistsError,
} from "@/lib/auth/provision-team";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { establishSessionForEmail } from "@/lib/auth/otp-session";
import { AcceptInviteSchema } from "@/modules/team/schema";
import { logError } from "@/lib/observability";

const ACCEPT_KIND = "team_accept";

// Phase C: accept a staff invite — set a password, become a seat, land signed in.
// Pre-session route: Origin-only CSRF (the login pattern). The token is the secret
// (it exists only in the invitee's inbox), so responses may distinguish dead links
// from live ones without an enumeration surface over EMAILS (AUT-05 posture — the
// uniform-timing floor guards identifier probes, not single-use 32-byte tokens).
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const parsed = AcceptInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A token and password are required.", 400);
  const { token, password } = parsed.data;
  const now = Date.now();
  const db = getDb();

  // AUT-03: the VERIFY_THROTTLE shape — reserve before deciding (CWE-367), sliding
  // window only (no AUT-04 ladder for a key derived from an inbox-held token).
  const tokenKey = sha256Hex(token).slice(0, 16);
  const ip = clientIp(request);
  const attempts = new AuthAttemptsStore(db);
  const attemptId = await attempts.reserve(tokenKey, ip, ACCEPT_KIND);
  const snap = await attempts.snapshot(tokenKey, ip, ACCEPT_KIND, now, TEAM_ACCEPT_THROTTLE);
  const byToken = rateDecisionWithSelf(snap.attempts, now, TEAM_ACCEPT_THROTTLE.perIdentifier);
  const byIp = rateDecisionWithSelf(snap.ipAttempts, now, TEAM_ACCEPT_THROTTLE.perIp);
  if (!byToken.allowed || !byIp.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byToken.retryAfterMs, byIp.retryAfterMs) / 1000);
    return NextResponse.json(
      { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let accepted = false;
  try {
    const [invite] = await db
      .select({
        id: schema.teamInvites.id,
        tenantId: schema.teamInvites.tenantId,
        email: schema.teamInvites.email,
        role: schema.teamInvites.role,
        tokenHash: schema.teamInvites.tokenHash,
        expiresAt: schema.teamInvites.expiresAt,
        acceptedAt: schema.teamInvites.acceptedAt,
        revokedAt: schema.teamInvites.revokedAt,
      })
      .from(schema.teamInvites)
      .where(and(eq(schema.teamInvites.tokenHash, sha256Hex(token))));
    if (!invite) return jsonError("invite_invalid", "This invite link is invalid or has expired.", 400);

    const check = verifyTeamInviteToken(token, invite, now);
    if (!check.ok) {
      // "used" is benign (double-click after success): safe to say so — only the exact
      // token holder can reach a matched-but-used row (the signup-verify precedent).
      if (check.reason === "used") {
        accepted = true;
        return jsonOk({ code: "invite_already_accepted", message: "This invite was already accepted. You can sign in." });
      }
      return jsonError("invite_invalid", "This invite link is invalid or has expired.", 400);
    }
    if (!INVITABLE_ROLES.includes(invite.role as InvitableRole)) {
      return jsonError("invite_invalid", "This invite link is invalid or has expired.", 400);
    }

    // AUT-02: strength + breach gate, exactly the signup rules.
    const evaluation = await evaluateNewPassword(password, [invite.email], hibpRangeFetcher);
    if (!evaluation.ok) return jsonError("weak_password", evaluation.reasons.join(" "), 422);

    const { userId } = await provisionTeamMember(getSupabaseAdmin(), db, {
      tenantId: invite.tenantId,
      inviteId: invite.id,
      email: invite.email,
      role: invite.role as InvitableRole,
      password,
    });

    // Land signed in (the OTP-session machinery mints a session for the request cookies).
    const session = await establishSessionForEmail(invite.email);
    accepted = true;
    if (session.status !== "established") {
      // The seat exists; only the auto-login failed — the login page works from here.
      logError("team_accept_session_failed", { userId, detail: session.detail });
      return jsonOk({ code: "accepted_login_required", message: "Your account is ready — please sign in." });
    }
    return jsonOk({ code: "accepted", message: "Welcome aboard." });
  } catch (e) {
    if (e instanceof TeamInviteConsumedError) {
      return jsonError("invite_invalid", "This invite link is invalid or has expired.", 400);
    }
    if (e instanceof TeamEmailExistsError) {
      // The address already has an account (any tenant). Honest and safe: the invitee
      // knows their own address; nothing about OTHER accounts is revealed.
      return jsonError("email_in_use", "That email already has an account. Sign in instead.", 409);
    }
    return jsonServerError("accept_failed", "Could not accept the invite. Please try again.", {
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await attempts.settle(attemptId, accepted).catch(() => {});
  }
}
