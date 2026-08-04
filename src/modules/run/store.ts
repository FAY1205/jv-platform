import { and, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { allocateRef, allocateRefBlock } from "@/db/ref-ids";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import type { RunStore, PersistRunInput, PersistRunResult } from "./process";
import type { PartnerInfo } from "../export/render";

// ─────────────────────────────────────────────────────────────────────────────
// DrizzleRunStore (WP-017b) — the DB adapter behind the RunStore port. Reads go
// through the scoping guard (PRN-08); the persist runs in ONE transaction that
// first takes a per-tenant advisory lock (ING-06 serialization) so concurrent
// uploads never interleave. Every lead row is inserted (ADR-0038: dedup collapse
// retired — repeats are ordinary leads; dedupe_key is stored for grouping only).
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Admin scope for the system-triggered run (tenant-scoped reads via the guard). */
function systemScope(tenantId: string): ScopeContext {
  return { tenantId, role: "admin", userId: "00000000-0000-0000-0000-000000000000" };
}

export class DrizzleRunStore implements RunStore {
  constructor(private db: DB) {}

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
          contentHash: input.contentHash,
        })
        .returning({ id: schema.uploads.id });

      // F-08: reserve every lead ref-id in ONE counter bump and insert all leads in ONE
      // multi-row statement. ADR-0038: no dedup filter — every input row is a lead.
      const leadRefIds: string[] = [];
      if (input.leads.length > 0) {
        const refs = await allocateRefBlock(txDb, input.tenantId, "lead", input.year, input.leads.length);
        leadRefIds.push(...refs);
        const values = input.leads.map((lead, i) => {
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
            matchedOn: lead.matchedOn,
            mlsStatus: lead.mlsStatus,
            mlsReason: lead.mlsReason,
            mlsPatternKey: lead.mlsPatternKey,
            mlsMatchSpan: lead.mlsMatchSpan,
            firstMatchedAt: new Date(lead.firstMatchedAt),
            possibleMlsListing: lead.possibleMlsListing,
            scoreTotal: lead.scoreTotal,
            scoreGroup: lead.scoreGroup,
            scoreStatus: lead.scoreStatus,
            scoreBreakdown: lead.scoreBreakdown,
          };
        });
        await tx.insert(schema.leads).values(values);
      }

      return {
        uploadId: upload.id,
        uploadRefId,
        leadRefIds,
      };
    });
  }
}
