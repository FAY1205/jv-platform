import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

const label13 = "text-step-1"; // 13px chrome floor

/** Which direction is GOOD for this metric — drives the delta's sentiment ink.
 *  "none" (default) keeps the neutral treatment for direction-less counts. */
export type KpiPolarity = "up" | "down" | "none";

// WP-UX-4 (audit D-3 + portal-3): deltas carry sentiment where direction has a known
// valence — "Leads in ↓ 5" (bad) no longer reads identically to "Closed ↑ 5" (good).
// The arrow + number always accompany the ink, so color is never the only carrier
// (PRN-14). Zero renders "— no change" (the bare "·" was a dangling separator that
// wrapped to noise on phones); "vs prior" stays muted either way.
function Delta({ delta, good = "none" }: { delta: number | null; good?: KpiPolarity }) {
  if (delta === null) return <span className={`num ${label13} text-text-3`}>all time</span>;
  if (delta === 0) return <span className={`num ${label13} text-text-3`}>— no change</span>;
  const arrow = delta > 0 ? "↑" : "↓";
  const ink =
    good === "none" ? "text-text-3" : (delta > 0) === (good === "up") ? "text-success" : "text-danger";
  return (
    <span className={`num ${label13} text-text-3`}>
      <span className={`font-semibold ${ink}`}>
        {arrow} {Math.abs(delta)}
      </span>{" "}
      vs prior
    </span>
  );
}

function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span
        tabIndex={0}
        className="cursor-help rounded underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
      >
        {label}
      </span>
    </Tooltip>
  );
}

/** Hero KPI cell — Fraunces numeral, 13px label, optional prior-window delta and calc
 *  tooltip. Shared by the admin dashboard and the partner portal dashboard. */
export function HeroKpi({
  label,
  value,
  delta,
  good,
  tone,
  tip,
  dense,
  href,
}: {
  label: string;
  value: number;
  delta?: number | null;
  /** WP-UX-4: which direction is good for THIS metric (delta sentiment ink). */
  good?: KpiPolarity;
  tone?: "brand" | "warn";
  tip?: string;
  /** WP-PW-2 final fix: px-3 instead of the default px-4 — keeps the portal's mobile
   *  KPI tiles pixel-exact to the pre-shared-component layout. */
  dense?: boolean;
  /** UXF-1.1 (Scope-E audit §1.1): make the tile the drill-down to the list it counts.
   *  Optional — a tile with no list to open stays a plain, non-focusable cell. */
  href?: string;
}) {
  const color = tone === "brand" ? "text-brand-ink" : tone === "warn" ? "text-warn" : "text-text";
  // A LINKED tile has exactly ONE focusable element: the link itself is the tooltip
  // trigger. The unlinked tile keeps the dotted-underline HeaderTip. (A tabindex span
  // nested inside an <a> is interactive-content-inside-a-link — invalid, and it gives
  // the cell two tab stops for one target.)
  const linked = href !== undefined;
  const body = (
    <>
      <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>
        {tip && !linked ? <HeaderTip label={label} tip={tip} /> : label}
      </div>
      {delta !== undefined && <div className="mt-0.5"><Delta delta={delta} good={good} /></div>}
    </>
  );
  const box = cn("bg-surface py-3", dense ? "px-3" : "px-4");

  if (!linked) return <div className={box}>{body}</div>;

  // DSN-03 states: default/hover/focus-visible/active. `ring-inset` because these tiles
  // sit in an `overflow-hidden` gap-px grid, where an outset ring is clipped away.
  const tile = (
    <Link
      href={href}
      className={cn(
        box,
        "block w-full outline-none transition-colors",
        "hover:bg-surface-2 active:bg-surface-2",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-ink",
      )}
    >
      {body}
    </Link>
  );
  return tip ? <Tooltip content={tip}>{tile}</Tooltip> : tile;
}
