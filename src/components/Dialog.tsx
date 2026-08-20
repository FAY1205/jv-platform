"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { DiscardGuard } from "./DiscardGuard";
import { ScrollHintFade, useScrollHint } from "./ScrollHint";

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
  /**
   * SRCH-02: drop the default body padding so `children` fill the panel edge-to-edge —
   * for command-palette style content that owns its own rows and separators. Purely
   * presentational; focus trap, Esc and return-focus are unchanged.
   */
  bare?: boolean;
}

const SIZES: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export function Dialog({ open, onClose, title, children, footer, ariaLabel, size = "md", confirmClose = false, bare = false }: DialogProps) {
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

  // C-65: bottom edge-fade on the BODY while content is still cut off below — the same
  // ScrollHint recipe the Table uses horizontally, on the vertical axis (one implementation).
  const { ref: bodyRef, more: moreBelow } = useScrollHint<HTMLDivElement>(true, "y");

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
          {/* C-65: the title bar and the footer sit OUTSIDE the scrolling region — a tall
              form used to scroll its own heading and its Save button off the screen, so the
              reader lost both the dialog's identity and its primary action. Only the middle
              region scrolls now; header/footer are pinned by the Content's flex column.
              The scroll still lives on an INNER region, never on Content, so the discard
              overlay (absolute inset-0 on Content) keeps covering the whole panel even when
              a tall form is scrolled (FRM-02a). */}
          {title ? (
            <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-5 py-4" inert={confirming}>
              <RadixDialog.Title className="font-display text-base font-semibold text-text">{title}</RadixDialog.Title>
              <RadixDialog.Close
                aria-label="Close"
                // C-52 (WCAG 2.5.8): the ✕ glyph stays 18px and `ml-auto` keeps owning the
                // alignment — the reach is an invisible pseudo-element, so nothing in the
                // title row moves. 18 + 2×6 = 30px, and 18 + 2×14 = 46px on coarse pointers
                // (the header's own px-5/py-4 padding absorbs the reach; the only neighbor is
                // the non-interactive title). A `-m-2 p-2` box would have fought `ml-auto`
                // for the margin, which is why this one is a pseudo-element too.
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
          ) : (
            // Radix requires a Title for a11y; hide it visually when none is provided.
            <RadixDialog.Title className="sr-only">{ariaLabel ?? "Dialog"}</RadixDialog.Title>
          )}
          {/* min-h-0 is what lets a flex child actually shrink below its content height —
              without it the body would push the footer past the panel's max-h. */}
          <div className="relative flex min-h-0 flex-1 flex-col" inert={confirming}>
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto">
              <div className={bare ? undefined : "p-5"}>{children}</div>
            </div>
            {moreBelow && <ScrollHintFade edge="bottom" />}
          </div>
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-soft px-5 py-4" inert={confirming}>{footer}</div>
          )}
          {/* Covers the panel (z above the title-bar ✕) so the only paths are Keep/Discard.
              Shared with SidePanel — see DiscardGuard for the focus-containment contract. */}
          {confirming && (
            <DiscardGuard
              className="rounded-2xl"
              onKeep={() => setConfirming(false)}
              onDiscard={() => { setConfirming(false); onClose(); }}
            />
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
