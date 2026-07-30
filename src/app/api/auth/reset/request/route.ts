import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { withUniformTiming } from "@/lib/auth/enumeration";
import { AuthAttemptsStore } from "@/lib/auth/attempts-store";
import { evaluateThrottle, RESET_THROTTLE } from "@/lib/auth/throttle";
import { clientIp } from "@/lib/auth/client-ip";
import { issueResetToken } from "@/lib/auth/reset-token";
import { ResetStore } from "@/lib/auth/reset-store";
import { notifyReset } from "@/lib/auth/notify";

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
  const origin = new URL(request.url).origin;
  const db = getDb();
  const attempts = new AuthAttemptsStore(db);

  // AUT-03: rate-limit reset requests (uniform 429 like other throttled routes).
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
      // AUT-04 (WP-SU-12): a reset REQUEST is not a credential failure. Record
      // success:true so it counts toward the AUT-03 rate cap but never feeds the
      // lockout ladder.
      await attempts.record(email, ip, KIND, true);
      const [user] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`);
      if (!user) return; // no account — respond uniformly, send nothing
      const { token, record } = issueResetToken(user.id, now);
      await new ResetStore(db).persist(record);
      await notifyReset(user.email, `${origin}/reset?token=${token}`);
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  return NextResponse.json({ ...UNIFORM });
}
