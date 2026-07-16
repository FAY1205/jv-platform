import { z } from "zod";
import { getDb } from "@/db";
import { jsonOk, jsonError } from "@/lib/http";
import { assertCsrf } from "@/lib/auth/guard";
import { sha256Hex } from "@/lib/auth/hash";
import { verifySignupToken } from "@/lib/auth/signup-token";
import { SignupStore } from "@/lib/auth/signup-store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";

// SCP-02/ADR-0033: complete signup by verifying the single-use email token and
// activating login (email_confirm:true). Uniform invalid/expired/used response.
const Input = z.object({ token: z.string().min(10) });

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: false })) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A token is required.", 400);
  const { token } = parsed.data;
  const now = Date.now();

  const db = getDb();
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

  return jsonOk({ code: "signup_verified", message: "Your email is verified. You can now log in." });
}
