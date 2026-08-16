import * as React from "react";

/**
 * Uncovered-territory hatch (WP-D). Diagonal survey hatch — NEUTRAL since WP-UX-4
 * (audit D-1/C-2): the old `--warn`-family amber sat in the same hue range as
 * legitimate partner fills, so on the dashboard (which had no legend) uncovered
 * Plains states read as *owned* — the one place the UI led a viewer to a wrong
 * conclusion. "Not owned" now wears no partner-like colour at all: `--border-strong`
 * lines over a `--surface-3` wash, in both themes. `userSpaceOnUse` keeps the lines
 * continuous across county borders within a multi-county uncovered state. Render one
 * per <svg> with a React.useId() id, then fill uncovered shapes with `url(#id)`.
 * Texture, not color alone (PRN-14).
 */
export function MapHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="var(--surface-3)" />
        <line x1={0} y1={0} x2={0} y2={6} stroke="var(--border-strong)" strokeWidth={1} />
      </pattern>
    </defs>
  );
}
