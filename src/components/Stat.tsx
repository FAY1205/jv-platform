import * as React from "react";
import { cn } from "@/lib/cn";

export interface StatProps {
  label: string;
  value: React.ReactNode;
  /** Optional trend indicator. */
  delta?: { dir: "up" | "down" | "flat"; text: string };
  /** Small caption under the value (e.g. "of 27 uploaded · 77.8% match rate"). */
  foot?: React.ReactNode;
  className?: string;
}

const deltaStyles = {
  up: "bg-success-soft text-success",
  down: "bg-danger-soft text-danger",
  flat: "bg-surface-3 text-text-3",
} as const;

/**
 * Stat — a KPI readout. The value is set in the display face with tabular numerals
 * ("ledger" identity, DSN-02); every figure is expected to carry a calculation
 * tooltip once wired (UXQ-05).
 */
export function Stat({ label, value, delta, foot, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-text-3">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-bold tracking-tight tabular-nums text-text">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.8125rem] font-bold",
              deltaStyles[delta.dir],
            )}
          >
            {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—"} {delta.text}
          </span>
        )}
      </div>
      {foot && <span className="text-xs text-text-3">{foot}</span>}
    </div>
  );
}
