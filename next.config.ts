import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
