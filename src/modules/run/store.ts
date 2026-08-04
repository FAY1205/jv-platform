import { and, eq, ne, isNull, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { allocateRef, allocateRefBlock } from "@/db/ref-ids";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import type { RunStore, PersistRunInput, PersistRunResult } from "./process";
import type { HistoryEntry } from "../pipeline/dedupe";
import type { PartnerInfo } from "../export/render";
import type { MatchMethod } from "../pipeline/assign";

// ─────────────────────────────────────────────────────────────────────────────
// DrizzleRunStore (WP-017b) — the DB adapter behind the RunStore port. Reads go
// through the scoping guard (PRN-08); the persist runs in ONE transaction that
// first takes a per-tenant advisory lock (ING-06 serialization) so concurrent
// uploads never interleave. New leads are inserted; a lead whose dedupe_key already
// exists (previously matched, or a within-run duplicate) is NOT re-inserted —
// ON CONFLICT (tenant_id, dedupe_key) DO NOTHING preserves the one canonical row and
// its first_matched_at (PRN-05), and the export references the existing ref-id.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Admin scope for the system-triggered run (tenant-scoped reads via the guard). */
function systemScope(tenantId: string): ScopeContext {
  return { tenantId, role: "admin", userId: "00000000-0000-0000-0000-000000000000" };
}

export class DrizzleRunStore implements RunStore {
  constructor(private db: DB) {}

  async loadHistory(tenantId: string): Promise<Map<string, HistoryEntry>> {
    const scope = systemScope(tenantId);
    const rows = await this.db
      .select({
        dedupeKey: schema.leads.dedupeKey,
        partnerId: schema.leads.partnerId,
        matchMethod: schema.leads.matchMethod,
        firstMatchedAt: schema.leads.firstMatchedAt,
        phoneNorm: schema.leads.phoneNorm,
      })
      .from(schema.leads)
      .innerJoin(schema.uploads, eq(schema.leads.uploadId, schema.uploads.id))
      .where(
        and(
          tenantWhere(schema.leads, scope),
          isNull(schema.leads.deletedAt),
          ne(schema.uploads.status, "voided"), // voided runs never poison dedupe (ING-09)
        ),
      );

    const map = new Map<string, HistoryEntry>();
    for (const r of rows) {
      // The PARTIAL unique index guarantees one LIVE row per key (WP-J2), and this read filters
      // deleted_at IS NULL, so at most one row per key reaches here; keep the first seen.
      if (map.has(r.dedupeKey)) continue;
      map.set(r.dedupeKey, {
        partnerId: r.partnerId,
        matchMethod: r.matchMethod as MatchMethod,
        firstMatchedAt: r.firstMatchedAt ? r.firstMatchedAt.toISOString() : "",
        phoneNorm: r.phoneNorm ?? "",
      });
    }
    return map;
  }

  async loadPartners(tenantId: string): Promise<Map<string, PartnerInfo>> {
    const scope = systemScope(tenantId);
    const rows = await this.db
      .select({
        id: schema.partners.id,
        name: schema.partners.name,
        refId: schema.partners.refId,
        color: schema.partners.color,
      })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt)));
    return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name, refId: p.refId, color: p.color }]));
  }

  async persistRun(input: PersistRunInput): Promise<PersistRunResult> {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as PostgresJsDatabase<Record<string, unknown>>;

      // ING-06: one run at a time per tenant. The lock releases at commit/rollback.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.tenantId})::bigint)`);

      const uploadRefId = await allocateRef(txDb, input.tenantId, "upload", input.year);
      const [upload] = await tx
        .insert(schema.uploads)
        .values({
          tenantId: input.tenantId,
          refId: uploadRefId,
          filename: input.filename,
          status: "processed",
          rowCount: input.leads.length,
          rulesHash: input.rulesHash,
          rulesSnapshot: input.rulesSnapshot as object,
          sourceProfileId: input.sourceProfileId,
          sourceProfileVersion: input.sourceProfileVersion,
        })
        .returning({ id: schema.uploads.id });

      // F-08: reserve every lead ref-id in ONE counter bump and insert the NEW leads
      // in ONE multi-row statement (was N allocate + N insert round-trips under the
      // advisory lock). "New" = not previously matched and the first occurrence of its
      // dedupe key in this run — exactly the rows the old per-lead loop inserted, in the
      // same input order, so ref numbers and firstMatchedAt are assigned identically
      // (determinism preserved). An ON CONFLICT skip burns its pre-allocated number as a
      // gap, just as the single allocator did; its ref is resolved below from the row.
      const seen = new Set<string>();
      const newLeads = input.leads.filter((lead) => {
        if (lead.previouslyMatched || seen.has(lead.dedupeKey)) return false;
        seen.add(lead.dedupeKey);
        return true;
      });

      const refByKey = new Map<string, string>();
      if (newLeads.length > 0) {
        const refs = await allocateRefBlock(txDb, input.tenantId, "lead", input.year, newLeads.length);
        const values = newLeads.map((lead, i) => {
          const sep = lead.dedupeKey.lastIndexOf("|");
          return {
            tenantId: input.tenantId,
            refId: refs[i],
            uploadId: upload.id,
            dedupeKey: lead.dedupeKey,
            rawJson: lead.rawJson,
            campaign: lead.campaign,
            dateCreated: lead.dateCreated,
            notes: lead.notes,
            address: lead.address,
            addressNormalized: sep >= 0 ? lead.dedupeKey.slice(0, sep) : lead.dedupeKey,
            city: lead.city,
            state: lead.state,
            zip: lead.zip,
            sellerFirst: lead.sellerFirst,
            sellerLast: lead.sellerLast,
            phone: lead.phone,
            phoneNorm: lead.phoneNorm,
            email: lead.email,
            reasonForSelling: lead.reasonForSelling,
            motivation: lead.motivation,
            timeToSell: lead.timeToSell,
            partnerId: lead.partnerId,
            matchMethod: lead.matchMethod,
            mlsStatus: lead.mlsStatus,
            mlsReason: lead.mlsReason,
            mlsPatternKey: lead.mlsPatternKey,
            mlsMatchSpan: lead.mlsMatchSpan,
            previouslyMatched: false,
            firstMatchedAt: new Date(lead.firstMatchedAt),
            possibleMlsListing: lead.possibleMlsListing,
            scoreTotal: lead.scoreTotal,
            scoreGroup: lead.scoreGroup,
            scoreStatus: lead.scoreStatus,
            scoreBreakdown: lead.scoreBreakdown,
          };
        });
        const inserted = await tx
          .insert(schema.leads)
          .values(values)
          // The (tenant, dedupe_key) unique index is PARTIAL (WHERE deleted_at IS NULL, WP-J2 /
          // DM-09) so a voided run's soft-deleted key can be re-uploaded; the ON CONFLICT arbiter
          // must name the same predicate to match that partial index.
          .onConflictDoNothing({
            target: [schema.leads.tenantId, schema.leads.dedupeKey],
            where: sql`${schema.leads.deletedAt} is null`,
          })
          .returning({ refId: schema.leads.refId, dedupeKey: schema.leads.dedupeKey });
        for (const r of inserted) refByKey.set(r.dedupeKey, r.refId);
      }

      // Resolve ref-ids for previously-matched (and any conflicted) keys from existing rows.
      const unresolved = [...new Set(input.leads.map((l) => l.dedupeKey).filter((k) => !refByKey.has(k)))];
      if (unresolved.length > 0) {
        const existing = await tx
          .select({ dedupeKey: schema.leads.dedupeKey, refId: schema.leads.refId })
          .from(schema.leads)
          // Resolve to the LIVE row (a soft-deleted voided-run row may share the key, WP-J2).
          .where(and(eq(schema.leads.tenantId, input.tenantId), inArray(schema.leads.dedupeKey, unresolved), isNull(schema.leads.deletedAt)));
        for (const e of existing) refByKey.set(e.dedupeKey, e.refId);
      }

      return {
        uploadId: upload.id,
        uploadRefId,
        leadRefIds: input.leads.map((l) => refByKey.get(l.dedupeKey) ?? ""),
      };
    });
  }
}
