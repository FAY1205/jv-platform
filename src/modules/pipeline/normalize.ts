// ─────────────────────────────────────────────────────────────────────────────
// Normalization (NRM-01/02). PURE — no I/O (PRN-01).
// Display values are preserved elsewhere; these functions produce the canonical
// forms used for matching, assignment, and the dedupe key.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NRM-01: ZIP → first digit-group, first 5 digits, left-padded to 5.
 * Excel drops leading zeros and CT/NJ ZIPs start with 0, so `6404` → `06404`
 * and `06404-1234` → `06404`. Applied to BOTH lead ZIPs and coverage import.
 */
export function normalizeZip(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  const firstGroup = String(raw)
    .split(/\D+/)
    .filter(Boolean)[0];
  if (!firstGroup) return "";
  return firstGroup.slice(0, 5).padStart(5, "0");
}

/** NRM-02: phone → digits only, last 10 (drops a leading country code). */
export function normalizePhone(raw: string | number | null | undefined): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(-10);
}

const STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR",
};

const STATE_CODES: ReadonlySet<string> = new Set(Object.values(STATE_NAME_TO_CODE));

/** NRM-02: state → 2-letter USPS code. Accepts codes and full names (any case). */
export function normalizeState(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!s) return "";
  if (s.length === 2) {
    const code = s.toUpperCase();
    return STATE_CODES.has(code) ? code : "";
  }
  return STATE_NAME_TO_CODE[s] ?? "";
}

/**
 * NRM-02: address normalized for the dedupe key — lowercase, punctuation → space,
 * whitespace collapsed. The original display value is preserved separately.
 */
export function normalizeAddress(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DM-01: dedupe_key = normalized(address) + zip5. Phone (last 10) is a secondary
 * confirm key, never primary — computed separately by the dedupe step.
 */
export function computeDedupeKey(
  address: string | null | undefined,
  zip: string | number | null | undefined,
): string {
  return `${normalizeAddress(address)}|${normalizeZip(zip)}`;
}
