// ─────────────────────────────────────────────────────────────────────────────
// Source Profiles (ING-01..08, SEAM-05). Declared, versioned format contracts:
// header signature, canonical mapping, required columns, strictness. New sources
// are rows, not code. PURE logic — no I/O (PRN-01).
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical fields (ING-03). Unmapped source columns are preserved in raw_json. */
export type CanonicalField =
  | "campaign"
  | "dateCreated"
  | "notes"
  | "address"
  | "city"
  | "state"
  | "zip"
  | "sellerFirst"
  | "sellerLast"
  | "phone"
  | "email"
  | "reasonForSelling"
  | "motivation"
  | "timeToSell";

export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  "campaign",
  "dateCreated",
  "notes",
  "address",
  "city",
  "state",
  "zip",
  "sellerFirst",
  "sellerLast",
  "phone",
  "email",
  "reasonForSelling",
  "motivation",
  "timeToSell",
];

/**
 * Strictness (ING-07): flexible = extra columns allowed; strict = any deviation
 * from the signature blocks and must be confirmed.
 */
export type Strictness = "flexible" | "strict";

export interface SourceProfile {
  id: string;
  name: string;
  /** Version pinned into a run's rules snapshot (DM-08); bumped on confirmed drift. */
  version: number;
  /** Expected source column headers (original casing, for display). */
  headerSignature: string[];
  /** canonical field → source column header. */
  mapping: Partial<Record<CanonicalField, string>>;
  /** Canonical fields whose source column MUST be present (else hard block). */
  requiredColumns: CanonicalField[];
  strictness: Strictness;
  /**
   * Optional derived-extraction seam (SEAM): the NAME of a transform registered in
   * ./transforms.ts, run after column mapping. Data names it, code implements it —
   * the same split as MLS patterns. Needed when canonical fields cannot be reached
   * by column mapping alone (a name to split, an address to decompose, fields buried
   * in a notes blob). Unknown name ⇒ applyProfile throws (never a silent skip).
   */
  transform?: string;
}
