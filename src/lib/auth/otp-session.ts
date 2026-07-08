import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

// PTL-01 (Option B, ADR-0009): after WE verify our own 6-digit OTP, establish a
// Supabase session WITHOUT sending any Supabase email. admin.generateLink mints a
// one-time token server-side (no email dispatched); verifyOtp on the request-bound
// server client exchanges it for a session and writes the auth cookies. This keeps
// all partner email inside our SEC-07 sink while the session stays Supabase-managed.

/** Establish a Supabase session (sets cookies) for an already-OTP-verified email. */
export async function establishSessionForEmail(email: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const supabase = await getSupabaseServer();

  // Token-hash verify type differs across Supabase versions ("email" vs "magiclink");
  // regenerate a fresh one per attempt so a type mismatch never consumes the token.
  for (const type of ["email", "magiclink"] as const) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) continue;
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!verifyError) return true;
  }
  return false;
}
