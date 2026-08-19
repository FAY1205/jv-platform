import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { sha256Hex } from "@/lib/auth/hash";
import { clientIp } from "@/lib/auth/client-ip";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { UNSUBSCRIBE_THROTTLE } from "@/lib/auth/throttle";
import { rateDecisionWithSelf } from "@/lib/auth/rate-limit";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { parseContentLength, exceedsBodyLimit } from "@/lib/upload-guard";
import { applyUnsubscribe, UnsubscribeRequestSchema } from "@/modules/notify/unsubscribe";

// POST /api/unsubscribe — NTF-13. The ONE write behind an email footer link.
//
// NO SESSION AND NO CSRF TOKEN, by design — and this is a decision to preserve, not a gap to
// close (see the CSRF_EXEMPT entry in tests/unit/csrf-conformance.test.ts). A recipient clicking
// "unsubscribe" in a mail client is, definitionally, not signed in, so requiring a session would
// send them to /login and make the control unusable for the people who most need it. The bearer
// token in the body IS the capability: unguessable (18B id + 32B secret), scoped to exactly one
// subject, and able only to REDUCE that subject's email. A CSRF token would add nothing — an
// attacker who could forge this request already holds the victim's token and could simply call
// the endpoint directly — and it would BREAK the RFC 8058 one-click flow (List-Unsubscribe-Post),
// where the mail provider POSTs from its own infrastructure with no cookie jar at all.
//
// AUT-05: every outcome — valid token, wrong secret, malformed token, unknown event, subject long
// gone — returns the SAME body and status, and the response never echoes an address.
const GENERIC_SUCCESS = {
  code: "ok",
  message: "If that link was still valid, those emails are switched off. It can take a few minutes to take effect.",
};

const UNSUBSCRIBE_KIND = "unsubscribe";

/** AUT-05 timing floor. The DB work here is one indexed lookup plus at most one small update, so
 *  a floor comfortably above the slow path makes every outcome indistinguishable by clock. */
const UNIFORM_TIMING_MS = 250;

export async function POST(request: Request) {
  try {
    // Reject an oversize body from its Content-Length before parsing it into memory (the
    // uploads-route F-86 guard). A token is ~70 characters; 4 KiB is already generous.
    if (exceedsBodyLimit(parseContentLength(request.headers.get("content-length")), 4096)) {
      return jsonError("invalid_input", "Invalid unsubscribe request.", 400);
    }
    const parsed = UnsubscribeRequestSchema.safeParse(await request.json().catch(() => null));
    // A body missing the fields entirely carries no token, so it is not an existence oracle —
    // it is a malformed call, and says so. Anything that IS a well-formed {token, event} pair
    // goes down the single uniform path below, whatever the strings contain.
    if (!parsed.success) return jsonError("invalid_input", "Invalid unsubscribe request.", 400);

    // AUT-03: sliding window ONLY (never evaluateThrottle) — see UNSUBSCRIBE_THROTTLE for why
    // progressive lockout must not be composed onto a key a stranger can hold. The identifier is
    // a TRUNCATED HASH of the presented token, never the token itself (SEC-05): auth_attempts
    // .identifier is indexed, queried and logged, and a live token is a capability.
    const db = getDb();
    const now = Date.now();
    const tokenKey = sha256Hex(parsed.data.token).slice(0, 16);
    const attempts = new AuthAttemptsStore(db);
    await attempts.reserve(tokenKey, clientIp(request), UNSUBSCRIBE_KIND);
    const snap = await attempts.snapshot(tokenKey, clientIp(request), UNSUBSCRIBE_KIND, now, UNSUBSCRIBE_THROTTLE);
    // *WithSelf: the snapshot includes the reservation above (WP-SU-9).
    const byToken = rateDecisionWithSelf(snap.attempts, now, UNSUBSCRIBE_THROTTLE.perIdentifier);
    const byIp = rateDecisionWithSelf(snap.ipAttempts, now, UNSUBSCRIBE_THROTTLE.perIp);
    if (!byToken.allowed || !byIp.allowed) {
      const retryAfterSec = Math.ceil(Math.max(byToken.retryAfterMs, byIp.retryAfterMs) / 1000);
      return NextResponse.json(
        { code: "too_many_requests", message: "Too many attempts. Please wait and try again.", traceId: newTraceId() },
        { status: 429, headers: { "Retry-After": String(retryAfterSec), "Cache-Control": "private, no-store" } },
      );
    }

    // AUT-05 timing parity with the auth family: the secret comparison is already constant-time
    // and length-uniform (see applyUnsubscribe), but a comparison is not a response — the DB work
    // downstream of it differs between "no row", "row, no write" and "row, write". This floors the
    // whole response so those branches are not separable by clock.
    await withUniformTiming(
      UNIFORM_TIMING_MS,
      () => applyUnsubscribe(db, parsed.data),
      (ms) => new Promise((r) => setTimeout(r, ms)),
      () => Date.now(),
    );
    return jsonOk(GENERIC_SUCCESS);
  } catch (e) {
    // SEC-05: the detail carries the error message only — never the token or an address.
    return jsonServerError("unsubscribe_failed", "Could not process that request.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
