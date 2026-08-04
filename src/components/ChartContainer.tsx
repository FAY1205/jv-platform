"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/cn";

// ChartContainer — the shared responsive sizing + tokened chrome for all charts
// (ADR-0017). LineChart/DonutChart render their Recharts chart as the single child.
// Colors here are token references (CSS vars), never hex literals (PRN-12).

export interface ChartContainerProps {
  height?: number;
  children: React.ReactElement;
  className?: string;
}

export function ChartContainer({ height = 280, children, className }: ChartContainerProps) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// Token chrome colors shared by the chart wrappers (CSS var references, not hex).
export const CHART_AXIS = "var(--text-3)";
export const CHART_GRID = "var(--border-soft)";

/** Recharts injects these at runtime; all optional so the element form type-checks. */
interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string | number; value?: string | number; color?: string }>;
}

/**
 * ChartTooltip — the shared styled tooltip. PRN-14: every series is identified by its
 * NAME (never color alone) alongside its value. Used by both LineChart and DonutChart.
 */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== "" && <div className="mb-1 font-semibold text-text-2">{String(label)}</div>}
      <ul className="flex flex-col gap-1">
        {payload.map((entry, i) => (
          <li key={`${entry.name}-${i}`} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
            <span className="text-text-2">{entry.name}</span>
            <span className="num ml-auto font-semibold text-text">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
