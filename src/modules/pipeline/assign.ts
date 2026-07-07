// ─────────────────────────────────────────────────────────────────────────────
// Assignment (ASN-01/02/03). PURE — no I/O, no Date.now() (PRN-01).
//
// Precedence (ASN-01):
//   (1) exact zip5 in coverage → that partner, stop;
//   (2) state fallback → that partner;
//   (3) unmatched → no partner.
//
// ASN-02: NO special-case partner code. The engine sees partner ids as opaque
// strings and does pure lookups — regional exceptions (Virginia Beach, Philadelphia
// metro) emerge purely from the ZIP map, never from a name conditional. If a test
// seems to need exception code, the test is wrong (CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

export type MatchMethod = "zip" | "state_fallback" | "none";

export interface Coverage {
  /** zip5 → partnerId. CURRENT coverage; the caller resolves the effective version (DM-06). */
  byZip: ReadonlyMap<string, string>;
  /** 2-letter state → partnerId (state fallback, ASN-01). */
  byState: ReadonlyMap<string, string>;
}

export interface AssignmentResult {
  partnerId: string | null;
  matchMethod: MatchMethod;
  /** The zip5 or state that decided it (per-lead audit); null when unmatched. */
  matchedOn: string | null;
}

/**
 * Assign a lead by ASN-01 precedence. `zip5`/`state` are already normalized
 * (NRM-01/02) — the caller normalizes once and shares them with the dedupe key.
 * Deterministic: same (zip5, state, coverage) ⇒ identical result (PRN-01).
 */
export function assign(zip5: string, state: string, coverage: Coverage): AssignmentResult {
  if (zip5) {
    const zipPartner = coverage.byZip.get(zip5);
    if (zipPartner !== undefined) {
      return { partnerId: zipPartner, matchMethod: "zip", matchedOn: zip5 };
    }
  }
  if (state) {
    const statePartner = coverage.byState.get(state);
    if (statePartner !== undefined) {
      return { partnerId: statePartner, matchMethod: "state_fallback", matchedOn: state };
    }
  }
  return { partnerId: null, matchMethod: "none", matchedOn: null };
}

/** Index coverage/state rows into lookup maps (pure). Reused by the run orchestration (WP-017). */
export function buildCoverage(
  zipRows: readonly { zip5: string; partnerId: string }[],
  stateRows: readonly { state: string; partnerId: string }[],
): Coverage {
  const byZip = new Map<string, string>();
  for (const r of zipRows) byZip.set(r.zip5, r.partnerId);
  const byState = new Map<string, string>();
  for (const r of stateRows) byState.set(r.state, r.partnerId);
  return { byZip, byState };
}
