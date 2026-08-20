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
import { evaluateThrottle, RESET_THROTTLE } from "@/lib/auth/throttle";
import { clientIp } from "@/lib/auth/client-ip";
import { issueResetToken } from "@/lib/auth/reset-token";
import { ResetStore } from "@/lib/auth/reset-store";
import { notifyReset } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";

// AUT-05/06: request a password reset. Uniform response + floored timing whether or
// not the account exists; rate-limited (AUT-03). A single-use, hashed, 30-min token
// is issued and emailed only when the account exists.
const Input = z.object({ email: z.email() });
const KIND = "reset";
const MIN_RESPONSE_MS = 600;

// The one response returned on BOTH the exists and not-exists paths (AUT-05).
const UNIFORM = { code: "reset_requested", message: "If an account exists, we've sent a reset link." };

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

  // AUT-03: rate-limit reset requests (uniform 429 like other throttled routes).
  // AUT-03 (WP-SU-9): reserve BEFORE deciding, so this request is inside the window it is
  // judged against. Snapshot-then-record let N concurrent requests all read the same
  // pre-burst state and all pass (CWE-367). The reservation is success:true, so a request
  // refused here never feeds the AUT-04 lockout ladder.
  const attemptId = await attempts.reserve(email, ip, KIND);
  const snap = await attempts.snapshot(email, ip, KIND, now, RESET_THROTTLE);
  const throttle = evaluateThrottle(snap, now, RESET_THROTTLE);
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
        // AUT-04 (WP-SU-12): a reset REQUEST is not a credential failure. Settle success:true so it
        // counts toward the AUT-03 rate cap but never feeds the lockout ladder — otherwise a stranger
        // could lock a victim out of password reset just by requesting resets for their address.
        await attempts.settle(attemptId, true);
        const [user] = await db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = ${email}`);
        if (!user) return; // no account — respond uniformly, send nothing
        const { token, record } = issueResetToken(user.id, now);
        await new ResetStore(db).persist(record);
        // C-101 (CWE-644): a link that LEAVES the system travels on env.APP_URL — the canonical
        // origin, prod-guarded in lib/env — never on the request Host. The Host header is
        // attacker-controlled input; deriving this link from it would mail the victim their own
        // single-use RESET TOKEN pointed at the attacker's origin (account takeover). The email
        // is not a response to the forger's request, so no same-request check defends it.
        await notifyReset(user.email, `${env.APP_URL}/reset?token=${token}`);
      } catch (e) {
        // WP-SU-19 (SEC-05/ADR-0032): withUniformTiming swallows a throw into the timing floor, so an
        // infra fault here (a DB fault, or the email transport rejecting) would otherwise vanish with
        // no log and no Sentry event. Capture it (message scrubbed by the seam), then rethrow: the
        // floor still applies and the caller's uniform response is unchanged. We must NOT surface a
        // 500 — this body only sends for a real account, so a distinct error status would leak account
        // existence and break AUT-05.
        logError("reset_request_failed", { message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  return NextResponse.json({ ...UNIFORM });
}
