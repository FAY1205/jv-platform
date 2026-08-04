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
