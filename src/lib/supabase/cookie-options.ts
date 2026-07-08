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
