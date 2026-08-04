"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

// Hot-lead visual language (SCR / WP-SCORE-2). A concentric-circle "target" mark —
// chosen over a flame (owner: too friendly) to read as "priority / act now" in a B2B
// tool. Meaning never rides on color alone (PRN-14): the mark carries an aria-label
// with the score, and it always sits beside the lead's reference ID. Hand-drawn SVG in
// the app's stroke style (no icon library). Amber (warn) tint — distinct from the red
// "Removed" language so the two never read the same.

export interface HotLeadIconProps {
  /** Pixel size of the square icon. Kept small by default (owner: "not too big"). */
  size?: number;
  className?: string;
}

/** The bare target glyph. Inherits color via currentColor; decorative by itself. */
export function HotLeadIcon({ size = 14, className }: HotLeadIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export interface HotLeadMarkProps {
  /** The lead's total, e.g. 42. Rendered into the accessible label. */
  score: number;
  /** Out of (default 50). */
  outOf?: number;
  size?: number;
  className?: string;
}

/**
 * The inline table mark: the target glyph with an accessible label carrying the score.
 * Render this ONLY for a kept, hot lead — an MLS-listed (removed) lead shows no mark
 * (owner decision). The tint is amber; the label makes the meaning colorless-safe.
 */
export function HotLeadMark({ score, outOf = 50, size = 14, className }: HotLeadMarkProps) {
  const label = `Hot lead — ${score} out of ${outOf}`;
  return (
    <Tooltip content={`Hot lead · ${score}/${outOf}`}>
      <span className={cn("inline-flex text-warn", className)} role="img" aria-label={label}>
        <HotLeadIcon size={size} />
      </span>
    </Tooltip>
  );
}
