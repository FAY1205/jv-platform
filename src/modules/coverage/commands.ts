import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { diffPartnerCoverage } from "./diff";
import { PartnerNotFoundError } from "../partners/commands";

// ─────────────────────────────────────────────────────────────────────────────
// Per-partner coverage entry (CVG-01). The owner types the ZIPs (and states) a
// partner covers; this applies the entry as that partner's COMPLETE set. ZIP
// coverage is versioned (DM-06): changed current rows are closed (effective_to)
// and new rows opened — history is never edited (DM-08). State rules aren't
// versioned in the schema — they're upserted/deleted in place. PRN-05: existing
// lead assignments are untouched; only future runs change. Every apply is audited.
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageChange {
  addedZips: number;
  reassignedZips: number;
  removedZips: number;
  statesSet: number;
  removedStates: number;
}

export async function setPartnerCoverage(
  scope: ScopeContext,
  partnerId: string,
  input: { zips: string[]; states: string[] },
): Promise<CoverageChange> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [partner] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId), isNull(schema.partners.deletedAt)));
    if (!partner) throw new PartnerNotFoundError();

    const now = new Date();

    // ── ZIP coverage (versioned) ──
    const currentRows = await tx
      .select({ zip5: schema.coverageZips.zip5, partnerId: schema.coverageZips.partnerId })
      .from(schema.coverageZips)
      .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)));
    const currentMap = new Map(currentRows.map((r) => [r.zip5, r.partnerId] as const));
    const zdiff = diffPartnerCoverage(input.zips, currentMap, partnerId);

    const toClose = [...zdiff.remove, ...zdiff.reassign.map((r) => r.zip)];
    const toInsert = [...zdiff.add, ...zdiff.reassign.map((r) => r.zip)];

    // Next version per affected zip = max existing version (incl. closed) + 1.
    const maxVer = new Map<string, number>();
    const affected = [...new Set([...toClose, ...toInsert])];
    if (affected.length > 0) {
      const vrows = await tx
        .select({ zip5: schema.coverageZips.zip5, v: sql<number>`max(${schema.coverageZips.version})` })
        .from(schema.coverageZips)
        .where(and(tenantWhere(schema.coverageZips, scope), inArray(schema.coverageZips.zip5, affected)))
        .groupBy(schema.coverageZips.zip5);
      for (const r of vrows) maxVer.set(r.zip5, Number(r.v));
    }

    if (toClose.length > 0) {
      await tx
        .update(schema.coverageZips)
        .set({ effectiveTo: now })
        .where(and(tenantWhere(schema.coverageZips, scope), inArray(schema.coverageZips.zip5, toClose), isNull(schema.coverageZips.effectiveTo)));
    }
    for (const zip of toInsert) {
      await tx.insert(schema.coverageZips).values({
        tenantId: scope.tenantId,
        zip5: zip,
        partnerId,
        version: (maxVer.get(zip) ?? 0) + 1,
        effectiveFrom: now,
        effectiveTo: null,
      });
    }

    // ── State rules (upsert to this partner; drop this partner's omitted states) ──
    const curStates = await tx
      .select({ state: schema.stateRules.state, partnerId: schema.stateRules.partnerId })
      .from(schema.stateRules)
      .where(tenantWhere(schema.stateRules, scope));
    for (const st of input.states) {
      await tx
        .insert(schema.stateRules)
        .values({ tenantId: scope.tenantId, state: st, partnerId })
        .onConflictDoUpdate({ target: [schema.stateRules.tenantId, schema.stateRules.state], set: { partnerId } });
    }
    const enteredStates = new Set(input.states);
    const removeStates = curStates.filter((r) => r.partnerId === partnerId && !enteredStates.has(r.state)).map((r) => r.state);
    if (removeStates.length > 0) {
      await tx
        .delete(schema.stateRules)
        .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId), inArray(schema.stateRules.state, removeStates)));
    }

    const change: CoverageChange = {
      addedZips: zdiff.add.length,
      reassignedZips: zdiff.reassign.length,
      removedZips: zdiff.remove.length,
      statesSet: input.states.length,
      removedStates: removeStates.length,
    };

    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "partner.coverage_updated",
      entityType: "partner",
      entityRef: partner.refId,
      before: { currentZips: currentRows.filter((r) => r.partnerId === partnerId).length },
      after: change as unknown as Record<string, unknown>,
      traceId: globalThis.crypto.randomUUID(),
    });

    return change;
  });
}
