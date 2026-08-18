import { describe, expect, it } from "vitest";
import { STATE_FIPS_TO_CODE } from "@/lib/geo/us-state-fips";
import {
  STATE_LABEL_ANCHORS,
  LABEL_CHIP_HEIGHT,
  LABEL_CHIP_WIDTH_MAX,
  labelChipWidth,
} from "@/lib/geo/us-state-anchors";

// WP-UX-4 / ADR-0050. The anchor table is committed DATA (PRN-10) generated offline from the
// county geometry, so it can only be trusted as far as its structural invariants are pinned:
// it must cover exactly the states the geometry knows about, sit inside the viewBox, and be
// spaced so the worst-case chip pair can never overlap — which is what buys the map a static
// table instead of a runtime collision solver.

const VIEWBOX_W = 960;
const VIEWBOX_H = 600;
const CALLOUTS = ["CT", "DC", "DE", "MA", "MD", "NH", "NJ", "RI", "VT"] as const;

describe("MAP-06: us-state-anchors label table", () => {
  it("PRN-10/MAP-06: 51 anchors whose keys are exactly the STATE_FIPS_TO_CODE value set", () => {
    const keys = Object.keys(STATE_LABEL_ANCHORS).sort();
    const fipsCodes = [...new Set(Object.values(STATE_FIPS_TO_CODE))].sort();

    expect(keys).toHaveLength(51); // 50 states + DC
    expect(fipsCodes).toHaveLength(51);
    expect(keys).toEqual(fipsCodes);
  });

  it("PRN-10/MAP-06: every anchor and leader point lies inside the 0 0 960 600 viewBox", () => {
    for (const [code, a] of Object.entries(STATE_LABEL_ANCHORS)) {
      expect(a.x, `${code}.x`).toBeGreaterThan(0);
      expect(a.x, `${code}.x`).toBeLessThan(VIEWBOX_W);
      expect(a.y, `${code}.y`).toBeGreaterThan(0);
      expect(a.y, `${code}.y`).toBeLessThan(VIEWBOX_H);
      if (a.leader) {
        expect(a.leader.x, `${code}.leader.x`).toBeGreaterThan(0);
        expect(a.leader.x, `${code}.leader.x`).toBeLessThan(VIEWBOX_W);
        expect(a.leader.y, `${code}.leader.y`).toBeGreaterThan(0);
        expect(a.leader.y, `${code}.leader.y`).toBeLessThan(VIEWBOX_H);
      }
    }
  });

  it("MAP-06: the callout set is exactly {CT,DC,DE,MA,MD,NH,NJ,RI,VT}", () => {
    const withLeader = Object.entries(STATE_LABEL_ANCHORS)
      .filter(([, a]) => a.leader !== undefined)
      .map(([code]) => code)
      .sort();
    expect(withLeader).toEqual([...CALLOUTS]);
  });

  it("MAP-06: the callout column is a fixed N→S stack with ≥ 24 units of vertical spacing", () => {
    // Fixed order, so the stack is deterministic and never needs a runtime solver.
    const order = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
    const ys = order.map((c) => STATE_LABEL_ANCHORS[c].y);
    const xs = order.map((c) => STATE_LABEL_ANCHORS[c].x);

    expect(new Set(xs).size).toBe(1); // one column
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1], `${order[i - 1]} → ${order[i]}`).toBeGreaterThanOrEqual(24);
    }
  });

  it("MAP-06: no two anchors' worst-case chip rects overlap at s = 1", () => {
    const entries = Object.entries(STATE_LABEL_ANCHORS);
    const collisions: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [ca, a] = entries[i];
        const [cb, b] = entries[j];
        if (Math.abs(a.x - b.x) < LABEL_CHIP_WIDTH_MAX && Math.abs(a.y - b.y) < LABEL_CHIP_HEIGHT) {
          collisions.push(`${ca}/${cb}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("MAP-06: no worst-case chip clips the viewBox edge", () => {
    for (const [code, a] of Object.entries(STATE_LABEL_ANCHORS)) {
      expect(a.x - LABEL_CHIP_WIDTH_MAX / 2, `${code} left`).toBeGreaterThanOrEqual(0);
      expect(a.x + LABEL_CHIP_WIDTH_MAX / 2, `${code} right`).toBeLessThanOrEqual(VIEWBOX_W);
      expect(a.y - LABEL_CHIP_HEIGHT / 2, `${code} top`).toBeGreaterThanOrEqual(0);
      expect(a.y + LABEL_CHIP_HEIGHT / 2, `${code} bottom`).toBeLessThanOrEqual(VIEWBOX_H);
    }
  });

  it("MAP-06: anchors land on their own state — spot-checked against the US map's geography", () => {
    // Coarse geographic sanity: the mainland reads left→right west→east, top→bottom north→south
    // in this projection. These pins catch a regenerate that silently shifts the whole table.
    const a = STATE_LABEL_ANCHORS;
    expect(a.TX.x).toBeGreaterThan(430); // Texas: lower-middle
    expect(a.TX.x).toBeLessThan(560);
    expect(a.TX.y).toBeGreaterThan(400);
    expect(a.TX.y).toBeLessThan(540);

    expect(a.ME.x).toBeGreaterThan(880); // Maine: top-right corner
    expect(a.ME.y).toBeLessThan(140);

    expect(a.CA.x).toBeLessThan(180); // California: left edge
    expect(a.WA.y).toBeLessThan(120); // Washington: top-left
    expect(a.FL.x).toBeGreaterThan(770); // Florida: the peninsula, not the Gulf bbox center
    expect(a.FL.y).toBeGreaterThan(470);
    expect(a.MI.y).toBeGreaterThan(180); // Michigan: the Lower Peninsula, not Lake Michigan
  });

  it("MAP-06: labelChipWidth is a pure function of character count (fixed-advance mono)", () => {
    expect(labelChipWidth("NE · 7")).toBeCloseTo(60.8, 5); // 6 chars × 7.8 + 14
    expect(labelChipWidth("MM · 999")).toBeCloseTo(LABEL_CHIP_WIDTH_MAX, 5); // 8 chars = worst case
    expect(labelChipWidth("")).toBe(14); // padding only (incl. the +2 fallback-metrics margin)
    expect(labelChipWidth("abcdef")).toBe(labelChipWidth("NE · 7")); // count, not glyph identity
  });
});
