import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Button";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon-only buttons must carry an accessible name (SC 4.1.2). */
  "aria-label": string;
  loading?: boolean;
}

// The shared 44px chrome icon button (F-66 tap target). One state recipe for the four
// topbar/chrome controls (AppShell menu toggle, ThemeToggle, NotificationBell):
// hairline-border hover + the global brand-ink focus outline + a subtle focus border. Tokens
// only (PRN-12); forwardRef so it can mount under Radix `DropdownMenuTrigger asChild`.
const base =
  "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-transparent text-text-2 " +
  "transition-colors hover:border-border hover:bg-surface focus-visible:border-border " +
  "active:scale-95 disabled:opacity-50 disabled:pointer-events-none";

/**
 * IconButton — an icon-only button implementing all DSN-03 states
 * (default/hover/focus-visible/active/disabled/loading). focus-visible is the global
 * 1px brand-ink outline plus a subtle border. `aria-label` is required (SC 4.1.2).
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { loading = false, disabled, children, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(base, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : children}
    </button>
  );
});
