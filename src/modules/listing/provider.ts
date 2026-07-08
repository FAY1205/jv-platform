// ─────────────────────────────────────────────────────────────────────────────
// Listing check provider seam (SEAM-02, LST-02). A provider takes a lead's address
// and returns a listing status + optional verify link. LinkOnly is the always-
// available V1 default; an automated data provider can be dropped in behind this
// same interface later without touching callers. LST-03: it's a labeled heuristic
// and its flags NEVER remove leads (PRN-09) — that's the caller's contract.
// ─────────────────────────────────────────────────────────────────────────────

export type ListingStatus = "yes" | "no" | "unknown";

export interface ListingLead {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface ListingResult {
  provider: string;
  status: ListingStatus;
  /** A link the admin/partner can open to verify manually (LinkOnly). */
  link?: string;
}

export interface ListingCheckProvider {
  readonly name: string;
  check(lead: ListingLead): ListingResult;
}
