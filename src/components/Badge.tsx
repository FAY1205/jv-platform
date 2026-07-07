import * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant =
  | "zip"
  | "state"
  | "removed"
  | "warn"
  | "prev"
  | "success"
  | "neutral"
  | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Show a leading status dot. */
  dot?: boolean;
}

const variants: Record<BadgeVariant, string> = {
  zip: "bg-brand-soft text-brand",
  state: "bg-info-soft text-info",
  removed: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  prev: "bg-prev-soft text-prev",
  success: "bg-success-soft text-success",
  neutral: "bg-surface-3 text-text-2",
  outline: "bg-surface border border-border text-text-2",
};

/** Badge — compact status label. Meaning never relies on color alone (PRN-14): a
 *  badge always carries text. */
export function Badge({ variant = "neutral", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
