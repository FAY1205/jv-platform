"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

// DiscardGuard — the FRM-02a "Discard unsaved changes?" overlay, shared by Dialog and
// SidePanel (FRONTEND_STANDARDS §2: the second copy becomes the shared recipe; this markup
// was duplicated near-verbatim between the two hosts). INTERNAL: deliberately not exported
// from the components barrel — it is a piece of dialog chrome, not a primitive a page mounts.
//
// It covers its host's whole panel (`absolute inset-0`, so the host must be `relative` /
// positioned), which is why the hosts keep their scrolling on an INNER region.
//
// Focus containment lives here rather than in either host. Dialog is modal and gets Radix's
// trap for free, but the SidePanel is non-modal by design (`modal={false}` at ≥768px), so an
// `alertdialog` inside it has no outer trap at all: Tab would walk into the very fields the
// scrim is covering, or leave the panel entirely. Two buttons is a small enough surface that
// the cycle is a handful of lines — no dependency, no hand-rolled general-purpose trap:
//  - `inert` on the host's other regions takes them out of the tab order AND the a11y tree,
//    which is the half a keydown handler cannot do (a screen reader's virtual cursor).
//  - the Tab cycle below keeps focus on Keep/Discard, which is the half `inert` cannot do
//    (Tab off the last control would otherwise escape to the page behind).

export interface DiscardGuardProps {
  /** Keep editing — dismiss the prompt, leave the host open. */
  onKeep: () => void;
  /** Discard — dismiss the prompt AND close the host. */
  onDiscard: () => void;
  /** Extra classes for the covering layer (Dialog rounds its corners to match the panel). */
  className?: string;
}

export function DiscardGuard({ onKeep, onDiscard, className }: DiscardGuardProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = ref.current;
    if (!root) return;
    const stops = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (e.shiftKey ? active === first : active === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };

  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-label="Discard unsaved changes?"
      onKeyDown={onKeyDown}
      className={cn("absolute inset-0 z-10 grid place-items-center p-5", className)}
      style={{ background: "var(--scrim)" }}
    >
      <div className="w-full max-w-xs rounded-xl border border-border bg-surface p-4 text-center shadow-lg">
        <p className="font-display text-base font-semibold text-text">Discard unsaved changes?</p>
        <p className="mt-1 text-sm text-text-2">Your edits haven&apos;t been saved. This can&apos;t be undone.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={onKeep} autoFocus>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
