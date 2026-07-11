import * as React from "react";

/**
 * Uncovered-territory hatch (WP-D). Diagonal amber survey hatch — `--warn` lines
 * over a `--warn-soft` wash. `userSpaceOnUse` keeps the lines continuous across
 * county borders within a multi-county uncovered state. Render one per <svg> with
 * a React.useId() id, then fill uncovered shapes with `url(#id)`. Texture, not
 * color alone (PRN-14).
 */
export function MapHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="var(--warn-soft)" />
        <line x1={0} y1={0} x2={0} y2={6} stroke="var(--warn)" strokeWidth={1} />
      </pattern>
    </defs>
  );
}
