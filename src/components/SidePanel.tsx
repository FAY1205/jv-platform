"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/use-media-query";
import { DiscardGuard } from "./DiscardGuard";
import { ScrollHintFade, useScrollHint } from "./ScrollHint";

// SidePanel (N5-01) — the right-anchored slide-over. A SIBLING of Dialog, not a Dialog mode:
// the two differ in the thing that matters most about a dialog (whether the page behind it is
// inert), and folding this into Dialog would make every existing call site carry a modality
// question it has already answered.
//
// MODALITY IS BREAKPOINT-DEPENDENT, and that is the whole contract:
//  - ≥768px it is NON-modal, and that is the feature: no scrim, no focus trap, no aria-hidden
//    on the rest of the page, and an outside click does NOT dismiss — the leads table stays
//    visible AND clickable, and clicking another row switches the panel's record in place.
//  - <768px it is a full-bleed SHEET that covers the page completely, so the page behind must
//    be modal-inert: leaving a fully-obscured table in the tab order and in the a11y tree is a
//    plain WCAG failure (2.4.3 focus order / 1.3.2), and "non-modal" means nothing to a reader
//    who cannot see that anything is behind the sheet.
// Radix supplies the dialog semantics (role="dialog", a Title that labels it) and Esc in both.
//
// Two behaviors Radix's non-modal path does NOT give us, handled here:
//  1. Outside interaction closes by default — we preventDefault it (that IS the feature).
//  2. Return-focus goes to a `Dialog.Trigger`, which a controlled panel has none of, and Radix
//     then preventDefaults the focus restoration entirely. So the opener is captured on the
//     open transition and refocused on close.

/** The sheet breakpoint, as a max-width so the UNRESOLVED answer (server render, first client
 *  paint, no matchMedia) is the desktop one — the panel must never start life modal on a
 *  desktop and then swap modality, which remounts Radix's Content. */
const SHEET_QUERY = "(max-width: 767.98px)";

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
  /** Accessible label when no visible title is rendered. */
  ariaLabel?: string;
  children?: React.ReactNode;
  /**
   * FRM-02a, same contract as Dialog: when the hosted form has unsaved changes, a dismiss
   * gesture (Esc / ✕) raises a discard-confirmation instead of closing. An explicit in-form
   * Cancel is an intentional discard and is NOT guarded.
   */
  confirmClose?: boolean;
  /**
   * N5-02: the identity of the record on screen. A non-modal panel switches records WITHOUT
   * closing (`open` stays true), so `open` alone cannot reset per-open state: a stale discard
   * prompt would survive a row click and then close the panel on the WRONG lead, and close
   * would return focus to the FIRST record's opener row. Change this whenever the panel's
   * subject changes and both are re-established.
   */
  resetKey?: string | number;
  /**
   * WCAG 4.1.3 (A11Y-03): text for the panel's persistent polite live region. The panel
   * deliberately does NOT move focus on a record switch (that is what makes the pager and
   * row-clicking usable), so the switch is otherwise silent to a screen reader. The region is
   * mounted for the panel's whole life and only its TEXT changes — never mounted with content
   * already in it, which some AT does not announce.
   */
  statusMessage?: string;
  /**
   * N5-13 (Esc precedence): while true, Esc does NOT close the panel — something inside it
   * owns the key first (an active inline edit, which reverts on that press). The next Esc,
   * with nothing left to consume it, closes as usual.
   *
   * It has to be a prop rather than the edit simply calling `stopPropagation`: Radix listens
   * for Escape on the DOCUMENT in the capture phase, so it has already decided by the time a
   * keystroke reaches the field. `onEscapeKeyDown` + `preventDefault` is the one seam that
   * runs early enough, and it lives here.
   */
  escapeHeld?: boolean;
}

export function SidePanel({
  open,
  onClose,
  leading,
  title,
  ariaLabel,
  children,
  confirmClose = false,
  resetKey,
  statusMessage = "",
  escapeHeld = false,
}: SidePanelProps) {
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
  // …and the same reset on an IN-PLACE record switch, where `open` never flips.
  const [prevKey, setPrevKey] = React.useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    if (confirming) setConfirming(false);
    // The new record may have been opened from a different control; close should return focus
    // THERE, not to whatever opened the first record of the session. Only when the switch came
    // from outside the panel, though: a pager arrow / ↑↓ switch leaves focus on a control that
    // this very panel owns, and capturing it would aim the close at a node about to unmount.
    // A mouse row-click leaves focus on <body> (rows are not focusable — the keyboard path is
    // the row's open button), which is likewise not an opener worth keeping. The "is it ours"
    // test is `closest('[role="dialog"]')` rather than a ref into our own Content: a ref may
    // not be read during render, and any element inside ANY open dialog is equally unfit to be
    // a return-focus target — it is about to unmount with its host.
    const el = activeElement();
    if (open && el && !el.closest('[role="dialog"]')) setOpener(el);
  }

  const requestClose = () => {
    if (!confirmClose) { onClose(); return; }
    // While the prompt is up, a further dismiss gesture means "keep editing".
    setConfirming((c) => (c ? false : true));
  };

  // C-65: the same bottom edge-fade recipe the Dialog body uses — one implementation.
  const { ref: bodyRef, more: moreBelow } = useScrollHint<HTMLDivElement>(true, "y");

  const sheet = useMediaQuery(SHEET_QUERY);

  return (
    <RadixDialog.Root open={open} modal={sheet} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <RadixDialog.Portal>
        {/* No Overlay by design — a scrim is exactly what the ≥768px panel must not have, and
            below 768 the sheet is opaque and full-bleed, so there is nothing to scrim. */}
        <RadixDialog.Content
          // Radix wires aria-labelledby to the rendered Title, which ALWAYS wins over
          // aria-label — so the fallback applies only when there is no title at all.
          aria-label={title == null ? ariaLabel : undefined}
          // The page behind stays live: a click on the leads table is a click on the leads
          // table, not a dismissal. ✕ and Esc are the only ways out.
          onInteractOutside={(e) => e.preventDefault()}
          // N5-13: hand the first Esc to whatever inside the panel claims it. Radix skips its
          // own dismiss when the event comes back defaultPrevented; the keystroke still
          // reaches the field, which is what performs the revert.
          onEscapeKeyDown={(e) => { if (escapeHeld) e.preventDefault(); }}
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
          {/* Header/body padding is Dialog's px-5 py-4 / p-5 verbatim — chrome parity is the
              default for a sibling primitive, and the ✕ reach below depends on it. */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border-soft px-5 py-4" inert={confirming}>
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
              // pseudo-element rather than padding that would fight the margin. 18 + 2×6 = 30px,
              // and 18 + 2×14 = 46px on coarse pointers — absorbed by the header's own px-5/py-4
              // padding (16px each side), which is why this header matches Dialog's rather than
              // running tighter: at py-3 the coarse reach overflowed a panel that is
              // `overflow-hidden`, and the top of it was clipped away.
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
          {/* A11Y-03: mounted for the panel's lifetime, only its TEXT changes. Kept OUT of the
              header above because that region goes `inert` behind the discard guard, and an
              inert live region announces nothing. */}
          <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>

          {/* min-h-0 is what lets a flex child shrink below its content height. The scroll lives
              on an INNER region, never on Content, so the discard overlay keeps covering the
              whole panel even when a tall form is scrolled (FRM-02a). */}
          <div className="relative flex min-h-0 flex-1 flex-col" inert={confirming}>
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
              <div className="p-5">{children}</div>
            </div>
            {moreBelow && <ScrollHintFade edge="bottom" />}
          </div>

          {confirming && (
            <DiscardGuard
              onKeep={() => setConfirming(false)}
              onDiscard={() => { setConfirming(false); onClose(); }}
            />
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
