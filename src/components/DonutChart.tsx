"use client";

import * as React from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip } from "./ChartContainer";

// DonutChart — a donut with a center total and a labeled legend (ADR-0017). PRN-14:
// every segment is named in the legend + tooltip (never color alone). Percentages are
// shown in the legend alongside counts. Segment colors come from tokens (caller-supplied).

export interface DonutDatum {
  name: string;
  value: number;
  /** Token-derived color (hex or `var(--…)`). */
  color: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  /** Text under the center total (e.g. "removed"). */
  centerLabel?: string;
  height?: number;
}

export function DonutChart({ data, centerLabel, height = 260 }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 100));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative" style={{ width: height, height }}>
        <ChartContainer height={height}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1} isAnimationActive>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-display text-2xl font-semibold text-text">{total}</span>
          {centerLabel && <span className="text-xs text-text-3">{centerLabel}</span>}
        </div>
      </div>

      {/* Labeled legend (PRN-14): name + count + percentage, never color alone. */}
      <ul className="flex min-w-[10rem] flex-col gap-1.5">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden="true" />
            <span className="text-text-2">{d.name}</span>
            <span className="num ml-auto font-semibold text-text">{d.value}</span>
            <span className="num w-10 text-right text-text-3">{pct(d.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
