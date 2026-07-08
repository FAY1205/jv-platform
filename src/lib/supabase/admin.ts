import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// ─────────────────────────────────────────────────────────────────────────────
// Service-role Supabase client (WP-023). Uses the SERVICE ROLE key and is for
// ADMIN operations only — creating auth users, setting app_metadata claims. It
// bypasses RLS and must NEVER be reachable from the request path or the browser;
// only provisioning scripts and server-side admin actions use it. Not a session
// client — no cookies, no session persistence.
// ─────────────────────────────────────────────────────────────────────────────

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase admin is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
