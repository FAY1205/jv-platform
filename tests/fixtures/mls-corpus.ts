import type { MlsVerdict } from "@/modules/pipeline/mls";

export interface MlsCase {
  /** MLS requirement / scenario id for the test name. */
  id: string;
  notes: string;
  expected: MlsVerdict;
  why: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TST-02 corpus — the institutional memory of the MLS engine. Every real-world
// miss becomes a new case here FIRST, then the pattern is fixed (PRN-04 workflow).
// ─────────────────────────────────────────────────────────────────────────────
export const MLS_CORPUS: readonly MlsCase[] = [
  // ── Canonical tricky cases (spec §9 TST-02) ──
  {
    id: "TST-02 canonical: positive true",
    notes: "Is it Listed? : true If Yes, MLS Date Active :",
    expected: "removed",
    why: "anchored positive 'is it listed? : true'",
  },
  {
    id: "TST-02 canonical: negative override with MLS date noise",
    notes: "Listed on MLS ? No, MLS Date Active: 3/2/25",
    expected: "kept",
    why: "'listed on mls? no' keep-override; 'MLS Date Active' is not a positive pattern",
  },
  {
    id: "TST-02 canonical: blank",
    notes: "",
    expected: "kept",
    why: "blank ⇒ keep (MLS-03)",
  },
  {
    id: "TST-02 canonical: 'no' outside listing context",
    notes: "seller has no mortgage",
    expected: "kept",
    why: "bare 'no' must not trigger a negative or positive (PRN-04)",
  },

  // ── MLS-01 positives → removed ──
  { id: "MLS-01: is it listed? : yes", notes: "Is it listed? : yes", expected: "removed", why: "positive" },
  { id: "MLS-01: is it listed : y", notes: "Is it listed : Y — wants to cancel", expected: "removed", why: "positive y" },
  { id: "MLS-01: listed on mls? yes", notes: "Listed on MLS ? Yes", expected: "removed", why: "positive" },
  { id: "MLS-01: active on mls", notes: "currently active on mls with agent", expected: "removed", why: "positive" },
  { id: "MLS-01: currently on market", notes: "…currently on market with agent…", expected: "removed", why: "positive" },
  { id: "MLS-01: mls status active", notes: "MLS status: Active", expected: "removed", why: "positive" },
  { id: "MLS-01: on market", notes: "seller says it is on market now", expected: "removed", why: "positive" },

  // ── MLS-02 keep-override → kept ──
  { id: "MLS-02: is it listed? : no", notes: "Is it listed? : no", expected: "kept", why: "negative override" },
  { id: "MLS-02: is it listed : false", notes: "Is it listed : false", expected: "kept", why: "negative override" },
  { id: "MLS-02: listed on mls? no", notes: "Listed on MLS ? No", expected: "kept", why: "negative override" },
  { id: "MLS-02: not listed", notes: "property is not listed anywhere", expected: "kept", why: "negative override" },
  { id: "MLS-02: off market", notes: "off market, direct to seller", expected: "kept", why: "negative override" },
  { id: "MLS-02: never listed", notes: "never listed on any site", expected: "kept", why: "negative override" },
  { id: "MLS-02: no mls", notes: "no mls, off-market deal", expected: "kept", why: "negative override" },

  // ── Precedence: keep-override beats a co-occurring positive (MLS-02) ──
  {
    id: "MLS-02 precedence: positive + override",
    notes: "Is it listed? : yes — but seller says not listed anymore",
    expected: "kept",
    why: "'not listed' keep-override beats the positive",
  },

  // ── PRN-04 no-false-positives (bare tokens outside the listing context) ──
  {
    id: "PRN-04: 'on market' inside 'common market'",
    notes: "common market analysis pending for the block",
    expected: "kept",
    why: "'on market' must be word-boundary anchored; 'commON MARKET' must not trigger",
  },
  { id: "PRN-04: bare 'none'", notes: "photos: none yet", expected: "kept", why: "'none' is not 'no mls'" },
  { id: "PRN-04: bare 'n'", notes: "seller is nervous about timing", expected: "kept", why: "bare 'n' must not trigger" },
  { id: "PRN-04: 'off market' negative only", notes: "off market — never listed", expected: "kept", why: "two negatives, still kept" },
];
