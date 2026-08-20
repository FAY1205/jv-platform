import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { TagNotFoundError, tagWhere } from "@/modules/tags/tags";
import { InvalidAssignTargetError } from "./commands";
import { leadsFilterConds, statusExpr } from "./queries";
import { BULK_SKIPPED_REFS_MAX, canonicalBulkFilters, type BulkSelection } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 — the bulk write resolvers (N6-10..15, N6-20..23, N6-30..33).
//
// Three rules hold across all three, and they are why this is one module rather than three
// additions to `commands.ts`:
//
//  1. ONE definition of "selected". A `refs` selection is an explicit bounded id list; a
//     `filter` selection is re-resolved server-side through `leadsFilterConds` — the SAME
//     predicate the list endpoint used to produce the count the operator read (PRN-15). The
//     filter arm NEVER materializes an id list before the write: the predicate goes straight
//     into the UPDATE/INSERT…SELECT/DELETE and the write reports back via RETURNING.
//  2. NOTHING is silent. Every selected lead is either applied or counted under a named skip
//     reason, and `applied + Σ skipped === total`. Refs that resolve to nothing in scope are
//     `notFound` — a foreign-tenant ref and a deleted ref are indistinguishable from the
//     outside, which is the point (PRN-08).
//  3. A dry run performs ZERO writes. The confirm dialogs render the server's numbers, so
//     the dialog cannot promise a different set than the execute touches. The census below
//     is the dry run — the execute path runs the same census and then writes.
// ─────────────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/** Every reason a selected lead can be skipped. The union is closed on purpose: a new reason
 *  is a contract change the client's "View skipped" grouping must learn about. */
export type BulkSkipReason =
  | "notFound"
  | "removedMls"
  | "alreadyAssigned"
  | "alreadyAtStatus"
  | "alreadyTagged"
  | "notTagged";

export type BulkSkips = Partial<Record<BulkSkipReason, number>>;

/**
 * One enumerated skip. The REASON travels with the ref because the "View skipped" dialog
 * groups by it (N6-55) — a bare `string[]` would force the client to re-derive why each ref
 * was skipped, which it cannot do without asking the server again.
 */
export interface BulkSkippedRef {
  ref: string;
  reason: BulkSkipReason;
}

/** N6-05 — the zero-write resolution the confirm dialogs render. */
export interface BulkDryRun {
  dryRun: true;
  total: number;
  eligible: number;
  skipped: BulkSkips;
}

/** N6-06 — the true split of an executed run. `skippedRefs` is bounded; the counts are exact. */
export interface BulkApplied {
  dryRun: false;
  total: number;
  applied: number;
  skipped: BulkSkips;
  skippedRefs: BulkSkippedRef[];
}

export type BulkOutcome = BulkDryRun | BulkApplied;

/** The sentinel `reasonExpr` returns for a lead the write will touch. */
const ELIGIBLE = "eligible";

function bump(skips: BulkSkips, reason: BulkSkipReason): void {
  skips[reason] = (skips[reason] ?? 0) + 1;
}

function totalSkipped(skips: BulkSkips): number {
  return Object.values(skips).reduce((a, b) => a + b, 0);
}

/**
 * The WHERE conjuncts that define "the selected leads", for either mode. Always includes the
 * tenant pin and the soft-delete exclusion — a caller cannot compose this and lose the scope
 * half, because the scope half is not separable (PRN-08).
 */
function selectionConds(scope: ScopeContext, selection: BulkSelection): SQL[] {
  if (selection.mode === "filter") return leadsFilterConds(scope, canonicalBulkFilters(selection.filters));
  return [
    tenantWhere(schema.leads, scope),
    isNull(schema.leads.deletedAt) as unknown as SQL,
    inArray(schema.leads.refId, dedupeRefs(selection)),
  ];
}

/** A hand-built selection can repeat a ref (two pages, one lead). Counting it twice would
 *  inflate every number the confirm dialog shows. */
function dedupeRefs(selection: Extract<BulkSelection, { mode: "refs" }>): string[] {
  return [...new Set(selection.leadRefs)];
}

interface Census {
  total: number;
  eligible: number;
  skipped: BulkSkips;
  skippedRefs: BulkSkippedRef[];
}

/**
 * Resolve the selection into applied-vs-skipped WITHOUT writing anything. `reasonExpr` is the
 * per-lead verdict — `'eligible'` or a `BulkSkipReason` — and it is the ONLY place an
 * action's eligibility rule is spelled out, so the dry run, the skip report and the write's
 * own predicate can never disagree about who is in.
 *
 * The two modes take different shapes for a reason. `refs` is bounded at 200, so one pass
 * over the resolved rows answers everything including which requested refs resolved to
 * nothing. `filter` can match an unbounded set (owner A4: no artificial ceiling), so it takes
 * a GROUP BY for the counts plus a bounded second pass for the enumerable refs.
 */
async function censusOf(
  tx: Tx,
  selection: BulkSelection,
  base: SQL[],
  reasonExpr: SQL<string>,
  wantRefs: boolean,
): Promise<Census> {
  const where = and(...base);
  const skipped: BulkSkips = {};
  const skippedRefs: BulkSkippedRef[] = [];
  const note = (ref: string, reason: BulkSkipReason) => {
    bump(skipped, reason);
    if (wantRefs && skippedRefs.length < BULK_SKIPPED_REFS_MAX) skippedRefs.push({ ref, reason });
  };

  if (selection.mode === "refs") {
    const rows = await tx
      .select({ refId: schema.leads.refId, reason: reasonExpr })
      .from(schema.leads)
      .where(where)
      .orderBy(schema.leads.refId);
    let eligible = 0;
    for (const r of rows) {
      if (r.reason === ELIGIBLE) eligible += 1;
      else note(r.refId, r.reason as BulkSkipReason);
    }
    // A requested ref that resolved to no row is `notFound` — out of tenant, recalled, or
    // never existed. Which one is deliberately not distinguished (PRN-08).
    const seen = new Set(rows.map((r) => r.refId));
    for (const ref of dedupeRefs(selection)) {
      if (!seen.has(ref)) note(ref, "notFound");
    }
    return { total: eligible + totalSkipped(skipped), eligible, skipped, skippedRefs };
  }

  const counts = await tx
    .select({ reason: reasonExpr, n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(where)
    // GROUP BY the ORDINAL, not the expression. Re-rendering `reasonExpr` here would emit a
    // second copy with FRESH bind placeholders ($4/$5 rather than $1/$2), and Postgres matches
    // a grouped expression structurally — two different placeholders are two different
    // expressions, so the select item reads as ungrouped and the query is rejected.
    .groupBy(sql`1`);
  let eligible = 0;
  for (const row of counts) {
    const n = Number(row.n);
    if (row.reason === ELIGIBLE) eligible += n;
    else skipped[row.reason as BulkSkipReason] = (skipped[row.reason as BulkSkipReason] ?? 0) + n;
  }
  if (wantRefs && totalSkipped(skipped) > 0) {
    const rows = await tx
      .select({ refId: schema.leads.refId, reason: reasonExpr })
      .from(schema.leads)
      .where(and(where, sql`${reasonExpr} <> ${ELIGIBLE}`))
      .orderBy(schema.leads.refId)
      .limit(BULK_SKIPPED_REFS_MAX);
    skippedRefs.push(...rows.map((r) => ({ ref: r.refId, reason: r.reason as BulkSkipReason })));
  }
  return { total: eligible + totalSkipped(skipped), eligible, skipped, skippedRefs };
}

function dryRunOf(c: Census): BulkDryRun {
  return { dryRun: true, total: c.total, eligible: c.eligible, skipped: c.skipped };
}

// ── Bulk assign (N6-10..15) ───────────────────────────────────────────────────

export interface BulkAssignArgs {
  selection: BulkSelection;
  partnerId: string;
  dryRun?: boolean;
}

export interface BulkAssignOutcome {
  outcome: BulkOutcome;
  /** The SERVER-RESOLVED destination — the only value a notify fan-out may address
   *  (PRN-08a; the audit-tenancy rule from WP-NF1: never echo the request body's id). */
  assignedPartnerId: string;
  partnerRefId: string;
  partnerName: string;
  /** The ONE assigned ref when exactly one lead moved, else null (N6-15: a single assign
   *  keeps the per-lead deep-link notification; a batch gets the one summary). Never the whole
   *  list — an escalated run can move tens of thousands of leads. */
  appliedRef: string | null;
}

/**
 * N6-10 — full transfer (owner A1), generalizing `bulkAssignLeads`' unmatched-only rule.
 * Eligible = kept, not soft-deleted, and the EFFECTIVE owner (`manual_partner_id ??
 * partner_id`) is not already the destination. The write touches ONLY the additive manual
 * overlay: `leads.partner_id` and `leads.match_method` are the import snapshot and are never
 * rewritten (PRN-05).
 */
export async function bulkAssign(scope: ScopeContext, args: BulkAssignArgs): Promise<BulkAssignOutcome> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // N6-11: the destination is re-resolved under the tenant predicate inside the
    // transaction — the body carries a hint, never an authorization.
    const [partner] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId, name: schema.partners.name })
      .from(schema.partners)
      .where(
        and(
          tenantWhere(schema.partners, scope),
          eq(schema.partners.id, args.partnerId),
          ne(schema.partners.status, "revoked"),
          isNull(schema.partners.deletedAt),
        ),
      );
    if (!partner) throw new InvalidAssignTargetError();

    const base = selectionConds(scope, args.selection);
    const effectiveOwner = sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`;
    const reason = sql<string>`case
      when ${schema.leads.mlsStatus} <> 'kept' then 'removedMls'
      when ${effectiveOwner} = ${partner.id}::uuid then 'alreadyAssigned'
      else ${ELIGIBLE} end`;

    const identity = { assignedPartnerId: partner.id, partnerRefId: partner.refId, partnerName: partner.name };
    const census = await censusOf(tx, args.selection, base, reason, !args.dryRun);
    if (args.dryRun) return { outcome: dryRunOf(census), ...identity, appliedRef: null };

    if (census.eligible === 0) {
      return {
        outcome: { dryRun: false as const, total: census.total, applied: 0, skipped: census.skipped, skippedRefs: census.skippedRefs },
        ...identity,
        appliedRef: null,
      };
    }

    // N6-12: set-based, with RETURNING. The eligibility predicate is re-stated here rather
    // than derived from the census rows — that is what keeps the filter mode free of a
    // client-side id list, and it doubles as the race guard (a lead someone else just moved
    // simply falls out of the UPDATE).
    const assigned = await tx
      .update(schema.leads)
      .set({ manualPartnerId: partner.id, manualAssignedAt: new Date(), manualAssignedBy: scope.userId })
      .where(
        and(
          ...base,
          eq(schema.leads.mlsStatus, "kept"),
          sql`${effectiveOwner} is distinct from ${partner.id}::uuid`,
        ),
      )
      .returning({ refId: schema.leads.refId, state: schema.leads.state, zip: schema.leads.zip });

    if (assigned.length > 0) {
      // N6-13: the EXISTING per-lead audit shape, unchanged — same no-free-text payload as
      // the single and legacy-bulk assigns (owner decision 2026-07-15), flagged `bulk`.
      await tx.insert(schema.auditLog).values(
        assigned.map((l) => ({
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: "lead.manually_assigned",
          entityType: "lead",
          entityRef: l.refId,
          before: { partnerId: null, state: l.state, zip: l.zip },
          after: { manualPartnerId: partner.id, partnerRefId: partner.refId, bulk: true },
          traceId: globalThis.crypto.randomUUID(),
        })),
      );
    }

    return {
      outcome: {
        dryRun: false as const,
        total: census.total,
        applied: assigned.length,
        skipped: census.skipped,
        skippedRefs: census.skippedRefs,
      },
      ...identity,
      appliedRef: assigned.length === 1 ? assigned[0].refId : null,
    };
  });
}

// ── Bulk status (N6-20..23) ───────────────────────────────────────────────────

export interface BulkStatusArgs {
  selection: BulkSelection;
  status: string;
  dryRun?: boolean;
}

/**
 * N6-21/N6-22 — the set-based mirror of `updateLeadStatus`. Eligible = kept, not
 * soft-deleted, and the lead's CURRENT derived status differs from the target: the same
 * idempotency `changed:false` expresses per lead, so a re-run at the same status writes zero
 * history rows. "Current" is the ADMIN derivation (`statusExpr` — unscoped latest by
 * `created_at desc, id desc`, missing history coalesced to 'New'), so this endpoint and the
 * list column can never disagree about what a lead's status is.
 *
 * Removed-MLS leads are skipped and reported, never written — the set-based form of the
 * `LeadRemovedError` refusal (PRN-04-adjacent). Assignment columns are untouched (PRN-05).
 * N6-23: no notifications, matching the admin single-lead status route.
 */
export async function bulkStatus(scope: ScopeContext, args: BulkStatusArgs): Promise<BulkOutcome> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const base = selectionConds(scope, args.selection);
    const current = statusExpr(scope);
    const reason = sql<string>`case
      when ${schema.leads.mlsStatus} <> 'kept' then 'removedMls'
      when ${current} = ${args.status} then 'alreadyAtStatus'
      else ${ELIGIBLE} end`;

    const census = await censusOf(tx, args.selection, base, reason, !args.dryRun);
    if (args.dryRun) return dryRunOf(census);
    if (census.eligible === 0) {
      return { dryRun: false, total: census.total, applied: 0, skipped: census.skipped, skippedRefs: census.skippedRefs };
    }

    // One INSERT … SELECT over the eligible set — no id list crosses into JS before the
    // write. Raw SQL because drizzle's insert builder has no INSERT…SELECT form; the scope
    // fragments render the `leads` TABLE name, so the source table must stay UNALIASED.
    const inserted = (await tx.execute(sql`
      insert into lead_status_history (tenant_id, lead_id, status, changed_by_user_id)
      select ${schema.leads.tenantId}, ${schema.leads.id}, ${args.status}, ${scope.userId}::uuid
      from leads
      where ${and(...base, eq(schema.leads.mlsStatus, "kept"), sql`${current} <> ${args.status}`)}
      returning id
    `)) as unknown as { id: string }[];

    return {
      dryRun: false,
      total: census.total,
      applied: inserted.length,
      skipped: census.skipped,
      skippedRefs: census.skippedRefs,
    };
  });
}

// ── Bulk tags (N6-30..33) ─────────────────────────────────────────────────────

export interface BulkTagsArgs {
  selection: BulkSelection;
  op: "add" | "remove";
  tagId: string;
  dryRun?: boolean;
}

export interface BulkTagsOutcome {
  outcome: BulkOutcome;
  tagName: string;
}

/**
 * N6-30/N6-31 — attach or detach one tag across the selection. Leads of ANY MLS status are
 * taggable: the per-lead attach never gated on status either, and a label is filing, not a
 * workflow transition. Both arms are set-based and idempotent by construction (`on conflict
 * do nothing` / a DELETE that matches nothing), so the skip counts fall out of the row
 * counts rather than a second opinion.
 */
export async function bulkTags(scope: ScopeContext, args: BulkTagsArgs): Promise<BulkTagsOutcome> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // N6-30: the tag is resolved under `tagWhere` FIRST — a tag id from another tenant simply
    // does not resolve, exactly as `attachTag` treats it (TAG-02).
    const [tag] = await tx
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(and(tagWhere(scope), eq(schema.tags.id, args.tagId)));
    if (!tag) throw new TagNotFoundError(args.tagId);

    const base = selectionConds(scope, args.selection);
    // Aliased (`lt`) and written in raw column names: the outer query already carries an
    // UNALIASED `lead_tags` subquery when the selection filters by tag (`taggedWithAny`), and
    // two unaliased copies in one statement would be needlessly hard to read.
    const carries = sql`exists (
      select 1 from lead_tags lt
      where lt.lead_id = ${schema.leads.id}
        and lt.tag_id = ${tag.id}::uuid
        and lt.tenant_id = ${scope.tenantId}::uuid
    )`;
    const reason =
      args.op === "add"
        ? sql<string>`case when ${carries} then 'alreadyTagged' else ${ELIGIBLE} end`
        : sql<string>`case when ${carries} then ${ELIGIBLE} else 'notTagged' end`;

    const census = await censusOf(tx, args.selection, base, reason, !args.dryRun);
    if (args.dryRun) return { outcome: dryRunOf(census), tagName: tag.name };

    const rows =
      args.op === "add"
        ? ((await tx.execute(sql`
            insert into lead_tags (tenant_id, lead_id, tag_id, added_by_user_id)
            select ${schema.leads.tenantId}, ${schema.leads.id}, ${tag.id}::uuid, ${scope.userId}::uuid
            from leads
            where ${and(...base)}
            on conflict (lead_id, tag_id) do nothing
            returning id
          `)) as unknown as { id: string }[])
        : ((await tx.execute(sql`
            delete from lead_tags
            where ${tenantWhere(schema.leadTags, scope)}
              and ${schema.leadTags.tagId} = ${tag.id}::uuid
              and ${schema.leadTags.leadId} in (select ${schema.leads.id} from leads where ${and(...base)})
            returning id
          `)) as unknown as { id: string }[]);

    const applied = rows.length;
    // N6-31: skips derived from the ROW COUNTS, so `applied + Σ skipped === total` holds by
    // arithmetic rather than by two queries happening to agree. `notFound` is a property of
    // the SELECTION rather than of the write, so it carries over from the census verbatim and
    // the remainder is the one write-side reason this op can have.
    const skipped: BulkSkips = {};
    const notFound = census.skipped.notFound ?? 0;
    if (notFound > 0) skipped.notFound = notFound;
    const missed = census.total - applied - notFound;
    if (missed > 0) skipped[args.op === "add" ? "alreadyTagged" : "notTagged"] = missed;

    if (applied > 0) {
      // N6-32: ONE summary row per run, not one per lead — the `deleteTag` `{detached: n}`
      // precedent. A bulk labelling gesture over thousands of leads would otherwise flood the
      // append-only trail with rows nobody reads; WHO relabelled HOW MANY leads with WHICH
      // tag, and when, is the audit-relevant part. Deliberate divergence from the per-lead
      // `tag.attached` / `tag.detached` entries the single-lead path writes.
      await tx.insert(schema.auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: scope.userId,
        action: "lead.tags_bulk",
        entityType: "tag",
        entityRef: tag.id,
        before: null,
        // Plain, not masked: a tag name is a workflow label an operator typed, not seller
        // PII (the tags module header).
        after: { op: args.op, tagId: tag.id, name: tag.name, count: applied },
        traceId: globalThis.crypto.randomUUID(),
      });
    }

    return {
      outcome: { dryRun: false, total: census.total, applied, skipped, skippedRefs: census.skippedRefs },
      tagName: tag.name,
    };
  });
}
