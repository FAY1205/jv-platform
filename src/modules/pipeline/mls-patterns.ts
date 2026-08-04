import type { MlsPattern } from "./mls";

// ─────────────────────────────────────────────────────────────────────────────
// Seed MLS patterns v2 (MLS-01, MLS-04, PRN-04, PRN-07). Seed for the mls_patterns
// table; admins edit the table, not code.
//
// THE RULE (owner decision 2026-07-15, WP-LS1): a lead is removed ONLY when a
// structured listing question is answered Yes/Y/True. Everything else — No, blank,
// free-text prose — falls through to the engine's default-keep (MLS-03), which IS
// the rule. Verified against 182 real rows: 112 removed / 70 kept, zero rows
// carrying both a Yes and a No, so "any Yes wins" needs no engine change.
//
// ── Why there are no keep_override patterns in v2 ──
// v1 shipped free-text overrides (`not listed`, `off market`, …) and free-text
// positives (`on market`, `active on mls`, …). Both are retired: the bare
// `on market` pattern matched the "MLS History / Days on Market:" TEMPLATE LABEL
// present in every vendor-A row and wrongly removed 57% of leads. The engine still
// implements keep_override (MLS-02) — the seed simply no longer uses it. Re-adding
// one is a data-only change to the patterns table, never a code change.
//
// ── ⚠️ Regex craft: [ \t]* — NEVER \s* ──
// The notes are MULTILINE. `\s` matches newlines, so `\s*` lets a question on one
// line bind to an answer on another ("Listed on MLS?:" + "\nYes I want to sell"
// ⇒ a false removal). Every gap here is [ \t]* so a pattern can only ever match
// WITHIN one line. Pinned by the multiline case in tests/fixtures/mls-corpus.ts.
//
// Regex sources use String.raw so single backslashes read faithfully.
// ─────────────────────────────────────────────────────────────────────────────

/** Affirmative answers that disqualify. `\b` stops "y" from matching "yet"/"your". */
const YES = String.raw`(?:yes|y|true)\b`;

export const DEFAULT_MLS_PATTERNS: readonly MlsPattern[] = [
  // ── MLS-01: DISQUALIFY — a structured listing question answered Yes ──
  {
    id: "dq_ls1_is_it_listed_yes",
    type: "disqualify",
    regex: String.raw`is[ \t]+it[ \t]+listed[ \t]*\??[ \t]*:?[ \t]*` + YES,
    label: "is it listed? : yes/y/true",
  },
  {
    id: "dq_ls1_listed_mls_yes",
    type: "disqualify",
    regex: String.raw`listed[ \t]+on[ \t]+mls[ \t]*\??[ \t]*:?[ \t]*` + YES,
    label: "listed on mls? yes",
  },
  {
    id: "dq_ls1_listed_realtor_yes",
    type: "disqualify",
    regex: String.raw`listed[ \t]+with[ \t]+realtor[ \t]*\??[ \t]*:?[ \t]*` + YES,
    label: "listed with realtor? yes",
  },
  {
    // LINE-ANCHORED (^ + the m flag) on purpose: "listed?" is a substring of
    // "Listed with realtor?" and "Listed on MLS?". Without the anchor this pattern
    // would fire on every vendor-B row. The optional `\*?` absorbs the vendor's
    // "* " bullet prefix.
    id: "dq_ls1_listed_yes",
    type: "disqualify",
    regex: String.raw`^[ \t]*\*?[ \t]*listed[ \t]*\?[ \t]*:?[ \t]*` + YES,
    flags: "im",
    label: "listed? yes",
  },
];
