import type { CanonicalField, SourceProfile } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Header-signature detection and drift diff (ING-02, ING-08). Never silently
// re-guesses a changed format: a partial match is surfaced as a diff to confirm.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize a header for signature comparison (case/whitespace-insensitive). */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A stable, order-independent signature (sorted, de-duplicated normalized headers). */
export function computeSignature(headers: string[]): string[] {
  return [...new Set(headers.map(normalizeHeader))].sort();
}

export interface HeaderDiff {
  /** Upload headers not in the profile signature. */
  added: string[];
  /** Profile signature headers absent from the upload. */
  removed: string[];
  /** Heuristic 1:1 rename proposal (one removed + one added). */
  renamed: { from: string; to: string }[];
}

export function diffHeaders(profileHeaders: string[], uploadHeaders: string[]): HeaderDiff {
  const profile = new Set(profileHeaders.map(normalizeHeader));
  const upload = new Set(uploadHeaders.map(normalizeHeader));
  const removed = [...profile].filter((h) => !upload.has(h)).sort();
  const added = [...upload].filter((h) => !profile.has(h)).sort();
  const renamed =
    removed.length === 1 && added.length === 1 ? [{ from: removed[0], to: added[0] }] : [];
  return { added, removed, renamed };
}

export type DetectStatus = "exact" | "drift" | "missing_required" | "unknown";

export interface DetectResult {
  status: DetectStatus;
  /** The best-matching profile (absent when status is "unknown"). */
  profile?: SourceProfile;
  /** Format diff for a drift result. */
  diff?: HeaderDiff;
  /** Required canonical fields whose source column is absent. */
  missingRequired?: CanonicalField[];
}

/** Fraction of a profile's signature that must appear before it is even considered. */
const MATCH_THRESHOLD = 0.5;

/**
 * Classify an upload's headers against saved profiles (ING-02, ING-08):
 *   exact            → signature matches (flexible extras allowed) → auto-apply
 *   drift            → partial match (rename/removal, or strict extras) → confirm
 *   missing_required → a required column is genuinely absent with no candidate → hard block
 *   unknown          → no profile matches meaningfully → inline mapping
 */
export function detectProfile(
  headers: string[],
  profiles: readonly SourceProfile[],
): DetectResult {
  const upload = new Set(headers.map(normalizeHeader));

  // R-34 (PRN-01, TST-11): rank by FIT RATIO (overlap / signature size), not absolute
  // overlap — an exact match on a small signature must beat a partial overlap on a
  // bigger one. Ties break deterministically on profile id (lexicographic), so the
  // winner never depends on candidate order (DB rows arrive unordered).
  let best: SourceProfile | undefined;
  let bestFit = -1;
  for (const p of profiles) {
    if (p.headerSignature.length === 0) continue;
    const sig = p.headerSignature.map(normalizeHeader);
    const overlap = sig.filter((h) => upload.has(h)).length;
    const fit = overlap / sig.length;
    if (fit > bestFit || (fit === bestFit && best !== undefined && p.id < best.id)) {
      bestFit = fit;
      best = p;
    }
  }

  if (!best) return { status: "unknown" };

  const sig = best.headerSignature.map(normalizeHeader);
  const sigSet = new Set(sig);
  if (bestFit < MATCH_THRESHOLD) return { status: "unknown" };

  const missing = sig.filter((h) => !upload.has(h));
  const extra = [...upload].filter((h) => !sigSet.has(h));

  const missingRequired = best.requiredColumns.filter((field) => {
    const col = best.mapping[field];
    return !col || !upload.has(normalizeHeader(col));
  });

  // A required column is genuinely gone (nothing new to remap it to) → hard block.
  if (missingRequired.length > 0 && extra.length === 0) {
    return { status: "missing_required", profile: best, missingRequired };
  }

  if (missing.length === 0) {
    if (extra.length === 0) return { status: "exact", profile: best };
    // Extra columns present: flexible allows them; strict must confirm.
    if (best.strictness === "flexible") return { status: "exact", profile: best };
    return { status: "drift", profile: best, diff: diffHeaders(sig, [...upload]) };
  }

  // Missing (rename/removal) → diff-and-confirm; never silently re-guess (ING-08).
  return {
    status: "drift",
    profile: best,
    diff: diffHeaders(sig, [...upload]),
    missingRequired: missingRequired.length ? missingRequired : undefined,
  };
}

/**
 * Confirmed drift produces a NEW profile version (ING-08, DM-08) — the old one is
 * never mutated in place, preserving determinism of past runs.
 */
export function createNextVersion(
  profile: SourceProfile,
  updates: {
    headerSignature: string[];
    mapping: Partial<Record<CanonicalField, string>>;
  },
): SourceProfile {
  return {
    ...profile,
    version: profile.version + 1,
    headerSignature: updates.headerSignature,
    mapping: updates.mapping,
  };
}
