"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// RowOpenButton — the keyboard-accessible pattern for opening a row's detail dialog
// (F-14). The Leads table previously opened a lead via a row `onClick` with no keyboard
// path; the ref-id cell now renders as a REAL <button aria-haspopup="dialog"> so keyboard
// and AT users can open it. Styled to read like the former mono ref-id link. WS-3 adopts
// this on the Leads table.

export interface RowOpenButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const RowOpenButton = React.forwardRef<HTMLButtonElement, RowOpenButtonProps>(function RowOpenButton(
  { children, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      className={cn(
        "num rounded text-left font-medium text-brand outline-none",
        "hover:underline focus-visible:ring-2 focus-visible:ring-brand/50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
