import { and, ilike, or, type SQL } from "drizzle-orm";
import * as schema from "@/db/schema";
import { containsPattern, searchPhoneDigits, tokenize } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// SRCH-06/07 — the ONE search-match builder behind all three surfaces: the Ctrl-K
// global search (modules/search/queries), the admin leads list + board
// (modules/leads/queries `qTextMatch`) and the partner portal list
// (modules/portal/queries). Before this module each surface hand-rolled its own OR
// of ILIKEs, and two of the three interpolated the RAW query into the pattern — so a
// typed `%` matched every row the caller could see.
//
// PRN-08 — SCOPE IS NOT THIS MODULE'S JOB. Every builder here returns a NARROWING
// conjunct: a predicate over lead/partner content columns only, which callers AND into
// their own already-scoped `where`. Nothing here reads tenant_id, partner_id or role,
// and nothing here can widen a caller's visible set — the portal's "can only narrow"
// property survives unchanged because the builder cannot express anything but a filter.
//
// SEC-05 — the query text is bound as a PARAMETER and never logged. There is no logging
// in this module by design: `q` can carry a seller's name or phone number.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SRCH-07 — does this term carry the digits that make the phone alternative meaningful?
 *
 * The phone pattern is derived from the WHOLE query (searchPhoneDigits(q)), because a
 * formatted number splits across terms: "(602) 555-0148" tokenizes to ["(602)", "555-0148"]
 * and neither half alone is the number. But offering that whole-query pattern to EVERY term
 * slot would let one phone hit satisfy the text terms too — "smith 6025550" would return
 * every lead with that phone whether or not the seller is a Smith. So the alternative is
 * offered only to terms that themselves contain a digit; a purely alphabetic term must match
 * a text column.
 */
function termCanBePhone(term: string): boolean {
  return /\d/.test(term);
}

/**
 * SRCH-06/07 — the lead free-text predicate for `q`, or undefined for a blank query
 * (callers push it conditionally).
 *
 * SEMANTICS, exactly:
 *  • the query is tokenized into at most SEARCH_MAX_TERMS terms (SRCH-06, DM-12 bound);
 *  • EVERY term must match (AND) — "john phoenix" finds John's Phoenix lead, and no longer
 *    requires the two words to be adjacent in one column;
 *  • each term may match ANY searched column (OR): seller first/last, address, city, ZIP,
 *    ref id — all case-insensitive substring, all through the ONE escapeLike, so `%` and `_`
 *    are LITERALS rather than wildcards (SRCH-07);
 *  • PHONE (SRCH-07): when the whole query carries ≥ SEARCH_PHONE_MIN_DIGITS digits, those
 *    digits become an extra OR-alternative on `phone_norm` (digits-only, NRM-02) — available
 *    only to terms that contain a digit (see termCanBePhone). So "602-555" matches on its own,
 *    "(602) 555-0148" matches across both of its terms, and "smith 6025550" needs the seller
 *    name AND the number.
 *
 * A single-term query behaves exactly as it did before this WP, minus the wildcard hole.
 */
export function leadSearchMatch(q: string): SQL | undefined {
  const terms = tokenize(q);
  if (terms.length === 0) return undefined;

  const digits = searchPhoneDigits(q);
  const phonePattern = digits ? containsPattern(digits) : null;

  return and(
    ...terms.map((term) => {
      const like = containsPattern(term);
      return or(
        ilike(schema.leads.sellerFirst, like),
        ilike(schema.leads.sellerLast, like),
        ilike(schema.leads.address, like),
        ilike(schema.leads.city, like),
        ilike(schema.leads.zip, like),
        ilike(schema.leads.refId, like),
        ...(phonePattern && termCanBePhone(term)
          ? [ilike(schema.leads.phoneNorm, phonePattern)]
          : []),
      )!;
    }),
  );
}

/**
 * SRCH-06 — the partner free-text predicate: the same AND-of-terms rule over the partner's
 * own columns (name, ref id, business email). No phone leg — partners carry no phone_norm,
 * and this is the admin-only Ctrl-K group.
 */
export function partnerSearchMatch(q: string): SQL | undefined {
  const terms = tokenize(q);
  if (terms.length === 0) return undefined;

  return and(
    ...terms.map((term) => {
      const like = containsPattern(term);
      return or(
        ilike(schema.partners.name, like),
        ilike(schema.partners.refId, like),
        ilike(schema.partners.email, like),
      )!;
    }),
  );
}

/**
 * SRCH-08 — "did this lead match on an IDENTIFIER?" (ref id, ZIP, or the phone digits),
 * the top tier of the Ctrl-K ranking. Typing a ref id or a phone number is an unambiguous
 * "take me to THAT lead"; a name or street fragment is a browse. Deliberately an OR (any
 * term hitting any identifier is enough) rather than the AND the match predicate uses: this
 * is a RANK input on rows that already matched, not a filter.
 *
 * Ranking is a Ctrl-K concern only — the leads list and the portal list keep their explicit
 * sort columns, so neither imports this.
 */
export function leadIdentifierMatch(q: string): SQL | undefined {
  const terms = tokenize(q);
  if (terms.length === 0) return undefined;

  const digits = searchPhoneDigits(q);

  return or(
    ...terms.flatMap((term) => {
      const like = containsPattern(term);
      return [ilike(schema.leads.refId, like), ilike(schema.leads.zip, like)];
    }),
    ...(digits ? [ilike(schema.leads.phoneNorm, containsPattern(digits))] : []),
  );
}
