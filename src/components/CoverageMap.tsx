"use client";

import * as React from "react";
import { US_HEX_STATES, HEX_VIEWBOX } from "@/lib/geo/us-hexgrid";
import type { StateCoverage } from "@/modules/coverage/map";
import { contrastText, contrastHalo } from "@/lib/contrast";
import { PartnerTag } from "./PartnerTag";
import { MapHatch, MapCaption, PARTNER_FILL_OPACITY, DIMMED_FILL_OPACITY, type MapCaptionProps } from "./map";

export interface CoverageMapProps {
  states: readonly StateCoverage[];
  /** When set, that partner's states stay lit and the rest dim (explore mode). */
  selectedPartnerId?: string | null;
  onSelectPartner?: (partnerId: string | null) => void;
  /** Optional blurred title plate; WP-E pages supply the content. */
  caption?: MapCaptionProps;
}

/**
 * CoverageMap (MAP-01) — a US states hex cartogram, Survey-skinned. Each state is
 * filled by its state-fallback partner at ~0.9 opacity; uncovered states carry the
 * amber survey hatch, and coverage gaps (leads from an unowned state) add a dashed
 * --warn ring + marker so they read without relying on color (PRN-14). Every hex is
 * labeled with its 2-letter code (on-fill color + halo via the shared contrast
 * picker, F-19); the hover card and page legend add partner name + JV ref. Keyboard
 * access is the page's companion list (R3 WS-8) — the map is role="img".
 */
export function CoverageMap({ states, selectedPartnerId = null, onSelectPartner, caption }: CoverageMapProps) {
  const byCode = React.useMemo(() => new Map(states.map((s) => [s.code, s])), [states]);
  const [hover, setHover] = React.useState<string | null>(null);
  const hatchId = React.useId();

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
        <MapHatch id={hatchId} />
        {US_HEX_STATES.map((hex) => {
          const cov = byCode.get(hex.code);
          const covered = Boolean(cov?.partnerId);
          const gap = Boolean(cov?.gap);
          const dimmed = selectedPartnerId != null && cov?.partnerId !== selectedPartnerId;
          const isHover = hover === hex.code;
          const fill = covered ? cov!.color! : `url(#${hatchId})`;
          // F-19: on-fill label + halo follow the fill's luminance (shared picker),
          // not always-white; uncovered gets a neutral label and no halo.
          const labelFill = covered ? contrastText(cov!.color!) : "var(--text-2)";
          const halo = covered ? contrastHalo(cov!.color!) : "transparent";
          return (
            <g
              key={hex.code}
              onMouseEnter={() => setHover(hex.code)}
              onMouseLeave={() => setHover((h) => (h === hex.code ? null : h))}
              onClick={() => onSelectPartner?.(cov?.partnerId ?? null)}
              className={covered ? "cursor-pointer" : "cursor-default"}
              style={{ opacity: dimmed ? DIMMED_FILL_OPACITY : 1, transition: "opacity 150ms" }}
            >
              <polygon
                points={hex.points}
                fill={fill}
                fillOpacity={covered ? PARTNER_FILL_OPACITY : 1}
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
                  // DSN-11 glyph-fit carve-out (WP-P): the 2-letter code is sized to fit
                  // the hex polygon, not to a reading step — excluded from the text-step
                  // ladder by design (FRONTEND_STANDARDS §2). Raw SVG attr, not a class.
                  fontSize: 11,
                  fontWeight: 600,
                  fill: labelFill,
                  paintOrder: "stroke",
                  stroke: halo,
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

      {caption && <MapCaption {...caption} />}

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
              <div className="num mt-1 text-step-0 text-text-3">
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
