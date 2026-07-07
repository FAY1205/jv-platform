import { CANONICAL_FIELDS, type CanonicalField, type SourceProfile } from "./types";
import { normalizeHeader } from "./signature";

// ─────────────────────────────────────────────────────────────────────────────
// Apply a Source Profile to a parsed row (ING-03/04). Maps source columns to
// canonical fields; the full source row is preserved as raw (DM-02 raw_json).
// ─────────────────────────────────────────────────────────────────────────────

export interface AppliedRow {
  canonical: Partial<Record<CanonicalField, string>>;
  /** The full original source row, preserved forever (DM-02). */
  raw: Record<string, unknown>;
}

export function applyProfile(row: Record<string, unknown>, profile: SourceProfile): AppliedRow {
  // Normalized-header lookup so mapping tolerates case/whitespace differences.
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    lookup.set(normalizeHeader(key), value);
  }

  const canonical: Partial<Record<CanonicalField, string>> = {};
  for (const field of CANONICAL_FIELDS) {
    const col = profile.mapping[field];
    if (!col) continue;
    const value = lookup.get(normalizeHeader(col));
    if (value != null && String(value).trim() !== "") {
      canonical[field] = String(value);
    }
  }

  return { canonical, raw: row };
}

/**
 * Row-level validation (ING-04): a row missing BOTH Zip and State is reported
 * (never hard-fails the file). Returns human-readable messages.
 */
export function findRowErrors(applied: AppliedRow): string[] {
  const errors: string[] = [];
  if (!applied.canonical.zip && !applied.canonical.state) {
    errors.push("Missing both Zip and State — cannot assign territory");
  }
  return errors;
}
