import * as React from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** The primary next action (DSN-06: an empty screen is an invitation to act). */
  action?: React.ReactNode;
  /**
   * Compact inline/embedded status — fills its container. For small error/empty
   * states inside a panel (e.g. a map that failed to load), not a full-page empty.
   * `icon` and `action` are ignored when compact (no icon circle, no action).
   */
  compact?: boolean;
  className?: string;
}

/** EmptyState — icon + one-line explanation + the primary next action (DSN-06).
 *  BOTH variants carry role="status" (D2, SC 4.1.3): an EmptyState always replaces
 *  loaded/expected content after an async settle (query error, zero results), so the
 *  swap-in announces politely. Only content present at the DOCUMENT's true initial
 *  paint (SSR/hydration) is inert — a client-side route mount or a dropdown/modal
 *  mounting this on open is a later DOM insertion and WILL typically be announced,
 *  which is the desired behavior for those cases too. */
export function EmptyState({ icon, title, description, action, compact, className }: EmptyStateProps) {
  if (compact) {
    return (
      <div role="status" className={cn("grid h-full place-items-center gap-1 px-4 text-center", className)}>
        <p className="text-sm text-text-3">{title}</p>
        {description && <p className="text-xs text-text-3">{description}</p>}
      </div>
    );
  }
  return (
    <div role="status" className={cn("flex flex-col items-center text-center gap-2 px-6 py-12", className)}>
      {icon && (
        <div className="w-10 h-10 rounded-full bg-brand-soft text-brand-ink grid place-items-center mb-1">
          {icon}
        </div>
      )}
      <div className="font-semibold">{title}</div>
      {description && <p className="text-sm text-text-3 max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
