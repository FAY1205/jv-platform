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

// The shared `lg` breakpoint (1024px, Tailwind default) used for the desktop/mobile split
// across the admin dashboard and partner portal hero layouts.
const LG = "(min-width: 1024px)";
const subscribeLg = subscribe(LG);

/**
 * C-41a: the `lg` breakpoint as a THREE-state value, because "not desktop yet" and "mobile"
 * are different facts and a boolean cannot tell them apart. `useIsDesktop()` returns false on
 * the server and through hydration, so a view that mounts its mobile branch on that false
 * genuinely mounts it — and anything that branch does on mount (a fetch) happens even on a
 * desktop that is about to swap it out.
 *
 * `"unresolved"` is that hydration window; a caller can hold side effects until the real
 * viewport is known while still RENDERING the same markup the server sent.
 *
 * One `useSyncExternalStore` (not a boolean plus a separate "hydrated" flag) so the two facts
 * come from ONE snapshot and can never disagree mid-render.
 */
export type DesktopState = "unresolved" | "desktop" | "mobile";

function getDesktopSnapshot(): DesktopState {
  return window.matchMedia(LG).matches ? "desktop" : "mobile";
}
function getDesktopServerSnapshot(): DesktopState {
  return "unresolved";
}

export function useDesktopState(): DesktopState {
  return React.useSyncExternalStore(subscribeLg, getDesktopSnapshot, getDesktopServerSnapshot);
}

/** True when the viewport is known to be >= `lg`. False on the server/first client paint —
 *  callers that need to distinguish that from "mobile" want `useDesktopState()`. */
export function useIsDesktop(): boolean {
  return useDesktopState() === "desktop";
}
