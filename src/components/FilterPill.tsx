"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// FilterPill (D3) — the toggleable status-filter chip, promoted from two byte-identical
// hand-rolled copies (admin leads-view + portal leads-desktop; FRONTEND_STANDARDS §2:
// repeated ad-hoc patterns become primitives). Carries aria-pressed itself. DSN-03
// states: default / hover (idle recipe) / focus-visible (global brand-ink outline) /
// active (press scale — added at promotion, the LinkCard precedent) / disabled.
// `loading` intentionally omitted: the pill toggles local filter state synchronously
// and never awaits its own async action (the LinkCard precedent for n/a states);
// if a caller ever needs an async-pending pill, add loading + aria-busy like IconButton.

export interface FilterPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state — rendered as the filled brand chip + aria-pressed. */
  active?: boolean;
}

export const FilterPill = React.forwardRef<HTMLButtonElement, FilterPillProps>(function FilterPill(
  { active = false, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-[color,background-color,border-color,transform] active:scale-[.97] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // C-52 (WCAG 2.5.8): the chip renders 22px tall (12px text + py-0.5 + 1px borders) —
        // under the 24px floor. VERTICAL-ONLY invisible expansion takes it to 28px without
        // moving anything. `-inset-y-1` is -4px from the chip's PADDING box (what absolute
        // insets resolve against), and the 1px border eats one of those, so the real reach is
        // 3px per side — measured, not assumed. `inset-x-0` is required: an absolute pseudo-
        // element with no horizontal insets collapses to zero width and reaches nothing.
        // Deliberately NOT 44px on coarse pointers: these chips sit in `flex-wrap gap-1.5` rows
        // (the admin leads bar), so a 44px hit area would reach 11px into a 6px row gap and
        // steal taps from the chip on the line above. 3px per side exactly meets the neighbour
        // without overlapping. Horizontal reach stays 0 for the same reason.
        "relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
        active
          ? "border-brand bg-brand-soft font-semibold text-brand-ink"
          : "border-border bg-surface font-medium text-text-2 hover:border-brand-line hover:text-text",
        className,
      )}
      {...rest}
      // After the spread: aria-pressed is OWNED by `active` — a stray caller prop can't
      // silently override the primitive's own state attribute (pr-review D3 F-3).
      aria-pressed={active}
    />
  );
});
