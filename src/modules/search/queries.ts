import { and, asc, desc, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, tenantWhere, type ScopeContext } from "@/lib/scope";
import { statusExpr } from "@/modules/leads/queries";
import { SEARCH_GROUP_LIMIT, isSearchable, type SearchResults } from "./schema";
import { leadIdentifierMatch, leadSearchMatch, partnerSearchMatch } from "./match";
import { can } from "@/lib/authz";

// ─────────────────────────────────────────────────────────────────────────────
// Global search (SRCH-01). Two groups — leads and partners — behind one debounced
// endpoint. MATCHING is boring exact-substring ILIKE with bound, metacharacter-escaped
// patterns, built by the shared modules/search/match builders (SRCH-06/07) — no fuzzy or
// typo-tolerant matching. RANKING (SRCH-08) is trigram similarity from pg_trgm, adopted in
// ADR-0051 (which supersedes SRCH-03's no-extension clause for ranking + index acceleration).
// Everything is scoped through lib/scope (PRN-08).
//
// Payload discipline (SRCH-04): a result row carries no more SELLER PII than the
// admin leads LIST row does — no seller phone, no seller email. Phone is a MATCHING
// input only (phone_norm), never an output field. The PARTNER group does carry the
// partner's business email: it is one of the fields matched on, the partners list
// already shows it, and a hit with no visible reason reads as a bug.
//
// The payload TYPES live in ./schema (pure) so the client overlay can import them
// without its module graph touching `@/db`; they are re-exported here for server
// callers that already import this module.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  SearchLeadRow,
  SearchPartnerRow,
  SearchGroup,
  SearchResults,
} from "./schema";

/**
 * The module's own admin-only guard (audit-tenancy F-1), mirroring listLeadsBoard's
 * BoardScopeError. NOT cosmetic, and not redundant with the route's gate:
 *
 *  • the partners group is TENANT-scoped only — a partner scope would see every
 *    partner in its workspace, including its competitors;
 *  • the status column comes from `statusExpr`, which resolves the GLOBAL latest
 *    status row without the R-22 `ownStatusAuthorScope` predicate the portal's own
 *    reads carry, so a re-routed lead would show a PRIOR owner's status.
 *
 * A future portal search must thread those two through FIRST — not relax this guard.
 */
export class SearchScopeError extends Error {
  constructor() {
    super("Global search is admin-only.");
    this.name = "SearchScopeError";
  }
}

function empty(q: string): SearchResults {
  return { q, leads: { total: 0, rows: [] }, partners: { total: 0, rows: [] } };
}

/**
 * SRCH-08 — the leads relevance score, computed server-side in SQL (PRN-15) so the overlay
 * only ever renders the order it was given.
 *
 * Two tiers, deliberately separated by a constant larger than any similarity can reach:
 *  • +2 when the row matched an IDENTIFIER (ref id / ZIP / phone digits) — typing an
 *    identifier means "take me to THAT lead", so it outranks every text hit outright;
 *  • + the best trigram `word_similarity` of the query against the seller's full name, the
 *    address and the city — so "cactus wren" puts the Cactus Wren address above a lead that
 *    merely shares a word.
 * `word_similarity(query, target)` scores the query's trigrams against the closest run of
 * words in the target (not the whole string), which is what a substring search wants; it is
 * case-insensitive, so it agrees with the ILIKE matching. `coalesce` because every one of
 * these columns is nullable and NULL would poison the greatest().
 *
 * The query text is a BOUND parameter here, exactly as in the match predicate — it is not
 * escaped, because this is a function argument, not a LIKE pattern.
 */
function leadRankExpr(q: string, identifierMatch: SQL | undefined): SQL<number> {
  const identifierBonus = identifierMatch ? sql`(case when ${identifierMatch} then 2 else 0 end)` : sql`0`;
  return sql<number>`${identifierBonus}::real + greatest(
    word_similarity(${q}::text, coalesce(${schema.leads.sellerFirst}, '') || ' ' || coalesce(${schema.leads.sellerLast}, '')),
    word_similarity(${q}::text, coalesce(${schema.leads.address}, '')),
    word_similarity(${q}::text, coalesce(${schema.leads.city}, ''))
  )`;
}

/**
 * SRCH-01/06/07/08 — one page of matches per group for `q`.
 *
 * Leads: seller first/last, address, city, ZIP and ref id by case-insensitive substring,
 * PLUS the digits of the query against `phone_norm` when it carries ≥4 — as an AND of the
 * query's terms (SRCH-06), through the shared `leadSearchMatch` builder that the admin leads
 * list and the portal list use too. Ordered by relevance (SRCH-08), then recency.
 * MLS-REMOVED leads are INCLUDED (with their verdict, so the overlay can badge them):
 * an admin searching an address must find the lead whatever the MLS said. RECALLED
 * (soft-deleted) leads are excluded everywhere, exactly as every sibling read does.
 *
 * Partners: name, ref id and email by substring; revoked and soft-deleted partners
 * are excluded (they are not a place to navigate to). Ordered by name similarity, then
 * name asc.
 *
 * A query shorter than SEARCH_MIN_CHARS short-circuits to an empty result without
 * touching the database.
 */
export async function globalSearch(scope: ScopeContext, q: string): Promise<SearchResults> {
  if (!can(scope, "leads.read")) throw new SearchScopeError();
  if (!isSearchable(q)) return empty(q);

  const db = getDb();

  // Every pattern inside the builders is a BOUND parameter with its LIKE metacharacters
  // escaped, so `%` matches a literal percent sign instead of every row (SRCH-07). The SAME
  // builder backs the admin leads list and the portal list — one definition of what `q` means.
  const leadMatch = leadSearchMatch(q);
  const partnerMatch = partnerSearchMatch(q);
  // Unreachable today — isSearchable already rejected everything that tokenizes to nothing —
  // but explicit, because the failure mode is silent: an undefined conjunct would drop OUT of
  // the `and()` below and return every row the scope allows instead of matching none.
  if (!leadMatch || !partnerMatch) return empty(q);

  // leadWhere (PRN-08) + the recall guard. No mls_status predicate — removed leads
  // stay findable by design (SRCH-01).
  const leadsWhere = and(leadWhere(scope), isNull(schema.leads.deletedAt), leadMatch)!;
  const leadRank = leadRankExpr(q, leadIdentifierMatch(q));

  const partnersWhere = and(
    tenantWhere(schema.partners, scope),
    isNull(schema.partners.deletedAt),
    ne(schema.partners.status, "revoked"),
    partnerMatch,
  )!;

  const sExpr = statusExpr(scope);

  const [leadRows, leadTotal, partnerRows, partnerTotal] = await Promise.all([
    db
      .select({
        refId: schema.leads.refId,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        mlsStatus: schema.leads.mlsStatus,
        scoreGroup: schema.leads.scoreGroup,
        scoreTotal: schema.leads.scoreTotal,
        status: sExpr,
      })
      .from(schema.leads)
      .where(leadsWhere)
      // SRCH-08: relevance first, recency as the tie-break. `rank` is an ORDER-BY-only
      // expression — it is never selected into the payload the overlay renders.
      .orderBy(desc(leadRank), desc(schema.leads.createdAt))
      .limit(SEARCH_GROUP_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(leadsWhere),
    db
      .select({
        id: schema.partners.id,
        name: schema.partners.name,
        refId: schema.partners.refId,
        color: schema.partners.color,
        email: schema.partners.email,
      })
      .from(schema.partners)
      .where(partnersWhere)
      // SRCH-08: closest name first, then the stable alphabetical order the group had before.
      .orderBy(desc(sql`word_similarity(${q}::text, ${schema.partners.name})`), asc(schema.partners.name))
      .limit(SEARCH_GROUP_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.partners).where(partnersWhere),
  ]);

  return {
    q,
    leads: {
      total: Number(leadTotal[0]?.n ?? 0),
      rows: leadRows.map((r) => ({
        refId: r.refId,
        seller: `${r.sellerFirst ?? ""} ${r.sellerLast ?? ""}`.trim() || "—",
        address: r.address,
        city: r.city,
        state: r.state,
        status: r.status,
        mlsStatus: r.mlsStatus,
        // Same rule the list row uses: an MLS-removed lead never shows the Hot mark.
        hot: r.mlsStatus === "kept" && r.scoreGroup === "hot" && r.scoreTotal !== null,
        scoreTotal: r.scoreTotal,
      })),
    },
    partners: {
      total: Number(partnerTotal[0]?.n ?? 0),
      rows: partnerRows,
    },
  };
}
