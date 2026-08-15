"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { tagChipClass } from "@/lib/tag-chip";
import { HotLeadIcon } from "./HotLeadMark";
import { Tooltip } from "./Tooltip";

// WP-TAG-1 (TAG-04/TAG-05) — the tag chip vocabulary. One shape, two kinds:
//
//   • TagChip     — a STORED tag. Name + palette tint, optional ✕ to detach.
//   • HotTagChip  — the SMART tag. Same chip language so the row reads as one vocabulary,
//                   but derived from the scorer (score_group/score_total, PRN-15), so it
//                   carries the target icon, has NO ✕, and is never editable or listed in
//                   the tag manager. Zero storage, zero new endpoint (TAG-05).
//
// PRN-12: no hex here — the palette key resolves to semantic-token utilities in
// lib/tag-chip.ts. PRN-14: the NAME is always rendered, so color is never the only signal;
// the ✕ carries its own accessible label naming the tag it removes.

export interface TagChipProps {
  name: string;
  /** A lib/tokens TAG_PALETTE key. An unknown key degrades to a neutral chip. */
  color: string;
  /** Present ⇒ the chip renders its ✕ (TAG-04). Omit for a read-only chip. */
  onRemove?: () => void;
  /** Disables the ✕ while a detach is in flight (the chip stays visible + readable). */
  busy?: boolean;
  title?: string;
  className?: string;
}

export function TagChip({ name, color, onRemove, busy = false, title, className }: TagChipProps) {
  return (
    <span className={tagChipClass(color, className)} title={title} data-tag-chip={name}>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          disabled={busy}
          onClick={(e) => {
            // Chips live inside clickable rows/cards — a detach must never also open the lead.
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "-mr-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full outline-none transition-colors",
            "hover:bg-surface-3 hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-95",
            "disabled:cursor-progress disabled:opacity-50",
          )}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

export interface HotTagChipProps {
  /** The lead's total (SCR). Rendered inline and into the accessible label. */
  score: number;
  outOf?: number;
  className?: string;
}

/** TAG-05: the Hot SMART tag — derived, not stored. No ✕ by construction. */
export function HotTagChip({ score, outOf = 50, className }: HotTagChipProps) {
  return (
    <Tooltip content={`Hot · ${score}/${outOf} — derived from the lead's score, not an editable tag`}>
      <span
        // The palette's amber slot, so the smart tag sits in the same color system as the
        // stored ones while the ICON (not the hue) is what marks it as different (PRN-14).
        className={tagChipClass("amber", className)}
        role="img"
        aria-label={`Hot lead — ${score} out of ${outOf}. Derived from the lead's score; not an editable tag.`}
      >
        <HotLeadIcon size={10} />
        <span>
          Hot · <span className="num">{score}</span>
        </span>
      </span>
    </Tooltip>
  );
}

/** TAG-04: the board card's overflow marker — "+n" past the visible cap, with the hidden
 *  names in its title/label so the information is never lost to the truncation. */
export function TagOverflowChip({ hidden }: { hidden: readonly string[] }) {
  const names = hidden.join(", ");
  return (
    <Tooltip content={names}>
      <span
        className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-text-3"
        aria-label={`${hidden.length} more tags: ${names}`}
      >
        +{hidden.length}
      </span>
    </Tooltip>
  );
}
