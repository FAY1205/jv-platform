import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getServerScope } from "@/lib/scope-context";
import { jsonOk, jsonError } from "@/lib/http";
import { originAllowed, authErrorResponse } from "@/lib/auth/guard";
import { evaluateNewPassword, hibpRangeFetcher } from "@/lib/auth/password";

// AUT-02 / AUT-08: authenticated admin changes their password. Requires recent
// re-authentication (the current password), enforces strength + breach check, and
// lets Supabase Auth hash/store it (AUT-01). Passwords are never logged (SEC-05).

const Input = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return jsonError("csrf_origin_rejected", "Request origin not allowed.", 403);
  }

  // Must be authenticated (401/403 via the uniform envelope).
  try {
    await getServerScope();
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("scope_failed", "Could not resolve session.", 500);
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("invalid_input", "Current and new passwords are required.", 400);
  }
  const { currentPassword, newPassword } = parsed.data;

  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return jsonError("unauthenticated", "Authentication required.", 401);
  }

  // Recent re-auth (AUT-08): confirm the current password before changing it.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return jsonError("reauth_failed", "Your current password is incorrect.", 401);
  }

  // AUT-02: strength + breach gate (the email is a zxcvbn user-input to penalize).
  const evaluation = await evaluateNewPassword(newPassword, [user.email], hibpRangeFetcher);
  if (!evaluation.ok) {
    return jsonError("weak_password", evaluation.reasons.join(" "), 422);
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return jsonError("update_failed", "Could not update the password. Please try again.", 400);
  }

  return jsonOk({ code: "ok", message: "Password updated." });
}
