"use client";

import * as React from "react";

// WP-PW-2 Task 3 (final fix): a small SSR-safe media-query hook, mirroring the
// useSyncExternalStore pattern already used in Tooltip.tsx (false on the server and
// during hydration, then the live client value) — generalized to matchMedia() so
// viewport-conditional rendering (e.g. mounting a heavy component in exactly one
// breakpoint's DOM location instead of both, gated by CSS `display`) has a shared,
// correct primitive instead of ad hoc window-width checks.

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

/** True when `query` currently matches; false on the server/first client paint. */
export function useMediaQuery(query: string): boolean {
  const subscribeToQuery = React.useCallback((onChange: () => void) => subscribe(query)(onChange), [query]);
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  return React.useSyncExternalStore(subscribeToQuery, getSnapshot, getServerSnapshot);
}

/** Matches the shared `lg` breakpoint (1024px, Tailwind default) used for the
 *  desktop/mobile split across the admin dashboard and partner portal hero layouts. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
