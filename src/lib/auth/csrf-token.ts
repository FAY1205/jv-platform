// Edge-safe CSRF token minting (used by the proxy, which runs on the Edge runtime
// and cannot import node:crypto). Web Crypto's randomUUID is available in both the
// Node route handlers and the Edge proxy.
export function newCsrfToken(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export const CSRF_COOKIE_NAME = "__Host-jv-csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
