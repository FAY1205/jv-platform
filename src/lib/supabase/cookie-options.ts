import type { CookieOptionsWithName } from "@supabase/ssr";

// AUT-12: session cookie hardening, shared by the server client and the middleware.
// Kept in its own module (no `next/headers` import) so the Edge middleware can use
// it without pulling in server-only APIs.
//
// __Host- prefix requires Secure + Path=/ + no Domain; the browser rejects a
// __Host- cookie that violates these — exactly the guarantee we want. HttpOnly
// keeps tokens out of JS; SameSite=Lax is the first CSRF line. (Modern browsers
// accept Secure/__Host- cookies over http://localhost for dev.)
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  name: "__Host-jv-auth",
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
};

// AUT-10: the trusted-device ("remember me") token cookie — long-lived (30 days),
// HttpOnly so JS can't read it, same hardening as the session cookie.
export const TRUST_COOKIE_NAME = "__Host-jv-trust";
export const TRUST_MAX_AGE_SEC = 30 * 24 * 3600;
export const TRUST_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: TRUST_MAX_AGE_SEC,
};
