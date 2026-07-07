import type { MlsPattern } from "./mls";

// ─────────────────────────────────────────────────────────────────────────────
// Seed MLS patterns (MLS-01 disqualify, MLS-02 keep-override). This is the seed
// for the mls_patterns table (MLS-04, PRN-07); admins edit the table, not code.
// Every pattern is anchored to the listing-question context (PRN-04) — negatives
// like "no"/"n"/"false" only match tied to the question, never as bare substrings.
//
// Regex sources use String.raw so single backslashes read faithfully.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MLS_PATTERNS: readonly MlsPattern[] = [
  // ── MLS-01: DISQUALIFY (on-market positives) ──
  {
    id: "dq_is_listed_yes",
    type: "disqualify",
    regex: String.raw`is\s*it\s*listed\s*\??\s*:?\s*(?:true|yes|y)\b`,
    label: "is it listed? : yes/true/y",
  },
  {
    id: "dq_listed_on_mls_yes",
    type: "disqualify",
    regex: String.raw`listed\s*on\s*mls\s*\??\s*:?\s*yes\b`,
    label: "listed on mls? yes",
  },
  {
    id: "dq_active_on_mls",
    type: "disqualify",
    regex: String.raw`\bactive\s+on\s+mls\b`,
    label: "active on mls",
  },
  {
    id: "dq_currently_on_market",
    type: "disqualify",
    regex: String.raw`\bcurrently\s+on\s+market\b`,
    label: "currently on market",
  },
  {
    id: "dq_mls_status_active",
    type: "disqualify",
    regex: String.raw`\bmls\s*status\s*:?\s*active\b`,
    label: "mls status: active",
  },
  {
    id: "dq_on_market",
    type: "disqualify",
    regex: String.raw`\bon\s+market\b`,
    label: "on market",
  },

  // ── MLS-02: KEEP-OVERRIDE (off-market negatives; beat any positive) ──
  {
    id: "ko_is_listed_no",
    type: "keep_override",
    regex: String.raw`is\s*it\s*listed\s*\??\s*:?\s*(?:no|false|n)\b`,
    label: "is it listed? : no/false/n",
  },
  {
    id: "ko_listed_on_mls_no",
    type: "keep_override",
    regex: String.raw`listed\s*on\s*mls\s*\??\s*:?\s*no\b`,
    label: "listed on mls? no",
  },
  {
    id: "ko_not_listed",
    type: "keep_override",
    regex: String.raw`\bnot\s+listed\b`,
    label: "not listed",
  },
  {
    id: "ko_off_market",
    type: "keep_override",
    regex: String.raw`\boff\s+market\b`,
    label: "off market",
  },
  {
    id: "ko_never_listed",
    type: "keep_override",
    regex: String.raw`\bnever\s+listed\b`,
    label: "never listed",
  },
  {
    id: "ko_no_mls",
    type: "keep_override",
    regex: String.raw`\bno\s+mls\b`,
    label: "no mls",
  },
];
