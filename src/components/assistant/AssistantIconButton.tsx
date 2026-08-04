"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "../Button";

/**
 * Compact icon button for the AI assistant widget. The shared `IconButton` is
 * hard-fixed at the 44px chrome tap target (F-66), but inside the 400px assistant
 * panel the approved mockup (rev-7) uses deliberately smaller controls that still
 * pass WCAG 2.1 AA. Rather than fight `cn` (a plain join, not tailwind-merge) to
 * shrink `IconButton` by className, the assistant owns this small variant set.
 * Tokens only (PRN-12); every DSN-03 state is baked in.
 *
 * Variants:
 *  - `ghost`   neutral chrome (panel Close / New chat) — 34px, rounded-lg, hairline
 *              hover on `surface`.
 *  - `toggle`  neutral two-state (message thumbs) — 26px, rounded-md, hover on
 *              `surface-2`; `aria-pressed` paints the brand-soft "chosen" state;
 *              disabled stays full opacity (it means "already voted", not "unavailable").
 *  - `primary` brand fill (composer Send) — 36px, rounded-full, marigold with a lift.
 *
 * Size is per-variant by default; pass `size` only for the rare off-mockup case.
 * The glyph is the caller's child (kept at its mockup dimensions).
 */
export type AssistantIconVariant = "ghost" | "toggle" | "primary";

const DEFAULT_SIZE: Record<AssistantIconVariant, number> = { ghost: 34, toggle: 26, primary: 36 };

const VARIANT_CLASS: Record<AssistantIconVariant, string> = {
  ghost:
    "rounded-lg border border-transparent text-text-3 hover:border-border hover:bg-surface focus-visible:border-border disabled:opacity-50",
  toggle:
    "rounded-md border border-transparent text-text-3 hover:border-border hover:bg-surface-2 focus-visible:border-border " +
    "aria-pressed:border-brand-line aria-pressed:bg-brand-soft aria-pressed:text-brand-ink disabled:opacity-100",
  primary:
    "rounded-full border border-brand-strong bg-brand text-brand-contrast shadow-xs hover:bg-brand-strong hover:shadow-md " +
    "disabled:opacity-45 disabled:shadow-none",
};

export interface AssistantIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon-only buttons must carry an accessible name (SC 4.1.2). */
  "aria-label": string;
  variant: AssistantIconVariant;
  /** Override the per-variant default px (rare — panel sizes are mockup-locked). */
  size?: number;
  /** DSN-03 loading: disables + marks aria-busy + swaps the glyph for a spinner
   *  (mirrors the shared IconButton). Used on the composer Send while streaming. */
  loading?: boolean;
}

export const AssistantIconButton = React.forwardRef<HTMLButtonElement, AssistantIconButtonProps>(
  function AssistantIconButton({ variant, size, loading = false, disabled, className, style, type, children, ...rest }, ref) {
    const px = size ?? DEFAULT_SIZE[variant];
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        // Numeric size lives inline (layout, not a design literal) so `size` can be
        // arbitrary without a dynamic Tailwind class the JIT can't see.
        style={{ width: px, height: px, ...style }}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "grid flex-none place-items-center transition-all active:scale-95 disabled:pointer-events-none",
          VARIANT_CLASS[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Spinner size={Math.round(px * 0.44)} /> : children}
      </button>
    );
  },
);
