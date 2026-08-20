import type { NextConfig } from "next";
// Relative import (not the @/ alias — this file is loaded by Next's config loader,
// before the tsconfig path alias is available). security-headers.ts is dependency-free.
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // F-06 / SEC-08: serve the security header set on every route. Supabase URL comes
  // straight from process.env (env.ts can't be imported here — it uses the @/ alias).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }),
      },
      // WP-NF2 / NTF-13: the unsubscribe URL carries a capability token in its query string, so
      // this ONE path tightens the site-wide Referrer-Policy to no-referrer. The site-wide value
      // (strict-origin-when-cross-origin, set above) already withholds the query string from
      // cross-origin referrers; no-referrer additionally withholds it from same-origin requests
      // the page makes, so the token never reaches a log or an analytics hit anywhere.
      //
      // Listed AFTER the catch-all deliberately: both rules match /unsubscribe, so the response
      // carries two Referrer-Policy values, and the Referrer Policy spec resolves a list by
      // taking the LAST valid token — which is this one.
      {
        source: "/unsubscribe",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // C-101 (audit-security F-6): the same reasoning, applied to the HIGHER-value one-time
      // tokens. Each of these pages is reached by clicking a link in an email, and each carries a
      // single-use credential in its URL — a password-reset token, a signup-verification token, a
      // team-seat token. Whatever the page then fetches (a font, an image, an analytics beacon,
      // an API call) would otherwise carry that URL in the Referer header; same-origin requests
      // get the FULL url under the site-wide strict-origin-when-cross-origin, so the token would
      // land in the app's own access logs. no-referrer withholds it everywhere.
      //
      // Listed after the catch-all for the same last-valid-token reason as /unsubscribe above.
      // `/team-invite/:token` needs the param segment — the token is in the PATH here, not a query.
      {
        source: "/reset",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/signup/verify",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/team-invite/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  async redirects() {
    // "Runs" became "Imports" (owner-facing rename). Old deep links — stored
    // notification links, bookmarks — keep working. Not permanent so browsers
    // don't cache the redirect forever while the app is still evolving.
    return [
      { source: "/runs", destination: "/imports", permanent: false },
      { source: "/runs/:ref", destination: "/imports/:ref", permanent: false },
      // Analytics merged into the Dashboard (redesign R2).
      { source: "/analytics", destination: "/dashboard", permanent: false },
    ];
  },
};

export default nextConfig;
