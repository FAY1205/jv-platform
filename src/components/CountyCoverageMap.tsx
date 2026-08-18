"use client";

import * as React from "react";
import type { StateCoverage, CountyCoverage } from "@/modules/coverage/map";
import { stateCodeForCounty } from "@/lib/geo/us-state-fips";
import { STATE_LABEL_ANCHORS, LABEL_CHIP_HEIGHT, labelChipWidth, type StateLabelAnchor } from "@/lib/geo/us-state-anchors";
import { PartnerTag } from "./PartnerTag";
import { Skeleton } from "./Skeleton";
import { MapHatch, MapCaption, PARTNER_FILL_OPACITY, DIMMED_FILL_OPACITY, type MapCaptionProps } from "./map";

interface CountyGeo {
  viewBox: string;
  counties: { f: string; n: string; d: string }[];
  borders: string;
}

export interface CountyCoverageMapProps {
  /** Per-state coverage (reused from the state view); a county with no ZIP-level owner below
   *  inherits its state's partner. */
  states: readonly StateCoverage[];
  /** WP-E (owner note #6): counties a partner covers via ZIPs. These color at county level and
   *  override the state fallback for that county. Omit for a pure state-level map. */
  counties?: readonly CountyCoverage[];
  selectedPartnerId?: string | null;
  onSelectPartner?: (partnerId: string | null) => void;
  /** Optional blurred title plate; WP-E pages supply the content. */
  caption?: MapCaptionProps;
  /** When false, render a static role="img" territory illustration — no zoom controls,
   *  wheel-zoom, drag-pan, or hover. Used on PHONES (VP-2), where the interactive map's
   *  `touch-none` would otherwise trap page-scroll, and anywhere a mouse-only pan would be
   *  a keyboard trap (SC 2.1.1). Defaults to true. */
  interactive?: boolean;
  /** Portal (WP-F.3): render non-covered states as a plain neutral fill instead of the
   *  `--warn` gap hatch. The partner's own dashboard shows "not yours" as calm land, never
   *  a coverage-gap alarm (an admin-only concern). Defaults to false (admin keeps the hatch). */
  neutralUncovered?: boolean;
  /** Override the SVG's accessible name (role="img"). Portal passes a scoped description
   *  ("your covered states"); admin keeps the default all-partner wording. */
  ariaLabel?: string;
  /** Hover copy for a state with NO entry coloring it. Defaults to the coverage wording
   *  ("No partner covers X"); the Unmatched gap map (T3) overrides it — there, an
   *  uncolored state means "no unmatched leads here", not "uncovered". */
  uncoveredHoverLabel?: (stateName: string) => string;
  /** Opt-in on-map state labels (WP-UX-4 / MAP-06, ADR-0050). Rendered as opaque `--surface`
   *  chips anchored by STATE_LABEL_ANCHORS. Absent (the default) ⇒ the layer renders NOTHING —
   *  /coverage, /dashboard and the portal keep byte-identical DOM. Only /unmatched passes it. */
  stateLabels?: readonly StateMapLabel[];
}

export interface StateMapLabel {
  /** USPS code — the key into STATE_LABEL_ANCHORS. An unknown code is skipped (dev warn). */
  code: string;
  /** The full label text, formatted by the page ("NE · 7"). The map formats nothing (PRN-15). */
  text: string;
}

// The chip splits its text at the FIRST " · " so the datum gets the max-contrast ink: the code
// reads as `--text-2`, the separator `--text-3`, the count `--text` at 600 (ADR-0050 / PRN-14).
// Pure — no measurement, no locale, same input ⇒ same output.
const LABEL_SEPARATOR = " · ";
function splitStateLabel(text: string): { head: string; tail: string | null } {
  const i = text.indexOf(LABEL_SEPARATOR);
  return i < 0 ? { head: text, tail: null } : { head: text.slice(0, i), tail: text.slice(i + LABEL_SEPARATOR.length) };
}

// Module-level cache so the ~0.9 MB geometry is fetched once per session.
let geoCache: CountyGeo | null = null;

/**
 * CountyCoverageMap (MAP-01) — a real US county choropleth. A county the partner covers by ZIP
 * (WP-E, `counties`) is filled at county level; every other county inherits its state's owner (the
 * state fallback). Geometry is a pre-projected static asset loaded on demand. 3,142 county paths
 * render once; hover/click use event delegation and a single highlight overlay so mouse-move never
 * re-renders the whole map.
 */
export function CountyCoverageMap({ states, counties = [], selectedPartnerId = null, onSelectPartner, caption, interactive = true, neutralUncovered = false, ariaLabel, uncoveredHoverLabel, stateLabels }: CountyCoverageMapProps) {
  const [geo, setGeo] = React.useState<CountyGeo | null>(geoCache);
  const [failed, setFailed] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<{ fips: string; name: string; x: number; y: number } | null>(null);
  const hatchId = React.useId();

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
  const byCounty = React.useMemo(() => new Map(counties.map((c) => [c.fips, c])), [counties]);
  const dByFips = React.useMemo(() => new Map((geo?.counties ?? []).map((c) => [c.f, c.d])), [geo]);
  const nameByFips = React.useMemo(() => new Map((geo?.counties ?? []).map((c) => [c.f, c.n])), [geo]);
  const covOfCounty = React.useCallback(
    (fips: string): StateCoverage | undefined => {
      const code = stateCodeForCounty(fips);
      const st = code ? byState.get(code) : undefined;
      // WP-E: a county the partner covers by ZIP takes that partner's color, overlaid on the
      // state entry (so the tooltip keeps the state name + lead count). ZIP beats state fallback.
      const cc = byCounty.get(fips);
      if (cc && st) {
        return { ...st, partnerId: cc.partnerId, partnerName: cc.partnerName, refId: cc.refId, color: cc.color, gap: false };
      }
      return st;
    },
    [byState, byCounty],
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
          fill={covered ? cov!.color! : neutralUncovered ? "var(--map-land)" : `url(#${hatchId})`}
          fillOpacity={dimmed ? DIMMED_FILL_OPACITY : covered ? PARTNER_FILL_OPACITY : 1}
          className={covered ? "cursor-pointer" : "cursor-default"}
        />
      );
    });
  }, [geo, covOfCounty, selectedPartnerId, hatchId, neutralUncovered]);

  // ── Zoom & pan (SVG transform on a group; strokes stay crisp via
  //    non-scaling-stroke). Drag to pan, wheel/buttons to zoom toward the cursor.
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const [vw, vh] = React.useMemo(() => {
    const p = (geo?.viewBox ?? "0 0 960 600").split(" ").map(Number);
    return [p[2] || 960, p[3] || 600];
  }, [geo]);
  const drag = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const clampView = React.useCallback(
    (v: { s: number; x: number; y: number }) => {
      const s = Math.min(6, Math.max(1, v.s));
      if (s === 1) return { s: 1, x: 0, y: 0 };
      return { s, x: Math.min(0, Math.max(vw * (1 - s), v.x)), y: Math.min(0, Math.max(vh * (1 - s), v.y)) };
    },
    [vw, vh],
  );

  const zoomAt = (factor: number, cxPx: number, cyPx: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cvx = (cxPx / rect.width) * vw;
    const cvy = (cyPx / rect.height) * vh;
    setView((v) => {
      const s2 = Math.min(6, Math.max(1, v.s * factor));
      const px = (cvx - v.x) / v.s;
      const py = (cvy - v.y) / v.s;
      return clampView({ s: s2, x: cvx - px * s2, y: cvy - py * s2 });
    });
  };

  // Non-passive wheel listener so zooming the map doesn't also scroll the page.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebind when geometry (vw/vh) is ready
  }, [geo, vw, vh, interactive]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    if (view.s > 1) setDragging(true);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    setDragging(false);
    if (!wasDrag) {
      const fips = (e.target as Element).getAttribute?.("data-fips");
      if (fips) onSelectPartner?.(covOfCounty(fips)?.partnerId ?? null);
    }
  };

  const onMove = (e: React.MouseEvent | React.PointerEvent) => {
    if (drag.current) {
      const rect = wrapRef.current!.getBoundingClientRect();
      const dx = ((e.clientX - drag.current.x) / rect.width) * vw;
      const dy = ((e.clientY - drag.current.y) / rect.height) * vh;
      if (Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 2) drag.current.moved = true;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      if (hover) setHover(null);
      setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }));
      return;
    }
    const el = e.target as Element;
    const fips = el.getAttribute?.("data-fips");
    if (!fips || !wrapRef.current) {
      if (hover) setHover(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    // Clamp the tooltip anchor inside the map card so the bubble (max-w 240px, centered
    // on x; rendered above y) never clips at the card edges — the dashboard's NE-corner
    // states used to push it out of the card.
    const halfW = Math.min(128, rect.width / 2);
    const x = Math.min(Math.max(e.clientX - rect.left, halfW), rect.width - halfW);
    const y = Math.max(e.clientY - rect.top, 64);
    setHover({ fips, name: el.getAttribute("data-name") ?? "", x, y });
  };

  // ── Opt-in state-label layer (MAP-06, ADR-0050) ─────────────────────────────────────────
  // Resolve each label to its committed anchor. Recomputes only when the (memoized) label
  // array or the zoom scale changes — nothing here listens to hover or pointer state.
  const anchored = React.useMemo(() => {
    if (!stateLabels) return null;
    const out: { code: string; text: string; anchor: StateLabelAnchor }[] = [];
    for (const l of stateLabels) {
      const anchor: StateLabelAnchor | undefined = STATE_LABEL_ANCHORS[l.code];
      if (!anchor) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`CountyCoverageMap: no label anchor for state code "${l.code}" — label skipped.`);
        }
        continue;
      }
      out.push({ code: l.code, text: l.text, anchor });
    }
    return out;
  }, [stateLabels]);

  if (failed) {
    return <p className="py-10 text-center text-sm text-text-3">Couldn&apos;t load the county map.</p>;
  }
  if (!geo) {
    return <Skeleton className="aspect-[960/600] w-full rounded-xl" />;
  }

  const hoverCov = hover ? covOfCounty(hover.fips) : null;
  const hoverName = hover ? nameByFips.get(hover.fips) ?? "" : "";

  const transform = `translate(${view.x} ${view.y}) scale(${view.s})`;
  const zoomBtn = "grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-text-2 shadow-sm transition-colors hover:bg-surface-2 disabled:opacity-40";

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={geo.viewBox}
        className={`w-full${interactive ? " touch-none" : ""}`}
        role="img"
        aria-label={ariaLabel ?? "United States county coverage map, colored by partner"}
        style={{ cursor: interactive && view.s > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onMove : undefined}
        onPointerUp={interactive ? onPointerUp : undefined}
        onPointerLeave={interactive ? () => { drag.current = null; setDragging(false); setHover(null); } : undefined}
      >
        <MapHatch id={hatchId} />
        <g transform={transform}>
          {countyPaths}
          {/* State borders — non-scaling so they stay crisp when zoomed */}
          <path d={geo.borders} fill="none" stroke="var(--map-line)" strokeWidth={0.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" opacity={0.9} />
          {hover && dByFips.get(hover.fips) && (
            <path d={dByFips.get(hover.fips)!} fill="none" stroke="var(--text)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}
          {/* State labels — LAST child of the zoom group, so a chip is never occluded by the
              hover outline. `pointerEvents: none` keeps the data-fips hover/click delegation
              working straight through the layer; `aria-hidden` because the SVG is already
              role="img" and the page's chip row + stat tiles are the accessible path
              (ADR-0050). Every leader is drawn BEFORE every chip so a converging leader can
              never cut across a neighbouring chip. */}
          {anchored && anchored.length > 0 && (
            <g data-map-labels="" aria-hidden="true" pointerEvents="none" fontFamily="var(--font-mono)" fontSize={13} textAnchor="middle">
              {anchored.map(({ code, anchor }) =>
                anchor.leader ? (
                  <line
                    key={`leader-${code}`}
                    x1={anchor.leader.x}
                    y1={anchor.leader.y}
                    x2={anchor.x}
                    y2={anchor.y}
                    stroke="var(--text-3)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    opacity={0.8}
                  />
                ) : null,
              )}
              {anchored.map(({ code, text, anchor }) => {
                const w = labelChipWidth(text);
                const { head, tail } = splitStateLabel(text);
                return (
                  // translate glues the chip to the geometry; scale(1/view.s) holds it at a
                  // constant 13px at every zoom — the text counterpart of the borders'
                  // non-scaling-stroke. The chip is centered on the anchor, so it always
                  // covers its leader's terminus.
                  <g key={code} data-map-label={code} transform={`translate(${anchor.x} ${anchor.y}) scale(${1 / view.s})`}>
                    <rect
                      x={-w / 2}
                      y={-LABEL_CHIP_HEIGHT / 2}
                      width={w}
                      height={LABEL_CHIP_HEIGHT}
                      rx={4}
                      fill="var(--surface)"
                      stroke="var(--border-strong)"
                      strokeWidth={1}
                    />
                    <text y={4.5} className="num">
                      {tail === null ? (
                        <tspan fill="var(--text)" fontWeight={600}>{text}</tspan>
                      ) : (
                        <>
                          <tspan fill="var(--text-2)">{head}</tspan>
                          <tspan fill="var(--text-3)">{LABEL_SEPARATOR}</tspan>
                          <tspan fill="var(--text)" fontWeight={600}>{tail}</tspan>
                        </>
                      )}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </g>
      </svg>

      {caption && <MapCaption {...caption} />}

      {/* Zoom controls — omitted in static (non-interactive) mode. WP-UX-4 (audit D-4/C-3):
          bottom-right, not top-right — the top corner collided with the caption plate on
          narrow maps and clipped against tight card tops (the dashboard's sliced "−"). */}
      {interactive && (
      <div className="absolute bottom-2 right-2 flex flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" className={zoomBtn} onClick={() => zoomAt(1.4, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" aria-label="Zoom out" className={zoomBtn} disabled={view.s <= 1} onClick={() => zoomAt(1 / 1.4, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        {view.s > 1 && (
          <button type="button" aria-label="Reset zoom" className={zoomBtn} onClick={() => setView({ s: 1, x: 0, y: 0 })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" /><path d="M3 3v5h5" /></svg>
          </button>
        )}
      </div>
      )}

      {hover && hoverCov && (
        <div
          className="anim-fade pointer-events-none absolute z-10 w-max max-w-[240px] -translate-x-1/2 -translate-y-[125%] rounded-xl border border-border bg-surface px-3 py-2 shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="text-sm font-semibold text-text">
            {hoverName} <span className="text-text-3">County · {hoverCov.name}</span>
          </div>
          {hoverCov.partnerId ? (
            <PartnerTag name={hoverCov.partnerName!} color={hoverCov.color!} refId={hoverCov.refId ?? undefined} size="sm" className="mt-1" />
          ) : (
            <div className="mt-1 text-xs text-text-3">
              {uncoveredHoverLabel ? uncoveredHoverLabel(hoverCov.name) : `No partner covers ${hoverCov.name}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
