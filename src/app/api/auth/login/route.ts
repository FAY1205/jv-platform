import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { jsonError, newTraceId } from "@/lib/http";
import { originAllowed } from "@/lib/auth/guard";
import { loginOutcome } from "@/lib/auth/login";
import { withUniformTiming } from "@/lib/auth/enumeration";

// AUT-05 / AUT-12: admin password login. One sign-in attempt, uniform failure,
// floored timing, Origin-checked. Partners never use this route (they have no
// password — PTL-01 email-OTP lands in WP-025).

const LoginInput = z.object({ email: z.email(), password: z.string().min(1) });

// Timing floor so an early failure can't be distinguished from a slow success.
const MIN_RESPONSE_MS = 500;

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = LoginInput.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_input", "A valid email and a password are required.", 400);
  }
  const { email, password } = parsed.data;

  const supabase = await getSupabaseServer();
  const success = await withUniformTiming(
    MIN_RESPONSE_MS,
    async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return !error;
    },
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => performance.now(),
  );

  const outcome = loginOutcome(success === true);
  if (outcome.status === 200) {
    return NextResponse.json({ code: outcome.code, message: outcome.message });
  }
  return NextResponse.json(
    { code: outcome.code, message: outcome.message, traceId: newTraceId() },
    { status: outcome.status },
  );
}
