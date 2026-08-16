import * as React from "react";
import { MapHatch } from "./MapHatch";

/**
 * UncoveredKey (WP-UX-4, audit D-1) — the one-swatch legend that says what the hatch
 * means. Promoted from the Coverage page's inline recipe so the DASHBOARD map (which
 * had no legend at all — the audit's wrong-conclusion finding) shows the identical
 * key. A map that draws uncovered ground must say so in words (PRN-14).
 */
export function UncoveredKey({ className }: { className?: string }) {
  const hatchId = React.useId();
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span className="inline-flex h-3.5 w-3.5 overflow-hidden rounded-[3px] border border-border">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <MapHatch id={hatchId} />
          <rect width="14" height="14" fill={`url(#${hatchId})`} />
        </svg>
      </span>
      Uncovered
    </span>
  );
}
