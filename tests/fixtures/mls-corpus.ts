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
//
// ⚠️ SANITIZED (SEC-05): every name / phone / email / address below is INVENTED.
// The structure of the Lead Source 1 note templates is reproduced faithfully; the
// seller PII in them is not real and must never be copied in from a sample export.
//
// RULES v2 (owner decision 2026-07-15, WP-LS1): a lead is removed ONLY when a
// structured listing question is answered Yes/Y/True. There are no keep-overrides,
// and free-text prose ("on market", "active on mls") no longer disqualifies —
// the bare `on market` pattern false-fired on the "MLS History / Days on Market:"
// template label in 57% of vendor-A rows. Cases retired by that decision are kept
// here with their v2 expectation and a note, never deleted (PRN-04).
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
  {
    id: "MLS-01: listed on mls ? yes (space before the question mark)",
    notes: "Listed on MLS ? Yes",
    expected: "removed",
    why: "real form with a space before '?' — v2 patterns are tolerant (`mls[ \\t]*\\??`), which is why this still fires",
  },

  // ── Retired by the v2 owner decision (2026-07-15): free-text prose no longer
  // disqualifies. Kept as institutional memory (PRN-04) — the v1 expectation was
  // "removed"; under v2 these are KEPT because no structured question is answered.
  {
    id: "MLS-01 (retired v1): 'active on mls' free text",
    notes: "currently active on mls with agent",
    expected: "kept",
    why: "v1 removed this; v2 has no free-text positives — only structured listing questions disqualify",
  },
  {
    id: "MLS-01 (retired v1): 'currently on market' free text",
    notes: "…currently on market with agent…",
    expected: "kept",
    why: "v1 removed this; retired with the free-text positives in v2",
  },
  {
    id: "MLS-01 (retired v1): 'mls status: active' free text",
    notes: "MLS status: Active",
    expected: "kept",
    why: "v1 removed this; retired with the free-text positives in v2",
  },
  {
    id: "MLS-01 (retired v1): bare 'on market'",
    notes: "seller says it is on market now",
    expected: "kept",
    why: "v1 removed this; the bare 'on market' pattern false-fired on the 'MLS History / Days on Market:' label in 57% of vendor-A rows — the reason v2 exists",
  },

  // ── "No" answers → kept. Under v1 a keep-override pattern did this; under v2 the
  // engine's default-keep (MLS-03) does it, which IS the owner rule. Same verdict,
  // different reason — the corpus pins the verdict, so these cases carry over intact.
  { id: "MLS-03: is it listed? : no", notes: "Is it listed? : no", expected: "kept", why: "No answer ⇒ default keep" },
  { id: "MLS-03: is it listed : false", notes: "Is it listed : false", expected: "kept", why: "false answer ⇒ default keep" },
  { id: "MLS-03: listed on mls? no", notes: "Listed on MLS ? No", expected: "kept", why: "No answer ⇒ default keep" },
  { id: "MLS-03: not listed", notes: "property is not listed anywhere", expected: "kept", why: "no structured Yes ⇒ default keep" },
  { id: "MLS-03: off market", notes: "off market, direct to seller", expected: "kept", why: "no structured Yes ⇒ default keep" },
  { id: "MLS-03: never listed", notes: "never listed on any site", expected: "kept", why: "no structured Yes ⇒ default keep" },
  { id: "MLS-03: no mls", notes: "no mls, off-market deal", expected: "kept", why: "no structured Yes ⇒ default keep" },

  // ── Precedence, retired by the v2 owner decision (2026-07-15) ──
  {
    id: "MLS-02 (retired v1): human correction no longer beats a vendor Yes",
    notes: "Is it listed? : yes — but seller says not listed anymore",
    expected: "removed",
    why: "v1 KEPT this ('not listed' keep-override won); v2 has no keep-overrides, so the vendor's structured 'yes' decides — a deliberate, owner-approved trade",
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

  // ── WP-013: real InvestorFuse note forms (verified against the two live weeks) ──
  // The dominant real survey form; note the "If Yes, MLS Date Active :" trailer must NOT
  // read as an 'mls ... active' positive, and capital "Yes" is matched case-insensitively.
  {
    id: "WP-013 real: is it listed? : Yes (with trailer)",
    notes: "Is it Listed? : Yes  If Yes, MLS Date Active :",
    expected: "removed",
    why: "real InvestorFuse positive; 'MLS Date Active' trailer is not a positive pattern",
  },
  {
    id: "WP-013 real: is it listed? : false (with trailer)",
    notes: "Is it Listed? : false If Yes, MLS Date Active :",
    expected: "kept",
    why: "real InvestorFuse 'false' answer → keep-override",
  },
  {
    id: "WP-013 real: two survey blocks, both Yes",
    notes: "Is it Listed? : Yes  If Yes, MLS Date Active :  \nIs it Listed? : Yes  If Yes, MLS Date Active :",
    expected: "removed",
    why: "multi-block real notes; any positive with no negative ⇒ removed",
  },
  {
    id: "WP-013 real: AI negotiation prose, no listing question (defensive)",
    notes:
      "### Top 3-5 Negotiation Pressure Points:\n1. Comparable homes sat on the market for 90+ days before selling. No MLS Date Active recorded; seller is motivated.",
    expected: "kept",
    why: "free-text analysis: 'on the market' (with 'the') and 'MLS Date Active' must not trip any disqualify pattern",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WP-LS1 — "Lead Source 1" note templates (structure real, PII invented).
  // Vendor A answers `Listed?`; vendor B answers `Listed with realtor?` and
  // `Listed on MLS?`. Verified against 182 real rows: 112 removed / 70 kept.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Vendor A ──
  {
    id: "MLS-01 LS1 vendor-A: Listed? Yes",
    notes:
      "Name: Dana Fake\nPhone: 5555550100\nAddress: 12 Invented St, Springfield IL 62704\n\nListed? Yes\n\nReason For Selling: Looking For a Quick Sale\n\nHow Soon to Sell: ASAP",
    expected: "removed",
    why: "the dominant vendor-A form (112 of 182 real rows) — structured Yes ⇒ removed",
  },
  {
    id: "MLS-03 LS1 vendor-A: Listed? No",
    notes:
      "Name: Dana Fake\nPhone: 5555550100\n\nListed? No\n\nReason For Selling: Relocating\n\nHow Soon to Sell: 3-6 months",
    expected: "kept",
    why: "vendor-A No ⇒ default keep",
  },
  {
    id: "PRN-04 LS1: the 'Days on Market' label trap (the 57% false-removal bug)",
    notes:
      "Listed? No\n\nMLS History / Days on Market:\n\nReason For Selling: Downsizing\n\nHow Soon to Sell: Flexible",
    expected: "kept",
    why: "the v1 bare `on market` pattern matched this TEMPLATE LABEL and wrongly removed 57% of vendor-A rows; v2 must never fire on it",
  },
  {
    id: "SEC-05 LS1 vendor-A: skip-trace lines present, Listed? Yes still decides",
    notes:
      "Listed? Yes\n\nReason For Selling: Inherited\n\nSkip Trace Emails: not.real@example.invalid; also.fake@example.invalid\n\nSkip Trace Phones: mobile, 5555550111; mobile, 5555550112 [DNC]\n\nHow Soon to Sell: ASAP",
    expected: "removed",
    why: "MLS runs on canonical notes AFTER the skip-trace strip; the listing line survives the strip and still decides",
  },

  // ── Vendor B ──
  {
    id: "MLS-03 LS1 vendor-B: realtor No + MLS blank",
    notes:
      "* Lead type: Seller\n* Listed with realtor?: No\n* Listed on MLS?:\n* Reason for selling: Job relocation\n* Sale urgency: Within 30 days\n* Address: 9 Pretend Ave, Fakeville, Cook County, IL 60007",
    expected: "kept",
    why: "the dominant vendor-B form (69 of 182 real rows) — No + blank ⇒ default keep",
  },
  {
    id: "MLS-03 LS1 vendor-B: realtor No + MLS No",
    notes: "* Listed with realtor?: No\n* Listed on MLS?: No\n* Sale urgency: Flexible",
    expected: "kept",
    why: "both structured answers No ⇒ default keep",
  },
  {
    id: "MLS-01 LS1 vendor-B: Listed with realtor?: Yes (defensive — no live sample coverage)",
    notes: "* Lead type: Seller\n* Listed with realtor?: Yes\n* Listed on MLS?:\n* Sale urgency: ASAP",
    expected: "removed",
    why: "vendor B has never answered Yes in the samples; this pins the owner rule for when it does",
  },
  {
    id: "MLS-01 LS1 vendor-B: Listed on MLS?: Yes (defensive — no live sample coverage)",
    notes: "* Listed with realtor?: No\n* Listed on MLS?: Yes\n* Sale urgency: ASAP",
    expected: "removed",
    why: "any structured Yes wins even when another listing question says No (owner rule: any-Yes)",
  },

  // ── Archived-notes form (still present in ~10 real rows) ──
  {
    id: "MLS-01 LS1 archived: Is it Listed? : Yes",
    notes: "Is it Listed? : Yes If Yes, MLS Date Active :\n\nListed? Yes",
    expected: "removed",
    why: "archived InvestorFuse-era block carried inside a Lead Source 1 export",
  },
  {
    id: "MLS-01 LS1 archived: Is it Listed? : True",
    notes: "Is it Listed? : True If Yes, MLS Date Active :",
    expected: "removed",
    why: "'True' is an accepted affirmative alongside Yes/Y",
  },

  // ── The two traps the v2 regex craft exists to survive ──
  {
    id: "PRN-04 LS1: substring containment — 'Listed with realtor?' must not read as 'Listed?'",
    notes: "* Listed with realtor?: No\n* Listed on MLS?: No",
    expected: "kept",
    why: "`dq_ls1_listed_yes` is line-anchored (^[ \\t]*\\*?[ \\t]*listed[ \\t]*\\?) so it can never match inside 'Listed with realtor?' — otherwise every vendor-B row would false-fire",
  },
  {
    id: "PRN-04 LS1: multiline — a question must never bind to an answer on a LATER line",
    notes: "* Listed on MLS?:\nYes I want to sell fast, call me\n* Sale urgency: ASAP",
    expected: "kept",
    why: "PROOF that patterns use [ \\t]* and never \\s*: \\s crosses newlines, so `\\s*` would bind this blank question to the 'Yes' below it and wrongly remove the lead",
  },
];
