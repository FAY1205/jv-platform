import { and, asc, desc, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, tenantWhere, type ScopeContext } from "@/lib/scope";
import { statusExpr } from "@/modules/leads/queries";
import {
  SEARCH_GROUP_LIMIT,
  containsPattern,
  isSearchable,
  searchPhoneDigits,
  type SearchResults,
} from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Global search (SRCH-01). Two groups — leads and partners — behind one debounced
// endpoint. Boring ILIKE with bound, metacharacter-escaped patterns (SRCH-03): no
// extension, no new dependency. Everything is scoped through lib/scope (PRN-08).
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
 * SRCH-01 — one page of matches per group for `q`.
 *
 * Leads: seller first/last, address, city, ZIP and ref id by case-insensitive
 * substring, PLUS the digits of the query against `phone_norm` when it carries ≥4.
 * MLS-REMOVED leads are INCLUDED (with their verdict, so the overlay can badge them):
 * an admin searching an address must find the lead whatever the MLS said. RECALLED
 * (soft-deleted) leads are excluded everywhere, exactly as every sibling read does.
 *
 * Partners: name, ref id and email by substring; revoked and soft-deleted partners
 * are excluded (they are not a place to navigate to).
 *
 * A query shorter than SEARCH_MIN_CHARS short-circuits to an empty result without
 * touching the database.
 */
export async function globalSearch(scope: ScopeContext, q: string): Promise<SearchResults> {
  if (scope.role !== "admin") throw new SearchScopeError();
  if (!isSearchable(q)) return empty(q);

  const db = getDb();
  const like = containsPattern(q);
  const digits = searchPhoneDigits(q);

  // Every pattern is a BOUND parameter with its LIKE metacharacters escaped, so `%`
  // matches a literal percent sign instead of every row (SRCH-01).
  const leadMatch = or(
    ilike(schema.leads.sellerFirst, like),
    ilike(schema.leads.sellerLast, like),
    ilike(schema.leads.address, like),
    ilike(schema.leads.city, like),
    // Parity with the leads list's own `q` filter (modules/leads/queries listLeads):
    // an admin typing a ZIP must get the same answer from both search boxes.
    ilike(schema.leads.zip, like),
    ilike(schema.leads.refId, like),
    // phone_norm is digits-only (NRM-02), so "(602) 555-0148" and "602-555" both find it.
    ...(digits ? [ilike(schema.leads.phoneNorm, containsPattern(digits))] : []),
  )!;
  // leadWhere (PRN-08) + the recall guard. No mls_status predicate — removed leads
  // stay findable by design (SRCH-01).
  const leadsWhere = and(leadWhere(scope), isNull(schema.leads.deletedAt), leadMatch)!;

  const partnerMatch = or(
    ilike(schema.partners.name, like),
    ilike(schema.partners.refId, like),
    ilike(schema.partners.email, like),
  )!;
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
      .orderBy(desc(schema.leads.createdAt))
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
      .orderBy(asc(schema.partners.name))
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
