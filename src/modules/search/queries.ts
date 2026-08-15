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
} from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// Global search (SRCH-01). Two groups — leads and partners — behind one debounced
// endpoint. Boring ILIKE with bound, metacharacter-escaped patterns (SRCH-03): no
// extension, no new dependency. Everything is scoped through lib/scope (PRN-08).
//
// Payload discipline (SRCH-04): a result row carries no more PII than the admin
// leads LIST row already does — no seller phone, no seller email. Phone is a
// MATCHING input only (phone_norm), never an output field.
// ─────────────────────────────────────────────────────────────────────────────

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

function empty(q: string): SearchResults {
  return { q, leads: { total: 0, rows: [] }, partners: { total: 0, rows: [] } };
}

/**
 * SRCH-01 — one page of matches per group for `q`.
 *
 * Leads: seller first/last, address, city and ref id by case-insensitive substring,
 * PLUS the digits of the query against `phone_norm` when it carries ≥4 of them.
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
