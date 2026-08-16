import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, leadWhere, type ScopeContext } from "@/lib/scope";
import { SEED_LEAD_STATUSES, currentStatus } from "@/modules/portal/statuses";
import type { ScoreGroup, ScoreStatus, ScoreBreakdown } from "@/modules/pipeline/score";
import { tagsByLeadRef, type TagView } from "@/modules/tags/tags";
import { noteAndTaskActivity, sortNewestFirst, type LeadActivity } from "./timeline";
import { BOARD_COLUMNS, BOARD_PAGE_SIZE } from "./board";
import type { BoardQuery, LeadsQuery } from "./schema";

/**
 * TAG-03 — the `?tags=` filter predicate, shared by the list and the board so both mean the
 * same thing: OR / any-of (a lead matches if it carries ANY of the selected tags).
 *
 * An EXISTS subquery rather than a join: a join would multiply a lead's row once per
 * matching tag and quietly inflate `count(*)` on the list and `col_total` on the board.
 * Every value is bound (`${...}`), never interpolated — the ids arrive from a URL. The
 * subquery carries its OWN tenant predicate (ADR-0013 defence-in-depth): the outer query
 * is already tenant-scoped, but a junction row is only reachable through its own tenant.
 * Written as a raw fragment so the ORM builder path (list) and the raw CTE (board) share
 * ONE definition — `leads.id` resolves identically in both.
 *
 * The tenant leg is `tenantWhere(schema.leadTags, …)`, not a hand-rolled `eq` (audit-tenancy
 * F-1, the same rule the partners join two functions below already follows): a future change
 * to tenant filtering reaches this predicate instead of missing a private copy (R-24). That
 * is also why the subquery is UNALIASED — the drizzle column refs render the TABLE name
 * (`"lead_tags"."tenant_id"`), so an alias would put the fragments out of scope. Nothing in
 * either outer query references `lead_tags`, so unaliased is unambiguous.
 */
function taggedWithAny(scope: ScopeContext, tagIds: readonly string[]): SQL {
  const ids = sql.join(tagIds.map((id) => sql`${id}::uuid`), sql`, `);
  return sql`exists (
    select 1 from lead_tags
    where ${schema.leadTags.leadId} = ${schema.leads.id}
      and ${tenantWhere(schema.leadTags, scope)}
      and ${schema.leadTags.tagId} in (${ids})
  )`;
}

/**
 * WP-UX-3 — the free-text search predicate, shared by the list and the board so `?q=`
 * means exactly one thing across both endpoints (the `taggedWithAny` precedent above).
 * Returns undefined for a blank query so callers can push conditionally.
 */
function qTextMatch(q: string): SQL | undefined {
  if (!q) return undefined;
  const like = `%${q}%`;
  return or(
    ilike(schema.leads.sellerFirst, like), ilike(schema.leads.sellerLast, like),
    ilike(schema.leads.address, like), ilike(schema.leads.city, like),
    ilike(schema.leads.zip, like), ilike(schema.leads.refId, like),
  );
}

/** Currently-unmatched = kept, not pipeline-routed, not yet manually assigned.
 *  Exported for the bulk-assign command's shared eligibility guard (S6/ASN-03). */
export function unmatchedWhere(scope: ScopeContext): SQL {
  return and(
    tenantWhere(schema.leads, scope),
    isNull(schema.leads.deletedAt),
    eq(schema.leads.mlsStatus, "kept"),
    isNull(schema.leads.partnerId),
    isNull(schema.leads.manualPartnerId),
  )!;
}

// The global admin leads list (ADM). Tenant-scoped through the guard (PRN-08),
// server-side paginated (FEP-03), filterable. Admin-only — the route enforces
// role; partners have their own scoped portal list.

export interface GlobalLeadRow {
  refId: string;
  seller: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  campaign: string | null;
  mlsStatus: "kept" | "removed";
  /** Derived: "Removed MLS" for removed leads, else the current workflow status. */
  status: string;
  /** Scoring (SCR). Group is null when the lead couldn't be scored (incomplete). */
  scoreTotal: number | null;
  scoreGroup: "hot" | "warm" | "nurture" | null;
  partner: { id: string; name: string; refId: string; color: string } | null;
  receivedAt: string;
  /** Last activity (latest status change or manual assignment), or null. */
  modifiedAt: string | null;
  /** TAG-04: the lead's tag chips, ordered by lower(name). Always present (possibly empty)
   *  so the row renderer never branches on undefined. */
  tags: TagView[];
}

export interface GlobalLeadsPage {
  leads: GlobalLeadRow[];
  page: number;
  pageSize: number;
  total: number;
}

// Correlated latest-status subquery — the current workflow status + when it last
// changed, per lead. Indexed by lead_status_history(lead_id).
// Scope-aware builders (ADR-0013 defence-in-depth, WP-F1): each caller passes the
// live ScopeContext so the subqueries below carry their own explicit tenant predicate.
// Both order by `created_at desc, id desc` — the SAME deliberate tie-break the write
// path uses (portal/status-update.ts). Two rows can share a created_at (one clock tick,
// or a scripted backfill); without the id leg Postgres is free to pick either, so a lead
// could read as "Contacted" in the list and "Closed" on the board on consecutive
// requests (audit-tenancy F-5). One definition of "latest", everywhere.
function latestStatus(scope: ScopeContext) {
  // self-scoped (ADR-0013 defence-in-depth): correlation key leads.id is globally unique, but
  // carry an explicit tenant predicate too so no single dropped predicate can widen scope.
  return sql`(select status from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)} order by created_at desc, id desc limit 1)`;
}
function latestAt(scope: ScopeContext) {
  // self-scoped (ADR-0013 defence-in-depth): correlation key leads.id is globally unique, but
  // carry an explicit tenant predicate too so no single dropped predicate can widen scope.
  return sql`(select created_at from lead_status_history where lead_id = ${schema.leads.id} and ${tenantWhere(schema.leadStatusHistory, scope)} order by created_at desc, id desc limit 1)`;
}
// The displayed status: removed leads read "Removed MLS"; else current or New.
// Exported (SRCH-01) so the global-search endpoint shows the SAME status string the
// list and the board show, rather than re-deriving "what status is this lead in"
// (PRN-15). Scope-aware — pass the caller's live ScopeContext.
export function statusExpr(scope: ScopeContext) {
  return sql<string>`case when ${schema.leads.mlsStatus} = 'removed' then 'Removed MLS' else coalesce(${latestStatus(scope)}, 'New') end`;
}
function modifiedExpr(scope: ScopeContext) {
  return sql<Date | null>`coalesce(${latestAt(scope)}, ${schema.leads.manualAssignedAt})`;
}
export async function listLeads(scope: ScopeContext, query: LeadsQuery): Promise<GlobalLeadsPage> {
  const db = getDb();
  const offset = (query.page - 1) * query.pageSize;

  const conds: SQL[] = [tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt) as unknown as SQL];
  if (query.partnerId === "unmatched") {
    conds.push(and(eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.partnerId), isNull(schema.leads.manualPartnerId))!);
  } else if (query.partnerId) {
    conds.push(partnerOwnsLead(query.partnerId)); // effective owner
  }
  if (query.state) conds.push(eq(schema.leads.state, query.state));
  if (query.source) conds.push(eq(schema.leads.campaign, query.source));
  // Hot filter (SCR): kept leads only — an MLS-removed lead is never treated as hot.
  if (query.hot) conds.push(and(eq(schema.leads.scoreGroup, "hot"), eq(schema.leads.mlsStatus, "kept"))!);
  // TAG-03: any-of. Combines with every other filter by plain AND — "hot AND (tag A or B)".
  if (query.tags.length > 0) conds.push(taggedWithAny(scope, query.tags));
  if (query.dateFrom) conds.push(gte(schema.leads.createdAt, new Date(`${query.dateFrom}T00:00:00Z`)));
  if (query.dateTo) conds.push(lte(schema.leads.createdAt, new Date(`${query.dateTo}T23:59:59Z`)));
  // Built once per call so the status filter, sort column, and select projection below
  // all share the identical scope-aware subqueries (ADR-0013 defence-in-depth, WP-F1).
  const sExpr = statusExpr(scope);
  const mExpr = modifiedExpr(scope);

  if (query.statuses.length > 0) {
    conds.push(or(...query.statuses.map((s) => sql`${sExpr} = ${s}`))!);
  }
  const textMatch = qTextMatch(query.q);
  if (textMatch) conds.push(textMatch);
  const where = and(...conds);

  const sortCol =
    query.sort === "lead" ? schema.leads.refId :
    query.sort === "modified" ? mExpr :
    query.sort === "seller" ? sql`lower(${schema.leads.sellerLast})` :
    schema.leads.createdAt;
  const dirFn = query.dir === "asc" ? asc : desc;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        refId: schema.leads.refId,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        zip: schema.leads.zip,
        campaign: schema.leads.campaign,
        mlsStatus: schema.leads.mlsStatus,
        scoreTotal: schema.leads.scoreTotal,
        scoreGroup: schema.leads.scoreGroup,
        createdAt: schema.leads.createdAt,
        status: sExpr,
        modifiedAt: mExpr,
        pId: schema.partners.id,
        pName: schema.partners.name,
        pRef: schema.partners.refId,
        pColor: schema.partners.color,
      })
      .from(schema.leads)
      // Effective owner = manual assignment if present, else the pipeline routing.
      // R-65: the partner must be same-tenant too — a mis-set partner_id must resolve to NULL
      // (no partner shown), never surface another tenant's partner name/colour (leftJoin).
      // C-18 (decided): this DISPLAY join deliberately does NOT filter deleted_at — a soft-deleted
      // partner keeps lending its name/colour to the historical leads it handled (PRN-05: who
      // handled a lead is history and must not silently blank to "Unmatched"). Contrast
      // unmatchedCoverageMatches, which DOES exclude deleted/revoked partners because it ROUTES new
      // work — a different question. The board join (listLeadsBoard) follows the same rule.
      .leftJoin(
        schema.partners,
        and(
          eq(schema.partners.id, sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`),
          eq(schema.partners.tenantId, scope.tenantId),
        ),
      )
      .where(where)
      .orderBy(dirFn(sortCol), desc(schema.leads.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(where),
  ]);

  // TAG-04: one extra round trip for the WHOLE page's chips (never per row). Runs after the
  // page query because it is keyed on the refs that actually came back.
  const tagsByRef = await tagsByLeadRef(db, scope, rows.map((r) => r.refId));

  return {
    leads: rows.map((r) => ({
      refId: r.refId,
      tags: tagsByRef.get(r.refId) ?? [],
      seller: `${r.sellerFirst ?? ""} ${r.sellerLast ?? ""}`.trim() || "—",
      address: r.address ?? "—",
      city: r.city,
      state: r.state,
      zip: r.zip,
      campaign: r.campaign,
      mlsStatus: r.mlsStatus,
      status: r.status,
      scoreTotal: r.scoreTotal,
      scoreGroup: r.scoreGroup,
      partner: r.pId ? { id: r.pId, name: r.pName!, refId: r.pRef!, color: r.pColor! } : null,
      receivedAt: r.createdAt.toISOString(),
      modifiedAt: r.modifiedAt ? new Date(r.modifiedAt).toISOString() : null,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRows[0]?.n ?? 0),
  };
}

// ── Board view (KAN-02) ───────────────────────────────────────────────────────
// The same leads the list serves, bucketed by their CURRENT status. It reuses the
// module's own correlated latest-status subqueries (statusExpr/latestAt) rather than
// re-deriving "what status is this lead in" (PRN-15), so a lead reads identically in
// both views. Kept + non-deleted only (KAN-08); scoped through leadWhere (PRN-08).

export interface BoardCard {
  refId: string;
  seller: string;
  city: string | null;
  state: string | null;
  /** Effective owner (manual overlay, else pipeline routing); null ⇒ render "Unmatched" (KAN-08). */
  partner: { name: string; refId: string; color: string } | null;
  /** SCR: hot group flag + its score, for the HotLeadMark. */
  hot: boolean;
  scoreTotal: number | null;
  /** ISO of the latest status row, else the lead's createdAt (KAN-03 feeds boardAge). */
  statusSince: string;
  /** TAG-04: the card's tag chips (the card caps the render at 2 + "+n"). */
  tags: TagView[];
}

export interface BoardColumn {
  status: string;
  /** TRUE total for the column, not the page length (KAN-02). */
  total: number;
  cards: BoardCard[];
  /** Which page of this column `cards` is (1-based). */
  page: number;
}

export interface LeadsBoard {
  columns: BoardColumn[];
  pageSize: number;
}

/** One result row: the column's true total, plus (when the requested slice covers it)
 *  a card. A column whose slice is empty still returns its totals row with a null
 *  ref_id, so the true count survives even on an out-of-range page. */
type BoardRow = {
  ref_id: string | null;
  seller_first: string | null;
  seller_last: string | null;
  city: string | null;
  state: string | null;
  score_total: number | null;
  score_group: string | null;
  p_name: string | null;
  p_ref: string | null;
  p_color: string | null;
  col_status: string;
  status_since: string | Date | null;
  col_total: number;
};

/**
 * KAN-02 — one page of every column (or, with `query.status`, one page of that single
 * column for its "Load more"). ONE round trip: a window over the scoped lead set gives
 * both the per-column true totals and the requested slice.
 */
export class BoardScopeError extends Error {
  constructor() {
    super("The leads board is admin-only.");
    this.name = "BoardScopeError";
  }
}

export async function listLeadsBoard(scope: ScopeContext, query: BoardQuery): Promise<LeadsBoard> {
  // Admin-only in v1 (owner decision; the route gates this too — this is the module's own
  // guard, audit-tenancy F-7). It is NOT cosmetic: statusExpr/latestAt resolve the GLOBAL
  // latest status row, without the R-22 `ownStatusAuthorScope` predicate the portal's own
  // reads carry. A partner board would therefore bucket a re-routed lead by a PRIOR
  // owner's status change. Any future portal board must thread that predicate through
  // these subqueries FIRST — not relax this guard.
  if (scope.role !== "admin") throw new BoardScopeError();

  const db = getDb();
  const wanted = query.status ? [query.status] : [...BOARD_COLUMNS];
  const offset = (query.page - 1) * BOARD_PAGE_SIZE;

  const conds: SQL[] = [
    leadWhere(scope),
    isNull(schema.leads.deletedAt) as unknown as SQL,
    // KAN-08: removed-from-MLS leads never appear on the board (and recalled ones are
    // already excluded by deleted_at above).
    eq(schema.leads.mlsStatus, "kept"),
  ];
  // KAN-09: the two list filters the board carries over.
  if (query.partnerId === "unmatched") {
    conds.push(and(isNull(schema.leads.partnerId), isNull(schema.leads.manualPartnerId))!);
  } else if (query.partnerId) {
    conds.push(partnerOwnsLead(query.partnerId)); // effective owner
  }
  if (query.hot) conds.push(eq(schema.leads.scoreGroup, "hot"));
  // TAG-03: the same any-of predicate the list uses, inside the CTE's `base` so the per-column
  // TOTALS are filtered too — a filter applied only to the card slice would report counts for
  // leads the board isn't showing.
  if (query.tags.length > 0) conds.push(taggedWithAny(scope, query.tags));
  // WP-UX-3 (audit 2.3): the REST of the list's filter set, same predicates, inside `base`
  // for the same totals-honesty reason. `statuses` is deliberately absent — the columns are
  // the status filter (KAN-09).
  if (query.state) conds.push(eq(schema.leads.state, query.state));
  if (query.source) conds.push(eq(schema.leads.campaign, query.source));
  if (query.dateFrom) conds.push(gte(schema.leads.createdAt, new Date(`${query.dateFrom}T00:00:00Z`)));
  if (query.dateTo) conds.push(lte(schema.leads.createdAt, new Date(`${query.dateTo}T23:59:59Z`)));
  const boardTextMatch = qTextMatch(query.q);
  if (boardTextMatch) conds.push(boardTextMatch);
  const where = and(...conds)!;

  // Reused, not re-derived (PRN-15): the same scope-aware correlated subqueries the
  // list view resolves current status / last-change with (ADR-0013 defence-in-depth).
  const sExpr = statusExpr(scope);
  const sinceExpr = sql`coalesce(${latestAt(scope)}, ${schema.leads.createdAt})`;
  const wantedList = sql.join(wanted.map((s) => sql`${s}`), sql`, `);

  const rows = (await db.execute(sql`
    with base as (
      select
        ${schema.leads.refId} as ref_id,
        ${schema.leads.sellerFirst} as seller_first,
        ${schema.leads.sellerLast} as seller_last,
        ${schema.leads.city} as city,
        ${schema.leads.state} as state,
        ${schema.leads.scoreTotal} as score_total,
        ${schema.leads.scoreGroup} as score_group,
        ${schema.partners.name} as p_name,
        ${schema.partners.refId} as p_ref,
        ${schema.partners.color} as p_color,
        ${sExpr} as col_status,
        ${sinceExpr} as status_since,
        ${schema.leads.createdAt} as created_at
      from leads
      -- R-65: the partner must be same-tenant, or a mis-set partner_id resolves to NULL
      -- (card reads "Unmatched") rather than surfacing another tenant's name/colour.
      -- Built from drizzle column refs + tenantWhere — the same predicate builder every
      -- other join uses — so this join can never drift from the guard (audit-tenancy F-1).
      -- It stays in the ON clause: moved to WHERE it would degrade the LEFT join and drop
      -- unmatched leads from the board entirely.
      -- C-18 (decided): like the list, this display join keeps a soft-deleted partner's
      -- name/colour on its historical leads (no deleted_at filter) — PRN-05 attribution, not
      -- routing; unmatchedCoverageMatches is the place that excludes deleted partners.
      left join partners
        on ${schema.partners.id} = coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})
       and ${tenantWhere(schema.partners, scope)}
      where ${where}
    ),
    ranked as (
      select base.*, row_number() over (partition by col_status order by status_since desc, created_at desc) as rn
      from base
    ),
    totals as (select col_status as status, count(*)::int as col_total from base group by 1)
    select totals.status as col_status, totals.col_total,
           ranked.ref_id, ranked.seller_first, ranked.seller_last, ranked.city, ranked.state,
           ranked.score_total, ranked.score_group, ranked.p_name, ranked.p_ref, ranked.p_color,
           ranked.status_since
    from totals
    -- LEFT join: a column whose requested page is past its end still reports its true
    -- total (one row, null card) instead of silently reading as empty.
    left join ranked
      on ranked.col_status = totals.status
     and ranked.rn > ${offset} and ranked.rn <= ${offset + BOARD_PAGE_SIZE}
    where totals.status in (${wantedList})
    order by totals.status, ranked.rn
  `)) as unknown as BoardRow[];

  const byStatus = new Map<string, BoardRow[]>();
  for (const r of rows) {
    const list = byStatus.get(r.col_status);
    if (list) list.push(r);
    else byStatus.set(r.col_status, [r]);
  }

  // TAG-04: one round trip for every card on the requested slice (the totals-only rows carry
  // a null ref and are skipped), keyed by ref exactly as the list does.
  const tagsByRef = await tagsByLeadRef(
    db,
    scope,
    rows.map((r) => r.ref_id).filter((v): v is string => v !== null),
  );

  return {
    columns: wanted.map((status) => {
      const own = byStatus.get(status) ?? [];
      return {
        status,
        // Every row of a column carries its true total (a status absent from `base`
        // has no row at all, so it is genuinely empty).
        total: own.length ? Number(own[0].col_total) : 0,
        page: query.page,
        cards: own
          .filter((r) => r.ref_id !== null)
          .map((r) => ({
            refId: r.ref_id!,
            seller: `${r.seller_first ?? ""} ${r.seller_last ?? ""}`.trim() || "—",
            city: r.city,
            state: r.state,
            partner: r.p_name ? { name: r.p_name, refId: r.p_ref!, color: r.p_color! } : null,
            hot: r.score_group === "hot",
            scoreTotal: r.score_total === null ? null : Number(r.score_total),
            statusSince: new Date(r.status_since!).toISOString(),
            tags: tagsByRef.get(r.ref_id!) ?? [],
          })),
      };
    }),
    pageSize: BOARD_PAGE_SIZE,
  };
}

/** Distinct lead sources (campaigns) for the filter dropdown. */
export async function listLeadSources(scope: ScopeContext): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ campaign: schema.leads.campaign })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)))
    .orderBy(schema.leads.campaign);
  return rows.map((r) => r.campaign).filter((c): c is string => Boolean(c));
}

// ── Admin lead detail (ADM) — powers the Leads dialog ────────────────────────
// Unlike the partner detail (portal/queries), this returns removed leads too and
// exposes the manual-assignment overlay + a full activity timeline. Admin scope
// sees the whole tenant; still routed through leadWhere for PRN-08.

export interface AdminLeadPartner {
  id: string;
  name: string;
  refId: string;
  color: string;
}

/** The admin timeline entry (TSK-06): the shared read-model's shape, so the admin and
 *  portal feeds carry one kind union. Kept as a named alias because this API contract has
 *  been `AdminLeadActivity` since ADM. Nothing client-side imports it — the lead dialog
 *  re-declares its own subset of the shape, per the leads-view convention, so a kind added
 *  here must be mirrored there (its `Activity` union + ACTIVITY_DOT map). */
export type AdminLeadActivity = LeadActivity;

export interface AdminLeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  campaign: string;
  notes: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  mlsStatus: "kept" | "removed";
  mlsReason: string;
  /** Derived: "Removed MLS" for removed leads, else the current workflow status. */
  status: string;
  /** Scoring (SCR) — breakdown + total for the dialog; null total when incomplete. */
  score: { total: number | null; group: ScoreGroup | null; status: ScoreStatus; breakdown: ScoreBreakdown | null };
  editable: boolean;
  receivedAt: string;
  modifiedAt: string | null;
  /** Effective owner = manual assignment if present, else pipeline routing. */
  partner: AdminLeadPartner | null;
  assignment: {
    manual: boolean;
    assignedAt: string | null;
    matchMethod: string;
    /** The exact ZIP5 or state the router matched on (leads.matched_on); null when unknown. */
    matchedOn: string | null;
    /** The pipeline-routed partner, shown when a manual assignment overrode it. */
    original: AdminLeadPartner | null;
  };
  availableStatuses: string[];
  activity: AdminLeadActivity[];
}

export async function getAdminLeadDetail(scope: ScopeContext, refId: string): Promise<AdminLeadDetail | null> {
  const db = getDb();
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(leadWhere(scope), eq(schema.leads.refId, refId), isNull(schema.leads.deletedAt)));
  if (!lead) return null;

  const effPartnerId = lead.manualPartnerId ?? lead.partnerId;
  const wantIds = [effPartnerId, lead.partnerId].filter((v): v is string => Boolean(v));
  const partnerRows = wantIds.length
    ? await db
        .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
        .from(schema.partners)
        .where(and(tenantWhere(schema.partners, scope), inArray(schema.partners.id, wantIds)))
    : [];
  const pMap = new Map(partnerRows.map((p) => [p.id, p]));
  const effPartner = effPartnerId ? pMap.get(effPartnerId) ?? null : null;
  const origPartner = lead.partnerId ? pMap.get(lead.partnerId) ?? null : null;

  const hist = await db
    .select({ status: schema.leadStatusHistory.status, at: schema.leadStatusHistory.createdAt, actor: schema.users.email })
    .from(schema.leadStatusHistory)
    // R-65 / ADR-0013 defence-in-depth: the actor join carries its own tenant predicate, so a
    // mis-set changed_by_user_id resolves to NULL (no actor) rather than surfacing another
    // tenant's email. The timeline's note/task author joins are built the same way.
    .leftJoin(schema.users, and(eq(schema.users.id, schema.leadStatusHistory.changedByUserId), tenantWhere(schema.users, scope)))
    .where(and(tenantWhere(schema.leadStatusHistory, scope), eq(schema.leadStatusHistory.leadId, lead.id)))
    .orderBy(asc(schema.leadStatusHistory.createdAt));

  let manualActor: string | null = null;
  if (lead.manualAssignedBy) {
    const [u] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, lead.manualAssignedBy)));
    manualActor = u?.email ?? null;
  }

  const workflowStatus = currentStatus(hist.map((h) => ({ status: h.status, createdAt: h.at.toISOString() })));
  const derivedStatus = lead.mlsStatus === "removed" ? "Removed MLS" : workflowStatus;

  // Build the activity timeline (newest first). All entries come from authoritative
  // columns — no reliance on the events jsonb.
  const activity: AdminLeadActivity[] = [];
  activity.push({
    kind: "imported",
    at: lead.createdAt.toISOString(),
    actor: null,
    label: lead.campaign ? `Imported · ${lead.campaign}` : "Imported",
  });
  const routedAt = (lead.firstMatchedAt ?? lead.createdAt).toISOString();
  if (lead.mlsStatus === "removed") {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: lead.mlsReason ? `Removed from MLS · ${lead.mlsReason}` : "Removed from MLS" });
  } else if (origPartner) {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: `Routed to ${origPartner.name} via ${lead.matchMethod}` });
  } else {
    activity.push({ kind: "routed", at: routedAt, actor: null, label: "Unmatched — no coverage" });
  }
  if (lead.manualAssignedAt && effPartner) {
    activity.push({
      kind: "assigned",
      at: lead.manualAssignedAt.toISOString(),
      actor: manualActor,
      label: `Assigned to ${effPartner.name}`,
    });
  }
  for (const h of hist) {
    activity.push({ kind: "status", status: h.status, at: h.at.toISOString(), actor: h.actor, label: `Status set to ${h.status}` });
  }
  // TSK-06: the admin stream's notes and tasks join the same array — scoped by
  // noteWhere/taskWhere, so the partner streams stay invisible here (PRN-13).
  activity.push(...(await noteAndTaskActivity(db, scope, lead.id)));
  sortNewestFirst(activity);

  const modifiedAt = hist.length ? hist[hist.length - 1].at : lead.manualAssignedAt;

  return {
    refId: lead.refId,
    seller: { first: lead.sellerFirst ?? "", last: lead.sellerLast ?? "", phone: lead.phone ?? "", email: lead.email ?? "" },
    address: lead.address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    zip: lead.zip ?? "",
    campaign: lead.campaign ?? "",
    notes: lead.notes ?? "",
    reasonForSelling: lead.reasonForSelling ?? "",
    motivation: lead.motivation ?? "",
    timeToSell: lead.timeToSell ?? "",
    mlsStatus: lead.mlsStatus,
    mlsReason: lead.mlsReason ?? "",
    status: derivedStatus,
    score: {
      total: lead.scoreTotal,
      group: lead.scoreGroup,
      status: lead.scoreStatus,
      breakdown: (lead.scoreBreakdown as ScoreBreakdown | null) ?? null,
    },
    editable: lead.mlsStatus === "kept",
    receivedAt: lead.createdAt.toISOString(),
    modifiedAt: modifiedAt ? modifiedAt.toISOString() : null,
    partner: effPartner,
    assignment: {
      manual: Boolean(lead.manualPartnerId),
      assignedAt: lead.manualAssignedAt ? lead.manualAssignedAt.toISOString() : null,
      matchMethod: lead.matchMethod,
      matchedOn: lead.matchedOn ?? null,
      original: lead.manualPartnerId ? origPartner : null,
    },
    availableStatuses: [...SEED_LEAD_STATUSES],
    activity,
  };
}

/** Count of currently-unmatched leads (the backlog) — drives the nav badge and
 *  the dashboard alert. Excludes leads already routed manually. */
export async function unmatchedCount(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(unmatchedWhere(scope));
  return Number(row?.n ?? 0);
}

/** Total lead count for the workspace — drives the Leads nav badge. Tenant-scoped (PRN-08),
 *  excluding soft-deleted rows to match the /leads list total (every sibling read does). */
export async function leadsCount(scope: ScopeContext): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)));
  return Number(row?.n ?? 0);
}

export interface UnmatchedStateStats {
  total: number;
  byState: { state: string; count: number }[];
}

/** Bounded per-state unmatched aggregate (F-11) — feeds the stats row + state map.
 *  Currently-unmatched only (kept, no pipeline partner, no manual overlay). The lead
 *  rows themselves come from the paginated /api/leads?partnerId=unmatched (WS-3). */
// ── Coverage backfill (S6 / ASN-03) ───────────────────────────────────────────
// "Which partner would TODAY'S coverage route each unmatched lead to?" — zip
// override first, then state rule, the same generic precedence the pipeline uses
// (ASN-02: no per-partner special-casing). Read-only derivation; assignment goes
// through the bulk-assign command's additive overlay (PRN-05).

export interface CoverageMatch {
  partnerId: string;
  refId: string;
  name: string;
  color: string;
  count: number;
}

/** The effective coverage partner per unmatched lead: live zip override (DM-06:
 *  effective_to IS NULL) beats state rule; leads nothing covers drop out. */
function coverageMatchRows(scope: ScopeContext) {
  const db = getDb();
  const zipCov = db
    .select({ zip5: schema.coverageZips.zip5, zipPartnerId: schema.coverageZips.partnerId })
    .from(schema.coverageZips)
    .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)))
    .as("zip_cov");
  const effectivePartner = sql<string>`coalesce(${zipCov.zipPartnerId}, ${schema.stateRules.partnerId})`;
  return { zipCov, effectivePartner, db };
}

/** Per-partner counts of unmatched leads their current coverage would take. */
export async function unmatchedCoverageMatches(scope: ScopeContext): Promise<CoverageMatch[]> {
  const { zipCov, effectivePartner, db } = coverageMatchRows(scope);
  const rows = await db
    .select({ partnerId: effectivePartner, count: sql<number>`count(*)::int` })
    .from(schema.leads)
    .leftJoin(zipCov, eq(zipCov.zip5, schema.leads.zip))
    .leftJoin(
      schema.stateRules,
      and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.state, sql`upper(trim(${schema.leads.state}))`)),
    )
    .where(and(unmatchedWhere(scope), sql`${effectivePartner} is not null`))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`, sql`1`);
  if (rows.length === 0) return [];
  const partners = await db
    .select({ id: schema.partners.id, refId: schema.partners.refId, name: schema.partners.name, color: schema.partners.color })
    .from(schema.partners)
    .where(
      and(
        tenantWhere(schema.partners, scope),
        inArray(schema.partners.id, rows.map((r) => r.partnerId)),
        ne(schema.partners.status, "revoked"),
        isNull(schema.partners.deletedAt),
      ),
    );
  const byId = new Map(partners.map((p) => [p.id, p]));
  // A match whose partner is no longer active/present is dropped — assignment would
  // reject it anyway (InvalidAssignTargetError), so don't offer it.
  return rows.flatMap((r) => {
    const p = byId.get(r.partnerId);
    return p ? [{ partnerId: p.id, refId: p.refId, name: p.name, color: p.color, count: Number(r.count) }] : [];
  });
}

/** The refIds of unmatched leads a specific partner's current coverage would take. */
export async function unmatchedCoverageLeadRefs(scope: ScopeContext, partnerId: string): Promise<string[]> {
  const { zipCov, effectivePartner, db } = coverageMatchRows(scope);
  const rows = await db
    .select({ refId: schema.leads.refId })
    .from(schema.leads)
    .leftJoin(zipCov, eq(zipCov.zip5, schema.leads.zip))
    .leftJoin(
      schema.stateRules,
      and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.state, sql`upper(trim(${schema.leads.state}))`)),
    )
    .where(and(unmatchedWhere(scope), sql`${effectivePartner} = ${partnerId}`))
    .orderBy(schema.leads.refId);
  return rows.map((r) => r.refId);
}

export async function unmatchedStateStats(scope: ScopeContext): Promise<UnmatchedStateStats> {
  const db = getDb();
  const rows = await db
    .select({
      state: sql<string>`coalesce(nullif(trim(upper(${schema.leads.state})), ''), '—')`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .where(unmatchedWhere(scope))
    .groupBy(sql`1`)
    .orderBy(sql`count(*) desc`, sql`1`);
  const byState = rows.map((r) => ({ state: r.state, count: Number(r.count) }));
  return { total: byState.reduce((s, r) => s + r.count, 0), byState };
}
