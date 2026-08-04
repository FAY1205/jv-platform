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
