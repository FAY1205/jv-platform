import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { clientIp } from "@/lib/auth/client-ip";
import { TrustedDeviceService } from "@/lib/auth/trusted-device";
import { establishSessionForEmail } from "@/lib/auth/otp-session";
import { latestTosVersion } from "@/lib/auth/tos-store";
import { needsTosAcceptance, CURRENT_TOS_VERSION } from "@/lib/legal/tos";
import { notifyTrustReuse } from "@/lib/auth/notify";
import { logError } from "@/lib/observability";
import { TRUST_COOKIE_NAME, TRUST_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// AUT-10: skip OTP on a trusted device. Rotate the trust token (reuse ⇒ revoke
// family + notify), then mint a fresh Supabase session. Pre-session → Origin-checked.
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
  const { result, email } = await new TrustedDeviceService(db).rotate(token, now, clientIp(request));

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
  if (!(await establishSessionForEmail(email))) {
    return jsonError("session_failed", "Could not establish a session. Please sign in.", 500);
  }

  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`);
  const accepted = u ? await latestTosVersion(db, u.id) : null;

  return NextResponse.json({
    code: "ok",
    message: "Welcome back.",
    tosRequired: needsTosAcceptance(accepted, CURRENT_TOS_VERSION),
  });
}
