"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// ScrollHint (C-53 / N3B-02) — the right-edge "there's more over there" affordance,
// lifted OUT of Table so the same recipe can dress any horizontal scroller (the portal's
// mobile chip strip is the second user; FRONTEND_STANDARDS §2: the second copy becomes the
// primitive). Table keeps its `scrollHint` prop and now consumes these two pieces, so there
// is exactly ONE fade recipe and one scroll-position rule in the app.
//
// Not a color-only cue (PRN-14): the fade is a redundant affordance over content that stays
// reachable by scrolling, keyboard (the Table's focusable region) and swipe — nothing is
// conveyed by the gradient alone.

/** Tracks whether the scroller still has content cut off to the RIGHT. `enabled=false`
 *  wires nothing up and reports false, so a caller can opt out without moving the hook. */
export function useScrollHint<T extends HTMLElement = HTMLDivElement>(enabled = true) {
  const ref = React.useRef<T>(null);
  const [moreRight, setMoreRight] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const check = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [enabled]);
  return { ref, moreRight };
}

const FADE_FROM = {
  /** Inside a Card / panel — the Table default. */
  surface: "from-surface",
  /** Directly on the page background — the portal's mobile chip strip. */
  bg: "from-bg",
} as const;

/** The fade itself. Render it as the last child of a `relative` wrapper around the scroller.
 *  `from` names the surface the fade dissolves into — semantic tokens only (PRN-12), spelled
 *  out as whole class names so Tailwind can see them. Both themes come free: the tokens are
 *  theme-scoped, and the gradient's far end is `transparent`, never a literal color. */
export function ScrollHintFade({ from = "surface", className }: { from?: keyof typeof FADE_FROM; className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="table-more-right"
      className={cn("pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent", FADE_FROM[from], className)}
    />
  );
}
