import * as React from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** The primary next action (DSN-06: an empty screen is an invitation to act). */
  action?: React.ReactNode;
  className?: string;
}

/** EmptyState — icon + one-line explanation + the primary next action (DSN-06). */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-2 px-6 py-12", className)}>
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
