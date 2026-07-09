"use client";

import * as React from "react";
import type { StateCoverage } from "@/modules/coverage/map";
import { stateCodeForCounty } from "@/lib/geo/us-state-fips";
import { PartnerTag } from "./PartnerTag";
import { Skeleton } from "./Skeleton";

interface CountyGeo {
  viewBox: string;
  counties: { f: string; n: string; d: string }[];
  borders: string;
}

export interface CountyCoverageMapProps {
  /** Per-state coverage (reused from the state view); counties inherit their state's partner. */
  states: readonly StateCoverage[];
  selectedPartnerId?: string | null;
  onSelectPartner?: (partnerId: string | null) => void;
}

// Module-level cache so the ~0.9 MB geometry is fetched once per session.
let geoCache: CountyGeo | null = null;

/**
 * CountyCoverageMap (MAP-01) — a real US county choropleth. Each county is filled
 * by its state-fallback partner (counties inherit the state's owner; ZIP-level
 * refinement is a later step). Geometry is a pre-projected static asset loaded on
 * demand. 3,142 county paths render once; hover/click use event delegation and a
 * single highlight overlay so mouse-move never re-renders the whole map.
 */
export function CountyCoverageMap({ states, selectedPartnerId = null, onSelectPartner }: CountyCoverageMapProps) {
  const [geo, setGeo] = React.useState<CountyGeo | null>(geoCache);
  const [failed, setFailed] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<{ fips: string; name: string; x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (geoCache) return;
    let alive = true;
    fetch("/geo/us-counties.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("geo"))))
      .then((g: CountyGeo) => {
        geoCache = g;
        if (alive) setGeo(g);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const byState = React.useMemo(() => new Map(states.map((s) => [s.code, s])), [states]);
  const dByFips = React.useMemo(() => new Map((geo?.counties ?? []).map((c) => [c.f, c.d])), [geo]);
  const nameByFips = React.useMemo(() => new Map((geo?.counties ?? []).map((c) => [c.f, c.n])), [geo]);
  const covOfCounty = React.useCallback(
    (fips: string): StateCoverage | undefined => {
      const code = stateCodeForCounty(fips);
      return code ? byState.get(code) : undefined;
    },
    [byState],
  );

  // Rendered once; only re-runs when geometry or the selection changes (not on hover).
  const countyPaths = React.useMemo(() => {
    if (!geo) return null;
    return geo.counties.map((c) => {
      const cov = covOfCounty(c.f);
      const covered = Boolean(cov?.partnerId);
      const dimmed = selectedPartnerId != null && cov?.partnerId !== selectedPartnerId;
      return (
        <path
          key={c.f}
          d={c.d}
          data-fips={c.f}
          fill={covered ? cov!.color! : "var(--surface-3)"}
          fillOpacity={dimmed ? 0.25 : 1}
          className={covered ? "cursor-pointer" : "cursor-default"}
        />
      );
    });
  }, [geo, covOfCounty, selectedPartnerId]);

  const onMove = (e: React.MouseEvent) => {
    const el = e.target as Element;
    const fips = el.getAttribute?.("data-fips");
    if (!fips || !wrapRef.current) {
      if (hover) setHover(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    setHover({ fips, name: el.getAttribute("data-name") ?? "", x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onClick = (e: React.MouseEvent) => {
    const fips = (e.target as Element).getAttribute?.("data-fips");
    if (!fips) return;
    onSelectPartner?.(covOfCounty(fips)?.partnerId ?? null);
  };

  if (failed) {
    return <p className="py-10 text-center text-sm text-text-3">Couldn&apos;t load the county map.</p>;
  }
  if (!geo) {
    return <Skeleton className="aspect-[960/600] w-full rounded-xl" />;
  }

  const hoverCov = hover ? covOfCounty(hover.fips) : null;
  const hoverName = hover ? nameByFips.get(hover.fips) ?? "" : "";

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={geo.viewBox}
        className="w-full"
        role="img"
        aria-label="United States county coverage map, colored by partner"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        {countyPaths}
        {/* State borders overlay for legibility */}
        <path d={geo.borders} fill="none" stroke="var(--surface)" strokeWidth={0.8} strokeLinejoin="round" pointerEvents="none" opacity={0.9} />
        {/* Single highlight overlay for the hovered county */}
        {hover && dByFips.get(hover.fips) && (
          <path d={dByFips.get(hover.fips)!} fill="none" stroke="var(--text)" strokeWidth={1.2} pointerEvents="none" />
        )}
      </svg>

      {hover && hoverCov && (
        <div
          className="anim-fade pointer-events-none absolute z-10 w-max max-w-[240px] -translate-x-1/2 -translate-y-[125%] rounded-xl border border-border bg-surface px-3 py-2 shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="text-sm font-semibold text-text">
            {hoverName} <span className="text-text-3">County</span>
          </div>
          {hoverCov.partnerId ? (
            <PartnerTag name={hoverCov.partnerName!} color={hoverCov.color!} refId={hoverCov.refId!} size="sm" className="mt-1" />
          ) : (
            <div className="mt-1 text-xs text-text-3">No partner covers {hoverCov.name}</div>
          )}
        </div>
      )}
    </div>
  );
}
