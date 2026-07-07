import { describe, it, expect } from "vitest";
import { detectProfile, applyProfile, GENERIC_PROFILE } from "@/modules/sources";
import { evaluate } from "@/modules/pipeline/mls";
import { DEFAULT_MLS_PATTERNS } from "@/modules/pipeline/mls-patterns";
import {
  normalizeZip,
  normalizeState,
  normalizePhone,
  computeDedupeKey,
} from "@/modules/pipeline/normalize";
import { assign, buildCoverage } from "@/modules/pipeline/assign";
import { dedupeRun, type HistoryEntry } from "@/modules/pipeline/dedupe";
import {
  BEES_PROFILE,
  ZOLO_ROWS,
  BEES_ROWS,
  SYNTH_STATE_FALLBACKS,
  type SyntheticLead,
} from "../fixtures/synthetic-week";

const PROFILES = [GENERIC_PROFILE, BEES_PROFILE];

// Phase-1 runtime coverage: no ZIP territories loaded — only the ASN-01 state fallbacks.
const COVERAGE = buildCoverage([], SYNTH_STATE_FALLBACKS);

// TST-05 (provisional): the full pure pipeline over a synthetic multi-source week.
// Assignment + dedupe are added in Phase 1; the golden then pins to a rules snapshot.
describe("TST-05 (provisional): synthetic multi-source week", () => {
  it("auto-detects each source format exactly", () => {
    expect(detectProfile(Object.keys(ZOLO_ROWS[0].row), PROFILES)).toMatchObject({
      status: "exact",
      profile: { id: "generic" },
    });
    expect(detectProfile(Object.keys(BEES_ROWS[0].row), PROFILES)).toMatchObject({
      status: "exact",
      profile: { id: "bees" },
    });
  });

  const run = (rows: SyntheticLead[], profileId: string) => {
    for (const { row, expect: want } of rows) {
      const detected = detectProfile(Object.keys(row), PROFILES);
      expect(detected.status).toBe("exact");
      expect(detected.profile?.id).toBe(profileId);

      const { canonical } = applyProfile(row, detected.profile!);
      const zip5 = normalizeZip(canonical.zip);
      const state = normalizeState(canonical.state);
      expect(zip5).toBe(want.zip5); // NRM-01 leading zeros
      expect(state).toBe(want.state); // NRM-02 names→codes
      expect(evaluate(canonical.notes, DEFAULT_MLS_PATTERNS).verdict).toBe(want.mls); // MLS

      const a = assign(zip5, state, COVERAGE); // ASN-01 (Phase-1: state fallback / unmatched)
      expect(a.matchMethod).toBe(want.assign.matchMethod);
      expect(a.partnerId).toBe(want.assign.partner);
    }
  };

  it("maps, normalizes, and MLS-filters every Zolo-format lead as expected", () => {
    run(ZOLO_ROWS, "generic");
  });

  it("maps, normalizes, and MLS-filters every Bees-format lead as expected", () => {
    run(BEES_ROWS, "bees");
  });

  it("covers the outcome mix a real week has (kept, removed, both formats)", () => {
    const all = [...ZOLO_ROWS, ...BEES_ROWS];
    expect(all.filter((l) => l.expect.mls === "removed").length).toBeGreaterThanOrEqual(3);
    expect(all.filter((l) => l.expect.mls === "kept").length).toBeGreaterThanOrEqual(6);
    // Leading-zero ZIPs are present (the CT/NJ Excel-drop hazard).
    expect(all.some((l) => l.expect.zip5.startsWith("0"))).toBe(true);
  });

  it("ASN-01: a national week yields a state-fallback + unmatched mix (no ZIP coverage in Phase 1)", () => {
    const all = [...ZOLO_ROWS, ...BEES_ROWS];
    const fallback = all.filter((l) => l.expect.assign.matchMethod === "state_fallback");
    const unmatched = all.filter((l) => l.expect.assign.matchMethod === "none");
    expect(fallback.length).toBeGreaterThanOrEqual(4);
    expect(unmatched.length).toBeGreaterThanOrEqual(4);
    // No ZIP matches are possible in Phase 1 — byZip is empty.
    expect(all.some((l) => l.expect.assign.matchMethod === "zip")).toBe(false);
  });

  const canonicalOf = (l: SyntheticLead) => {
    const detected = detectProfile(Object.keys(l.row), PROFILES);
    return applyProfile(l.row, detected.profile!).canonical;
  };

  it("DED-01/PRN-05: a week-1 lead reappearing in week-2 keeps its ORIGINAL partner + first-matched date", () => {
    const nj = canonicalOf(ZOLO_ROWS[0]); // 142 Garden State Ave / NJ / 08034
    const key = computeDedupeKey(nj.address, nj.zip);

    // Week-1 originally matched this lead to a partner that DIFFERS from today's state fallback,
    // e.g. because coverage changed. History must win (PRN-05).
    const history = new Map<string, HistoryEntry>([
      [key, { partnerId: "week1-original", matchMethod: "zip", firstMatchedAt: "2026-06-29T00:00:00Z", phoneNorm: normalizePhone(nj.phone) }],
    ]);

    const fresh = canonicalOf(BEES_ROWS[5]); // Brooklyn NY — brand new, unmatched
    const [repeat, brandNew] = dedupeRun(
      [
        { dedupeKey: key, phoneNorm: normalizePhone(nj.phone), partnerId: "Josh Ax", matchMethod: "state_fallback" },
        { dedupeKey: computeDedupeKey(fresh.address, fresh.zip), phoneNorm: normalizePhone(fresh.phone), partnerId: null, matchMethod: "none" },
      ],
      history,
    );

    expect(repeat).toMatchObject({
      previouslyMatched: true,
      partnerId: "week1-original", // original beats the current "Josh Ax" fallback
      firstMatchedAt: "2026-06-29T00:00:00Z",
      phoneConfirmed: true,
    });
    expect(brandNew).toMatchObject({ previouslyMatched: false, firstMatchedAt: null });
  });
});
