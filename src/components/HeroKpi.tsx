import * as React from "react";
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
}) {
  const color = tone === "brand" ? "text-brand-ink" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className={`bg-surface py-3 ${dense ? "px-3" : "px-4"}`}>
      <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${color}`}>{value.toLocaleString()}</div>
      <div className={`mt-1 font-medium uppercase tracking-[.05em] text-text-3 ${label13}`}>
        {tip ? <HeaderTip label={label} tip={tip} /> : label}
      </div>
      {delta !== undefined && <div className="mt-0.5"><Delta delta={delta} good={good} /></div>}
    </div>
  );
}
