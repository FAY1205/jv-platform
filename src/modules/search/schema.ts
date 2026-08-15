import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Global search (SRCH-01) — the query contract + the pure helpers the query layer
// builds its patterns with. PURE: no DB, no I/O, so the escaping rules that keep a
// user's `%` from turning into "match everything" are unit-testable on their own.
// ─────────────────────────────────────────────────────────────────────────────

/** Below this, the endpoint short-circuits to an empty result (SRCH-01): a 1-char
 *  query would scan the whole tenant for nothing useful. */
export const SEARCH_MIN_CHARS = 2;
/** Rows returned per group. No pagination in v1 — the overlay is a jump-to, not a list. */
export const SEARCH_GROUP_LIMIT = 10;
/** Fewer digits than this and a numeric query is treated as text only — "12" would
 *  otherwise match a third of every phone number in the tenant. */
export const SEARCH_PHONE_MIN_DIGITS = 4;
/** Hard cap on the accepted query length (mirrors the leads list's `q`). */
export const SEARCH_MAX_CHARS = 120;

/** GET /api/search?q= — same graceful contract as the leads list: a nonsense param
 *  degrades to an empty query (⇒ empty result, 200) instead of a 400. */
export const SearchQuerySchema = z.object({
  q: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim().slice(0, SEARCH_MAX_CHARS) : "")),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * Escape the LIKE/ILIKE metacharacters in user input so the query text is matched
 * LITERALLY (SRCH-01). Without this `q=%` becomes the pattern `%%%` — every lead in
 * the tenant — and `_` becomes a single-character wildcard. Postgres LIKE's default
 * escape character is the backslash, so the backslash itself is escaped first (the
 * single regex pass handles that: each of `\ % _` maps to `\<char>`).
 *
 * The escaped text is still bound as a PARAMETER (drizzle `ilike`), never interpolated —
 * this closes the wildcard hole, not an injection hole.
 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%…%` substring pattern for `raw`, with its metacharacters escaped. */
export function containsPattern(raw: string): string {
  return `%${escapeLike(raw)}%`;
}

/**
 * The digits of a query, when there are enough of them to be a phone fragment
 * (SEARCH_PHONE_MIN_DIGITS). `(602) 555-0148` ⇒ `6025550148`, matched against
 * `leads.phone_norm` (itself digits-only, NRM-02). Returns null when the query
 * carries too few digits to search phones with.
 */
export function searchPhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= SEARCH_PHONE_MIN_DIGITS ? digits : null;
}

/** True when the (already trimmed) query is long enough to run (SRCH-01). */
export function isSearchable(q: string): boolean {
  return q.trim().length >= SEARCH_MIN_CHARS;
}
