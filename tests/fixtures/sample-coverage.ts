// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE coverage for testing/preview only (owner-requested 2026-07-08). NOT real
// territory data — it exists so the national real week actually distributes end-to-
// end. Real coverage import is a separate, deferred decision. Pure data (no imports)
// so both vitest and the dev preview script can consume it.
//
// State fallbacks cover the states present in the anonymized week (27) plus the four
// real seed states. ZIP entries demonstrate ASN-01 zip precedence (a metro routed to
// a specialist, overriding its state fallback — the ASN-02 "regional exception").
// Partner ids here are partner NAMES (matched to the seed PARTNER_PALETTE colors).
// ─────────────────────────────────────────────────────────────────────────────

export const SAMPLE_STATE_RULES: readonly { state: string; partnerId: string }[] = [
  { state: "TX", partnerId: "Michael Pinter" },
  { state: "CA", partnerId: "Blake McCreight" },
  { state: "FL", partnerId: "Josh Ax" },
  { state: "AZ", partnerId: "Jeff Lister" },
  { state: "WA", partnerId: "Dylan Tanaka" },
  { state: "NV", partnerId: "Randy Wolfe" },
  { state: "MN", partnerId: "Joe Lieber" },
  { state: "NM", partnerId: "Forrest McGhee" },
  { state: "OR", partnerId: "Jason Beery" },
  { state: "OH", partnerId: "Michael Pinter" },
  { state: "CO", partnerId: "Blake McCreight" },
  { state: "HI", partnerId: "Josh Ax" },
  // The four real seed fallbacks (absent from week 27, kept for completeness).
  { state: "SC", partnerId: "Randy Wolfe" },
  { state: "VA", partnerId: "Forrest McGhee" },
  { state: "NJ", partnerId: "Josh Ax" },
  { state: "CT", partnerId: "Josh Ax" },
];

export const SAMPLE_ZIP_COVERAGE: readonly { zip5: string; partnerId: string }[] = [
  { zip5: "77021", partnerId: "Joe Lieber" }, // Houston TX → overrides the TX fallback (Michael Pinter)
  { zip5: "90815", partnerId: "Jason Beery" }, // Long Beach CA → overrides the CA fallback (Blake McCreight)
];
