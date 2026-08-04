import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";

// ─────────────────────────────────────────────────────────────────────────────
// Per-request Supabase server client (WP-023). Uses the ANON key + the request's
// auth cookies; getUser() verifies the JWT. Cookie hardening (AUT-12) lives in
// ./cookie-options so the Edge middleware can share it without importing
// `next/headers`. Tokens never touch localStorage.
// ─────────────────────────────────────────────────────────────────────────────

export { AUTH_COOKIE_OPTIONS };

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

export function supabaseAnonConfig(): { url: string; anonKey: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase Auth is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
}

/**
 * Create a Supabase client bound to the Next App Router cookie store. Create a
 * fresh one per request — never share across requests. In Server Components the
 * cookie store is read-only, so setAll is a no-op there; the middleware performs
 * the token refresh and writes rotated cookies back.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseAnonConfig();
  return createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Read-only cookie store (Server Component render) — middleware writes.
        }
      },
    },
  });
}
