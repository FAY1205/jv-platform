"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

// Dialog — the Radix-backed replacement for Modal (ADR-0016, F-15). Focus trap and
// return-focus-to-opener are provided by Radix, not hand-rolled. The prop shape mirrors
// Modal (open / onClose / title / footer / size) so call sites migrate as a drop-in;
// Modal is retired at the end of WS-8 once every page has moved over.

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible label when no visible title is provided. */
  ariaLabel?: string;
  /** Panel width. Defaults to "md". */
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export function Dialog({ open, onClose, title, children, footer, ariaLabel, size = "md" }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="anim-scrim fixed inset-0 z-[100]"
          style={{ background: "var(--scrim)" }}
        />
        <RadixDialog.Content
          aria-label={typeof title === "string" ? undefined : ariaLabel}
          className={cn(
            "anim-pop fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border bg-surface shadow-lg outline-none",
            SIZES[size],
            "max-h-[90vh] overflow-auto",
          )}
        >
          {title ? (
            <div className="flex items-center gap-3 border-b border-border-soft px-5 py-4">
              <RadixDialog.Title className="font-display text-base font-semibold text-text">{title}</RadixDialog.Title>
              <RadixDialog.Close
                aria-label="Close"
                className="ml-auto rounded text-text-3 outline-none transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </RadixDialog.Close>
            </div>
          ) : (
            // Radix requires a Title for a11y; hide it visually when none is provided.
            <RadixDialog.Title className="sr-only">{ariaLabel ?? "Dialog"}</RadixDialog.Title>
          )}
          <div className="p-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
