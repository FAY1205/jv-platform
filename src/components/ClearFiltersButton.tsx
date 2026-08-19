"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// ClearFiltersButton (C-54 / N3B-03) — the way OUT of a filtered-to-zero list. Activity
// had the only copy; Leads, Unmatched and Imports would have made it the fourth, so the
// recipe is promoted verbatim into a primitive (FRONTEND_STANDARDS §2) instead of being
// pasted a fourth time. Lives in the EmptyState `action` slot.
//
// DSN-03 states: default / hover (border + text warm up) / focus-visible (the global
// brand-ink ring) / active (the app-wide press scale) / disabled (a page can hand it a
// pending clear; pointer-events off + dimmed). No `loading`: clearing filters is local
// state, resolved synchronously — the FilterPill precedent for an n/a state.

export interface ClearFiltersButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Override the label only for a genuinely different reset ("Clear search", …). */
  children?: React.ReactNode;
}

export const ClearFiltersButton = React.forwardRef<HTMLButtonElement, ClearFiltersButtonProps>(
  function ClearFiltersButton({ className, type, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          "rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-2 outline-none",
          "transition-colors hover:border-brand-line hover:text-text",
          "focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.98]",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {children ?? "Clear filters"}
      </button>
    );
  },
);
