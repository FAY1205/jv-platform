// AUT-12: session cookies are HttpOnly, Secure, SameSite=Lax, with the __Host-
// prefix (which requires Secure + Path=/ + no Domain). Tokens never in localStorage.

export const SESSION_COOKIE_NAME = "__Host-jv_session";

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/** Build the hardened session cookie attributes (AUT-12, AUT-13 lifetime via maxAge). */
export function buildSessionCookie(value: string, maxAgeSeconds: number): CookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Attributes that expire/clear the cookie (AUT-14 logout). */
export function clearSessionCookie(): CookieAttributes {
  return buildSessionCookie("", 0);
}

/** Serialize to a Set-Cookie header value. */
export function serializeCookie(c: CookieAttributes): string {
  const parts = [
    `${c.name}=${c.value}`,
    `Path=${c.path}`,
    `Max-Age=${c.maxAge}`,
    "HttpOnly",
    "Secure",
    `SameSite=${c.sameSite === "lax" ? "Lax" : c.sameSite}`,
  ];
  return parts.join("; ");
}
