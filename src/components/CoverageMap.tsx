"use client";

import * as React from "react";
import { US_HEX_STATES, HEX_VIEWBOX } from "@/lib/geo/us-hexgrid";
import type { StateCoverage } from "@/modules/coverage/map";
import { contrastText } from "@/lib/contrast";
import { PartnerTag } from "./PartnerTag";

export interface CoverageMapProps {
  states: readonly StateCoverage[];
  /** When set, that partner's states stay lit and the rest dim (explore mode). */
  selectedPartnerId?: string | null;
  onSelectPartner?: (partnerId: string | null) => void;
}

/**
 * CoverageMap (MAP-01) — a US states hex cartogram. Each state is colored by its
 * state-fallback partner; uncovered states are neutral, and coverage gaps (leads
 * from an unowned state) carry a dashed warn ring + marker so they read without
 * relying on color (PRN-14). Every hex is labeled with its 2-letter code; the
 * hover card and the page legend add partner name + JV ref.
 */
export function CoverageMap({ states, selectedPartnerId = null, onSelectPartner }: CoverageMapProps) {
  const byCode = React.useMemo(() => new Map(states.map((s) => [s.code, s])), [states]);
  const [hover, setHover] = React.useState<string | null>(null);

  const hoveredHex = hover ? US_HEX_STATES.find((h) => h.code === hover) ?? null : null;
  const hoveredCov = hover ? byCode.get(hover) ?? null : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${HEX_VIEWBOX.w} ${HEX_VIEWBOX.h}`}
        className="w-full"
        role="img"
        aria-label="United States coverage map, colored by partner"
      >
        {US_HEX_STATES.map((hex) => {
          const cov = byCode.get(hex.code);
          const covered = Boolean(cov?.partnerId);
          const gap = Boolean(cov?.gap);
          const dimmed = selectedPartnerId != null && cov?.partnerId !== selectedPartnerId;
          const isHover = hover === hex.code;
          const fill = covered ? cov!.color! : "var(--surface-3)";
          // F-19: label color follows the fill's luminance (dark text on light tints, white
          // on dark) instead of always-white; the halo takes the opposite tone.
          const labelFill = covered ? contrastText(cov!.color!) : "var(--text-2)";
          const halo = labelFill === "#ffffff" ? "rgba(0,0,0,.3)" : "rgba(255,255,255,.6)";
          return (
            <g
              key={hex.code}
              onMouseEnter={() => setHover(hex.code)}
              onMouseLeave={() => setHover((h) => (h === hex.code ? null : h))}
              onClick={() => onSelectPartner?.(cov?.partnerId ?? null)}
              className={covered ? "cursor-pointer" : "cursor-default"}
              style={{ opacity: dimmed ? 0.28 : 1, transition: "opacity 150ms" }}
            >
              <polygon
                points={hex.points}
                fill={fill}
                stroke={gap ? "var(--warn)" : isHover ? "var(--text)" : "var(--surface)"}
                strokeWidth={gap || isHover ? 2 : 1.5}
                strokeDasharray={gap ? "3 2" : undefined}
                style={{ transition: "stroke 120ms" }}
              />
              <text
                x={hex.cx}
                y={hex.cy}
                textAnchor="middle"
                dominantBaseline="central"
                className="num pointer-events-none select-none"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fill: labelFill,
                  paintOrder: "stroke",
                  stroke: covered ? halo : "transparent",
                  strokeWidth: covered ? 2.5 : 0,
                }}
              >
                {hex.code}
              </text>
              {gap && <circle cx={hex.cx + 15} cy={hex.cy - 12} r={2.6} fill="var(--warn)" />}
            </g>
          );
        })}
      </svg>

      {hoveredHex && hoveredCov && (
        <div
          className="anim-fade pointer-events-none absolute z-10 w-max max-w-[220px] -translate-x-1/2 -translate-y-[118%] rounded-xl border border-border bg-surface px-3 py-2 shadow-lg"
          style={{
            left: `${(hoveredHex.cx / HEX_VIEWBOX.w) * 100}%`,
            top: `${(hoveredHex.cy / HEX_VIEWBOX.h) * 100}%`,
          }}
        >
          <div className="text-sm font-semibold text-text">{hoveredCov.name}</div>
          {hoveredCov.partnerId ? (
            <>
              <PartnerTag
                name={hoveredCov.partnerName!}
                color={hoveredCov.color!}
                refId={hoveredCov.refId!}
                size="sm"
                className="mt-1"
              />
              <div className="num mt-1 text-[.7rem] text-text-3">
                {hoveredCov.leadCount} lead{hoveredCov.leadCount === 1 ? "" : "s"} received
              </div>
            </>
          ) : hoveredCov.gap ? (
            <div className="mt-1 text-xs font-medium text-warn">
              No coverage · <span className="num">{hoveredCov.leadCount}</span> lead
              {hoveredCov.leadCount === 1 ? "" : "s"} unmatched
            </div>
          ) : (
            <div className="mt-1 text-xs text-text-3">No partner assigned</div>
          )}
        </div>
      )}
    </div>
  );
}
