"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ScrollHintFade, useScrollHint } from "./ScrollHint";

// SidePanel (N5-01) — the right-anchored, NON-MODAL slide-over. A SIBLING of Dialog, not a
// Dialog mode: the two differ in the thing that matters most about a dialog (whether the page
// behind it is inert), and folding "non-modal" into Dialog would make every existing call site
// carry a modality question it has already answered.
//
// Non-modal means, concretely: no scrim, no focus trap, no aria-hidden on the rest of the page,
// and an outside click does NOT dismiss — the leads table stays visible AND clickable, and
// clicking another row switches the panel's record in place. Radix still supplies the dialog
// semantics (role="dialog", a Title that labels it) and Esc-to-dismiss.
//
// Two behaviors Radix's non-modal path does NOT give us, handled here:
//  1. Outside interaction closes by default — we preventDefault it (that IS the feature).
//  2. Return-focus goes to a `Dialog.Trigger`, which a controlled panel has none of, and Radix
//     then preventDefaults the focus restoration entirely. So the opener is captured on the
//     open transition and refocused on close.

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Leading header slot, before the title — the N-of-M pager (N5-04). Kept a slot rather than
   * props because the working set that feeds it belongs to the LIST, not to this primitive.
   */
  leading?: React.ReactNode;
  /** The record's title. A string title labels the panel; otherwise pass `ariaLabel`. */
  title?: React.ReactNode;
  /** Accessible label when the visible title is not a plain string. */
  ariaLabel?: string;
  children?: React.ReactNode;
  /**
   * FRM-02a, same contract as Dialog: when the hosted form has unsaved changes, a dismiss
   * gesture (Esc / ✕) raises a discard-confirmation instead of closing. An explicit in-form
   * Cancel is an intentional discard and is NOT guarded.
   */
  confirmClose?: boolean;
}

export function SidePanel({ open, onClose, leading, title, ariaLabel, children, confirmClose = false }: SidePanelProps) {
  const [confirming, setConfirming] = React.useState(false);
  // The element to hand focus back to on close. Captured on the open TRANSITION (during render,
  // the same "adjust state while rendering" idiom Dialog uses for `prevOpen`) because every
  // effect below us — Radix's included — has already moved focus into the panel by commit time.
  const [opener, setOpener] = React.useState<HTMLElement | null>(() => (open ? activeElement() : null));
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (confirming) setConfirming(false);
    // Only ever set on OPEN. Clearing it on close would race the close handler below, which
    // runs from Radix's unmount cleanup and needs the opener that was captured on the way in.
    if (open) setOpener(activeElement());
  }

  const requestClose = () => {
    if (!confirmClose) { onClose(); return; }
    // While the prompt is up, a further dismiss gesture means "keep editing".
    setConfirming((c) => (c ? false : true));
  };

  // C-65: the same bottom edge-fade recipe the Dialog body uses — one implementation.
  const { ref: bodyRef, more: moreBelow } = useScrollHint<HTMLDivElement>(true, "y");

  return (
    <RadixDialog.Root open={open} modal={false} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <RadixDialog.Portal>
        {/* No Overlay by design — a scrim is exactly what a non-modal panel must not have. */}
        <RadixDialog.Content
          aria-label={typeof title === "string" ? undefined : ariaLabel}
          // The page behind stays live: a click on the leads table is a click on the leads
          // table, not a dismissal. ✕ and Esc are the only ways out.
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            // Radix's non-modal path aims focus at a Dialog.Trigger; this panel is controlled
            // and has none, so its restoration is a no-op that also blocks the FocusScope
            // fallback. Take it over: return focus to whatever opened the panel.
            e.preventDefault();
            opener?.focus?.();
          }}
          className={cn(
            "anim-panel fixed inset-y-0 right-0 z-[100] flex w-full flex-col overflow-hidden bg-surface shadow-lg outline-none",
            // Below 768px it is a full-screen sheet (the portal's phone reality in PR C, and a
            // narrow admin window here). From 768px it is a slide-over beside a still-usable
            // table: 560px is the floor the field grid reads at, 600px the desktop width — so
            // between 768 and 1100 the panel takes MORE of the table rather than getting thinner.
            "md:w-[560px] md:border-l md:border-border min-[1100px]:w-[600px]",
          )}
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border-soft px-4 py-3">
            {leading}
            {title ? (
              <RadixDialog.Title className="min-w-0 font-display text-base font-semibold text-text">{title}</RadixDialog.Title>
            ) : (
              // Radix requires a Title for a11y; hide it visually when none is provided.
              <RadixDialog.Title className="sr-only">{ariaLabel ?? "Panel"}</RadixDialog.Title>
            )}
            <RadixDialog.Close
              aria-label="Close"
              // C-52 (WCAG 2.5.8), the Dialog ✕ recipe verbatim: the glyph stays 18px and
              // `ml-auto` keeps owning the alignment, so the reach is an invisible
              // pseudo-element rather than padding that would fight the margin.
              className={cn(
                "relative ml-auto rounded text-text-3 outline-none transition-colors hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink",
                "before:absolute before:-inset-1.5 before:content-[''] pointer-coarse:before:-inset-3.5",
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </RadixDialog.Close>
          </div>

          {/* min-h-0 is what lets a flex child shrink below its content height. The scroll lives
              on an INNER region, never on Content, so the discard overlay keeps covering the
              whole panel even when a tall form is scrolled (FRM-02a). */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
              <div className="p-4">{children}</div>
            </div>
            {moreBelow && <ScrollHintFade edge="bottom" />}
          </div>

          {confirming && (
            <div
              role="alertdialog"
              aria-label="Discard unsaved changes?"
              className="absolute inset-0 z-10 grid place-items-center p-5"
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

function activeElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}
