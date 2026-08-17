import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

// PTL-01 (Option B, ADR-0009): after WE verify our own 6-digit OTP, establish a
// Supabase session WITHOUT sending any Supabase email. admin.generateLink mints a
// one-time token server-side (no email dispatched); verifyOtp on the request-bound
// server client exchanges it for a session and writes the auth cookies. This keeps
// all partner email inside our SEC-07 sink while the session stays Supabase-managed.

// C-34 (SEC-09 availability): a tri-state outcome so the caller can signal honestly. The OTP is
// already correct by the time we get here, so a failure is never the caller's fault — but it splits
// into two kinds. "unavailable": a backend call errored or threw (bad service-role key / wrong
// project URL / Supabase down) — transient and retryable, so the route answers 503 + Retry-After,
// mirroring how login treats a thrown signInWithPassword (WP-SU-20). "failed": the backend answered
// cleanly but handed back no usable token — a non-retryable contract/config fault, so the route
// answers 500. "established": the session cookies were written.
export type SessionEstablishResult = "established" | "unavailable" | "failed";

export interface SessionEstablishOutcome {
  status: SessionEstablishResult;
  /** The last diagnostic (SEC-05: message only, no token). The CALLER logs this ONCE via
   *  jsonServiceUnavailable/jsonServerError so it shares the response's traceId (F-42) — we
   *  deliberately do NOT log here, which would emit a second, uncorrelated line. */
  detail: string;
}

/** Establish a Supabase session (sets cookies) for an already-OTP-verified email. */
export async function establishSessionForEmail(email: string): Promise<SessionEstablishOutcome> {
  const admin = getSupabaseAdmin();
  const supabase = await getSupabaseServer();

  // Token-hash verify type differs across Supabase versions ("email" vs "magiclink");
  // regenerate a fresh one per attempt so a type mismatch never consumes the token.
  let lastError = "no attempt made";
  // Any errored/thrown auth-backend call ⇒ a retryable outage. OR'd across both verify-type attempts
  // on purpose: we only reach the classification below if BOTH types failed (a healthy backend
  // returns "established" on the matching type), so a single real backend error/throw in either
  // attempt is enough to call the whole thing retryable. The "no token_hash" branch does NOT set it —
  // only a clean-but-empty response on every attempt yields the non-retryable "failed".
  let sawBackendFault = false;
  for (const type of ["email", "magiclink"] as const) {
    try {
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = data?.properties?.hashed_token;
      if (error) {
        sawBackendFault = true;
        lastError = error.message;
        continue;
      }
      if (!tokenHash) {
        // A clean response with no token is a contract/config fault, not a transient outage.
        lastError = "generateLink returned no token_hash";
        continue;
      }
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!verifyError) return { status: "established", detail: "ok" };
      sawBackendFault = true;
      lastError = `verifyOtp(${type}): ${verifyError.message}`;
    } catch (e) {
      // A thrown call (network/transport) is the clearest transient-outage signal — fold it into the
      // return here (rather than propagating) so BOTH callers get one classified outcome instead of
      // an unhandled 500 on trust/refresh (which has no catch of its own).
      sawBackendFault = true;
      lastError = `threw(${type}): ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { status: sawBackendFault ? "unavailable" : "failed", detail: lastError };
}
