# WP-D — Survey Maps Reskin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the two map components (`CoverageMap` hex, `CountyCoverageMap` county) to the Survey identity — amber uncovered hatch, ~0.9 partner fills, blurred caption plate, centralized on-fill contrast — with no page-body changes.

**Architecture:** A new internal `src/components/map/` module holds the shared visuals (`MapHatch` pattern, `MapCaption` plate, `PARTNER_FILL_OPACITY` constant); both maps consume it so they stay identical across themes. The only real logic is the pure on-fill contrast layer in `lib/contrast.ts` (extended with `contrastHalo`), which is TDD'd first. Keyboard access stays the page-level companion-list pattern (R3 WS-8) — unchanged.

**Tech Stack:** Next.js 15 / React 19, TypeScript, Tailwind v4 semantic tokens, Vitest + @testing-library/react (jsdom), SVG.

**Spec:** `docs/superpowers/specs/2026-07-11-wp-d-maps-survey-design.md`

## Global Constraints

- **PRN-12:** no hardcoded hex/rgba/font in component code — consume tokens from `lib/tokens` / CSS vars. Computed a11y colors (`contrastText`/`contrastHalo`) live in `lib/contrast.ts`, not components.
- **PRN-14:** partner color never the sole signal — swatch always paired with name + `JV-###` (`PartnerTag`); uncovered is a **texture** (hatch) channel, gap adds ring + marker + tooltip text.
- **PRN-01:** `src/modules/coverage/map.ts` stays a pure view-model — do not touch it.
- **MAP-01 / MAP-02 (R3 WS-8):** maps are `role="img"` + descriptive `aria-label`; the page's keyboard companion is the keyboard path. Do not add SVG-internal focus nav.
- **Env:** run vitest **serially** — `--no-file-parallelism`, one instance (two jsdom runs OOM the machine). `prefers-reduced-motion` already handled globally in `globals.css` — no per-component gating.
- **Commit discipline:** **one commit for the whole WP** (owner rule) — tasks below end at green tests, NOT per-task commits. The single commit is Task 6.
- Test names carry requirement IDs (`MAP-01`, `F-19`).

---

### Task 1: `contrastHalo` + partner-swatch contrast coverage (pure logic, TDD)

Moves the raw `rgba()` halos out of `CoverageMap` into a pure, tested helper; proves the ~0.9 fill opacity is safe for on-fill labels.

**Files:**
- Modify: `src/lib/contrast.ts` (add `contrastHalo`)
- Test: `tests/unit/contrast.test.ts` (extend)

**Interfaces:**
- Consumes: `contrastText(hex: string): "#111111" | "#ffffff"` (existing), `PARTNER_SWATCHES` from `@/lib/tokens/tokens`, `PARTNER_FILL_OPACITY` from `@/components/map/mapStyle` (Task 2 — but the constant is a literal `0.9`; if running Task 1 first, inline `0.9` and swap the import in Task 2).
- Produces: `contrastHalo(hex: string): string` — the translucent halo tone opposite the label.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/contrast.test.ts`:

```ts
import { contrastText, contrastHalo } from "@/lib/contrast";
import { PARTNER_SWATCHES } from "@/lib/tokens/tokens";

const PARTNER_FILL_OPACITY = 0.9; // mirror of the shared constant (Task 2)

// Per-channel sRGB composite of a fill at `opacity` over a solid surface — what a
// renderer actually shows for fill-opacity. Used to prove the label pick is stable.
function composite(fillHex: string, opacity: number, overHex: string): string {
  const rgb = (h: string) => {
    const s = h.replace(/^#/, "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const [fr, fg, fb] = rgb(fillHex);
  const [br, bg, bb] = rgb(overHex);
  const mix = (f: number, b: number) => Math.round(f * opacity + b * (1 - opacity));
  const h2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h2(mix(fr, br))}${h2(mix(fg, bg))}${h2(mix(fb, bb))}`;
}

describe("contrastText on partner swatches (F-19)", () => {
  it("F-19: picks a black-or-white on-fill label for every partner swatch", () => {
    for (const hex of PARTNER_SWATCHES) {
      expect(["#111111", "#ffffff"]).toContain(contrastText(hex));
    }
  });

  it("F-19: ~0.9 fill opacity never flips the label choice in either theme", () => {
    const LIGHT_SURFACE = "#ffffff";
    const DARK_SURFACE = "#17232a";
    for (const hex of PARTNER_SWATCHES) {
      const solid = contrastText(hex);
      expect(contrastText(composite(hex, PARTNER_FILL_OPACITY, LIGHT_SURFACE))).toBe(solid);
      expect(contrastText(composite(hex, PARTNER_FILL_OPACITY, DARK_SURFACE))).toBe(solid);
    }
  });
});

describe("contrastHalo (F-19)", () => {
  it("F-19: returns the opposite translucent tone to the chosen label", () => {
    expect(contrastHalo("#000000")).toBe("rgba(0,0,0,0.3)"); // white label → dark halo
    expect(contrastHalo("#ffffff")).toBe("rgba(255,255,255,0.6)"); // dark label → light halo
  });

  it("F-19: pairs with contrastText for every partner swatch", () => {
    for (const hex of PARTNER_SWATCHES) {
      const expected = contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
      expect(contrastHalo(hex)).toBe(expected);
    }
  });

  it("falls back to the dark-label pairing on unparseable input (never throws)", () => {
    expect(contrastHalo("not-a-color")).toBe("rgba(255,255,255,0.6)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/contrast.test.ts --no-file-parallelism`
Expected: FAIL — `contrastHalo is not a function` / import error.

- [ ] **Step 3: Implement `contrastHalo`** — append to `src/lib/contrast.ts`:

```ts
/**
 * Translucent halo tone that lifts an on-fill label off a busy partner fill.
 * Opposite tonal family to the label (WCAG-picked by contrastText): white label
 * (dark fill) → dark halo; dark label (light fill) → light halo. Pure; never throws.
 */
export function contrastHalo(hex: string): string {
  return contrastText(hex) === "#ffffff" ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.6)";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/contrast.test.ts --no-file-parallelism`
Expected: PASS (all describes). If the 0.9-opacity test flips for a specific swatch, that swatch sits on the luminance crossover — handle by compositing that fill before `contrastText` in the component and note it; do not weaken the assertion.

- [ ] **Step 5: Typecheck** — Run: `pnpm run typecheck` → Expected: no errors. (No commit — WP commits once at the end.)

---

### Task 2: Shared map internals (`src/components/map/`)

**Files:**
- Create: `src/components/map/mapStyle.ts`
- Create: `src/components/map/MapHatch.tsx`
- Create: `src/components/map/MapCaption.tsx`
- Create: `src/components/map/index.ts`
- Test: `tests/unit/components/map-internals.test.tsx`

**Interfaces:**
- Produces:
  - `PARTNER_FILL_OPACITY: number` (= `0.9`)
  - `MapHatch({ id }: { id: string }): JSX.Element` — renders `<defs><pattern id=…>`
  - `MapCaption(props: MapCaptionProps): JSX.Element`
  - `MapCaptionProps = { title: string; subtitle?: string }`

- [ ] **Step 1: Write the failing test** — `tests/unit/components/map-internals.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MapHatch, MapCaption } from "@/components/map";

afterEach(() => cleanup());

describe("MAP-01: MapHatch", () => {
  it("MAP-01: renders a <pattern> with the supplied id", () => {
    const { container } = render(<svg><MapHatch id="hx1" /></svg>);
    expect(container.querySelector("pattern#hx1")).toBeInTheDocument();
  });
});

describe("MAP-01: MapCaption", () => {
  it("MAP-01: always renders the title", () => {
    render(<MapCaption title="United States" />);
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("MAP-01: renders the subtitle only when provided", () => {
    const { rerender } = render(<MapCaption title="United States" />);
    expect(screen.queryByText("50 states")).toBeNull();
    rerender(<MapCaption title="United States" subtitle="50 states" />);
    expect(screen.getByText("50 states")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/components/map-internals.test.tsx --no-file-parallelism`
Expected: FAIL — cannot resolve `@/components/map`.

- [ ] **Step 3: Create the module.**

`src/components/map/mapStyle.ts`:
```ts
// Shared Survey map styling (WP-D). Consumed by CoverageMap (hex) and
// CountyCoverageMap (county) so the two maps read identically in both themes.

/** Covered-territory fill opacity — the survey-paper softening (DIRECTION §Signature). */
export const PARTNER_FILL_OPACITY = 0.9;
```

`src/components/map/MapHatch.tsx`:
```tsx
import * as React from "react";

/**
 * Uncovered-territory hatch (WP-D). Diagonal amber survey hatch — `--warn` lines
 * over a `--warn-soft` wash. `userSpaceOnUse` keeps the lines continuous across
 * county borders within a multi-county uncovered state. Render one per <svg> with
 * a React.useId() id, then fill uncovered shapes with `url(#id)`. Texture, not
 * color alone (PRN-14).
 */
export function MapHatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill="var(--warn-soft)" />
        <line x1={0} y1={0} x2={0} y2={6} stroke="var(--warn)" strokeWidth={1} />
      </pattern>
    </defs>
  );
}
```

`src/components/map/MapCaption.tsx`:
```tsx
import * as React from "react";

export interface MapCaptionProps {
  title: string;
  subtitle?: string;
}

/**
 * Blurred map title plate (WP-D — the mockups' `.mapcap`). Absolutely placed in
 * the map's top-left; the parent map owns the `relative` wrapper. The component
 * owns the chrome + type treatment (Fraunces title / 13px mono subtitle — ≥13px
 * per the WP-A/C no-tiny-chrome rule); pages pass content in WP-E. Tokenized,
 * theme-aware. `pointer-events-none` so it never blocks map interaction.
 */
export function MapCaption({ title, subtitle }: MapCaptionProps) {
  return (
    <div
      className="pointer-events-none absolute left-3.5 top-3.5 rounded-xl border border-border px-3.5 py-2"
      style={{
        background: "color-mix(in srgb, var(--surface) 88%, transparent)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div className="font-display text-[1.3rem] font-semibold leading-tight tracking-tight text-balance">
        {title}
      </div>
      {subtitle && (
        <div className="num mt-0.5 text-[.8125rem] tracking-[.04em] text-text-3">{subtitle}</div>
      )}
    </div>
  );
}
```

`src/components/map/index.ts`:
```ts
export { PARTNER_FILL_OPACITY } from "./mapStyle";
export { MapHatch } from "./MapHatch";
export { MapCaption, type MapCaptionProps } from "./MapCaption";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/components/map-internals.test.tsx --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Typecheck** — Run: `pnpm run typecheck` → Expected: no errors.

---

### Task 3: Reskin `CoverageMap.tsx` (hex)

**Files:**
- Modify: `src/components/CoverageMap.tsx`
- Test: `tests/unit/components/coverage-maps.test.tsx` (create)

**Interfaces:**
- Consumes: `contrastText`, `contrastHalo` from `@/lib/contrast`; `MapHatch`, `MapCaption`, `MapCaptionProps`, `PARTNER_FILL_OPACITY` from `./map`.
- Produces: `CoverageMapProps` gains `caption?: MapCaptionProps`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/components/coverage-maps.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CoverageMap } from "@/components/CoverageMap";
import { contrastText } from "@/lib/contrast";
import type { StateCoverage } from "@/modules/coverage/map";

function stateRow(over: Partial<StateCoverage> & Pick<StateCoverage, "code" | "name">): StateCoverage {
  return {
    code: over.code,
    name: over.name,
    partnerId: over.partnerId ?? null,
    partnerName: over.partnerName ?? null,
    refId: over.refId ?? null,
    color: over.color ?? null,
    leadCount: over.leadCount ?? 0,
    gap: over.gap ?? false,
  };
}

const COVERED = stateRow({ code: "CA", name: "California", partnerId: "p1", partnerName: "Acme", refId: "JV-001", color: "#5B7A9E", leadCount: 3 });
const GAP = stateRow({ code: "TX", name: "Texas", gap: true, leadCount: 5 });

afterEach(() => cleanup());

describe("MAP-01: CoverageMap (hex) — Survey reskin", () => {
  it("MAP-01: defines the uncovered hatch pattern", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    expect(container.querySelector("pattern")).toBeInTheDocument();
  });

  it("MAP-01: fills uncovered states with the hatch (url reference)", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const hatched = [...container.querySelectorAll("polygon")].filter((p) =>
      (p.getAttribute("fill") || "").startsWith("url(#"),
    );
    expect(hatched.length).toBeGreaterThan(0);
  });

  it("MAP-01: keeps the warn ring + marker dot on gap states only", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const dashed = [...container.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke-dasharray"));
    expect(dashed.length).toBe(1); // only TX gap
    expect(container.querySelector("circle")).toBeInTheDocument(); // marker dot
  });

  it("MAP-01: labels covered states via the shared contrast picker (F-19)", () => {
    const { container } = render(<CoverageMap states={[COVERED, GAP]} />);
    const ca = [...container.querySelectorAll("text")].find((t) => t.textContent === "CA")!;
    expect(ca.style.fill).toBe(contrastText("#5B7A9E"));
  });

  it("MAP-01: exposes role=img with a descriptive label", () => {
    render(<CoverageMap states={[COVERED, GAP]} />);
    expect(screen.getByRole("img", { name: /coverage map/i })).toBeInTheDocument();
  });

  it("MAP-01: renders the caption plate only when a caption is provided", () => {
    const { rerender } = render(<CoverageMap states={[COVERED]} />);
    expect(screen.queryByText("United States")).toBeNull();
    rerender(<CoverageMap states={[COVERED]} caption={{ title: "United States", subtitle: "50 states" }} />);
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(screen.getByText("50 states")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/components/coverage-maps.test.tsx --no-file-parallelism`
Expected: FAIL — no `pattern` element / `caption` prop unknown / label still `#ffffff` for a light fill.

- [ ] **Step 3: Apply the reskin.** Replace the body of `src/components/CoverageMap.tsx` with:

```tsx
"use client";

import * as React from "react";
import { US_HEX_STATES, HEX_VIEWBOX } from "@/lib/geo/us-hexgrid";
import type { StateCoverage } from "@/modules/coverage/map";
import { contrastText, contrastHalo } from "@/lib/contrast";
import { PartnerTag } from "./PartnerTag";
import { MapHatch, MapCaption, PARTNER_FILL_OPACITY, type MapCaptionProps } from "./map";

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
 * labeled with its 2-letter code (on-fill color via the shared contrast picker,
 * F-19); the hover card and page legend add partner name + JV ref. Keyboard access
 * is the page's companion list (R3 WS-8) — the map is role=img.
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
              style={{ opacity: dimmed ? 0.28 : 1, transition: "opacity 150ms" }}
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/components/coverage-maps.test.tsx --no-file-parallelism`
Expected: PASS (6 tests). (If `ca.style.fill` normalizes unexpectedly in jsdom, assert `expect(["#111111","#ffffff"]).toContain(ca.style.fill)` — still proves F-19.)

- [ ] **Step 5: Typecheck** — Run: `pnpm run typecheck` → Expected: no errors.

---

### Task 4: Reskin `CountyCoverageMap.tsx` (county)

**Files:**
- Modify: `src/components/CountyCoverageMap.tsx`
- Test: `tests/unit/components/coverage-maps.test.tsx` (append county describe)

**Interfaces:**
- Consumes: `MapHatch`, `MapCaption`, `MapCaptionProps`, `PARTNER_FILL_OPACITY` from `./map`.
- Produces: `CountyCoverageMapProps` gains `caption?: MapCaptionProps`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/components/coverage-maps.test.tsx`:

```tsx
import { beforeEach, vi, waitFor } from "vitest";
import { CountyCoverageMap } from "@/components/CountyCoverageMap";
import { PARTNER_FILL_OPACITY } from "@/components/map";

describe("MAP-01: CountyCoverageMap (county) — Survey reskin", () => {
  const GEO = {
    viewBox: "0 0 960 600",
    counties: [
      { f: "06001", n: "Alameda", d: "M0 0h10v10h-10z" }, // CA
      { f: "48001", n: "Anderson", d: "M20 0h10v10h-10z" }, // TX
    ],
    borders: "M0 0h960v600h-960z",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(GEO) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("MAP-01: defines the hatch and fills uncovered counties with it", async () => {
    const { container } = render(<CountyCoverageMap states={[]} />);
    await waitFor(() => expect(container.querySelectorAll("path[data-fips]").length).toBe(2));
    expect(container.querySelector("pattern")).toBeInTheDocument();
    const hatched = [...container.querySelectorAll("path[data-fips]")].filter((p) =>
      (p.getAttribute("fill") || "").startsWith("url(#"),
    );
    expect(hatched.length).toBe(2);
  });

  it("MAP-01: softens covered counties to the shared fill opacity", async () => {
    const states: StateCoverage[] = [
      stateRow({ code: "CA", name: "California", partnerId: "p1", partnerName: "Acme", refId: "JV-001", color: "#5B7A9E" }),
    ];
    const { container } = render(<CountyCoverageMap states={states} />);
    await waitFor(() => expect(container.querySelectorAll("path[data-fips]").length).toBe(2));
    const covered = container.querySelector('path[data-fips="06001"]')!;
    expect(covered.getAttribute("fill-opacity")).toBe(String(PARTNER_FILL_OPACITY));
    const uncovered = container.querySelector('path[data-fips="48001"]')!;
    expect((uncovered.getAttribute("fill") || "").startsWith("url(#")).toBe(true);
  });

  it("MAP-01: exposes role=img and renders a caption when provided", async () => {
    render(<CountyCoverageMap states={[]} caption={{ title: "United States", subtitle: "county coverage" }} />);
    expect(await screen.findByRole("img", { name: /county coverage map/i })).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/components/coverage-maps.test.tsx --no-file-parallelism`
Expected: FAIL — uncovered counties still `var(--surface-3)`, no `pattern`, `caption` prop unknown.

- [ ] **Step 3: Apply the reskin.** Four edits in `src/components/CountyCoverageMap.tsx`:

**(a)** Add imports after the `Skeleton` import (line 7):
```tsx
import { MapHatch, MapCaption, PARTNER_FILL_OPACITY, type MapCaptionProps } from "./map";
```

**(b)** Add the `caption` prop to the interface:
```tsx
export interface CountyCoverageMapProps {
  /** Per-state coverage (reused from the state view); counties inherit their state's partner. */
  states: readonly StateCoverage[];
  selectedPartnerId?: string | null;
  onSelectPartner?: (partnerId: string | null) => void;
  /** Optional blurred title plate; WP-E pages supply the content. */
  caption?: MapCaptionProps;
}
```
and destructure it in the signature:
```tsx
export function CountyCoverageMap({ states, selectedPartnerId = null, onSelectPartner, caption }: CountyCoverageMapProps) {
```

**(c)** Add `const hatchId = React.useId();` next to the other hooks (e.g. after the `hover` state), and update `countyPaths` — uncovered → hatch, covered → shared opacity:
```tsx
  const hatchId = React.useId();

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
          data-name={c.n}
          fill={covered ? cov!.color! : `url(#${hatchId})`}
          fillOpacity={dimmed ? 0.25 : covered ? PARTNER_FILL_OPACITY : 1}
          className={covered ? "cursor-pointer" : "cursor-default"}
        />
      );
    });
  }, [geo, covOfCounty, selectedPartnerId, hatchId]);
```
> Note: `data-name={c.n}` is added so the hover tooltip's `el.getAttribute("data-name")` resolves (it currently reads an attribute the paths never set — harmless pre-existing bug; the name is re-derived from `nameByFips` anyway, so this is a low-risk correctness tidy-up, not scope creep). If you prefer zero behavior change, omit `data-name` — the tests do not depend on it.

**(d)** Render `<MapHatch>` as the first child of `<svg>` (right after the opening `<svg …>` tag, before `<g transform={transform}>`):
```tsx
      >
        <MapHatch id={hatchId} />
        <g transform={transform}>
```
and render the caption inside the outer wrapper — add right after the closing `</svg>` (before the zoom-controls `<div>`):
```tsx
      </svg>

      {caption && <MapCaption {...caption} />}

      {/* Zoom controls */}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/components/coverage-maps.test.tsx --no-file-parallelism`
Expected: PASS (all hex + county describes).

- [ ] **Step 5: Typecheck** — Run: `pnpm run typecheck` → Expected: no errors.

---

### Task 5: Full serial suite + lint + raw-value grep

**Files:** none (verification only).

- [ ] **Step 1: Lint** — Run: `pnpm run lint` → Expected: clean (watch for `react-hooks/exhaustive-deps` on the county `countyPaths` memo — `hatchId` is in the dep array).

- [ ] **Step 2: PRN-12 raw-value grep** — Run:
`git diff --unified=0 -- src/components/CoverageMap.tsx src/components/CountyCoverageMap.tsx | grep -nE '^\+' | grep -iE 'rgba\(|#[0-9a-f]{3,6}'`
Expected: **no matches** (no raw hex/rgba added in component code; partner `color` values come from data, not literals).

- [ ] **Step 3: Full unit suite, serial** — Run: `pnpm exec vitest run tests/unit --no-file-parallelism`
Expected: PASS, no regressions (contrast, map-internals, coverage-maps, plus the existing WP-A/B/C suites).

---

### Task 6: Self-audit, review, walkthrough, single commit

**Files:** none until the commit.

- [ ] **Step 1: PLAYBOOK §6 self-audit** — read `docs/PLAYBOOK.md` §6, fill the checklist against this diff, print it in the summary.

- [ ] **Step 2: pr-reviewer on the diff** — dispatch the `pr-reviewer` agent scoped to the WP-D diff; triage findings; fix any correctness/spec issues.

- [ ] **Step 3: `/audit frontend` on the diff** — run the frontend audit (pr-reviewer + audit-design-system + audit-a11y); address findings (expect checks on PRN-12 token discipline, theme parity, and MAP-02 keyboard companion).

- [ ] **Step 4: Owner walkthrough** — build a `visualize` widget showing both maps (covered fills, amber hatch, gap ring+marker, caption plate) in **light and dark** (the browser-preview renderer is env-blocked, so no live screenshot). Get owner sign-off.

- [ ] **Step 5: Single WP-D commit** (after sign-off):
```bash
git add src/lib/contrast.ts tests/unit/contrast.test.ts \
        src/components/map/ tests/unit/components/map-internals.test.tsx \
        src/components/CoverageMap.tsx src/components/CountyCoverageMap.tsx \
        tests/unit/components/coverage-maps.test.tsx \
        docs/superpowers/specs/2026-07-11-wp-d-maps-survey-design.md \
        docs/superpowers/plans/2026-07-11-wp-d-maps-survey.md
git commit -m "$(cat <<'EOF'
feat(wp-d): Survey maps — amber uncovered hatch, ~0.9 fills, caption plate (F-19)

Reskin CoverageMap (hex) + CountyCoverageMap (county) to the Survey identity:
uncovered territory as a --warn diagonal hatch (texture, PRN-14), covered fills
at 0.9 opacity, blurred .mapcap caption plate behind an optional prop, and the
on-fill label contrast centralized in lib/contrast (contrastText + new
contrastHalo) — removes the raw rgba() halos from CoverageMap (PRN-12). Gap
states keep the dashed --warn ring + marker. Shared visuals live in
src/components/map (MapHatch, MapCaption, PARTNER_FILL_OPACITY). Keyboard access
stays the page companion-list pattern (R3 WS-8 / MAP-02); role=img retained.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- §2 Hatch (hybrid) → Task 2 `MapHatch`, Task 3 (hex uncovered→hatch + gap ring kept), Task 4 (county uncovered→hatch). ✓
- §2 Caption (optional prop) → Task 2 `MapCaption`, Tasks 3/4 wire the prop. ✓
- §2 Consolidation (`src/components/map/`) → Task 2. ✓
- §2 Keyboard/hover (companion-list) → unchanged by construction; `role="img"` asserted in Tasks 3/4. ✓
- §3 `contrastHalo` in `lib/contrast` → Task 1. ✓
- §5 PRN-12 (no raw hex/rgba in components) → Task 1 relocates halos; Task 5 Step 2 greps to prove it. ✓
- §6 Test plan (contrastText over swatches, 0.9 stability, contrastHalo; component branch tests) → Tasks 1–4. ✓
- §7 DoD (typecheck/lint/serial-green/both themes/self-audit/pr-review/audit/walkthrough/one commit) → Tasks 5–6. ✓

**Placeholder scan:** none — every code/test step carries complete content.

**Type consistency:** `PARTNER_FILL_OPACITY` (number), `MapCaptionProps = {title; subtitle?}`, `MapHatch({id})`, `contrastHalo(hex): string` — used identically in Tasks 1–4. County memo dep array includes `hatchId`. ✓
