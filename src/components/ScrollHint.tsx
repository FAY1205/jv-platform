"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// ScrollHint (C-53 / N3B-02) — the "there's more over there" affordance, lifted OUT of
// Table so the same recipe can dress any scroller (the portal's mobile chip strip was the
// second user; FRONTEND_STANDARDS §2: the second copy becomes the primitive). Table keeps
// its `scrollHint` prop and consumes these two pieces, so there is exactly ONE fade recipe
// and one scroll-position rule in the app.
//
// N3C-11 (C-65) extended it to the VERTICAL axis for the Dialog's body region — the same
// hook and the same fade, one `axis`/`edge` switch rather than a second implementation.
//
// Not a color-only cue (PRN-14): the fade is a redundant affordance over content that stays
// reachable by scrolling, keyboard (the scroller's own focusable region) and swipe —
// nothing is conveyed by the gradient alone.

/** Tracks whether the scroller still has content cut off past its far edge — to the RIGHT
 *  (`axis="x"`, the default) or BELOW (`axis="y"`). `enabled=false` wires nothing up and
 *  reports false, so a caller can opt out without moving the hook. */
export function useScrollHint<T extends HTMLElement = HTMLDivElement>(enabled = true, axis: "x" | "y" = "x") {
  const ref = React.useRef<T>(null);
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setMore(
        axis === "y"
          ? el.scrollTop + el.clientHeight < el.scrollHeight - 8
          : el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
      );
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // On the vertical axis the scroller's own box often keeps its size while the CONTENT
    // grows (a query resolves, a panel expands), so observe the content wrapper too —
    // otherwise a dialog that becomes scrollable after its data lands shows no cue.
    const content = el.firstElementChild;
    if (content) ro.observe(content);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [enabled, axis]);
  return { ref, more };
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
 *  theme-scoped, and the gradient's far end is `transparent`, never a literal color.
 *  `edge` picks which side is cut off: "right" (horizontal scrollers) or "bottom" (the
 *  Dialog body). */
export function ScrollHintFade({
  from = "surface",
  edge = "right",
  className,
}: {
  from?: keyof typeof FADE_FROM;
  edge?: "right" | "bottom";
  className?: string;
}) {
  const bottom = edge === "bottom";
  return (
    <div
      aria-hidden="true"
      // The horizontal testid predates the vertical variant and is asserted by existing
      // tests; keep it stable rather than renaming a shipped contract.
      data-testid={bottom ? "scroll-more-bottom" : "table-more-right"}
      className={cn(
        "pointer-events-none absolute to-transparent",
        bottom ? "inset-x-0 bottom-0 h-8 bg-gradient-to-t" : "inset-y-0 right-0 w-10 bg-gradient-to-l",
        FADE_FROM[from],
        className,
      )}
    />
  );
}
