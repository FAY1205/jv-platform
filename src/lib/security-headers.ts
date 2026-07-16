// F-06 / SEC-08: the security response headers the app serves on every route.
// Pure + dependency-free so next.config can import it directly and a unit test can
// assert the policy. HSTS/nosniff/frame-deny/referrer/permissions are safe, well-
// understood defaults. The CSP shuts the high-risk doors (frame-ancestors, object-src,
// base-uri, form-action) while keeping 'unsafe-inline' for script/style — the Next App
// Router injects inline bootstrap without nonce plumbing, and nonce-based tightening
// needs a served build to verify (flagged WS-10 follow-up).
//
// script-src/frame-src/connect-src additionally allowlist challenges.cloudflare.com
// site-wide: the Turnstile widget on /signup loads a script + iframe from that origin
// and posts telemetry back to it. Without this the CAPTCHA never renders and signup's
// submit button never enables. Site-wide is intentional/simplest — no other directive
// is weakened.

export const HSTS_MAX_AGE = 63_072_000; // 2 years, in seconds

export interface SecurityHeaderOptions {
  /** The public Supabase URL — added to connect-src (https + wss) so the client can
   *  reach Auth/PostgREST/Realtime. Malformed/absent → connect-src stays 'self'. */
  supabaseUrl?: string;
}

export interface HeaderPair {
  key: string;
  value: string;
}

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

function contentSecurityPolicy(supabaseUrl?: string): string {
  const connect = ["'self'"];
  if (supabaseUrl) {
    try {
      const origin = new URL(supabaseUrl).origin;
      connect.push(origin, origin.replace(/^https:/, "wss:"));
    } catch {
      // Malformed URL: leave connect-src at 'self' rather than emit a broken directive.
    }
  }
  connect.push(TURNSTILE_ORIGIN);
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["frame-src", TURNSTILE_ORIGIN],
    ["form-action", "'self'"],
    ["script-src", `'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data:"],
    ["font-src", "'self'"],
    ["connect-src", connect.join(" ")],
  ];
  return directives.map(([k, v]) => `${k} ${v}`).join("; ");
}

/** The full security header set, in next.config `headers()` `{ key, value }` shape. */
export function securityHeaders(opts: SecurityHeaderOptions = {}): HeaderPair[] {
  return [
    { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE}; includeSubDomains; preload` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts.supabaseUrl) },
  ];
}
