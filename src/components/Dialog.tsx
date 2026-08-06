"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

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
  /**
   * FRM-02a (audit F-6): when the hosted form has unsaved changes, pass `true` so a dismiss
   * gesture (Esc / backdrop / ✕) shows a lightweight discard-confirmation instead of closing.
   * The explicit footer Cancel is an intentional discard and is NOT guarded. Compute this from
   * `useDirty` (or a simple emptiness check). Default false keeps the drop-in behavior.
   */
  confirmClose?: boolean;
}

const SIZES: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export function Dialog({ open, onClose, title, children, footer, ariaLabel, size = "md", confirmClose = false }: DialogProps) {
  // FRM-02a: a dismiss gesture on a dirty form raises this in-dialog confirmation instead of
  // closing; only an explicit "Discard" (or a pristine form) actually closes.
  const [confirming, setConfirming] = React.useState(false);
  // Never let a stale prompt survive a close/reopen of a persistently-mounted Dialog: clear it
  // whenever `open` flips, adjusting state during render (the React-recommended alternative to
  // an effect — no cascading-render lint, matches the `seeded` pattern used elsewhere).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (confirming) setConfirming(false);
  }

  const requestClose = () => {
    if (!confirmClose) { onClose(); return; }
    // While the prompt is up, a further dismiss gesture (Esc/backdrop) means "keep editing".
    setConfirming((c) => (c ? false : true));
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="anim-scrim fixed inset-0 z-[100]"
          style={{ background: "var(--scrim)" }}
        />
        <RadixDialog.Content
          aria-label={typeof title === "string" ? undefined : ariaLabel}
          className={cn(
            "anim-pop fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg outline-none",
            SIZES[size],
          )}
        >
          {/* The scroll lives on this inner region, NOT on Content — so the discard overlay
              (absolute inset-0 on Content) reliably covers the whole panel even when a tall
              form is scrolled (FRM-02a). */}
          <div className="flex flex-col overflow-auto">
            {title ? (
              <div className="flex items-center gap-3 border-b border-border-soft px-5 py-4">
                <RadixDialog.Title className="font-display text-base font-semibold text-text">{title}</RadixDialog.Title>
                <RadixDialog.Close
                  aria-label="Close"
                  className="ml-auto rounded text-text-3 outline-none transition-colors hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink"
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
          </div>
          {confirming && (
            // Covers the panel (z above the title-bar ✕) so the only paths are Keep/Discard.
            <div
              role="alertdialog"
              aria-label="Discard unsaved changes?"
              className="absolute inset-0 z-10 grid place-items-center rounded-2xl p-5"
              style={{ background: "var(--scrim)" }}
            >
              <div className="w-full max-w-xs rounded-xl border border-border bg-surface p-4 text-center shadow-lg">
                <p className="font-display text-base font-semibold text-text">Discard unsaved changes?</p>
                <p className="mt-1 text-sm text-text-2">Your edits haven&apos;t been saved. This can&apos;t be undone.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="secondary" onClick={() => setConfirming(false)} autoFocus>
                    Keep editing
                  </Button>
                  <Button variant="danger" onClick={() => { setConfirming(false); onClose(); }}>
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
