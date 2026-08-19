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
/**
 * SRCH-06 — the most whitespace-separated terms a query is split into. Six is well past
 * any real search ("first last street city state zip") while keeping the AND-of-ORs
 * predicate a fixed, plannable size: each term costs one OR-group over seven columns.
 */
export const SEARCH_MAX_TERMS = 6;

/**
 * The ONE normalization the query text goes through. The client applies it before it
 * builds the request URL and before it compares the server's echoed `q`; the endpoint
 * applies it (through SearchQuerySchema) to whatever actually arrives. Two copies of
 * this rule would strand the overlay on a permanent skeleton the moment they disagreed
 * — e.g. a trailing space or an over-long paste, where the echo would never equal the
 * raw term the client was waiting on (audit-tenancy F-3).
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().slice(0, SEARCH_MAX_CHARS);
}

/** GET /api/search?q= — same graceful contract as the leads list: a nonsense param
 *  degrades to an empty query (⇒ empty result, 200) instead of a 400. */
export const SearchQuerySchema = z.object({
  q: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" ? normalizeSearchTerm(v) : "")),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ─── Payload shapes ──────────────────────────────────────────────────────────
// The result types live HERE, in the pure module, not beside the query builders:
// the overlay is a client component, and a type-only import that resolves into a
// module which pulls in `@/db` is one refactor away from dragging the server DB
// client into the client bundle (this repo has shipped that crash before).
// `modules/search/queries` re-exports them for server callers.

export interface SearchLeadRow {
  refId: string;
  /** "First Last", or "—" when the source carried no name (same as the list row). */
  seller: string;
  address: string | null;
  city: string | null;
  state: string | null;
  /** The SAME derived status the list/board show — "Removed MLS" for a removed lead. */
  status: string;
  /** The MLS verdict, so the overlay can badge a removed lead (it is still findable). */
  mlsStatus: "kept" | "removed";
  /** SCR: the smart-tag Hot flag (kept leads only) + its score, for the HotLeadIcon chip. */
  hot: boolean;
  scoreTotal: number | null;
}

export interface SearchPartnerRow {
  id: string;
  name: string;
  refId: string;
  color: string;
  /** The partner's BUSINESS contact address — deliberately in the payload: it is one of
   *  the three fields the query matches on, and a hit with no visible reason reads as a
   *  bug. Admin-only surface, and the partners list already shows it. This is not seller
   *  PII, which never appears here (SRCH-04). */
  email: string | null;
}

export interface SearchGroup<T> {
  /** True total behind the capped rows (the overlay renders "Leads · 12"). */
  total: number;
  rows: T[];
}

export interface SearchResults {
  /** Echoed back so the client can ignore a response that lost the race with typing. */
  q: string;
  leads: SearchGroup<SearchLeadRow>;
  partners: SearchGroup<SearchPartnerRow>;
}

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

/**
 * SRCH-06 — split a query into its search TERMS: runs of whitespace collapse, empties drop,
 * and at most SEARCH_MAX_TERMS come back. "marcus  phoenix" ⇒ ["marcus", "phoenix"], which
 * the match builder turns into an AND of per-term column ORs.
 *
 * DM-12: the bound is on the SPLIT, not on the result — `split(sep, limit)` stops producing
 * segments at the limit, so a 120-character query of single letters never materialises 60
 * terms just to have 54 of them thrown away. Terms past the cap are silently dropped rather
 * than rejected: the query still runs, on its first six terms (the same graceful-degradation
 * contract as the over-long paste that SEARCH_MAX_CHARS truncates).
 *
 * PURE. Escaping happens downstream, per term, through containsPattern — a term is raw user
 * text here and must never be interpolated into SQL.
 */
export function tokenize(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/, SEARCH_MAX_TERMS)
    .filter((t) => t.length > 0);
}

/** True when the (already trimmed) query is long enough to run (SRCH-01). */
export function isSearchable(q: string): boolean {
  return q.trim().length >= SEARCH_MIN_CHARS;
}
