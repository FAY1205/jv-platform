"use client";

import * as React from "react";
import { LineChart as RLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartContainer, ChartTooltip, CHART_AXIS, CHART_GRID } from "./ChartContainer";

// LineChart — multi-series line over a shared x key (ADR-0017). PRN-14: every series is
// named in the legend AND the tooltip (never color alone). Series colors are supplied by
// the caller from tokens; axis/grid chrome uses token CSS vars.

export interface LineSeries {
  key: string;
  name: string;
  /** Token-derived color (hex or `var(--…)`), supplied by the page. */
  color: string;
}

export interface LineChartProps {
  data: Array<Record<string, string | number>>;
  series: LineSeries[];
  xKey: string;
  height?: number;
  /** Format a y value for the axis + tooltip (e.g. compact counts). */
  yTickFormatter?: (value: number) => string;
}

export function LineChart({ data, series, xKey, height = 280, yTickFormatter }: LineChartProps) {
  return (
    <ChartContainer height={height}>
      <RLineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} stroke={CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID }} fontSize={12} />
        <YAxis stroke={CHART_AXIS} tickLine={false} axisLine={false} width={40} fontSize={12} tickFormatter={yTickFormatter} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_GRID }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive
          />
        ))}
      </RLineChart>
    </ChartContainer>
  );
}
