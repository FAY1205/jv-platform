"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

/**
 * Tooltip — shows on hover and keyboard focus (never hover-only, DSN-07). Used for
 * the calculation tooltips required on every computed value and badge (UXQ-05/F-64).
 * Hand-rolled and accessible (role="tooltip" + aria-describedby); usable on any page.
 * (Tooltip is intentionally NOT a Radix primitive — it is outside the ADR-0016 list.)
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {React.cloneElement(children, { "aria-describedby": id } as React.HTMLAttributes<HTMLElement>)}
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className={cn(
          "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-xs",
          "rounded-md bg-text text-surface text-xs font-medium px-2.5 py-1.5 shadow-md",
          "pointer-events-none",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
