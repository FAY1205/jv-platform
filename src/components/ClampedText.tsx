"use client";

import * as React from "react";

export interface ClampedTextProps {
  children: React.ReactNode;
  /** Lines shown before the "Show more" toggle appears (default 5). */
  lines?: number;
  className?: string;
}

// ClampedText (DSN-03) — long free-text (source notes) collapsed to `lines`, with a
// "Show more" toggle that appears ONLY when the text actually overflows the clamp, so short
// notes read as plain text with no button noise (measured after layout). Preserves the notes'
// pre-wrap formatting; tokens only (PRN-12). The toggle carries default/hover/focus-visible
// states + aria-expanded; expansion is not remembered across remounts (a reopened dialog
// starts clamped again — deliberate, per the notes-length decision).
export function ClampedText({ children, lines = 5, className }: ClampedTextProps) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    // Re-measure only while collapsed; once expanded the toggle stays, to collapse again.
    // +1 absorbs sub-pixel rounding so a lead that exactly fills the clamp shows no toggle.
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [children, expanded, lines]);

  const clampStyle = {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  } as React.CSSProperties;

  return (
    <div className={className}>
      <p ref={ref} className="whitespace-pre-wrap text-sm text-text-2" style={expanded ? undefined : clampStyle}>
        {children}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center gap-0.5 rounded-sm text-xs font-semibold text-brand-ink transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        >
          {expanded ? "Show less" : "Show more"}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
      )}
    </div>
  );
}
