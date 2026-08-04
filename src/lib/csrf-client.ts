import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-token";

// Client-side: read the readable double-submit CSRF token (set by the proxy on
// authed sessions) so state-changing fetches can echo it in the x-csrf-token
// header (AUT-12). Returns {} when unavailable (SSR, or before the cookie is set).
export function csrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const found = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return found ? { [CSRF_HEADER_NAME]: decodeURIComponent(found.slice(prefix.length)) } : {};
}
