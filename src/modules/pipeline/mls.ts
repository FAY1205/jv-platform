// ─────────────────────────────────────────────────────────────────────────────
// MLS filter engine (MLS-01..05, PRN-04). PURE — no I/O, no Date.now() (PRN-01).
//
// Semantics:
//   • DISQUALIFY on anchored positive patterns (lead is on-market → removed).
//   • KEEP-OVERRIDE beats any positive: an anchored negative keeps the lead.
//   • Blank / missing / no-match ⇒ KEEP (treated off-market) (MLS-03).
//
// PRN-04: negative tokens (no / n / false) match ONLY via anchored regex tied to
// the listing question — never bare substrings. Patterns are DATA (from the
// mls_patterns table, MLS-04); the seed lives in ./mls-patterns.ts. Removed leads
// retain the matched pattern + text span for highlighted display (MLS-05).
// ─────────────────────────────────────────────────────────────────────────────

export type MlsPatternType = "disqualify" | "keep_override";

export interface MlsPattern {
  id: string;
  type: MlsPatternType;
  /** Regex source (anchored). Stored as a string so it round-trips through the DB. */
  regex: string;
  /** Regex flags; case-insensitive by default. `g`/`y` are stripped for determinism. */
  flags?: string;
  label: string;
}

export type MlsVerdict = "kept" | "removed";
export type MlsReason = "keep_override" | "disqualify" | "blank_default" | "no_match_default";

export interface MlsMatch {
  start: number;
  end: number;
  text: string;
}

export interface MlsResult {
  verdict: MlsVerdict;
  reason: MlsReason;
  /** The pattern that decided the verdict (absent for blank/no-match defaults). */
  pattern?: { id: string; label: string };
  /** The matched span in the original notes (for highlighted display, MLS-05). */
  match?: MlsMatch;
}

/** Compile a stored pattern into a stateless RegExp (no g/y flags → no lastIndex state). */
function compile(pattern: MlsPattern): RegExp {
  const flags = (pattern.flags ?? "i").replace(/[gy]/g, "");
  return new RegExp(pattern.regex, flags.includes("i") ? flags : flags + "i");
}

function firstMatch(
  notes: string,
  patterns: readonly MlsPattern[],
  type: MlsPatternType,
): { pattern: MlsPattern; match: MlsMatch } | null {
  for (const pattern of patterns) {
    if (pattern.type !== type) continue;
    const m = compile(pattern).exec(notes);
    if (m) {
      return {
        pattern,
        match: { start: m.index, end: m.index + m[0].length, text: m[0] },
      };
    }
  }
  return null;
}

/**
 * Evaluate a lead's Notes against the MLS pattern set.
 * Deterministic: same (notes, patterns) ⇒ identical result (PRN-01).
 */
export function evaluate(
  notes: string | null | undefined,
  patterns: readonly MlsPattern[],
): MlsResult {
  const text = notes ?? "";
  if (text.trim() === "") {
    return { verdict: "kept", reason: "blank_default" };
  }

  // Keep-override beats any positive (MLS-02), so it is checked first.
  const keep = firstMatch(text, patterns, "keep_override");
  if (keep) {
    return {
      verdict: "kept",
      reason: "keep_override",
      pattern: { id: keep.pattern.id, label: keep.pattern.label },
      match: keep.match,
    };
  }

  const disqualify = firstMatch(text, patterns, "disqualify");
  if (disqualify) {
    return {
      verdict: "removed",
      reason: "disqualify",
      pattern: { id: disqualify.pattern.id, label: disqualify.pattern.label },
      match: disqualify.match,
    };
  }

  // Notes present but nothing indicates a listing ⇒ keep (off-market, MLS-03).
  return { verdict: "kept", reason: "no_match_default" };
}

/** Validate a candidate pattern's regex (supports the admin pattern editor, MLS-04). */
export function isValidPatternRegex(regex: string, flags?: string): boolean {
  try {
    new RegExp(regex, (flags ?? "i").replace(/[gy]/g, "") || "i");
    return true;
  } catch {
    return false;
  }
}
