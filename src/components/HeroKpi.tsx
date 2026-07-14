import * as React from "react";
import { Tooltip } from "./Tooltip";

const label13 = "text-step-1"; // 13px chrome floor

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className={`num ${label13} text-text-3`}>all time</span>;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
  return <span className={`num ${label13} text-text-3`}>{arrow} {delta === 0 ? "same" : Math.abs(delta)} vs prior</span>;
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
  tone,
  tip,
  dense,
}: {
  label: string;
  value: number;
  delta?: number | null;
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
      {delta !== undefined && <div className="mt-0.5"><Delta delta={delta} /></div>}
    </div>
  );
}
