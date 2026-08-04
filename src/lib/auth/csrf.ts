import { timingSafeEqualStr } from "./constant-time";

// Re-exported so consumers importing from "./csrf" get the Edge-safe minter too.
export { newCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-token";

// AUT-12: CSRF protection for state-changing routes. SameSite=Lax on the session
// cookie is the first line; on top of it the server verifies the request Origin
// against an allowlist (fail closed on a missing Origin) and, where a token is
// used, compares it in constant time (AUT-09).

/** True only when `origin` is present and exactly matches an allowed app origin. */
export function isAllowedOrigin(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  return allowed.includes(origin);
}

/**
 * Double-submit token check: the cookie-bound token and the submitted token must
 * both be present and equal. Compared in constant time so a mismatch does not
 * leak position via timing (AUT-09).
 */
export function csrfTokenMatches(cookieToken: string | undefined, submitted: string | undefined): boolean {
  if (!cookieToken || !submitted) return false;
  return timingSafeEqualStr(cookieToken, submitted);
}

export interface CsrfCheck {
  origin: string | null | undefined;
  allowedOrigins: readonly string[];
  /** True for authed state-changing routes; false pre-session (e.g. login). */
  requireToken: boolean;
  cookieToken?: string;
  headerToken?: string;
}

/** Combined CSRF verdict: Origin allowlist, plus the double-submit token when required. */
export function csrfOk(c: CsrfCheck): boolean {
  if (!isAllowedOrigin(c.origin, c.allowedOrigins)) return false;
  if (c.requireToken && !csrfTokenMatches(c.cookieToken, c.headerToken)) return false;
  return true;
}
