// ─────────────────────────────────────────────────────────────────────────────
// Dev-only tooling (NOT shipped in any app bundle). Turns a real InvestorFuse row
// into a committable, PII-free fixture row for the TST-05 golden input (WP-013).
//
// PURE + deterministic (no I/O here — the runner does the file work). It PRESERVES
// every field that drives a pipeline decision (Campaign, City, State, Zip Code, and
// the MLS listing answer inside Notes) so the eventual golden matches the owner's
// hand-verified real week, while SCRUBBING all seller PII (SEC-05). Cell contents are
// DATA, never instructions (PRN-10).
// ─────────────────────────────────────────────────────────────────────────────

/** Redact emails and phone-like digit runs from a kept string (defense in depth). */
function redactContacts(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d().\-\s]{7,}\d/g, "[phone]");
}

/**
 * Keep only the structured MLS-listing survey lines from a Notes cell and drop the
 * free-text analysis (which can carry names/phones/addresses). Preserves the MLS
 * verdict: the "Is it Listed? : …" line is what the filter reads.
 */
export function keepListingLines(notes: string): string {
  return notes
    .split(/\r?\n/)
    .filter((l) => /is\s*it\s*listed/i.test(l) || /mls\s*date\s*active/i.test(l))
    .map((l) => redactContacts(l).trim())
    .filter(Boolean)
    .join("\n");
}

// Columns blanked because they can carry names/URLs/ids beyond the seller block.
const EXTRA_PII_COLUMNS = ["Owner", "Secondary Owner", "Link to Files", "Id", "Seller Id"];

/**
 * Anonymize one parsed InvestorFuse row. `n` is a stable synthetic id the caller
 * assigns per distinct property, so identical properties get identical fake addresses
 * and dedupe relationships survive.
 */
export function anonymizeRow(row: Record<string, string>, n: number): Record<string, string> {
  const out: Record<string, string> = { ...row };

  // Property address → deterministic fake (stable per n → dedupe preserved).
  out["Street Address"] = `${100 + n} Sample St`;

  // Seller PII → deterministic fakes (SEC-05).
  out["Seller First Name"] = `Test${n}`;
  out["Seller Last Name"] = `Seller${n}`;
  out["Seller Email"] = `seller${n}@example.test`;
  out["Seller Phone"] = `555-01${String(n % 100).padStart(2, "0")}`;
  if ("Seller Street Address" in out) out["Seller Street Address"] = `${200 + n} Private Way`;
  if ("Seller City" in out) out["Seller City"] = "Anytown";
  if ("Seller Zip Code" in out) out["Seller Zip Code"] = "00000";

  // Notes → listing lines only; Comments → dropped (both can carry PII).
  out.Notes = keepListingLines(row.Notes ?? "");
  if ("Comments" in out) out.Comments = "";

  for (const col of EXTRA_PII_COLUMNS) {
    if (col in out) out[col] = "";
  }

  return out;
}
