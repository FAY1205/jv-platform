import { CANONICAL_FIELDS, type CanonicalField, type SourceProfile, type Strictness } from "./types";
import { diffHeaders, normalizeHeader } from "./signature";

// ─────────────────────────────────────────────────────────────────────────────
// Mapping proposal + confirmation (ING-02/08). PURE. `suggestMapping` proposes a
// canonical→source-column mapping for a drifted or unknown file; the admin edits
// and confirms it into a new/next profile version (buildConfirmedProfile, DM-08).
// ─────────────────────────────────────────────────────────────────────────────

export type Mapping = Partial<Record<CanonicalField, string>>;

/** Normalized header → original-cased upload header. */
function originalByNorm(uploadHeaders: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of uploadHeaders) m.set(normalizeHeader(h), h);
  return m;
}

/**
 * Propose a mapping for the uploaded headers. With a base profile: keep each field
 * whose mapped column is still present, follow a 1:1 rename, else drop it. Without
 * a base (unknown file): auto-map any column whose header matches a canonical name.
 */
export function suggestMapping(base: SourceProfile | null, uploadHeaders: string[]): Mapping {
  const byNorm = originalByNorm(uploadHeaders);
  const mapping: Mapping = {};

  if (base) {
    const { renamed } = diffHeaders(base.headerSignature, uploadHeaders);
    for (const field of CANONICAL_FIELDS) {
      const baseCol = base.mapping[field];
      if (!baseCol) continue;
      const norm = normalizeHeader(baseCol);
      if (byNorm.has(norm)) {
        mapping[field] = byNorm.get(norm)!;
      } else {
        const r = renamed.find((x) => x.from === norm);
        if (r && byNorm.has(r.to)) mapping[field] = byNorm.get(r.to)!;
      }
    }
    return mapping;
  }

  // Unknown file: map a column whose header matches a canonical field's name.
  for (const field of CANONICAL_FIELDS) {
    if (byNorm.has(field)) mapping[field] = byNorm.get(field)!;
  }
  return mapping;
}

/** Required canonical fields whose mapped source column is absent from the file. */
export function missingRequiredFor(mapping: Mapping, requiredColumns: CanonicalField[], uploadHeaders: string[]): CanonicalField[] {
  const present = new Set(uploadHeaders.map(normalizeHeader));
  return requiredColumns.filter((field) => {
    const col = mapping[field];
    return !col || !present.has(normalizeHeader(col));
  });
}

export interface BuildProfileInput {
  base: SourceProfile | null;
  name: string;
  uploadHeaders: string[];
  mapping: Mapping;
  strictness: Strictness;
  requiredColumns?: CanonicalField[];
}

/** Build the confirmed profile: a new version of the base, or a brand-new profile. */
export function buildConfirmedProfile(input: BuildProfileInput): SourceProfile {
  // Keep only real canonical fields with a non-empty mapped column.
  const mapping: Mapping = {};
  for (const field of CANONICAL_FIELDS) {
    const col = input.mapping[field];
    if (col && col.trim() !== "") mapping[field] = col;
  }
  const requiredColumns = input.requiredColumns ?? input.base?.requiredColumns ?? [];
  return {
    id: input.base?.id ?? input.name,
    name: input.base?.name ?? input.name,
    version: (input.base?.version ?? 0) + 1,
    headerSignature: [...input.uploadHeaders],
    mapping,
    requiredColumns,
    strictness: input.strictness,
    // A new VERSION inherits the base's derivation (WP-LS1): a drift is a column
    // rename, never a change of format identity. Dropping this would silently ingest
    // every later upload with no address, no seller name and un-stripped skip-trace
    // notes (SEC-05) — no error, just wrong data. A brand-new format (no base) has no
    // transform: no registered code exists to derive an unknown shape.
    transform: input.base?.transform,
  };
}
