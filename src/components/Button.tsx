import * as React from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-lg border " +
  "transition-[background-color,border-color,transform,opacity] duration-[120ms] " +
  "active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast border-brand hover:bg-brand-strong",
  secondary:
    "bg-surface text-text-2 border-border shadow-xs hover:bg-surface-2 hover:border-text-3",
  ghost: "bg-transparent text-text-2 border-transparent hover:bg-surface-3",
  // Destructive is never the visual default (DSN-04); it is opt-in and labeled.
  danger: "bg-danger text-white border-danger hover:brightness-95",
};

const sizes: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 min-h-8",
  md: "text-sm px-3.5 py-2 min-h-9",
  // ≥44px touch target for the mobile-first portal (SCP-04 / DSN-10, F-66).
  lg: "text-sm px-4 py-2.5 min-h-11",
};

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Button — implements all interactive states (default/hover/focus-visible/active/
 * disabled/loading) per DSN-03. focus-visible is the global token ring.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, leftIcon, disabled, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
    </button>
  );
});
